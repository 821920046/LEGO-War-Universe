import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/ai-brain.js';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { validateShotSpec } from '../src/domain/shot-spec.js';

const registry = createRegistry(assets, profiles, { references: [] });

const call = (body, method = 'POST', headers = {}, env = {}) => {
  const req = new Request('https://lwu.example/api/ai-brain', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
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
  assert.ok(data.engine.includes('本地高保真离线引擎'));
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
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        matchedMovie: '无人机战争',
        shots: [{ phase: 'establish', action: '乐高无人机蜂群升空。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } }]
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
    assert.match(sentUser, /assets 字段必须使用上方清单中的真实 ID/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Backend AI Brain: drops hallucinated asset IDs and reports them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      matchedMovie: '测试片',
      shots: [
        { phase: 'establish', action: '乐高特战小队推进。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        { phase: 'climax', action: '敌方防空火力压制我方无人机群，双方在电磁黑域中交战。', assets: { subjects: ['CHR-630', 'ZZZ-999'], environment: 'ENV-640', camera: 'CAM-801', lighting: 'LGT-001', colorGrade: 'CLR-001', fx: ['FX-801'], audio: ['AUD-801'] } }
      ],
      proposedAssets: [{ name: 'Sonic Disruptor', nameZh: '声波压制器', group: 'weapons' }]
    }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await call({ query: '现代高科技无人机作战', requestedShots: 2 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.isAiGenerated, true);
    assert.ok(data.assetUsage.matched > 0);
    assert.ok(data.assetUsage.unknown.includes('ZZZ-999'));
    // 幻觉 ID 绝不能进入最终分镜
    for (const shot of data.shots) {
      assert.ok(!(shot.subjects || []).includes('ZZZ-999'));
    }
    // 真实 ID 必须保留
    assert.ok(data.shots[1].subjects.includes('CHR-630'));
    // 模型只写了友军时，后端必须在含交战语义的镜头里补上敌方，保证「敌对双方都出场」
    const opposingIds = data.roster.filter(r => r.side === 'opposing').map(r => r.id);
    assert.ok(opposingIds.length > 0, 'expected a deterministic opposing cast for this era');
    assert.ok(
      data.shots.some(s => (s.subjects || []).some(id => opposingIds.includes(id))),
      'expected at least one shot to actually feature an opposing-faction asset'
    );
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

test('Backend AI Brain: 仅在合法对抗语义的镜头补入敌人（非战斗/协同镜头绝不硬塞）', async () => {
  const originalFetch = globalThis.fetch;
  // 对抗审查用例：四个镜头中只有 S4 具备合法对抗语义，
  // 因此必须满足「S4 补入了敌人（证明补入逻辑没被整体关掉）」且「S1~S3 一个敌人都没有」。
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      matchedMovie: '测试片',
      shots: [
        // S1 静默潜行：无战斗语义
        { phase: 'build', action: '小队在雨夜中静默潜行，全程保持无线电静默。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        // S2 集结待命：无战斗语义
        { phase: 'climax', action: '队员在废墟中默默集结待命，等待撤离窗口。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        // S3 并肩交战：含「交战」但同时是协同语义，必须排除
        { phase: 'climax', action: '小队与友军并肩交战，掩护彼此推进。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } },
        // S4 正面交战：合法对抗语义，应被补入敌人
        { phase: 'climax', action: '正面开火交战，重机枪压制敌方火力点。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } }
      ]
    }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const res = await call({ query: '现代特战城市巷战', requestedShots: 4 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    const data = await res.json();
    const opposingIds = data.roster.filter(r => r.side === 'opposing').map(r => r.id);
    assert.ok(opposingIds.length > 0, '合法对抗镜头存在时，名册里必须有敌方角色（否则本用例是空断言）');

    const hasFoe = shot => (shot.subjects || []).some(id => opposingIds.includes(id));
    // S1~S3：无对抗语义 / 协同语义，绝不补入敌人
    for (const shot of data.shots.slice(0, 3)) {
      assert.ok(!hasFoe(shot), `无合法对抗语义的镜头不得被补入敌方角色: ${shot.action}`);
    }
    // S4：具备合法对抗语义，必须真的补入敌人，证明补入逻辑本身有效
    assert.ok(hasFoe(data.shots[3]), `具备合法对抗语义的镜头应补入敌方角色: ${data.shots[3].action}`);

    // 且每个镜头都必须能通过校验，绝不能因为补入敌人而触发阵营冲突
    for (const shot of data.shots) {
      const check = validateShotSpec(shot, registry, { era: data.era });
      const conflict = (check.violations || []).filter(v => v.code === 'FACTION_CONFLICT_INVALID');
      assert.equal(conflict.length, 0, `S${shot.shotId} 触发阵营冲突: ${JSON.stringify(conflict)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
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
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        matchedMovie: '测试片',
        shots: [{ phase: 'establish', action: '特战小队推进。', assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-001', colorGrade: 'CLR-001' } }]
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await call({ query: '现代特战城市巷战', requestedShots: 1 }, 'POST', {}, { GROQ_API_KEY: 'k' });
    // 模型必须拿到「固定阵容 + 代号」与原创性/反复读纪律，否则它会凭空发明角色并复制粘贴分镜
    assert.match(sentSystem, /本片固定阵容/);
    assert.match(sentSystem, /COALITION CAST:/);
    assert.match(sentSystem, /原创性/);
    assert.match(sentSystem, /禁止复读/);
    assert.match(sentSystem, /敌对双方都要出场/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
