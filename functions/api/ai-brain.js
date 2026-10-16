/**
 * LEGO War Universe - 后台免费大模型统一调度中枢 (/api/ai-brain)
 * 功能：
 * 1. 后端集中托管 Groq / OpenRouter / Gemini 等免费大模型 API Key，前端免配置开箱即用
 * 2. 具备多通道自动故障转移 (Failover Engine)：Groq -> OpenRouter -> Gemini -> 本地离线引擎
 * 3. 严格审计与速率限制保护
 */

import { transpileMovieToLego, matchCuratedFilm } from '../../src/domain/cinema-homage.js';
import { generateLocally, OFFLINE_ENGINES } from '../../src/domain/local-engine.js';
import { alignShotsToLego } from '../../src/domain/lego-aligner.js';
import { checkContentGovernance } from '../../src/domain/governance.js';
import { parseIntent } from '../../src/domain/intent.js';
import { hasHostileFraming } from '../../src/domain/shot-spec.js';
import { buildAssetCatalog, formatCatalogForPrompt, collectValidIds, resolveShotAssets } from '../../src/domain/asset-catalog.js';
import { assets as ASSET_REGISTRY } from '../../src/domain/assets-data.js';
import { createRegistry } from '../../src/domain/registry.js';
import { selectCast, buildRoster, rosterToJSON, rosterPromptLines } from '../../src/domain/roster.js';
import { diversifyShots, tagDramaticFunctions } from '../../src/domain/narrative.js';

/**
 * 后端侧的资产注册表。
 *
 * 存在的意义：后台必须和前端用**同一套算法**从资产库里挑演员并分配代号，
 * 否则「大模型脚本里的角色」与「前端定妆表里的角色」会对不上。
 * 这里只依赖 byId / byKind，因此用一个占位 profile 即可。
 */
const REGISTRY = (() => {
  try {
    return createRegistry(ASSET_REGISTRY, { profiles: [{ id: '__backend__', durations: [8], aspectRatios: ['9:16'] }] });
  } catch (err) {
    console.warn('后端资产注册表构建失败，将退化为无阵容模式:', err?.message);
    return null;
  }
})();

// 简易限流配置
// 注意：Cloudflare Workers 的模块级 Map 只在单个 isolate 内有效，且随时可能被回收，
// 因此这里只是「尽力而为」的单点保护，不能当作严格的配额系统。
// 更重要的是必须定期清理过期条目：早期实现只增不删，任何访问过的 IP 都会永久驻留，
// 构成明确的内存泄漏 / 内存耗尽型 DoS 面。
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_MAX_TRACKED = 5000;
let lastSweep = 0;

function sweepExpired(now) {
  for (const [key, record] of rateLimits) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) rateLimits.delete(key);
  }
  lastSweep = now;
}

// now 参数是给测试用的时钟探针：窗口轮转（60s）不可能在测试里真的等，
// 没有这个探针，「过期后计数重置」这条行为就是不可测的。
export function checkRateLimit(clientId, now = Date.now()) {

  // 周期性清理 + 容量硬上限，双重保证 Map 不会无界增长
  if (now - lastSweep > RATE_LIMIT_WINDOW_MS) sweepExpired(now);
  if (rateLimits.size > RATE_LIMIT_MAX_TRACKED) sweepExpired(now);
  if (rateLimits.size > RATE_LIMIT_MAX_TRACKED) {
    // 极端情况下（全部条目都在窗口内）丢弃最早写入的一批，保住 isolate 内存
    const overflow = rateLimits.size - RATE_LIMIT_MAX_TRACKED;
    let dropped = 0;
    for (const key of rateLimits.keys()) {
      if (dropped++ >= overflow) break;
      rateLimits.delete(key);
    }
  }

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

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  }
});

function cors(request, env = {}) {
  const origin = request.headers.get('origin');
  const expected = env.ALLOWED_ORIGIN;
  // Same-origin requests need no CORS header. Cross-origin callers are allowed only
  // when they exactly match the configured deployment origin; never fall back to '*'.
  if (origin && expected && origin === expected) {
    return { 'access-control-allow-origin': origin, 'vary': 'Origin' };
  }
  return {};
}

