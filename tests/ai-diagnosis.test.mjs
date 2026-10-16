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
 *
 * 6.8.5 追加：模型名会腐烂 —— 必须有候选列表 + 环境变量覆盖。
 * 6.8.6 追加：**把「慢」与「挂死」分开**。
 *   6.8.5 让 Gemini 真的通了之后，线上实测单镜就要 30–59 秒；
 *   而 fetch 完全没有超时，上游一旦不返回，请求就永远挂着 ——
 *   前端既不报错也不回退，用户看到的就是死机。
 *   因此这里立三条门禁：单次调用超时、整次请求总预算、逐模型耗时可见。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/ai-brain.js';
import { callAiBrain } from '../src/domain/ai-brain.js';

// 每次调用都带**唯一**的 cf-connecting-ip。
//
// 6.8.8 起因：本套件的调用原先全都不带这个头，于是统统落进同一个
// 'anonymous' 限流桶（30 次/60s，滑动窗口）。实测 35 次连续调用，
// 第 31 次起全部 429 RATE_LIMITED —— 而 429 的响应体里**没有
// aiStatus / roster**，下游断言就变成
// "Cannot read properties of undefined (reading 'providers')" 这种
// 跟真正被测行为毫无关系的 TypeError；且是否撞上取决于调用与 60s
// 窗口的相对时序，于是表现为随机失败（6 次连跑挂了 3 次）。
// 这不是把限流关掉：每个测试调用仍然是一个独立客户端，独立计数。
// 限流本身的契约由 tests/rate-limit-contract.test.mjs 专门守。
let clientSeq = 0;
const freshClientIp = () => `test-client-${process.pid}-${++clientSeq}`;

const call = (body, method = 'POST', headers = {}, env = {}, url = 'https://lwu.example/api/ai-brain') => {
  const req = new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshClientIp(), ...headers },
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
    // 6.8.7：名单重排后第一个候选已换成 gemini-2.5-flash
    if (model === 'gemini-2.5-flash') return new Response('model not found', { status: 404 });
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
      tried.slice(0, 2), ['gemini-2.5-flash', 'gemini-3.5-flash-lite'],
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

// ── 6.8.6：把「慢」与「挂死」分开 ──────────────────────────────────────
// 起因：6.8.5 修好模型名之后云端 AI 真的通了，于是暴露出真正的问题 ——
// 线上实测 requestedShots=1 也要 30.7s / 59.0s，requestedShots=4 更是 60s/90s 都等不到。
// 它不是挂死，是**真的很慢**；但代码里的 fetch 没有任何超时，
// 于是「慢」与「挂死」在行为上完全一样：请求一直挂着，前端既不报错也不回退。
//
// 三条门禁：单次调用超时 / 整次请求总预算 / 逐模型耗时可见。

/** 永不返回的 fetch：模拟上游彻底挂死（而不是「慢」）。 */
const hangingFetch = () => new Promise(() => {});

