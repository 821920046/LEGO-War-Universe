import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, ensureOpposingPresence, resetCircuitForTests } from '../functions/api/ai-brain.js';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { validateShotSpec } from '../src/domain/shot-spec.js';
import { collectValidIds } from '../src/domain/asset-catalog.js';

const registry = createRegistry(assets, profiles, { references: [] });

// 每次调用都带**唯一**的 cf-connecting-ip：否则本套件的调用全部落进
// 同一个 'anonymous' 限流桶（30 次/60s），打爆后拿到 429，而 429 响应体
// 没有 roster，下游断言会变成与被测行为无关的 TypeError。
// 详见 tests/ai-diagnosis.test.mjs 顶部注释与 tests/rate-limit-contract.test.mjs。
let clientSeq = 0;
const freshClientIp = () => `test-client-${process.pid}-${++clientSeq}`;

// 6.9.0：熔断器是模块级状态 —— 与限流桶同型的跨用例污染源（见 ai-diagnosis.test.mjs）。
afterEach(() => {
  resetCircuitForTests();
});

const call = (body, method = 'POST', headers = {}, env = {}) => {
  const req = new Request('https://lwu.example/api/ai-brain', {
    method,
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshClientIp(), ...headers },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });
  return onRequest({ request: req, env });
};

test('Backend AI Brain: rejects GET with 405 Method Not Allowed', async () => {
  const res = await call({}, 'GET');
  assert.equal(res.status, 405);
});

test('Backend AI Brain: accepts OPTIONS with 204 No Content', async () => {
  const res = await call({}, 'OPTIONS');
  assert.equal(res.status, 204);
});

test('Backend AI Brain: rejects missing query with 400', async () => {
  const res = await call({ query: '' });
  assert.equal(res.status, 400);
});

test('Backend AI Brain: gracefully falls back to built-in engine and outputs full film plan', async () => {
  const res = await call({ query: '壮志凌云', requestedShots: 4 });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.ok(data.matchedMovie.includes('壮志凌云'));
  assert.equal(data.shots.length, 4);
  assert.ok(data.shots[0].action.includes('隐形五代战机'));
  // 6.8.1：离线兜底现在要如实区分「策展复刻」与「原创生成」，不能再笼统写
  // 「本地高保真离线引擎」——那句话让用户以为内容是 AI 生成的。
  assert.equal(data.contentKind, 'curated');
  assert.equal(data.isAiGenerated, false);
  assert.ok(data.engine.includes('策展致敬库'), `引擎标签应如实标注为策展复刻：${data.engine}`);
  assert.equal(data.governance.status, 'passed');
});

test('Backend AI Brain: blocks normalized policy evasion before provider or local generation', async () => {
  const res = await call({ query: 't r u m p tactical plan' });
  assert.equal(res.status, 403);
  const data = await res.json();
  assert.equal(data.error, 'CONTENT_BLOCKED');
  assert.ok(data.flags.includes('REAL_POLITICAL_FIGURE'));
});

test('Backend AI Brain: marks review-required requests in its API response', async () => {
  const res = await call({ query: '俄乌冲突前线撤离' });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.reviewRequired, true);
  assert.equal(data.governance.status, 'review_required');
  assert.ok(data.flags.includes('SENSITIVE_MODERN_CONFLICT'));
});

test('Backend AI Brain: bounds query length and requested shot count', async () => {
  const longQuery = await call({ query: 'x'.repeat(1201) });
  assert.equal(longQuery.status, 413);
  assert.equal((await longQuery.json()).error, 'QUERY_TOO_LONG');

  const tooMany = await call({ query: 'safe', requestedShots: 1000 });
  assert.equal(tooMany.status, 400);
  assert.equal((await tooMany.json()).error, 'INVALID_REQUESTED_SHOTS');
});