// ── AI 可用性诊断（6.8.4）────────────────────────────────────────────────
// 存在的意义：前端在云端不可用时**静默回退本地引擎**，而此前响应体里没有任何
// 字段说明「为什么没走 AI」。于是用户配了 Key、以为生效了，实际永远在跑本地，
// 却看不出原因 —— 只能来问「AI 不是已经配了 api 了吗」。
//
// 这里把「后台到底有没有 Key、每个 provider 是成功还是失败」如实报出来。
// 两条互补的入口：
//   · GET  /api/ai-brain?probe=1 → 只读自检，只回答「配了没」（零外部调用、零额度消耗）
//   · POST /api/ai-brain         → 响应体带 aiStatus，回答「为什么没用上」（含真实 HTTP 错误）
// ── provider 表（6.8.5 起模型名可配置，且带候选列表）──────────────────────
// 为什么必须有「候选列表」：**模型名会腐烂。**
//
// 6.8.5 实测发现，代码里硬编码的 `gemini-1.5-flash` 早已退役
// （Google 官方退役表里连条目都没有；连 2.0 系列也已在 2026-06-01 关停），
// 于是 Gemini 这条路**长期静默 404**，而用户在界面上完全看不出 ——
// 因为失败只写进 console.warn、徽章又无条件显示绿色。
//
// 单点硬编码一个模型名 = 一次退役就永久失效；
// 候选列表 + 环境变量覆盖，才能让「模型下线」退化成「换下一个」，
// 而不是「整条路哑掉、还没人知道」。
const PROVIDERS = [
  {
    id: 'groq',
    label: 'Groq',
    envVar: 'GROQ_API_KEY',
    modelEnvVar: 'GROQ_MODEL',
    models: ['llama-3.3-70b-versatile'],
    url: 'https://api.groq.com/openai/v1/chat/completions',
    extraHeaders: {},
    jsonMode: true
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    modelEnvVar: 'OPENROUTER_MODEL',
    // 免费档候选（6.8.7）。
    //
    // 名单来源：OpenRouter 公开模型接口 /api/v1/models 实拉，
    // 2026-10-14 共 462 个模型，其中 `:free` 后缀 14 个、纯文本输出 14 个。
    // 按用途排除：coding agent（poolside/laguna-*、cohere/north-mini-code）、
    // 内容安全分类器（nemotron-3.5-content-safety，它是判别器不是生成器）、
    // 多模态感知（nemotron-3-nano-omni）。剩下 8 个进入候选。
    //
    // jsonMode 是**逐个模型**从接口的 supported_parameters 读出来的实测事实，
    // 不是猜的：对不支持 response_format 的模型发这个参数，上游直接 4xx ——
    // 同一家 provider 里混着支持与不支持，所以不能再按 provider 一把切。
    //
    // ⚠️ 当前顺序是**按参数量排的暂定先验，未经本项目实测**。
    // 实测基准（_bench_openrouter.mjs，8 模型 × 3 题材）跑完后按数据裁剪为 4 个。
    models: [
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', jsonMode: false }, // 550B MoE 推理型
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', jsonMode: true },  // 120B MoE
      { id: 'google/gemma-4-31b-it:free', jsonMode: true },              // 31B dense
      { id: 'thinkingmachines/inkling:free', jsonMode: false },          // 41B active MoE
      { id: 'google/gemma-4-26b-a4b-it:free', jsonMode: true },          // 26B MoE
      { id: 'dots-studio/dots-3-note-preview:free', jsonMode: true },    // 16B active MoE
      { id: 'nvidia/nemotron-3.5-lightning:free', jsonMode: false },     // 3B active
      { id: 'liquid/lfm-2.5-2.6b:free', jsonMode: true }                 // 2.6B，64k 上下文
    ],
    url: 'https://openrouter.ai/api/v1/chat/completions',
    extraHeaders: { 'HTTP-Referer': 'https://legowaruniverse.pages.dev', 'X-Title': 'LEGO War Universe' },
    jsonMode: false
  },
  {
    id: 'gemini',
    label: 'Gemini',
    envVar: 'GEMINI_API_KEY',
    modelEnvVar: 'GEMINI_MODEL',
    // 顺序按 6.8.6 发布后实测（2026-10-14，两次真实采样）重排：
    //   · gemini-3.8-flash          两次都 HTTP 503（1.8s / 0.7s 快速失败）
    //   · gemini-3.5-flash-lite     一次成功（41.4s）、一次 503 但耗了 40.5s 才失败
    //   · gemini-2.5-flash          一次成功（36.8s）
    // 把「从未成功过」的挪到最后：它失败虽快（约 1.8s），但没必要拿它开头赌。
    // 任一模型退役/过载都不会让整条路彻底哑掉，只是退化成「换下一个」。
    models: ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    extraHeaders: {},
    jsonMode: true
  }
];

/**
 * 解析某 provider 实际要尝试的模型列表。
 * 环境变量（逗号 / 分号 / 空白分隔）优先，否则用内置候选。
 * 这让「模型名退役」可以在不改代码的前提下由运维直接修掉。
 */
/**
 * 归一化模型候选条目。
 *
 * 6.8.7 起因：`jsonMode`（是否要求模型强制输出 JSON）原本是 **provider 级** 的，
 * 但 OpenRouter 上各免费模型**支持情况不一致** —— 同一家 provider 里有的模型支持
 * `response_format: json_object`，有的不支持。对不支持的模型发这个参数，
 * 上游直接 4xx，于是「明明配了 Key 却整个 provider 都跑不通」。
 * 因此把它下沉到 **模型级**：provider 级只作为未显式声明时的默认值。
 *
 * @param {string|{id:string, jsonMode?:boolean}} entry
 * @returns {{id: string, jsonMode: boolean|null}} jsonMode 为 null 表示沿用 provider 默认
 */
function normalizeModelEntry(entry) {
  if (typeof entry === 'string') return { id: entry, jsonMode: null };
  const jsonMode = entry && typeof entry.jsonMode === 'boolean' ? entry.jsonMode : null;
  return { id: String(entry && entry.id), jsonMode };
}

function modelsFor(provider, env = {}) {
  const raw = String(env[provider.modelEnvVar] == null ? '' : env[provider.modelEnvVar]).trim();
  if (raw) {
    // 环境变量覆盖只给模型名，JSON 模式沿用 provider 默认值
    return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).map(normalizeModelEntry);
  }
  return provider.models.map(normalizeModelEntry);
}

// ── 超时与总预算（6.8.6）────────────────────────────────────────────────
// 起因：6.8.5 修好模型名之后，Gemini 这条路**真的通了** —— 于是线上出现了新症状：
// 「点一次深度转译，页面长时间没反应」。实测线上（2026-10-13）：
//   · requestedShots=1 → HTTP 200，但耗时 30.7s / 59.0s 两次；
//   · requestedShots=4 → 客户端 60s / 90s 都没等到，看起来就是死机。
//
// 也就是说：**它不是挂死，是真的很慢**；但代码里的 fetch **完全没有超时**，
// 于是「慢」和「挂死」在行为上完全一样 —— 上游一旦不返回，请求就永远挂着，
// 前端既不报错也不回退，用户只能干等。
//
// 加两层上限，且都可用环境变量覆盖（默认值不合适时不必改代码）：
//   · AI_PROVIDER_TIMEOUT_MS —— 单次模型调用上限，一次上游卡死不会吃掉整次请求；
//   · AI_REQUEST_BUDGET_MS   —— 整次请求总预算，无论多少 provider / 候选模型，总时长有界。
//
// 默认值刻意给得比实测耗时宽松（单次 60s / 总计 120s）：
// 先把「无界」变成「有界」并**测出真实耗时分布**，再依据数据收紧 ——
// 而不是凭感觉定一个会把当前可用路径掐死的数字。
const DEFAULT_PROVIDER_TIMEOUT_MS = 60000;
const DEFAULT_REQUEST_BUDGET_MS = 120000;

/** 解析超时配置：环境变量优先，非法值一律退回默认。 */
function timeoutsFor(env = {}) {
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    perModelMs: positive(env.AI_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS),
    totalMs: positive(env.AI_REQUEST_BUDGET_MS, DEFAULT_REQUEST_BUDGET_MS)
  };
}

