import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/ai-brain.js';

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
        { phase: 'climax', action: '定向能激光与蜂群对轰。', assets: { subjects: ['CHR-630', 'ZZZ-999'], environment: 'ENV-640', camera: 'CAM-801', lighting: 'LGT-001', colorGrade: 'CLR-001', fx: ['FX-801'], audio: ['AUD-801'] } }
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
    assert.deepEqual(data.shots[1].subjects, ['CHR-630']);
    assert.equal(data.proposedAssets.length, 1);
    assert.equal(data.proposedAssets[0].nameZh, '声波压制器');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
