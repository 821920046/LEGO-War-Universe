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
});