/**
 * 给任意 Promise 加超时，超时后触发 onTimeout（用于 abort 底层连接）。
 *
 * 两个细节都不能省，否则会引入新 bug：
 *   1. 必须给原始 promise 挂一个空 catch。Promise.race 一旦被 guard 抢先结束，
 *      原始 promise 之后再 reject（abort 触发的 AbortError）就没有接收者，
 *      会变成 unhandled rejection —— Node 会直接让测试进程失败。
 *   2. onTimeout 只在**真的超时**时才调用，不能在 finally 里无条件调用。
 */
async function withTimeout(promise, timeoutMs, onTimeout) {
  let timer = null;
  let timedOut = false;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`TIMEOUT_${timeoutMs}ms`));
    }, timeoutMs);
  });
  promise.catch(() => { /* 见上：避免 race 结束后再抛成为 unhandled rejection */ });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
    if (timedOut && typeof onTimeout === 'function') onTimeout();
  }
}

const isTimeoutError = (err) => /^TIMEOUT_\d+ms$/.test(String(err && err.message ? err.message : ''));

/**
 * 把 provider 的原始 HTTP 错误翻译成「人话 + 下一步怎么办」。
 * 光有 `Groq HTTP 403` 用户仍然不知道该干什么 —— 这一层才是可操作的信息。
 */
function adviseProviderError(provider, model, message) {
  // 超时没有 HTTP 状态码，必须单独判，否则会掉进兜底那句无信息量的「调用失败」。
  if (/超时/.test(String(message == null ? '' : message))) {
    return `${provider.label} 在限定时间内没有返回（超时）：多半是该模型当前排队严重或上游卡住。可以换更快的模型（环境变量 ${provider.modelEnvVar}），或调大 AI_PROVIDER_TIMEOUT_MS。`;
  }
  const matched = /HTTP (\d{3})/.exec(String(message == null ? '' : message));
  const status = matched ? Number(matched[1]) : null;
  if (status === 401) {
    return `${provider.label} 拒绝了这把 Key（401 未授权）：请到控制台重新生成并完整复制（注意别带多余空格），然后更新环境变量 ${provider.envVar} 并重新部署。`;
  }
  if (status === 403) {
    return `${provider.label} 拒绝了这把 Key（403 禁止访问）：常见原因是 Key 无效 / 已撤销 / 账户受限或未完成验证 / 所在地区不支持。请到控制台确认 Key 状态，或换一把新 Key。`;
  }
  if (status === 404) {
    return `${provider.label} 找不到模型「${model}」（404）：多半是这个模型名已经退役。用环境变量 ${provider.modelEnvVar} 指定一个当前可用的模型名即可，无需改代码。`;
  }
  if (status === 429) {
    return `${provider.label} 额度用尽或触发限流（429）：换一个 provider，或等额度重置。`;
  }
  if (status === 413) {
    return `${provider.label} 提示请求体积过大（413）：可减少镜头数或资产目录后再试。`;
  }
  return `${provider.label} 调用失败：${message}`;
}

/**
 * 密钥掩码：只保留长度与后四位，**绝不返回密钥本身**。
 * 后四位足以让用户确认「这是我新配的那把 key」，而不构成泄露。
 */
function maskKey(value) {
  const key = String(value == null ? '' : value);
  if (!key) return null;
  return key.length <= 4 ? `••••（长度 ${key.length}）` : `••••${key.slice(-4)}（长度 ${key.length}）`;
}

/** 每个 provider 的「配置态」报告（不发起任何外部调用）。 */
function providerReport(env = {}) {
  return PROVIDERS.map(p => ({
    id: p.id,
    envVar: p.envVar,
    modelEnvVar: p.modelEnvVar,
    // 自检只报模型名（保持对外契约稳定）；每个模型是否要求 JSON 模式
    // 从条目里解析出来一并带出，方便运维核对上游支持情况。
    models: modelsFor(p, env).map(m => m.id),
    jsonModes: modelsFor(p, env).map(m => (m.jsonMode === null ? Boolean(p.jsonMode) : m.jsonMode)),
    configured: Boolean(env[p.envVar]),
    keyHint: maskKey(env[p.envVar])
  }));
}

/**
 * 汇总本次请求的 AI 使用结论。
 * @param {Array} attempts 逐个 provider 的尝试记录（含各自的 calls 逐次耗时）
 * @param {object} env 运行时环境变量
 * @param {object} meta 本次请求的预算与耗时信息
 */
function buildAiStatus(attempts, env = {}, meta = {}) {
  const configured = PROVIDERS.filter(p => env[p.envVar]).length;
  const won = attempts.find(a => a.ok) || null;
  const reason = won ? 'OK' : (configured === 0 ? 'NO_KEYS_CONFIGURED' : 'ALL_PROVIDERS_FAILED');

  // 「哪个模型慢、哪个模型挂」必须能从响应里直接读出来 ——
  // 这正是 6.8.6 之前读不出来的东西：attemptedModels 只记了名字，
  // 记不下「这个名字失败了、失败在哪、花了多久」。
  const calls = attempts.flatMap(a => (a.calls || []).map(c => ({ provider: a.id, ...c })));
  const timedOutCalls = calls.filter(c => c.timedOut);
  const budgetExhausted = Boolean(meta.budgetExhausted);

  let hint;
  if (won) {
    hint = null;
  } else if (configured === 0) {
    hint = '后台未配置任何模型 Key，本次由本地引擎生成。启用云端 AI：Cloudflare Pages → Settings → Environment variables → Production 配置 GROQ_API_KEY（类型选 Secret），然后重新部署。';
  } else {
    hint = '后台已配置模型 Key，但本次调用全部失败 —— 请看 providers 里每个 provider 的 advice 字段（已把 HTTP 状态码翻译成具体怎么办：401/403=Key 被拒绝，404=模型名可能已退役，429=额度或限流）。';
    if (timedOutCalls.length) {
      hint += ` 另有 ${timedOutCalls.length} 次是**超时**（${timedOutCalls.map(c => `${c.provider}/${c.model}`).join('、')}）：说明该模型排队严重或上游卡住，可换更快的模型或调大 AI_PROVIDER_TIMEOUT_MS。`;
    }
    if (budgetExhausted) {
      hint += ' 本次请求还触发了总预算上限（AI_REQUEST_BUDGET_MS），后续候选模型未再尝试。';
    }
  }

  return {
    aiAvailable: Boolean(won),
    reason,
    activeProvider: won ? won.id : null,
    configuredCount: configured,
    providers: attempts,
    // ── 6.8.6：让「慢」可测量 ────────────────────────────────────────
    // 有了逐次耗时，才能回答「到底是哪个模型慢/挂」，
    // 而不是像 6.8.4 那样拿总耗时（latencyMs=193）去反推结论、反推出错。
    calls,
    timedOut: timedOutCalls.length > 0,
    timedOutCalls: timedOutCalls.map(c => ({ provider: c.provider, model: c.model, ms: c.ms })),
    budgetExhausted,
    budgetMs: meta.budgetMs == null ? null : meta.budgetMs,
    elapsedMs: meta.elapsedMs == null ? null : meta.elapsedMs,
    hint
  };
}

