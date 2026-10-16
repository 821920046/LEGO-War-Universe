/**
 * 6.9.0 熔断器门禁
 *
 * 背景（线上实测 2026-10-16）：Gemini 免费档 503 风暴，一次请求里三个候选
 * 模型全挂（0.4s / 12.3s / 27.5s），而本地基底是毫秒级就能给出的。没有熔断时，
 * **模型过载期间每一次请求都要按顺序把所有候选再撞一遍** —— 用户等了半天，
 * 拿到的却正是第一毫秒就能拿到的东西。熔断器的意义：让失败路径也快。
 *
 * 本文件钉住状态机的五条行为：
 *   1. 连续失败达到阈值才开闸（一次失败不开）；
 *   2. 开闸后直接跳过该 provider，冷却内不再发起调用（由集成测试验证）；
 *   3. 冷却结束自动半开（放行一次尝试）；
 *   4. 半开失败必须以**新冷却期**重开（否则熔断退化成定时重试）；
 *   5. 任何一次成功立即关闸、计数归零。
 *
 * 全部用 now 时钟探针注入时间 —— 60 秒冷却不可能在测试里真等。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { circuitStatus, recordCircuitOutcome, resetCircuitForTests } from '../functions/api/ai-brain.js';

const T0 = 1_000_000_000_000;
const COOLDOWN = 60_000;
const THRESHOLD = 3;

test('6.9.0 熔断 · 初始状态不开闸', () => {
  resetCircuitForTests();
  const st = circuitStatus('gemini', T0);
  assert.equal(st.open, false);
  assert.equal(st.failures, 0);
  assert.equal(st.retryAfterMs, 0);
});

test('6.9.0 熔断 · 未达阈值的连续失败不开闸', () => {
  resetCircuitForTests();
  recordCircuitOutcome('gemini', false, T0);
  recordCircuitOutcome('gemini', false, T0 + 10);
  const st = circuitStatus('gemini', T0 + 20);
  assert.equal(st.open, false, '2 次失败（阈值 3）不得开闸');
  assert.equal(st.failures, 2);
});

test('6.9.0 熔断 · 达到阈值即开闸，冷却内保持开闸', () => {
  resetCircuitForTests();
  recordCircuitOutcome('gemini', false, T0);
  recordCircuitOutcome('gemini', false, T0 + 10);
  recordCircuitOutcome('gemini', false, T0 + 20);
  const st = circuitStatus('gemini', T0 + 30);
  assert.equal(st.open, true, '第 3 次连续失败必须开闸');
  assert.equal(st.failures, 3);
  // 开闸时刻 = 第 3 次失败那一刻（T0+20），不是第一次失败（T0）
  assert.equal(st.retryAfterMs, COOLDOWN - 10);

  // 冷却中后段仍开闸，重试倒计时从开闸时刻起算递减
  const mid = circuitStatus('gemini', T0 + 30_000);
  assert.equal(mid.open, true);
  assert.equal(mid.retryAfterMs, COOLDOWN - 29_980);

  // 冷却边界：差 1ms 到点也不放行
  assert.equal(circuitStatus('gemini', T0 + 20 + COOLDOWN - 1).open, true);
});

test('6.9.0 熔断 · 冷却结束自动半开（放行一次）', () => {
  resetCircuitForTests();
  recordCircuitOutcome('gemini', false, T0);
  recordCircuitOutcome('gemini', false, T0 + 1);
  recordCircuitOutcome('gemini', false, T0 + 2);
  const openedAt = T0 + 2;
  assert.equal(circuitStatus('gemini', openedAt + COOLDOWN - 1).open, true, '差 1ms 到冷却结束也不放行');
  const halfOpen = circuitStatus('gemini', openedAt + COOLDOWN);
  assert.equal(halfOpen.open, false, '冷却结束必须放行（半开）');
  assert.equal(halfOpen.halfOpen, true);
  assert.equal(halfOpen.failures, 3, '半开不重置失败计数（成功才重置）');
});

test('6.9.0 熔断 · 半开失败以新冷却期重开（绝不退化成定时重试）', () => {
  resetCircuitForTests();
  for (let i = 0; i < THRESHOLD; i++) recordCircuitOutcome('gemini', false, T0 + i);
  // 半开窗口内失败 → 必须以新 openedAt 重新开闸
  recordCircuitOutcome('gemini', false, T0 + COOLDOWN + 5);
  const st = circuitStatus('gemini', T0 + COOLDOWN + 10);
  assert.equal(st.open, true, '半开失败必须重新开闸');
  assert.equal(st.retryAfterMs, COOLDOWN - 5, '冷却期必须从半开失败那一刻重新起算');
  const later = circuitStatus('gemini', T0 + COOLDOWN + 40_000);
  assert.equal(later.open, true, '新冷却期未满不得再次放行');
  assert.equal(circuitStatus('gemini', T0 + COOLDOWN * 2 + 5).open, false);
});

test('6.9.0 熔断 · 任何一次成功立即关闸并归零', () => {
  resetCircuitForTests();
  recordCircuitOutcome('gemini', false, T0);
  recordCircuitOutcome('gemini', false, T0 + 1);
  recordCircuitOutcome('gemini', false, T0 + 2);
  assert.equal(circuitStatus('gemini', T0 + 3).open, true);
  recordCircuitOutcome('gemini', true, T0 + 4);
  const st = circuitStatus('gemini', T0 + 5);
  assert.equal(st.open, false);
  assert.equal(st.failures, 0, '成功后计数必须归零');
  // 归零后要重新累计 3 次才会再开闸
  recordCircuitOutcome('gemini', false, T0 + 6);
  recordCircuitOutcome('gemini', false, T0 + 7);
  assert.equal(circuitStatus('gemini', T0 + 8).open, false);
  recordCircuitOutcome('gemini', false, T0 + 9);
  assert.equal(circuitStatus('gemini', T0 + 10).open, true);
});

test('6.9.0 熔断 · 各 provider 独立计数，互不干扰', () => {
  resetCircuitForTests();
  recordCircuitOutcome('groq', false, T0);
  recordCircuitOutcome('groq', false, T0 + 1);
  recordCircuitOutcome('groq', false, T0 + 2);
  assert.equal(circuitStatus('groq', T0 + 3).open, true);
  assert.equal(circuitStatus('gemini', T0 + 3).open, false, 'groq 开闸不得连带 gemini');
  assert.equal(circuitStatus('openrouter', T0 + 3).open, false);
  // 未知 provider 查询不抛，按未开闸处理
  assert.equal(circuitStatus('nonexistent', T0 + 3).open, false);
});
