import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/compose.js';

// ⚠️ 共享限流桶警示（6.8.8）：AUTH_MODE=disabled 时 compose 的限流客户端标识
// 恒为 'development'，本文件所有调用共用同一个桶（30 次/60s 滑动窗口）。
// 超限会拿到 429 RATE_LIMITED，而 429 响应体没有正常业务的字段，
// 下游断言会变成 "Cannot read properties of undefined" 这类莫名失败。
// 目前本文件调用量远低于限额；若后续加用例，先数一遍调用次数，
// 或改用 AUTH_MODE:'access' + 每个用例一个独立 cf-access-authenticated-user-email。
// 限流器契约见 tests/rate-limit-contract.test.mjs。

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