/** GET /api/ai-brain?probe=1 的响应体：只读、无副作用、不泄露密钥。 */
function buildProbeReport(env = {}) {
  const providers = providerReport(env);
  const anyConfigured = providers.some(p => p.configured);
  const { perModelMs, totalMs } = timeoutsFor(env);
  return {
    ok: true,
    probe: true,
    aiAvailable: anyConfigured,
    configuredCount: providers.filter(p => p.configured).length,
    providerOrder: PROVIDERS.map(p => p.id),
    providers,
    // 6.8.6：超时与预算是「为什么慢/为什么没反应」的直接答案，必须能一眼看到当前生效值。
    timeouts: {
      perModelMs,
      totalMs,
      perModelEnvVar: 'AI_PROVIDER_TIMEOUT_MS',
      totalEnvVar: 'AI_REQUEST_BUDGET_MS'
    },
    diagnosis: anyConfigured
      ? '后台至少配置了一个模型 Key。若「深度转译」仍显示本地引擎，请点一次「深度转译」，响应里的 aiStatus.providers[].calls 会逐次给出每个模型的耗时与真实失败原因（401=Key 无效，429=额度或限流，404=模型不可用，超时=该模型排队严重）。'
      : '后台没有配置任何模型 Key（GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY 均为空），因此所有生成都会走本地引擎 —— 功能完整、不联网、不花钱。想启用云端 AI，请按 howToFix 操作。',
    howToFix: [
      'Cloudflare 控制台 → 你的 Pages 项目 → Settings → Environment variables → Production',
      '新增 GROQ_API_KEY，类型必须选 Secret（加密），不要选 Text',
      '点一次 Redeploy / 重新部署 —— 环境变量改动不重新部署不生效（最高频的坑）',
      '重新打开本地址，确认对应 provider 的 configured 变成 true'
    ],
    docs: 'docs/AI启用时机与配置.md',
    note: '本接口只报告 Key 是否存在（掩码显示后四位与长度），绝不返回密钥本身，也不会发起任何外部请求、不消耗任何额度。'
  };
}

function governResponse(responseBody, inputGovernance) {
  const outputGovernance = checkContentGovernance(JSON.stringify(responseBody));
  if (outputGovernance.status === 'blocked') {
    return {
      status: 502,
      body: {
        error: 'GENERATED_CONTENT_BLOCKED',
        flags: outputGovernance.flags,
        reasons: outputGovernance.reasons
      }
    };
  }

  const flags = [...new Set([
    ...(inputGovernance.flags || []),
    ...(outputGovernance.flags || [])
  ])];
  const reasons = [...new Set([
    ...(inputGovernance.reasons || []),
    ...(outputGovernance.reasons || [])
  ])];
  const reviewRequired = inputGovernance.status === 'review_required' || outputGovernance.status === 'review_required';
  responseBody.governance = { status: reviewRequired ? 'review_required' : 'passed', flags, reasons };
  if (reviewRequired) {
    responseBody.reviewRequired = true;
    responseBody.flags = flags;
    responseBody.reasons = reasons;
  }
  return { status: 200, body: responseBody };
}

