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
