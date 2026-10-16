/**
 * 6.8.9 电影识别真实性门禁
 *
 * 线上实测到的 bug（2026-10-16）：用户输入并非真实电影的片名时，云端模型
 * 不报「查无此片」，而是现编一部电影 —— 并把导演挂到**真实在世导演**名下：
 *   「热带雨林狙击手生死对决」→ 导演：丹尼斯·维伦纽瓦 · 2025
 *   「赛博朋克熊猫特工队大电影」→ 导演：诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦 · 2077
 * 用户视角：UI 还照常显示「乐高适配度高：已完成认证资产」，编造的结果看起来
 * 像一次成功的真实解构。这是 v6.8.x 一直在治的「幻觉」旧疾在新路径上的复发。
 *
 * 本文件立三道门禁：
 *   1. 模型如实返回 recognized:false 时，后端必须丢弃一切元数据、转本地原创引擎，
 *      aiStatus 必须标 UNRECOGNIZED_INPUT（防幻觉路径 ≠ 故障）；
 *   2. 发给模型的 system/user prompt 必须真实包含「不许现编 / 不许挂真实在世导演」规则
 *      （直接断言 prompt 文本，杜绝「规则写在注释里却没进 prompt」）；
 *   3. 正常识别路径不受影响（recognized:true 照常走云端）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/api/ai-brain.js';

// 每次调用独立 cf-connecting-ip：避免撞共享限流桶（见 rate-limit-contract.test.mjs）
let clientSeq = 0;
const freshClientIp = () => `test-client-${process.pid}-${++clientSeq}`;

const originalFetch = globalThis.fetch;

const call = (body, env = {}) => onRequest({
  request: new Request('https://lwu.example/api/ai-brain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshClientIp() },
    body: JSON.stringify(body)
  }),
  env
});

/** 捕获实际发给模型的 system / user prompt，供第 2 道门禁断言 */
function makeCapturingFetch(aiJson) {
  const seen = {};
  globalThis.fetch = async (url, options = {}) => {
    seen.url = String(url);
    const body = JSON.parse(options.body || '{}');
    seen.system = body.messages?.find(m => m.role === 'system')?.content || '';
    seen.user = body.messages?.find(m => m.role === 'user')?.content || '';
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(aiJson) } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}

const AI_OK_BODY = recognized => ({
  recognized,
  ...(recognized ? {
    matchedMovie: '测试片 (Test Film)',
    director: '测试导演',
    year: '2020',
    genre: '动作'
  } : {
    matchedMovie: '', director: '', year: '', genre: ''
  }),
  dramaticConflict: '测试危机',
  visualGrammar: { cameraMotion: 'm', lightingTone: 'l', soundDesign: 's' },
  legoAdaptation: 'a', creatorTips: 't',
  originality: { logline: 'l', twist: 't', hook: 'h', homageNote: 'n' },
  shots: [{
    phase: 'establish',
    fn: 'goal',
    action: '乐高特战小队在测试环境中推进。',
    assets: { subjects: ['CHR-401'], environment: 'ENV-401', camera: 'CAM-401', lighting: 'LGT-401', colorGrade: 'CLR-401' }
  }]
});

test('6.8.9 · 模型如实报告「查无此片」时必须转本地原创，而不是把编造的元数据当真', async () => {
  const seen = makeCapturingFetch(AI_OK_BODY(false));
  try {
    const res = await call({ query: '热带雨林狙击手生死对决', requestedShots: 1 }, { GEMINI_API_KEY: 'k' });
    assert.equal(res.status, 200);
    const data = await res.json();

    // 必须走本地原创引擎，且如实标注非 AI
    assert.equal(data.isAiGenerated, false, '未识别输入不得标成 AI 生成');
    assert.match(data.engine, /本地|离线/, `engine 应如实标注本地引擎，实际：${data.engine}`);
    // 编造的元数据不得透传
    assert.ok(!data.director, `不得透传模型编造的导演，实际：${data.director}`);
    // 分镜仍然产出（原创不失灵）
    assert.ok(Array.isArray(data.shots) && data.shots.length > 0, '未识别也必须出片（题材转原创）');
    // 治理面不得被拖垮
    assert.equal(data.governance.status, 'passed');
    // 防幻觉路径必须与故障明确区分
    assert.equal(data.aiStatus.reason, 'UNRECOGNIZED_INPUT');
    assert.equal(data.aiStatus.unrecognized, true);
    assert.match(data.aiStatus.hint, /防幻觉|原创/, 'hint 必须说明这是预期路径');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 正常识别的真实影片不受影响，照常走云端 AI', async () => {
  const seen = makeCapturingFetch(AI_OK_BODY(true));
  try {
    const res = await call({ query: '狂怒', requestedShots: 1 }, { GEMINI_API_KEY: 'k' });
    const data = await res.json();
    assert.equal(data.isAiGenerated, true, 'recognized:true 不得被误伤');
    assert.match(data.engine, /Cloud Free AI/);
    assert.equal(data.matchedMovie, '测试片 (Test Film)');
    assert.equal(data.director, '测试导演');
    assert.equal(data.aiStatus.reason, 'OK');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 发给模型的 prompt 必须真实包含反幻觉与反挂名规则', async () => {
  const seen = makeCapturingFetch(AI_OK_BODY(true));
  try {
    await call({ query: '热带雨林狙击手生死对决', requestedShots: 1 }, { GEMINI_API_KEY: 'k' });
    assert.match(seen.system, /最高优先级零：真实性与署名纪律/, 'system prompt 必须带真实性规则段');
    assert.match(seen.system, /recognized/, 'system prompt 必须定义 recognized 字段口径');
    assert.match(seen.system, /绝不允许现编|绝不允许把影片归到真实在世导演名下/, '必须有反现编/反挂名明文');
    assert.match(seen.user, /识别判定/, 'user prompt 必须带识别判定指令');
    assert.match(seen.user, /recognized/, 'user prompt 必须让模型对陌生片名输出 recognized:false');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.8.9 · 静态防回归：prompt 模板与响应契约不得被静默删除', () => {
  const src = readFileSync(new URL('../functions/api/ai-brain.js', import.meta.url), 'utf8');
  assert.match(src, /最高优先级零：真实性与署名纪律/);
  assert.match(src, /"recognized": true/, 'JSON 契约里必须声明 recognized 字段');
  assert.match(src, /result\.recognized === false/, '后端必须处理 recognized:false 分支');
  assert.match(src, /UNRECOGNIZED_INPUT/, 'reason 必须与前端口径一致');
  const ui = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  assert.match(ui, /UNRECOGNIZED_INPUT/, '前端必须给这条 reason 一句人话文案');
});
