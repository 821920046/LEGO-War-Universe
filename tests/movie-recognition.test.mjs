/**
 * 电影识别真实性门禁（6.8.9 立，6.9.0 随「本地打底 + AI 润色」迁移）
 *
 * 线上实测到的 bug（2026-10-16）：用户输入并非真实电影的片名时，云端模型
 * 不报「查无此片」，而是现编一部电影 —— 并把导演挂到**真实在世导演**名下：
 *   「热带雨林狙击手生死对决」→ 导演：丹尼斯·维伦纽瓦 · 2025
 *   「赛博朋克熊猫特工队大电影」→ 导演：诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦 · 2077
 * 用户视角：UI 还照常显示「乐高适配度高：已完成认证资产」，编造的结果看起来
 * 像一次成功的真实解构。这是 v6.8.x 一直在治的「幻觉」旧疾在新路径上的复发。
 *
 * 6.9.0 架构变化（本地打底 + AI 润色）后，防幻觉的最终形态是三句话：
 *   ① 元数据只可能来自两个可信来源：手写策展库的影片事实，或模型对
 *      「它确切知道的真实影片」的回答。recognized:false 时一律留空；
 *   ② recognized:false **不再作废这次调用** —— 润色照常进行（本地基底已在手，
 *      模型只改三句文案），unrecognized 降级为响应体里的透明标记；
 *   ③ 策展影片的元数据只来自手写库本身，绝不拿去问 AI（问 = 把事实陈述
 *      降级成模型回忆，平白制造幻觉面）。
 *
 * 本文件立四道门禁：
 *   1. 模型如实返回 recognized:false 时：元数据一律留空、润色照常、reason=OK、
 *      unrecognized 透明标记（防幻觉路径 ≠ 故障路径，也 ≠ 润色失败）；
 *   2. 正常识别路径不受影响（recognized:true 照常用模型元数据、照常润色）；
 *   3. 发给模型的 prompt 必须真实包含「不许现编 / 不许挂真实在世导演」规则
 *      （直接断言 prompt 文本，杜绝「规则写在注释里却没进 prompt」）；
 *   4. prompt 模板与响应契约不得被静默删除（静态防回归）。
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest, resetCircuitForTests } from '../functions/api/ai-brain.js';

// 每次调用独立 cf-connecting-ip：避免撞共享限流桶（见 rate-limit-contract.test.mjs）
let clientSeq = 0;
const freshClientIp = () => `test-client-${process.pid}-${++clientSeq}`;

// 6.9.0：熔断器是模块级状态，与限流桶同型的跨用例污染源
afterEach(() => {
  resetCircuitForTests();
});

const originalFetch = globalThis.fetch;

const call = (body, env = {}) => onRequest({
  request: new Request('https://lwu.example/api/ai-brain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshClientIp() },
    body: JSON.stringify(body)
  }),
  env
});

/** 捕获实际发给模型的 system / user prompt，供第 3 道门禁断言 */
function makeCapturingFetch(aiJson) {
  const seen = {};
  globalThis.fetch = async (url, options = {}) => {
    seen.url = String(url);
    const body = JSON.parse(options.body || '{}');
    seen.system = body.messages?.find(m => m.role === 'system')?.content || '';
    seen.user = body.messages?.find(m => m.role === 'user')?.content || '';
    // 6.9.0 润色形状：一镜一条、shotId 从基底素材里原样带回
    const ids = [...seen.user.matchAll(/"shotId":"(shot_\d+)"/g)].map(m => m[1]);
    assert.ok(ids.length > 0, 'prompt 里必须带上基底 shotId（润色素材）');
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        ...aiJson,
        shots: ids.map((id, i) => ({
          shotId: id,
          action: `润色后的第 ${i + 1} 镜动作。`,
          audioCue: `润色音效 ${i}`,
          radioVoice: `润色台词 ${i}`
        }))
      }) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}