test('AI 诊断：单次模型调用超时必须被中断，而不是无限等待', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = hangingFetch;
  try {
    const t0 = Date.now();
    const res = await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, {
      GEMINI_API_KEY: 'k',
      AI_PROVIDER_TIMEOUT_MS: '40',
      // 6.8.8：这个预算原先只有 200ms。实测（8 路并行负载）从请求启动到
      // 第一次模型调用之间的本地工作（治理/意图/资产目录组装）空闲时约 63ms，
      // 负载下会超过 200ms —— 于是预算在第一次调用前就被耗尽，三个候选模型
      // 全部 skipped、一次都没真的发出去，timedOut 恒为 false。
      // 8 路并行下 200ms 预算 5/8 复现该失败，5000ms 预算 8/8 通过。
      // 预算的职责是「兜住整次请求」，不是「比本地准备工作还快」。
      AI_REQUEST_BUDGET_MS: '5000'
    });
    const elapsed = Date.now() - t0;
    const data = await res.json();

    // 上界取「总预算 + 一次在途超时 + 本地兜底与响应组装」的余量：
    // 5000 + 40 + ~200，给到 15000 仍能在真挂死时立刻区分出来。
    assert.ok(elapsed < 15000, `超时没有被真正执行，请求耗时 ${elapsed}ms`);
    assert.equal(data.isAiGenerated, false);
    assert.equal(data.aiStatus.timedOut, true, 'aiStatus 必须标记出发生过超时');

    const gemini = data.aiStatus.providers.find(p => p.id === 'gemini');
    assert.ok(gemini.calls.length >= 1, '必须留下逐次调用记录');
    const first = gemini.calls[0];
    assert.equal(first.model, 'gemini-2.5-flash');
    assert.equal(first.ok, false);
    assert.equal(first.timedOut, true, '超时必须被单独标出来，否则与 404/403 混为一谈');
    assert.ok(first.ms >= 40, `必须记录真实耗时，实际 ${first.ms}ms`);
    assert.match(first.error, /超时/);

    // 光说「超时」不够，必须告诉用户下一步怎么办
    assert.match(gemini.advice, /超时/);
    assert.match(gemini.advice, /GEMINI_MODEL|AI_PROVIDER_TIMEOUT_MS/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：必须逐模型记录耗时，才能测出到底哪个模型慢', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const model = JSON.parse(options.body).model;
    // 6.8.7 重排后第一个候选是 gemini-2.5-flash：让它慢且失败，
    // 第二个（3.5-flash-lite）快且也失败，第三个（3.8-flash）快且成功 ——
    // 这样「慢模型与快模型必须能区分开」才有可区分的一对。
    await new Promise(r => setTimeout(r, model === 'gemini-2.5-flash' ? 60 : 10));
    if (model !== 'gemini-3.8-flash') return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        matchedMovie: '测试片',
        shots: [{
          phase: 'establish',
          action: '乐高特战小队推进。',
          assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' }
        }]
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const data = await (await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GEMINI_API_KEY: 'k' })).json();
    const gemini = data.aiStatus.providers.find(p => p.id === 'gemini');

    assert.deepEqual(
      gemini.calls.map(c => c.model),
      // 6.8.7 按发布后实测重排：gemini-3.8-flash 两次采样都 503（从未成功），
      // 因此从首位挪到末位；2.5-flash 与 3.5-flash-lite 各有一次成功记录。
      ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
      '必须逐个候选模型留下记录，顺序与实际尝试一致'
    );
    assert.deepEqual(gemini.calls.map(c => c.ok), [false, false, true]);
    assert.ok(gemini.calls[0].ms >= 60, `第一个模型真的很慢，必须记录下来，实际 ${gemini.calls[0].ms}ms`);
    assert.ok(
      gemini.calls[0].ms > gemini.calls[1].ms,
      '慢的模型与快的模型必须能区分开 —— 否则「哪个模型慢」永远只能靠猜'
    );
    assert.equal(gemini.totalMs, gemini.calls.reduce((s, c) => s + c.ms, 0), 'provider 级总耗时必须是逐次之和');
    assert.equal(data.isAiGenerated, true);
    assert.equal(data.aiStatus.activeProvider, 'gemini');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：总预算耗尽后必须停止尝试，而不是继续烧时间', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = hangingFetch;
  try {
    const t0 = Date.now();
    const data = await (await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, {
      GEMINI_API_KEY: 'k',
      AI_PROVIDER_TIMEOUT_MS: '300',
      AI_REQUEST_BUDGET_MS: '300'
    })).json();
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 3000, `总预算没有生效，请求耗时 ${elapsed}ms`);
    assert.equal(data.aiStatus.budgetMs, 300);
    assert.equal(data.aiStatus.budgetExhausted, true, '总预算耗尽必须被如实标记');
    const gemini = data.aiStatus.providers.find(p => p.id === 'gemini');
    assert.ok(
      gemini.calls.some(c => c.skipped === true),
      '预算耗尽后剩余的候选模型必须被跳过，否则「总预算」只是装饰'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI 诊断：自检必须报告当前生效的超时与预算', async () => {
  const data = await (await probe({ AI_PROVIDER_TIMEOUT_MS: '1234', AI_REQUEST_BUDGET_MS: '5678' })).json();
  assert.equal(data.timeouts.perModelMs, 1234);
  assert.equal(data.timeouts.totalMs, 5678);
  assert.equal(data.timeouts.perModelEnvVar, 'AI_PROVIDER_TIMEOUT_MS');
  assert.equal(data.timeouts.totalEnvVar, 'AI_REQUEST_BUDGET_MS');
});

test('AI 诊断：非法超时配置一律退回默认，不能让 0 或负数把路径掐死', async () => {
  const data = await (await probe({ AI_PROVIDER_TIMEOUT_MS: '0', AI_REQUEST_BUDGET_MS: '-5' })).json();
  assert.equal(data.timeouts.perModelMs, 60000);
  assert.equal(data.timeouts.totalMs, 120000);
});