const DIRECTOR_SYSTEM_PROMPT_HEADER = `你是一位好莱坞顶级电影摄影指导与微缩定格动画导演（擅长诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦的视听语言，精通乐高定格微缩物理美学）。
用户的输入可能是一部电影名称（如《长津湖》《阿凡达》《星际穿越》《狂怒》《黑客帝国》等），或者任意战术/科幻创意大纲。
你的任务是将该内容深度解构并转译为一部乐高微缩定格大片分镜剧本。

【最高优先级一：必须使用真实资产 ID】
下方是 LEGO War Universe 资产库中与本片题材最相关的真实资产清单（格式：ID=名称(时代)）。
每一个镜头都必须从清单中挑选真实存在的 ID 填入 assets 字段，严禁编造清单以外的 ID。
- subjects：1–3 个角色或载具 ID（从【角色人仔】【载具】里选）
- environment / camera / lighting / colorGrade：各 1 个对应分组的 ID
- fx / audio：各 0–3 / 0–2 个 ID（可选）
如果题材所需的现代/未来战争装备在清单中确实不存在，请照常发挥想象力描写动作，并在顶层 proposedAssets 数组里给出建议新增的资产（含 name / nameZh / group / lines），但镜头里仍必须使用清单内最接近的真实 ID 兜底。

【最高优先级二：原创性，不许照着原作抄】
参考片只贡献**视听语言与戏剧母题**，绝不贡献情节。你必须给出独立于原作的立意：
- originality.logline：一句话立意（谁、在哪、要做什么、赌注是什么）
- originality.twist：一个能翻转局势的转折（例如情报是诱饵、撤离窗口提前关闭、通讯已被敌方接管、敌方指挥官是主角的教官）
- originality.hook：前 3 秒抓人的开场钩子
禁止复述原作的经典桥段；允许在视听语法上致敬，但情节必须自己长出来。

【最高优先级三：禁止复读】
每个镜头的 action 必须**彼此明显不同**：主体、机位、动作、环境互动都要变化。
严禁把同一句话复制到多个镜头，严禁只改几个字充数。系统会对重复文本做去重惩罚。

【最高优先级四：敌对双方都要出场】
若下方【本片固定阵容】中存在对立阵营角色，则至少有两个镜头必须让敌方实际出场并产生对抗；
同时，每个镜头的 subjects 必须与 action 里实际描写的角色保持一致，不得出现「写的是敌人、填的是友军」。

【最高优先级五：每镜必须有各自不同的戏剧功能（这是「能不能构成电影」的生死线）】
一部电影不是把「开火」拍 N 遍。逐镜检查：这一镜在故事里**做了一件什么事**？
你必须为每个镜头在 fn 字段里声明它的戏剧功能，取值只能从下面这 17 个里选：
  goal(交代目标) world(铺陈规模) character(人物时刻) approach(接近) observe(观察等待)
  plan(临场计划) contact(首次接触) escalate(压力升级) reveal(情报有变) decision(抉择)
  reversal(反转) cost(代价) clash(正面交锋) quiet(静默) aftermath(残局) reaction(反应) close(收束)
硬约束（系统会逐条校验，违反即判定不合格）：
- **相邻两镜的 fn 必须不同**：绝不允许连续两个镜头都在干同一件戏剧上的事。
- **clash（正面交锋）最多占全片 1/3**：全片若有一半以上镜头是 clash，就直接判定为「蒙太奇、不成电影」。
- **必须包含非战斗功能**：全片至少要有 goal / character / observe / quiet / decision / cost / reaction / close 中的 3 种。
- 每个阶段各自的长相：
  · establish（铺垫）：先让人知道「要干什么、赌注是什么、人是谁」，再谈打。
  · build（展开）：制造意外（reveal）、让压力加码（escalate）、逼出计划（plan）。
  · climax（决战）：升级到正面交锋，但**必须**在交锋之间插入抉择(decision)/反转(reversal)/代价(cost)/静默(quiet)。
  · resolve（尾声）：打完之后的残局(aftermath)、反应(reaction)、收束(close)——而不是继续开火。
- 允许并且鼓励「不开枪的镜头」：观察、等待、静默、一个反应特写，往往比又一场交火更有力量。

【角色代号纪律】
阵容里给出的代号是该角色在全片的唯一身份，action / radioVoice 中必须用【代号】称呼角色，
且同一角色全片同名，绝不换称呼。镜头间保持同一套外观与损伤状态。

你必须严格以合法的 JSON 格式输出，不要包含任何多余的开场白或解释。JSON 结构必须符合以下格式：
{
  "matchedMovie": "电影中文全名 (英文原名)",
  "director": "导演姓名",
  "year": "上映年份",
  "genre": "电影流派题材",
  "dramaticConflict": "一句话核心危机与戏剧生死矛盾",
  "visualGrammar": {
    "cameraMotion": "标志性摄影机运动与景别法则",
    "lightingTone": "色彩影调与明暗反差设计",
    "soundDesign": "声音设计与配乐灵魂"
  },
  "legoAdaptation": "如何用乐高微缩积木、微距景深、特技烟雾与真实塑料材质进行定格微缩还原的专业建议",
  "creatorTips": "给自媒体创作者提升前3秒完播率与声画对齐的实战拉片教学秘籍",
  "originality": {
    "logline": "独立原创的一句话立意",
    "twist": "能翻转局势的原创转折",
    "hook": "前3秒开场钩子",
    "homageNote": "说明本片在视听语言上致敬了谁，但情节为独立原创"
  },
  "proposedAssets": [],
  "shots": [
    {
      "phase": "establish",
      "fn": "本镜戏剧功能，只能取以下 17 值之一：goal/world/character/approach/observe/plan/contact/escalate/reveal/decision/reversal/cost/clash/quiet/aftermath/reaction/close（相邻两镜不得相同）",
      "shotType": "景别类型（如：超低空掠地全景 / 驾驶舱微型特写）",
      "action": "详细的乐高微缩动作描述，必须指明乐高人仔、载具、建筑积木细节，并用【代号】称呼角色",
      "screenDirection": "towards-camera",
      "damageState": "clean",
      "audioCue": "环境音效与伴随音乐描述",
      "radioVoice": "【台词/无线电】核心角色对白或战术呼叫",
      "assets": {
        "subjects": ["CHR-401"],
        "environment": "ENV-001",
        "camera": "CAM-001",
        "lighting": "LGT-001",
        "colorGrade": "CLR-001",
        "fx": [],
        "audio": []
      }
    }
  ]
}`;

function buildDirectorSystemPrompt(catalogText, era, castText = '') {
  return `${DIRECTOR_SYSTEM_PROMPT_HEADER}

【本片时代判定】${era || '未明确（默认 Modern 现代）'}
${castText}
【可用真实资产清单】
${catalogText || '（资产库目录为空，请使用 CHR-401 / ENV-001 / CAM-001 / LGT-001 / CLR-001 作为兜底）'}`;
}

/** 把确定性阵容渲染成 Prompt 片段（真实资产 + 固定代号） */
function buildCastSection(castRoster) {
  const lines = castRoster ? rosterPromptLines(castRoster) : [];
  if (!lines.length) return '';
  return `
【本片固定阵容（由系统从资产库确定性挑选，代号全片固定）】
${lines.join('\n')}
`;
}

function buildUserPrompt(query, requestedShots) {
  return `请深度解构并转译：${query}。输出正好 ${requestedShots} 个镜头的完整分镜（四阶段叙事：铺垫 establish -> 展开 build -> 决战 climax -> 尾声 resolve）。每个镜头的 assets 字段必须使用上方清单中的真实 ID。若上方【本片固定阵容】给了代号，请在 action 与 radioVoice 中始终用【代号】称呼角色，并确保 ${requestedShots} 个镜头的 action 描述各不相同。`;
}

/** 判定一段动作描述是否已包含交战语义（用于安全地补入敌方角色） */
/**
 * 确保敌方阵营确实上镜。
 *
 * 大模型常常「只在台词里提敌人，subjects 里却全是友军」。这里做一次保守修补：
 * 只在「build / climax 阶段 + 动作已含交战语义 + 主体不足 3 个」的镜头上补入敌军，
 * 既不触发阵营冲突校验（对立阵营同框必须有对抗动作），也不会挤掉已有主体。
 *
 * 交战语义必须复用 shot-spec 的 hasHostileFraming，绝不能自己再写一份正则：
 * 两份判定不一致时，补进去的镜头会直接在校验阶段报 FACTION_CONFLICT_INVALID。
 */
