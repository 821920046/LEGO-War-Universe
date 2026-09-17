import assets from '../../02_Assets/assets.json';
import profiles from '../../02_Assets/model-profiles.json';
import { createRegistry } from '../../src/domain/registry.js';
import { planFilm } from '../../src/domain/planner.js';
import { compileShot } from '../../src/domain/compiler.js';
import { checkContentGovernance } from '../../src/domain/governance.js';

const registry = createRegistry(assets, profiles, { references: [] });
const allowed = new Set(['theme', 'projectId', 'assetManifestVersion', 'mode', 'requestedShots', 'rhythm', 'profileId']);

// 简易滑动窗口限流状态
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

function checkRateLimit(clientId) {
    const now = Date.now();
    let record = rateLimits.get(clientId);
    if (!record || (now - record.windowStart) > RATE_LIMIT_WINDOW_MS) {
        record = { count: 0, windowStart: now };
    }
    record.count++;
    rateLimits.set(clientId, record);

    if (record.count > RATE_LIMIT_MAX) {
        const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - record.windowStart);
        return { limited: true, retryAfterMs };
    }
    return { limited: false };
}

// 简单的哈希函数用于生成12位 themeHash
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(12, '0').slice(0, 12);
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { 
    status, 
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } 
});

function cors(request, env) {
    const origin = request.headers.get('origin');
    const expected = env.ALLOWED_ORIGIN;
    return origin && expected && origin === expected ? { 'access-control-allow-origin': origin, 'vary': 'Origin' } : {};
}

function auth(request, env) {
    if (env.ENVIRONMENT !== 'production' && env.AUTH_MODE === 'disabled') return { ok: true, clientId: 'development' };
    if (env.AUTH_MODE === 'access' && request.headers.get('cf-access-authenticated-user-email')) return { ok: true, clientId: request.headers.get('cf-access-authenticated-user-email') };
    return { ok: false };
}

export async function onRequest({ request, env }) {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const headers = cors(request, env);

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: { ...headers, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname.endsWith('/health')) {
        return json({ ready: true, requestId }, 200, headers);
    }

    if (request.method !== 'POST') {
        return json({ error: 'METHOD_NOT_ALLOWED', requestId }, 405, headers);
    }

    const identity = auth(request, env);
    if (!identity.ok) {
        return json({ error: 'AUTH_REQUIRED', requestId }, 401, headers);
    }

    const clientId = identity.clientId || 'unknown';

    // 2. 简易滑动窗口限流
    const rl = checkRateLimit(clientId);
    if (rl.limited) {
        return json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs, requestId }, 429, headers);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'INVALID_JSON', requestId }, 400, headers);
    }

    if (!body || Object.keys(body).some(key => !allowed.has(key))) {
        return json({ error: 'UNSUPPORTED_REQUEST_FIELD', requestId }, 400, headers);
    }

    if (typeof body.theme !== 'string' || !body.theme.trim()) {
        return json({ error: 'MISSING_THEME', requestId }, 400, headers);
    }

    const themeHash = simpleHash(body.theme);

    // 1. 内容治理前置拦截
    const govResult = checkContentGovernance(body.theme);

    if (govResult.status === 'blocked') {
        const latencyMs = Date.now() - startTime;
        console.log(JSON.stringify({
            audit: true, requestId, timestamp: new Date().toISOString(), clientId,
            themeHash, safetyStatus: govResult.status, shotCount: 0, latencyMs, outcome: 'blocked'
        }));
        return json({ error: 'CONTENT_BLOCKED', flags: govResult.flags, reasons: govResult.reasons, requestId }, 403, headers);
    }

    const profileId = body.profileId || 'veo-3.1-lite';

    try {
        const { intent, plan, warnings, governance } = planFilm({ theme: body.theme, requestedShots: body.requestedShots || 1, profileId }, registry);
        const result = plan.shots.map(shot => ({ ...shot, ...compileShot(shot, registry, registry.profileById.get(profileId)) }));
        
        const latencyMs = Date.now() - startTime;
        const responseBody = { ok: true, requestId, intent, warnings, profileId, shots: result };
        
        // 4. 保持现有功能兼容，透传 governance
        if (governance) {
            responseBody.governance = governance;
        }

        // 如果状态是 review_required，添加标记
        if (govResult.status === 'review_required') {
            responseBody.reviewRequired = true;
            responseBody.flags = govResult.flags;
            responseBody.reasons = govResult.reasons;
        }

        // 3. 审计日志
        console.log(JSON.stringify({
            audit: true, requestId, timestamp: new Date().toISOString(), clientId,
            themeHash, safetyStatus: govResult.status, shotCount: result.length, latencyMs, outcome: 'success'
        }));

        return json(responseBody, 200, headers);
    } catch (err) {
        const latencyMs = Date.now() - startTime;
        console.log(JSON.stringify({
            audit: true, requestId, timestamp: new Date().toISOString(), clientId,
            themeHash, safetyStatus: govResult.status, shotCount: 0, latencyMs, outcome: 'error'
        }));
        return json({ error: 'PLANNING_FAILED', requestId }, 422, headers);
    }
}