test('6.8.6 · 前端：云端长时间不返回必须中断并如实回退，而不是无限等待', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = hangingFetch;
  const progress = [];
  try {
    const t0 = Date.now();
    const result = await callAiBrain({
      query: '北极冰原上的雷达站遭遇突袭',
      requestedShots: 2,
      onProgress: (m) => progress.push(m),
      timeoutMs: 60,
      progressIntervalMs: 10
    });
    const elapsed = Date.now() - t0;

    assert.ok(elapsed < 5000, `前端超时没有生效，耗时 ${elapsed}ms`);
    assert.equal(result.isAiGenerated, false);
    assert.ok(result.aiStatus, '前端超时也必须带诊断，否则徽章又只能含糊其辞');
    assert.equal(result.aiStatus.reason, 'FRONTEND_TIMEOUT');
    assert.ok(Array.isArray(result.shots) && result.shots.length > 0, '超时后仍必须出片（回退本地引擎）');
    assert.ok(
      progress.some(m => /已等待 \d+ 秒/.test(m)),
      '等待期间必须有「已等待 N 秒」的心跳 —— 否则几十秒的合法等待与界面卡死观感完全一样'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.6 · 前端：后台返回非 2xx 时必须回显状态码，不能含糊其辞', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'RATE_LIMITED' }), {
    status: 429,
    headers: { 'content-type': 'application/json' }
  });
  try {
    const result = await callAiBrain({ query: '北极冰原上的雷达站遭遇突袭', requestedShots: 2 });
    assert.equal(result.aiStatus.reason, 'BACKEND_ERROR');
    assert.match(result.aiStatus.hint, /429/);
    assert.match(result.aiStatus.hint, /RATE_LIMITED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.6 · 源码门禁：所有 fetch 都必须带超时（防「慢」与「挂死」再次混为一谈）', () => {
  const backend = readFileSync(new URL('../functions/api/ai-brain.js', import.meta.url), 'utf8');
  assert.ok(!/await\s+fetch\(/.test(backend), '后端所有 fetch 都必须包在 withTimeout 里');
  assert.match(backend, /AbortController/, '超时必须真的 abort 底层连接，否则连接仍挂着白占额度');
  assert.match(backend, /AI_PROVIDER_TIMEOUT_MS/);
  assert.match(backend, /AI_REQUEST_BUDGET_MS/);

  const frontend = readFileSync(new URL('../src/domain/ai-brain.js', import.meta.url), 'utf8');
  assert.ok(!/await\s+fetch\(/.test(frontend), '前端 fetch 必须走 Promise.race 超时，否则后端挂住时界面会一直等');
  assert.match(frontend, /FRONTEND_TIMEOUT_MS/);
});

// ── 6.8.7：JSON 模式按模型生效，不再按 provider 一把切 ──────────────────
//
// 起因：OpenRouter 免费档里，「支持 response_format」与「不支持」的模型混在同一家。
// 对不支持的模型发这个参数，上游直接 4xx —— 于是「配了 Key 却整个 provider 都不通」。
// 这里立门禁：声明了 jsonMode 的模型必须按声明发；没声明的沿用 provider 默认。

const OK_BODY = JSON.stringify({
  matchedMovie: '测试片',
  shots: [{
    phase: 'establish',
    fn: 'goal',
    action: '乐高特战小队在雷达站外沿低温推进。',
    assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' }
  }]
});

test('6.8.7 · JSON 模式必须按模型生效：声明的以模型为准，未声明的沿用 provider 默认', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('openrouter.ai')) throw new Error('非预期调用：' + u);
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    seen.push({ model: body && body.model, hasJson: Boolean(body && body.response_format) });
    // 只让名单里第二个模型成功，好让第一个（jsonMode: false）也被真实调用到
    if (body && body.model === 'nvidia/nemotron-3-super-120b-a12b:free') {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: OK_BODY } }] }) };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  };

  try {
    const data = await (await call(
      { query: '北极冰原上的雷达站遭遇突袭', requestedShots: 1 },
      'POST', {}, { OPENROUTER_API_KEY: 'k' }
    )).json();

    // 第一个候选（nemotron-3-ultra-550b，实测不支持 response_format）不得带该参数
    const first = seen.find(s => s.model === 'nvidia/nemotron-3-ultra-550b-a55b:free');
    assert.ok(first, '必须真的调用到第一个候选模型');
    assert.equal(first.hasJson, false,
      '对不支持 response_format 的模型发这个参数会让上游 4xx，整个 provider 都会失败');

    // 第二个候选（nemotron-3-super-120b，实测支持）必须带上该参数
    const second = seen.find(s => s.model === 'nvidia/nemotron-3-super-120b-a12b:free');
    assert.ok(second, '第一个失败后必须继续试第二个候选');
    assert.equal(second.hasJson, true,
      '模型声明了支持 JSON 模式，就必须真的发 response_format');

    assert.equal(data.isAiGenerated, true, '第二个候选成功后本次应由云端 AI 生成');
    assert.equal(data.aiStatus.activeProvider, 'openrouter');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.7 · 环境变量覆盖的模型名沿用 provider 默认（不允许因为覆盖而静默改语义）', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (!u.includes('openrouter.ai')) throw new Error('非预期调用：' + u);
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    seen.push({ model: body && body.model, hasJson: Boolean(body && body.response_format) });
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: OK_BODY } }] }) };
  };

  try {
    await (await call(
      { query: '北极冰原上的雷达站遭遇突袭', requestedShots: 1 },
      'POST', {},
      { OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'google/gemma-4-31b-it:free' }
    )).json();

    assert.equal(seen.length, 1, '环境变量覆盖后只应尝试指定的那一个模型');
    assert.equal(seen[0].model, 'google/gemma-4-31b-it:free');
    // provider 默认是 false，覆盖名没有显式声明 → 沿用默认
    assert.equal(seen[0].hasJson, false,
      '环境变量覆盖只给模型名，JSON 模式应沿用 provider 默认，不能凭空改变语义');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.7 · 自检必须报出每个模型是否要求 JSON 模式，便于运维核对上游支持情况', async () => {
  const res = await probe({ OPENROUTER_API_KEY: 'k' });
  const d = await res.json();
  const or = d.providers.find(p => p.id === 'openrouter');

  assert.equal(or.models[0], 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(or.jsonModes[0], false, '550b 实测不支持 response_format，必须如实报 false');
  assert.equal(or.models[1], 'nvidia/nemotron-3-super-120b-a12b:free');
  assert.equal(or.jsonModes[1], true, '120b 实测支持 response_format，必须如实报 true');
  assert.equal(or.models.length, or.jsonModes.length, '两个数组必须等长、一一对应');
  assert.ok(or.models.every(m => !/gemini|llama-3\.3/.test(m)), '不得混入其他 provider 的模型');
});

