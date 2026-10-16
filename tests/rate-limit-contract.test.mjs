/**
 * 限流器契约门禁（6.8.8）
 *
 * 背景：测试套件曾经随机红（6 次连跑挂 3 次）。根因是全套队的调用都不带
 * cf-connecting-ip，所有请求挤进同一个 'anonymous' 桶（30 次/60s，滑动窗口）。
 * 实测 35 次连续调用，第 31 次起全部 429 RATE_LIMITED —— 而 429 的响应体里
 * **没有 aiStatus / roster**，下游断言于是变成
 *   "Cannot read properties of undefined (reading 'providers')"
 * 这种与真正被测行为毫无关系的 TypeError，且是否撞上取决于调用与 60s 窗口
 * 的相对时序，所以表现为随机失败。
 *
 * 直接修复在测试侧：helper 每次调用换一个独立客户端 IP。但那个修复成立的
 * 前提是**限流器本身的行为是对的** —— 按客户端隔离、超限即 429、窗口会轮转、
 * retryAfterMs 有界。这个文件守的就是这些前提；此前它们一条测试都没有。
 *
 * 两个端点的限流器是同一种实现的两份拷贝，都必须守。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRateLimit as checkAiBrainRateLimit } from '../functions/api/ai-brain.js';
import { checkRateLimit as checkComposeRateLimit } from '../functions/api/compose.js';

const T0 = 1_000_000_000_000; // 固定时钟：窗口轮转必须可确定性地测，不能真的等 60 秒
const WINDOW = 60_000;
const MAX = 30;

for (const [name, check] of [
  ['ai-brain', checkAiBrainRateLimit],
  ['compose', checkComposeRateLimit]
]) {
  test(`${name}：同一客户端前 ${MAX} 次放行，第 ${MAX + 1} 次限流`, () => {
    for (let i = 1; i <= MAX; i++) {
      const r = check(`${name}-a`, T0);
      assert.equal(r.limited, false, `第 ${i} 次调用不应被限流`);
    }
    const over = check(`${name}-a`, T0);
    assert.equal(over.limited, true, `第 ${MAX + 1} 次必须被限流`);
    assert.ok(over.retryAfterMs > 0 && over.retryAfterMs <= WINDOW, 'retryAfterMs 必须告诉客户端多久后重试');
  });

  test(`${name}：限流按客户端隔离，一个客户端超限不连累其他客户端`, () => {
    for (let i = 0; i <= MAX; i++) check(`${name}-b`, T0);
    assert.equal(check(`${name}-b`, T0).limited, true, '前置条件：b 已被限流');
    assert.equal(check(`${name}-c`, T0).limited, false, '被限流的客户端不能影响别的客户端');
  });

  test(`${name}：窗口轮转后同一客户端恢复（滑动 60s）`, () => {
    for (let i = 0; i <= MAX; i++) check(`${name}-d`, T0);
    assert.equal(check(`${name}-d`, T0).limited, true, '窗口内持续超限');

    assert.equal(check(`${name}-d`, T0 + WINDOW + 1).limited, false,
      '越过窗口后计数必须重置 —— 否则一个客户端被打爆一次就永远不可用');
  });

  test(`${name}：窗口内未超限时不会被误限`, () => {
    for (let i = 1; i <= MAX; i++) {
      assert.equal(check(`${name}-e`, T0 + i).limited, false,
        `窗口内第 ${i} 次（时钟在推进）不应被限流`);
    }
  });
}