function ensureOpposingPresence(shots = [], opposingIds = []) {
  if (!opposingIds.length) return { shots, injected: 0 };
  const hasFoe = shots.some(s => (s.subjects || []).some(id => opposingIds.includes(id)));
  if (hasFoe) return { shots, injected: 0 };

  let injected = 0;
  const out = shots.map((s, i) => {
    if (injected >= 2) return s;
    const phase = s.phase || 'build';
    if (phase !== 'build' && phase !== 'climax') return s;
    if (!hasHostileFraming(s.action)) return s;
    const subjects = Array.isArray(s.subjects) ? s.subjects : [];
    if (subjects.length >= 3) return s;
    const foe = opposingIds[i % opposingIds.length];
    if (subjects.includes(foe)) return s;
    injected++;
    return { ...s, subjects: [...subjects, foe] };
  });
  return { shots: out, injected };
}

function cleanAndParseJson(text) {
  if (!text || typeof text !== 'string') throw new Error('Empty AI response');
  let clean = text.trim();
  const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    clean = match[1].trim();
  }
  return JSON.parse(clean);
}

/**
 * 调一次指定 provider 的指定模型。
 *
 * 6.8.5 起由「每个 provider 一个写死模型的函数」改为「通用函数 + 模型候选列表」——
 * 起因是 `gemini-1.5-flash` 退役后整条路静默 404，而模型名硬编码在函数体里，
 * 除了改代码没有任何办法修。现在模型名来自 PROVIDERS / 环境变量，可运维。
 *
 * 失败时抛出带 provider 名与 HTTP 状态码的错误，供 aiStatus 诊断字段使用。
 *
 * 6.8.6 起**每一次网络等待都有上限**：响应头、响应体分别计时，
 * 超时既 abort 底层连接、也抛出可读的错误（否则「慢」与「挂死」行为一致）。
 */
async function callProviderModel(provider, model, systemPrompt, userPrompt, apiKey, timeoutMs, jsonMode) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7
  };
  // 6.8.7：jsonMode 由**模型级**条目解析后传入，不再读 provider.jsonMode ——
  // OpenRouter 的免费模型对这个参数支持不一致，provider 级一把切会让
  // 「不支持的模型」整个 provider 都失败。
  if (jsonMode) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const abort = () => { try { controller.abort(); } catch { /* abort 失败不影响超时语义 */ } };

  let res;
  try {
    res = await withTimeout(fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...provider.extraHeaders
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }), timeoutMs, abort);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(`${provider.label} 超时：${timeoutMs}ms 内未返回响应头（模型「${model}」）`);
    }
    throw err;
  }

  if (!res.ok) throw new Error(`${provider.label} HTTP ${res.status}`);

  let data;
  try {
    // 响应头到了不代表响应体到齐：流式响应可能卡在传输中途，这里同样要计时。
    data = await withTimeout(res.json(), timeoutMs, abort);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(`${provider.label} 超时：${timeoutMs}ms 内未读完响应体（模型「${model}」）`);
    }
    throw err;
  }

  const content = data.choices?.[0]?.message?.content;
  return cleanAndParseJson(content);
}