// ── 6.8.8：限流按客户端隔离，且超限响应必须如实可辨 ──────────────────────
//
// 这个门禁的起因就是本套件自己：所有调用都不带 cf-connecting-ip，
// 一起挤在 'anonymous' 桶里，第 31 次起全部 429，而 429 响应体没有
// aiStatus —— 下游测试于是随机报 "Cannot read properties of undefined"。
// 上面各 helper 已改为每次调用换一个独立 IP；这里守的是限流器本身：
// 同一客户端超限必须 429，别的客户端不受牵连，且超限响应里不会凭空冒出 aiStatus。
test('6.8.8 · 同一客户端超限必须 429 RATE_LIMITED，且不同客户端互不影响', async () => {
  const originalFetch = globalThis.fetch;
  // 桩掉 fetch：只求快速走完整条「provider 全失败 → 本地兜底」链路，绝不外网。
  globalThis.fetch = async () => new Response('Forbidden', { status: 403 });
  try {
    const hammer = { 'cf-connecting-ip': 'hammer-client-6.8.8' };
    let limited = null;
    for (let i = 1; i <= 31; i++) {
      const res = await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', hammer, { GROQ_API_KEY: 'k' });
      if (res.status === 429) { limited = res; break; }
      assert.equal(res.status, 200, `第 ${i} 次调用应放行（限流阈值是 30 次/60s）`);
    }
    assert.ok(limited, '同一客户端第 31 次调用必须被限流，否则限流形同虚设');

    const body = await limited.json();
    assert.equal(body.error, 'RATE_LIMITED');
    assert.ok(body.retryAfterMs > 0 && body.retryAfterMs <= 60000, '必须告诉客户端多久后可以重试');
    assert.equal(body.aiStatus, undefined,
      '限流短路发生在诊断之前，响应体不带 aiStatus —— 这正是测试 helper 必须每次换 IP 的原因');

    // 换一个客户端立刻恢复：限流必须按客户端隔离
    const other = await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    assert.equal(other.status, 200, '一个客户端超限不能连累其他客户端');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
