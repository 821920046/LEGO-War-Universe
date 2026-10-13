/**
 * AI 可用性诊断门禁（6.8.4）
 *
 * 背景：用户问「AI 不是已经配了 api 了吗？还不能使用吗」。
 * 线上实测证明后台**没有配置任何 Key**（engine = 本地自主想象引擎 · 离线生成，
 * handler 仅 193ms —— 装不下任何一次外部 HTTPS 调用），但用户在界面上**看不出原因**：
 *   · 前端在云端不可用时静默回退本地；
 *   · 「本次引擎」徽章无论走没走 AI 都显示绿色。
 *
 * 本文件为「让失败可见」这条修复立门禁，保证以后不会再退化：
 *   1. 只读自检 /api/ai-brain?probe=1 能如实报告「配了没」；
 *   2. 自检**绝不泄露密钥**，也**不发起任何外部调用**；
 *   3. 既有契约不放宽（不带 probe 的 GET 仍然 405）；
 *   4. 生成响应必须带 aiStatus，如实说明为什么没用上云端 AI。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/ai-brain.js';

const call = (body, method = 'POST', headers = {}, env = {}, url = 'https://lwu.example/api/ai-brain') => {
  const req = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
  return onRequest({ request: req, env });
};

const probe = (env = {}) =>
  call(null, 'GET', {}, env, 'https://lwu.example/api/ai-brain?probe=1');

const FAKE_SECRET = 'gsk_THIS_IS_A_FAKE_SECRET_KEY_abcd1234';

test('AI 诊断：未配 Key 时自检如实报告 aiAvailable=false', async () => {
  const res = await probe();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.probe, true);
  assert.equal(data.aiAvailable, false);
  assert.equal(data.configuredCount, 0);
  for (const p of data.providers) {
    assert.equal(p.configured, false, `${p.id} 不应被标记为已配置`);
    assert.equal(p.keyHint, null, `${p.id} 未配置时不应有 keyHint`);
  }
  // 诊断必须能指导下一步，而不是丢一句「不可用」了事
  assert.ok(Array.isArray(data.howToFix) && data.howToFix.length >= 3);
  assert.ok(data.diagnosis.includes('没有配置任何模型 Key'));
});

test('AI 诊断：自检绝不泄露密钥，只给掩码', async () => {
  const res = await probe({ GROQ_API_KEY: FAKE_SECRET });
  const data = await res.json();
  const raw = JSON.stringify(data);

  assert.equal(data.aiAvailable, true);
  assert.equal(data.configuredCount, 1);
  const groq = data.providers.find(p => p.id === 'groq');
  assert.equal(groq.configured, true);
  assert.equal(groq.keyHint, `••••1234（长度 ${FAKE_SECRET.length}）`);

  // 最关键的一条：完整密钥绝不能出现在响应里
  assert.ok(!raw.includes(FAKE_SECRET), '自检响应泄露了完整密钥');
  // 除掩码外，密钥的其余片段也不得出现
  assert.ok(!raw.includes(FAKE_SECRET.slice(0, 20)), '自检响应泄露了密钥前缀');
});

test('AI 诊断：自检不发起任何外部调用（零额度消耗）', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('probe 不应发起任何外部调用'); };
  try {
    const res = await probe({ GROQ_API_KEY: FAKE_SECRET });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.aiAvailable, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：既有契约不放宽 —— 不带 probe 的 GET 仍然 405', async () => {
  const res = await call(null, 'GET');
  assert.equal(res.status, 405);
  assert.equal((await res.json()).error, 'METHOD_NOT_ALLOWED');
});

test('AI 诊断：兜底响应必须带 aiStatus，说明是「没配 Key」而不是含糊其辞', async () => {
  const res = await call({ query: '二战诺曼底登陆抢滩', requestedShots: 2 });
  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.isAiGenerated, false);
  assert.ok(data.aiStatus, '兜底响应缺少 aiStatus，前端将无法解释原因');
  assert.equal(data.aiStatus.aiAvailable, false);
  assert.equal(data.aiStatus.reason, 'NO_KEYS_CONFIGURED');
  assert.equal(data.aiStatus.activeProvider, null);
  assert.ok(data.aiStatus.hint && data.aiStatus.hint.length > 0);
});

test('AI 诊断：Key 存在但调用失败时，必须回传真实的 HTTP 错误', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('unauthorized', { status: 401 });
  try {
    const res = await call({ query: '现代特战城市巷战', requestedShots: 2 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    const data = await res.json();

    assert.equal(data.isAiGenerated, false);
    assert.equal(data.aiStatus.reason, 'ALL_PROVIDERS_FAILED');
    assert.equal(data.aiStatus.configuredCount, 1);

    const groq = data.aiStatus.providers.find(p => p.id === 'groq');
    assert.equal(groq.tried, true, '配置了的 provider 必须被标记为已尝试');
    assert.match(groq.error, /Groq HTTP 401/, '必须回传真实 HTTP 状态码，否则用户无从排查');

    // 「没配」与「配了但失败」必须可区分 —— 这正是用户最需要的那一条信息
    const gemini = data.aiStatus.providers.find(p => p.id === 'gemini');
    assert.equal(gemini.configured, false);
    assert.equal(gemini.tried, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：云端 AI 成功时 aiStatus 如实标记 aiAvailable=true', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      matchedMovie: '测试片',
      shots: [{
        phase: 'establish',
        action: '乐高特战小队推进。',
        assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' }
      }]
    }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    const data = await res.json();

    assert.equal(data.isAiGenerated, true);
    assert.equal(data.aiStatus.aiAvailable, true);
    assert.equal(data.aiStatus.reason, 'OK');
    assert.equal(data.aiStatus.activeProvider, 'groq');
    assert.equal(data.aiStatus.hint, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ── 6.8.5：模型名会腐烂 ────────────────────────────────────────────────
// 起因：代码里硬编码的 `gemini-1.5-flash` 早已退役（Google 官方退役表里连条目
// 都没有，2.0 系列也已在 2026-06-01 关停），于是 Gemini 这条路长期静默 404。
// 单点硬编码一个模型名 = 一次退役就永久失效，所以必须有候选列表 + 环境变量覆盖。

test('AI 诊断：自检必须报告候选模型列表与可覆盖的环境变量', async () => {
  const res = await probe();
  const data = await res.json();
  const gemini = data.providers.find(p => p.id === 'gemini');
  assert.equal(gemini.modelEnvVar, 'GEMINI_MODEL');
  assert.ok(
    Array.isArray(gemini.models) && gemini.models.length >= 2,
    'Gemini 必须有候选模型列表，否则一次退役就永久失效'
  );
  assert.ok(!gemini.models.includes('gemini-1.5-flash'), 'gemini-1.5-flash 早已退役，不得出现在默认候选里');
  assert.ok(
    !gemini.models.some(m => /^gemini-2\.0-/.test(m)),
    'gemini-2.0 系列已于 2026-06-01 关停，不得出现在默认候选里'
  );
});

test('AI 诊断：单个模型退役时自动换下一个，整条路不会哑掉', async () => {
  const originalFetch = globalThis.fetch;
  const tried = [];
  globalThis.fetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    tried.push(model);
    if (model === 'gemini-3.8-flash') return new Response('model not found', { status: 404 });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        matchedMovie: '测试片',
        shots: [{ phase: 'establish', action: '乐高特战小队推进。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } }]
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GEMINI_API_KEY: 'k' });
    const data = await res.json();
    assert.deepEqual(
      tried.slice(0, 2), ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
      '必须按候选顺序逐个尝试，第一个 404 后要自动换下一个'
    );
    assert.equal(data.isAiGenerated, true);
    assert.equal(data.aiStatus.activeProvider, 'gemini');
    assert.equal(
      data.aiStatus.providers.find(p => p.id === 'gemini').model,
      'gemini-3.5-flash-lite',
      'aiStatus 必须记下最终真正生效的那个模型'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：可用环境变量覆盖模型名（模型退役不必改代码）', async () => {
  const res = await probe({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-9.9-flash, gemini-x' });
  const data = await res.json();
  assert.deepEqual(
    data.providers.find(p => p.id === 'gemini').models,
    ['gemini-9.9-flash', 'gemini-x']
  );
});

test('AI 诊断：失败必须给出可操作的 advice，而不只是一个状态码', async () => {
  const originalFetch = globalThis.fetch;

  // 403 = Key 被拒绝
  globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
  try {
    let data = await (await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GROQ_API_KEY: 'k' })).json();
    const groq = data.aiStatus.providers.find(p => p.id === 'groq');
    assert.equal(groq.error, 'Groq HTTP 403');
    assert.match(groq.advice, /Key/, '403 的 advice 必须指出这是 Key 的问题');
    assert.match(groq.advice, /GROQ_API_KEY|控制台/, '403 的 advice 必须给出下一步怎么办');

    // 404 = 模型名退役，且必须告诉用户用哪个环境变量覆盖
    globalThis.fetch = async () => new Response('model not found', { status: 404 });
    data = await (await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GEMINI_API_KEY: 'k' })).json();
    const gemini = data.aiStatus.providers.find(p => p.id === 'gemini');
    assert.equal(gemini.error, 'Gemini HTTP 404');
    assert.match(gemini.advice, /退役/);
    assert.match(gemini.advice, /GEMINI_MODEL/, '必须告诉用户用哪个环境变量换模型名');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：源码里不得再硬编码已退役的模型名（防模型腐烂回归）', () => {
  const src = readFileSync(new URL('../functions/api/ai-brain.js', import.meta.url), 'utf8');
  assert.ok(!/['"]gemini-1\.5-flash['"]/.test(src), 'gemini-1.5-flash 早已退役，不得再硬编码');
  assert.ok(!/['"]gemini-2\.0-flash/.test(src), 'gemini-2.0 系列已于 2026-06-01 关停，不得再硬编码');
});