export async function onRequest({ request, env = {} }) {
  const startTime = Date.now();
  const headers = cors(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    });
  }

  // 只读自检：GET /api/ai-brain?probe=1
  // 必须在 405 之前拦截，但不能放宽「非 POST 一律 405」的既有契约 ——
  // 因此只认带 probe 参数的 GET，其余方法原样 405。
  const url = new URL(request.url);
  const isProbe = request.method === 'GET' && url.searchParams.has('probe');

  if (!isProbe && request.method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, headers);
  }

  // 基础限流保护（probe 与生成共用同一窗口）
  const clientIp = request.headers.get('cf-connecting-ip') || 'anonymous';
  const rl = checkRateLimit(clientIp);
  if (rl.limited) {
    return json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs }, 429, headers);
  }

  if (isProbe) {
    return json(buildProbeReport(env), 200, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, 400, headers);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'INVALID_BODY' }, 400, headers);
  }

  const query = String(body.query || '').trim();
  if (!query) {
    return json({ error: 'MISSING_QUERY' }, 400, headers);
  }
  if (query.length > 1200) {
    return json({ error: 'QUERY_TOO_LONG', maxLength: 1200 }, 413, headers);
  }

  const requestedShots = body.requestedShots == null ? 4 : Number(body.requestedShots);
  if (!Number.isInteger(requestedShots) || requestedShots < 1 || requestedShots > 12) {
    return json({ error: 'INVALID_REQUESTED_SHOTS', allowedRange: [1, 12] }, 400, headers);
  }

  const inputGovernance = checkContentGovernance(query);
  if (inputGovernance.status === 'blocked') {
    return json({
      error: 'CONTENT_BLOCKED',
      flags: inputGovernance.flags,
      reasons: inputGovernance.reasons
    }, 403, headers);
  }

  // 依据题材解析时代，构建「与题材相关」的真实资产目录，注入 Prompt。
  // 这是「AI 优先且必须使用资产库」的关键：模型拿到的是真实 ID，而不是空白想象。
  const intent = parseIntent(query);
  const catalog = buildAssetCatalog(ASSET_REGISTRY, { era: intent.era, keywords: query });
  const catalogText = formatCatalogForPrompt(catalog);
  const validIds = collectValidIds(ASSET_REGISTRY);

  // 确定性阵容：后台先按时代从资产库里挑出正反双方 + 载具，并分配固定代号，
  // 再把这份「演员表」交给大模型 —— 模型因此无法凭空发明角色，只能按代号排戏。
  const cast = REGISTRY ? selectCast(REGISTRY, { era: intent.era || 'Modern', task: 'combat', theme: query }) : null;
  const castIds = cast ? [...cast.heroes, ...cast.enemies, ...cast.vehicles].map(a => a.id) : [];
  const castRoster = REGISTRY && castIds.length ? buildRoster([{ subjects: castIds }], REGISTRY) : null;
  const opposingIds = castRoster ? castRoster.opposing.map(e => e.id) : [];

  const systemPrompt = buildDirectorSystemPrompt(catalogText, intent.era, buildCastSection(castRoster));
  const userPrompt = buildUserPrompt(query, requestedShots);

  let result = null;
  let usedEngine = 'None';

  // 本次请求的超时与总预算（6.8.6）。deadline 用绝对时间，
  // 这样「还要不要开始下一次调用」是一个可以算出来的问题，而不是凭感觉。
  const { perModelMs, totalMs } = timeoutsFor(env);
  const deadline = startTime + totalMs;
  let budgetExhausted = false;

  // 逐个 provider 的尝试记录 —— 这是「为什么没用上 AI」的唯一证据来源。
  // 此前这些失败只写进 console.warn（用户在页面上永远看不到），
  // 于是「配了 Key 却一直跑本地」没有任何可观测的线索。
  const attempts = PROVIDERS.map(p => ({
    id: p.id,
    envVar: p.envVar,
    modelEnvVar: p.modelEnvVar,
    configured: Boolean(env[p.envVar]),
    tried: false,
    ok: false,
    model: null,
    ms: null,
    attemptedModels: [],
    // 6.8.6：逐次调用记录。attemptedModels 只记名字，答不了
    // 「哪个名字失败了、失败在哪、花了多久」—— 而那才是排查要的东西。
    calls: [],
    totalMs: 0,
    error: null,
    advice: null
  }));

  // 按顺序尝试，一个成功就停；每个 provider 内部还会按候选模型列表逐个试。
  // 6.8.5 之前这里是三段写死的 if + 三个写死模型的函数，模型一退役就整条路哑掉。
  for (const provider of PROVIDERS) {
    if (result || budgetExhausted) break;
    const record = attempts.find(a => a.id === provider.id);
    if (!record.configured) continue;

    const models = modelsFor(provider, env);
    record.tried = true;
    record.attemptedModels = models.map(m => m.id);
    let lastError = null;

    for (const entry of models) {
      const model = entry.id;
      // 6.8.7：JSON 模式按模型解析 —— 模型没显式声明就沿用 provider 默认。
      const jsonMode = entry.jsonMode === null ? Boolean(provider.jsonMode) : entry.jsonMode;
      // 开始下一次调用之前先看预算：剩余时间不够就不要再发起，
      // 否则「总预算」只是装饰 —— 一次 60s 的调用就能把 120s 的预算吃掉一半以上。
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        budgetExhausted = true;
        record.calls.push({ model, ok: false, ms: 0, error: '跳过：整次请求总预算已耗尽', timedOut: false, skipped: true });
        break;
      }
      // 单次上限再被剩余预算夹一次，保证「总时长有界」是硬保证。
      const callTimeout = Math.min(perModelMs, remaining);
      const callStart = Date.now();

      try {
        result = await callProviderModel(provider, model, systemPrompt, userPrompt, env[provider.envVar], callTimeout, jsonMode);
        const ms = Date.now() - callStart;
        record.calls.push({ model, ok: true, ms, error: null, timedOut: false, skipped: false });
        usedEngine = `${provider.label} (${model})`;
        record.ok = true;
        record.model = model;
        record.ms = ms;
        break;
      } catch (e) {
        const ms = Date.now() - callStart;
        lastError = e;
        record.calls.push({
          model,
          ok: false,
          ms,
          error: e.message,
          timedOut: /超时/.test(e.message),
          skipped: false
        });
        console.warn(`${provider.id}/${model} 调度失败（${ms}ms）:`, e.message);
      }
    }

    record.totalMs = record.calls.reduce((sum, c) => sum + (c.ms || 0), 0);
    if (!record.ok && lastError) {
      record.error = lastError.message;
      // 把 HTTP 状态码 / 超时翻译成「人话 + 下一步怎么办」——
      // 光有 `Groq HTTP 403` 用户仍然不知道该干什么。
      record.advice = adviseProviderError(provider, models[models.length - 1].id, lastError.message);
    }
  }

  // 本次请求的 AI 结论：无论走云端还是回退本地，都如实带在响应里。
  const aiStatus = buildAiStatus(attempts, env, {
    budgetExhausted,
    budgetMs: totalMs,
    perModelMs,
    elapsedMs: Date.now() - startTime
  });

  // 4. 若无云端 Key 或调用均异常，自动由本地引擎无缝兜底。
  //
  //    本地引擎有**两套性质完全不同**的东西，必须分开走（6.8.1 修复）：
  //      · 命中 9 部策展影片 → 手写分镜复刻，如实标注「非 AI 生成」；
  //      · 未命中任何策展影片 → 交给自主想象引擎真的按题材写一部，输入决定输出。
  //    旧实现只有第一条路，且把未命中一律静默退回《黑鹰坠落》——
  //    于是「换了两次内容，第一个脚本永远是同一句直升机索降」。
  if (!result) {
    const latencyMs = Date.now() - startTime;
    const curated = matchCuratedFilm(query);

    // 4a. 命中策展影片：交付手写复刻（内容固定，如实告知）
    if (curated.film) {
      const local = transpileMovieToLego(query, requestedShots, REGISTRY);
      const responseBody = {
        ok: true,
        matchedMovie: local.matchedMovie,
        movieId: local.movieId,
        matchKind: local.matchKind,
        contentKind: 'curated',
        director: local.director,
        year: local.year,
        genre: local.genre,
        dramaticConflict: local.dramaticConflict,
        visualGrammar: local.visualGrammar,
        legoAdaptation: local.legoAdaptation,
        creatorTips: local.creatorTips,
        themeZh: local.themeZh,
        shots: local.shots,
        originality: local.originality || null,
        roster: Array.isArray(local.roster) ? local.roster : [],
        repetitionFixed: local.repetitionFixed || 0,
        isAiGenerated: false,
        engine: OFFLINE_ENGINES.curated,
        era: local.era || intent.era,
        assetUsage: { catalogSize: validIds.size, matched: 0, unknown: [] },
        proposedAssets: [],
        latencyMs,
        aiStatus
      };
      const governed = governResponse(responseBody, inputGovernance);
      return json(governed.body, governed.status, headers);
    }

    // 4b. 未命中：改用自主想象引擎真的生成一部（含 4 方案择优），输入真正参与生成
    const generated = generateLocally({
      theme: query,
      requestedShots,
      registry: REGISTRY
    });
    if (generated) {
      const responseBody = {
        ok: true,
        matchedMovie: null,
        movieId: null,
        matchKind: 'none',
        contentKind: 'generated',
        director: null,
        year: null,
        genre: generated.genre,
        dramaticConflict: null,
        visualGrammar: null,
        legoAdaptation: null,
        creatorTips: null,
        themeZh: generated.themeZh,
        shots: generated.shots,
        originality: generated.originality || null,
        roster: Array.isArray(generated.roster) ? generated.roster : [],
        variant: generated.variant || null,
        variants: generated.variants || [],
        score: generated.score || null,
        repetitionFixed: 0,
        isAiGenerated: false,
        engine: OFFLINE_ENGINES.generated,
        era: generated.era || intent.era,
        assetUsage: { catalogSize: validIds.size, matched: 0, unknown: [] },
        proposedAssets: [],
        latencyMs,
        aiStatus
      };
      const governed = governResponse(responseBody, inputGovernance);
      return json(governed.body, governed.status, headers);
    }

    // 4c. 生成也失败（极端情况）才退回策展兜底，但仍然如实标注，绝不冒充 AI
    const fallback = transpileMovieToLego(query, requestedShots, REGISTRY, { genericFallback: true });
    const responseBody = {
      ok: true,
      matchedMovie: fallback.matchedMovie,
      movieId: fallback.movieId,
      matchKind: fallback.matchKind,
      contentKind: 'curated',
      director: fallback.director,
      year: fallback.year,
      genre: fallback.genre,
      dramaticConflict: fallback.dramaticConflict,
      visualGrammar: fallback.visualGrammar,
      legoAdaptation: fallback.legoAdaptation,
      creatorTips: fallback.creatorTips,
      themeZh: fallback.themeZh,
      shots: fallback.shots,
      originality: fallback.originality || null,
      roster: Array.isArray(fallback.roster) ? fallback.roster : [],
      repetitionFixed: fallback.repetitionFixed || 0,
      isAiGenerated: false,
      engine: `${OFFLINE_ENGINES.curated} · 生成引擎不可用，已退回通用军事分镜`,
      era: fallback.era || intent.era,
      assetUsage: { catalogSize: validIds.size, matched: 0, unknown: [] },
      proposedAssets: [],
      latencyMs,
      aiStatus
    };
    const governed = governResponse(responseBody, inputGovernance);
    return json(governed.body, governed.status, headers);
  }

  // 5. 校验大模型返回的资产引用：只保留真实存在的 ID，非法 ID 降级为默认资产。
  const rawShots = Array.isArray(result.shots) ? result.shots : [];
  const unknownIds = new Set();
  let matchedRefs = 0;
  const sanitizedShots = rawShots.map(shot => {
    const { refs, unknown } = resolveShotAssets(shot, validIds);
    unknown.forEach(id => unknownIds.add(id));
    matchedRefs += refs.subjects.length
      + ['environment', 'camera', 'lighting', 'colorGrade'].filter(k => refs[k]).length
      + refs.fx.length + refs.audio.length;
    return {
      ...shot,
      subjects: refs.subjects.length ? refs.subjects : undefined,
      environment: refs.environment || undefined,
      camera: refs.camera || undefined,
      lighting: refs.lighting || undefined,
      colorGrade: refs.colorGrade || undefined,
      fx: refs.fx,
      audio: refs.audio
    };
  });

  // 5b. 保证敌方阵营真的上镜（只在含交战语义的镜头里保守补入，绝不制造阵营冲突）
  const foeFixed = ensureOpposingPresence(sanitizedShots, opposingIds);

  // 6. 与乐高资产规范对齐（含连续性链条强制注入）
  const alignedShots = alignShotsToLego(foeFixed.shots, {}, intent.era || 'Modern');

  // 6b. 反重复兜底：大模型最爱偷懒复制同一句话，这里对撞车的 action 做确定性变奏
  const diversified = diversifyShots(alignedShots);

  // 6c. 戏剧功能兜底：大模型最爱的另一种偷懒是「8 个镜头全是对轰」——
  //     文字各不相同，但每一镜在故事里干的是同一件事，观感仍是蒙太奇而非电影。
  //     这里给每镜补/规整 fn（戏剧功能），保证相邻两镜不同功能、整片长出戏剧弧线。
  const functioned = tagDramaticFunctions(diversified.shots);

  // 6d. 以「最终真正上镜的镜头」为准聚合名册，并继承 Prompt 阶段已分配的代号，
  //     保证「模型脚本里的称呼」与「前端定妆表 / 编译 Prompt」完全一致。
  const finalRoster = REGISTRY
    ? buildRoster(functioned.shots, REGISTRY, { prior: castRoster })
    : null;

  const latencyMs = Date.now() - startTime;

  const responseBody = {
    ok: true,
    matchedMovie: result.matchedMovie || query,
    director: result.director || 'AI 导演中枢',
    year: result.year || '2026',
    genre: result.genre || '好莱坞大片',
    dramaticConflict: result.dramaticConflict || '高危战术突破与终极对决',
    visualGrammar: result.visualGrammar || {},
    legoAdaptation: result.legoAdaptation || '高精度乐高微缩定格美学',
    creatorTips: result.creatorTips || '把握前3秒视听钩子',
    themeZh: `【${result.matchedMovie || query} · AI 大脑转译】${(functioned.shots[0]?.action || '').slice(0, 35)}…`,
    shots: functioned.shots,
    originality: result.originality || null,
    roster: finalRoster ? rosterToJSON(finalRoster) : [],
    repetitionFixed: diversified.fixed,
    functionRetagged: functioned.retagged,
    monotoneGuard: functioned.monotone,
    isAiGenerated: true,
    engine: `Cloud Free AI (${usedEngine})`,
    era: intent.era,
    assetUsage: {
      catalogSize: validIds.size,
      matched: matchedRefs,
      unknown: [...unknownIds]
    },
    // 模型建议新增、但资产库暂缺的现代/未来战争装备 —— 交给前端进化引擎锻造落地
    proposedAssets: Array.isArray(result.proposedAssets) ? result.proposedAssets.slice(0, 8) : [],
    latencyMs,
    aiStatus
  };
  const governed = governResponse(responseBody, inputGovernance);
  return json(governed.body, governed.status, headers);
}