test('6.8.9 · 模型如实报告「查无此片」时：元数据一律留空，但润色照常进行', async () => {
  const seen = makeCapturingFetch({ recognized: false });
  try {
    const res = await call({ query: '热带雨林狙击手生死对决', requestedShots: 2 }, { GEMINI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const data = await res.json();

    // ① 编造的元数据绝不留存（模型即使嘴硬给了也要被丢弃 —— recognized:false 时不取）
    assert.equal(data.director, null, `不得透传模型编造的导演，实际：${data.director}`);
    assert.equal(data.matchedMovie, null, `不得透传模型编造的片名，实际：${data.matchedMovie}`);
    assert.equal(data.year, null);

    // ② 6.9.0：recognized:false 不再把成功调用作废 —— 本地基底 + 润色文案照常交付
    assert.equal(data.isAiGenerated, true, '润色成功必须如实标注（本地基底 + 云端文案）');
    assert.match(data.engine, /Cloud Free AI/);
    assert.match(data.engine, /润色本地基底/);
    assert.ok(data.polish.merged >= 1, 'recognized:false 也必须真的润色');
    for (const shot of data.shots) assert.match(shot.action, /润色后的第 \d 镜动作/);

    // ③ 未识别作为透明标记回传，与故障路径明确区分
    assert.equal(data.aiStatus.reason, 'OK', '防幻觉路径不是故障，reason 必须是 OK');
    assert.equal(data.aiStatus.unrecognized, true);

    // 分镜仍然产出（原创不失灵）
    assert.ok(Array.isArray(data.shots) && data.shots.length === 2, '未识别也必须出片（题材转原创）');
    // 治理面不得被拖垮
    assert.equal(data.governance.status, 'passed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 模型嘴硬：recognized:false 却附了编造元数据，元数据也必须被丢弃', async () => {
  // 线上实测形态：模型一边在顶层字段说 recognized:false，一边又把导演/年份写得有鼻子有眼。
  // 后端只认 recognized 这一个口径 —— 为 false 时整套元数据一律不取。
  makeCapturingFetch({
    recognized: false,
    matchedMovie: '完全不存在的电影 (Made Up)', director: '某位真实在世导演', year: '2025', genre: '战争'
  });
  try {
    const data = await (await call({ query: '深海古墓机械龙王', requestedShots: 1 }, { GEMINI_API_KEY: 'k' })).json();
    assert.equal(data.matchedMovie, null, `嘴硬的元数据不得透传，实际：${data.matchedMovie}`);
    assert.equal(data.director, null, `嘴硬的导演不得透传，实际：${data.director}`);
    assert.equal(data.year, null, `嘴硬的年份不得透传，实际：${data.year}`);
    // 但润色不受影响：行为必须只由 recognized 决定，而不是由元数据长什么样决定
    assert.equal(data.isAiGenerated, true);
    assert.equal(data.aiStatus.unrecognized, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 正常识别的真实影片不受影响，照常走云端 AI', async () => {
  makeCapturingFetch({
    recognized: true,
    matchedMovie: '测试片 (Test Film)',
    director: '测试导演',
    year: '2020',
    genre: '动作'
  });
  try {
    const res = await call({ query: '狂怒', requestedShots: 1 }, { GEMINI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.isAiGenerated, true, 'recognized:true 不得被误伤');
    assert.match(data.engine, /Cloud Free AI/);
    assert.equal(data.matchedMovie, '测试片 (Test Film)');
    assert.equal(data.director, '测试导演');
    assert.equal(data.year, '2020');
    assert.equal(data.aiStatus.reason, 'OK');
    assert.equal(data.aiStatus.unrecognized, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 发给模型的 prompt 必须真实包含反幻觉与反挂名规则', async () => {
  const seen = makeCapturingFetch({ recognized: true });
  try {
    await call({ query: '热带雨林狙击手生死对决', requestedShots: 1 }, { GEMINI_API_KEY: 'k' });
    assert.match(seen.system, /最高优先级零：真实性与署名纪律/, 'system prompt 必须带真实性规则段');
    assert.match(seen.system, /recognized/, 'system prompt 必须定义 recognized 字段口径');
    assert.match(seen.system, /绝不允许现编/, '必须有反现编明文');
    assert.match(seen.system, /真实在世导演/, '必须有反挂名明文');
    assert.match(seen.system, /查无此片|片名陌生|用户自编的题材/, '必须要求对陌生片名判 false');
    assert.match(seen.user, /识别判定/, 'user prompt 必须带识别判定指令');
    assert.match(seen.user, /recognized.*必须为 false|"recognized" 必须为 false/, 'user prompt 必须让模型对陌生片名输出 recognized:false');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 静态防回归：prompt 模板与响应契约不得被静默删除', () => {
  // 反幻觉纪律住在契约文件里（前端后台共用同一份），后台必须真的 import 并使用它
  const contract = readFileSync(new URL('../src/domain/polish-contract.js', import.meta.url), 'utf8');
  assert.match(contract, /最高优先级零：真实性与署名纪律/);
  assert.match(contract, /绝不允许现编/);
  assert.match(contract, /把用户自编的题材挂到任何真实在世导演名下/);
  assert.match(contract, /"recognized": true/, 'JSON 契约里必须声明 recognized 字段');

  const src = readFileSync(new URL('../functions/api/ai-brain.js', import.meta.url), 'utf8');
  assert.match(src, /buildPolishSystemPrompt\(/, '后端必须使用共用契约构建 prompt');
  assert.match(src, /result\.recognized === false/, '后端必须处理 recognized:false 分支');
  assert.match(src, /unrecognized: Boolean\(unrecognized\)/, '未识别必须以透明标记回传');

  // 前端必须给这条路径一句人话文案（过渡期 UNRECOGNIZED_INPUT 仍保留作防御）
  const ui = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  assert.match(ui, /UNRECOGNIZED_INPUT/, '前端必须给这条 reason 一句人话文案');
  assert.match(ui, /未识别为已知影片/, '前端必须向用户说明「未识别」的含义');
});
