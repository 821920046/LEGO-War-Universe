import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/compose.js';

const call = async (env, body, headers = {}) => {
  const req = new Request('https://lwu.example/api/compose', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  return onRequest({ request: req, env });
};

const devEnv = { ENVIRONMENT: 'development', AUTH_MODE: 'disabled' };

test('Orchestration: blocked content policy topic returns 403 CONTENT_BLOCKED', async () => {
  const res = await call(devEnv, { theme: '关于普京的作战指令' });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'CONTENT_BLOCKED');
  assert.ok(body.flags.includes('REAL_POLITICAL_FIGURE'));
});

test('Orchestration: review required topic returns 200 with reviewRequired flag', async () => {
  const res = await call(devEnv, { theme: '俄乌冲突前线撤离平民' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.reviewRequired, true);
  assert.ok(body.flags.length > 0);
});

test('Orchestration: compliant topic returns 200 with planned and compiled shots', async () => {
  const res = await call(devEnv, { theme: '航母战斗群在远海风暴中放飞舰载机', requestedShots: 2 });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.shots.length, 2);
  assert.ok(body.shots[0].prompt.includes('Screen direction:'));
});