test('Backend AI Brain: rejects blocked generated content before returning provider output', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ shots: [{ action: 'Graphic torture scene' }] }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await call({ query: 'safe cinematic scene', requestedShots: 1 }, 'POST', {}, { GROQ_API_KEY: 'test-key' });
    assert.equal(res.status, 502);
    const data = await res.json();
    assert.equal(data.error, 'GENERATED_CONTENT_BLOCKED');
    assert.ok(data.flags.includes('GRAPHIC_VIOLENCE_AND_HARM'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Backend AI Brain: only echoes the exact configured CORS origin', async () => {
  const allowed = await call({}, 'OPTIONS', { origin: 'https://lwu.example' }, { ALLOWED_ORIGIN: 'https://lwu.example' });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://lwu.example');

  const denied = await call({}, 'OPTIONS', { origin: 'https://attacker.example' }, { ALLOWED_ORIGIN: 'https://lwu.example' });
  assert.equal(denied.headers.get('access-control-allow-origin'), null);

  const unconfigured = await call({}, 'OPTIONS', { origin: 'https://attacker.example' });
  assert.equal(unconfigured.headers.get('access-control-allow-origin'), null);
});

test('Backend AI Brain: injects the real asset catalog into the provider prompt', async () => {
  const originalFetch = globalThis.fetch;
  let sentSystem = '';
  let sentUser = '';
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    sentSystem = body.messages.find(m => m.role === 'system')?.content || '';
    sentUser = body.messages.find(m => m.role === 'user')?.content || '';
    // 6.9.0 润色形状：一镜一条、shotId 与基底一致、只回三个文本字段
    const ids = [...sentUser.matchAll(/"shotId":"(shot_\d+)"/g)].map(m => m[1]);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        recognized: false,
        shots: ids.map((id, i) => ({
          shotId: id,
          action: `乐高无人机蜂群第 ${i + 1} 波次升空，旋翼切开晨雾。`,
          audioCue: `电机蜂鸣 ${i}`,
          radioVoice: ''
        }))
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await call({ query: '无人机蜂群现代战争', requestedShots: 1 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    assert.equal(res.status, 200);
    // 注入的目录必须是真实资产 ID，而不是空白想象
    assert.match(sentSystem, /CHR-\d{3}=/);
    assert.match(sentSystem, /【角色人仔】/);
    assert.match(sentSystem, /可用真实资产清单/);
    // 6.9.0：润色契约的核心指令必须真的在 prompt 里（不是只写在注释里）
    assert.match(sentSystem, /润色，不是重写/);
    assert.match(sentSystem, /结构冻结/);
    assert.match(sentSystem, /只输出三个文本字段/);
    assert.match(sentUser, /分镜基底（结构已锁定，供润色）/);
    assert.match(sentUser, /shotId 与基底逐字一致/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Backend AI Brain: drops hallucinated asset IDs and reports them', async () => {
  // 6.9.0 契约迁移：AI 再也**没有机会**提供资产 ID —— subjects/phase/assets
  // 一律来自本地基底。本门禁的形态从「事后清洗」变成「结构性不可能」：
  // 即使模型在润色条目里夹带 subjects / 资产 ID，合并层也只认三个文本字段。
  const baseRes = await call({ query: '现代高科技无人机作战', requestedShots: 2 });
  const baseData = await baseRes.json();
  const baseStructure = baseData.shots.map(s => JSON.stringify({
    shotId: s.shotId, phase: s.phase, fn: s.fn, shotType: s.shotType,
    subjects: s.subjects, environment: s.environment, camera: s.camera,
    lighting: s.lighting, colorGrade: s.colorGrade, fx: s.fx, audio: s.audio
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const user = body.messages.find(m => m.role === 'user')?.content || '';
    const ids = [...user.matchAll(/"shotId":"(shot_\d+)"/g)].map(m => m[1]);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        // 模型试图夹带：资产字段 + 幻觉 ID + 自创镜头
        shots: ids.map((id, i) => ({
          shotId: id,
          action: `乐高无人机群第 ${i + 1} 波次俯冲，蜂群锁定目标。`,
          audioCue: `旋翼蜂鸣 ${i}`,
          radioVoice: '',
          subjects: ['CHR-401', 'ZZZ-999'],
          environment: 'ENV-999',
          camera: 'CAM-999',
          phase: 'climax',
          fn: 'goal',
          assets: { subjects: ['ZZZ-999'], environment: 'ENV-999', camera: 'CAM-999', lighting: 'LGT-999', colorGrade: 'CLR-999', fx: ['FX-999'], audio: ['AUD-999'] }
        })).concat([{ shotId: 'shot_99', action: '自创的幻觉镜头' }]),
        proposedAssets: [{ name: 'Sonic Disruptor', nameZh: '声波压制器', group: 'weapons' }]
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const res = await call({ query: '现代高科技无人机作战', requestedShots: 2 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isAiGenerated, true);

    // 结构逐字段冻结：AI 夹带的资产 ID / phase / fn / 自创镜头全部无效
    const finalStructure = data.shots.map(s => JSON.stringify({
      shotId: s.shotId, phase: s.phase, fn: s.fn, shotType: s.shotType,
      subjects: s.subjects, environment: s.environment, camera: s.camera,
      lighting: s.lighting, colorGrade: s.colorGrade, fx: s.fx, audio: s.audio
    }));
    assert.deepEqual(finalStructure, baseStructure, '润色后结构必须与本地基底完全一致');

    // 幻觉 ID 绝不能进入最终分镜（任何字段）
    const allIds = data.shots.flatMap(s => [
      ...(Array.isArray(s.subjects) ? s.subjects : []),
      s.environment, s.camera, s.lighting, s.colorGrade,
      ...(Array.isArray(s.fx) ? s.fx : []), ...(Array.isArray(s.audio) ? s.audio : [])
    ]).filter(Boolean);
    const validIds = collectValidIds(assets);
    for (const id of allIds) {
      assert.ok(validIds.has(id), `最终分镜出现资产库之外的 ID：${id}`);
    }
    // 资产统计必须如实：基底全部来自真实资产库
    assert.deepEqual(data.assetUsage.unknown, [], '结构冻结后不存在未知 ID');
    assert.ok(data.assetUsage.matched > 0);
    // 自创镜头被记账拒绝，而不是偷偷混进来
    assert.ok(data.polish.rejected.some(x => x.reason === 'UNMATCHED_SHOT' || x.shotId === 'shot_99'),
      `自创镜头必须被记账拒绝，实际：${JSON.stringify(data.polish.rejected)}`);

    // 模型建议的新资产仍然透传给前端进化引擎
    assert.equal(data.proposedAssets.length, 1);
    assert.equal(data.proposedAssets[0].nameZh, '声波压制器');

    // 关键：补入敌军后，成片绝不能触发阵营冲突校验
    for (const shot of data.shots) {
      const check = validateShotSpec(shot, registry, { era: data.era });
      const conflict = (check.violations || []).filter(v => v.code === 'FACTION_CONFLICT_INVALID');
      assert.equal(conflict.length, 0, `S${shot.shotId} 触发阵营冲突: ${JSON.stringify(conflict)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Backend AI Brain: 仅在合法对抗语义的镜头补入敌人（非战斗/协同镜头绝不硬塞）', () => {
  // 6.9.0：守卫作用点前移到 AI 之前，于是这道门禁可以直接单元测试守卫本身
  // （不再需要 mock 模型去控制哪些镜头有交战语义）。
  const opposing = ['CHR-914', 'CHR-630'];
  const craft = (phase, action) => ({
    shotId: `s_${action.length}`, phase, action, subjects: ['CHR-401']
  });
  const out = ensureOpposingPresence([
    craft('build', '小队在雨夜中静默潜行，全程保持无线电静默。'),      // 无战斗语义
    craft('climax', '队员在废墟中默默集结待命，等待撤离窗口。'),        // 无战斗语义
    craft('climax', '小队与友军并肩交战，掩护彼此推进。'),              // 协同语义，必须排除
    craft('climax', '正面开火交战，重机枪压制敌方火力点。'),            // 合法对抗语义
    craft('establish', '黎明前的阵地全景，旗帜在风中静止。')            // 非 build/climax
  ], opposing);

  const hasFoe = s => (s.subjects || []).some(id => opposing.includes(id));
  assert.equal(hasFoe(out.shots[0]), false, '无合法对抗语义的镜头不得被补入敌方角色');
  assert.equal(hasFoe(out.shots[1]), false, '无合法对抗语义的镜头不得被补入敌方角色');
  assert.equal(hasFoe(out.shots[2]), false, '协同语义（并肩交战）不得被补入敌方角色');
  assert.equal(hasFoe(out.shots[3]), true, '具备合法对抗语义的镜头应补入敌方角色');
  assert.equal(hasFoe(out.shots[4]), false, '非 build/climax 阶段不得补入');
  // 已有敌军的基底不做任何补入（守卫是幂等的）
  const already = ensureOpposingPresence([{ ...craft('climax', '正面开火交战，压制敌方火力点。'), subjects: ['CHR-401', 'CHR-914'] }], opposing);
  assert.deepEqual(already.shots[0].subjects, ['CHR-401', 'CHR-914']);
  assert.equal(already.injected, 0);
  // 没有敌方 ID 可用时必须原样返回，绝不能崩
  assert.deepEqual(ensureOpposingPresence([craft('climax', '正面开火交战。')], []).shots[0].subjects, ['CHR-401']);
});

test('Backend AI Brain: returns a frozen cast roster with unique callsigns', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      matchedMovie: '测试片',
      shots: [
        { phase: 'establish', action: '特战小队在城市废墟中推进。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        { phase: 'build', action: '【BASILISK】与敌人哨兵交火压制。', assets: { subjects: ['CHR-401', 'CHR-412'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        { phase: 'climax', action: '正面开火交战，重机枪压制敌方火力点。', assets: { subjects: ['CHR-401', 'CHR-619'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        { phase: 'resolve', action: '硝烟散去，队员撤离废墟。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } }
      ]
    }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await call({ query: '现代特战城市巷战', requestedShots: 4 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    const data = await res.json();
    assert.ok(Array.isArray(data.roster));
    assert.ok(data.roster.length >= 2);
    const callsigns = data.roster.map(r => r.callsign);
    assert.equal(new Set(callsigns).size, callsigns.length, 'callsigns must be unique within one film');
    for (const entry of data.roster) {
      assert.ok(entry.id && entry.callsign && entry.name);
      assert.ok(['coalition', 'opposing', 'neutral'].includes(entry.side));
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Backend AI Brain: injects a deterministic cast with callsigns into the provider prompt', async () => {
  const originalFetch = globalThis.fetch;
  let sentSystem = '';
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    sentSystem = body.messages.find(m => m.role === 'system')?.content || '';
    const user = body.messages.find(m => m.role === 'user')?.content || '';
    const ids = [...user.matchAll(/"shotId":"(shot_\d+)"/g)].map(m => m[1]);
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        recognized: false,
        shots: ids.map((id, i) => ({ shotId: id, action: `特战小队第 ${i + 1} 镜推进。`, audioCue: '', radioVoice: '' }))
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    // 4 镜：本地基底名册会同时含敌我两侧（1 镜基底实测只有敌方，
    // 那是规划器的事，与 prompt 注入无关）
    await call({ query: '现代特战城市巷战', requestedShots: 4 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    // 模型必须拿到「固定阵容 + 代号」：否则润色台词时会发明新称呼，
    // 与下游 script-callsign 契约（台词代号必须来自名册）直接冲突
    assert.match(sentSystem, /本片固定阵容/);
    assert.match(sentSystem, /COALITION CAST:/);
    assert.match(sentSystem, /OPPOSING CAST:/);
    assert.match(sentSystem, /角色称呼沿用基底里的【代号】/);
    assert.match(sentSystem, /绝不允许发明新代号/);
    // 反复读纪律：0 个镜头也要各不相同（6.8.x 实测模型爱把一句话复制到多镜）
    assert.match(sentSystem, /每镜 action 必须彼此明显不同/);
    assert.match(sentSystem, /严禁把同一句话复制到多个镜头/);
    // 原创性纪律
    assert.match(sentSystem, /原创性/);
    assert.match(sentSystem, /禁止复述任何原作的经典桥段/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
