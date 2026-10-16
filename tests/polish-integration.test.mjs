/**
 * 6.9.0 端到端集成门禁：基底先行 + AI 润色 + 熔断快速回退
 *
 * 覆盖四条主路径与两条不变式：
 *   · 转译 + 云端可用：润色合并进基底（结构逐字段冻结），engine 如实标注
 *   · 转译 + 无 Key / 全失败 / 熔断中：本地基底照常交付，reason 各不相同
 *   · plan 模式（自由战术分镜）：前端发来基底，云端只回润色文案
 *   · 防幻觉的最终形态：recognized:false 时元数据一律留空；策展影片的
 *     元数据只来自手写库自身事实，绝不问 AI
 *   · 不变式 A：润色前后结构字段完全一致（AI 无权碰结构）
 *   · 不变式 B：敌方登场守卫作用在 AI 之前（实测「现代特战城市巷战」
 *     的原始名册敌方为 0，必须被守卫补上，而不是等 AI）
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest, circuitStatus, resetCircuitForTests } from '../functions/api/ai-brain.js';

// 每次调用独立 cf-connecting-ip：避免撞共享限流桶（30 次/60s）
let clientSeq = 0;
const freshClientIp = () => `polish-test-${process.pid}-${++clientSeq}`;

const originalFetch = globalThis.fetch;

const call = (body, env = {}) => onRequest({
  request: new Request('https://lwu.example/api/ai-brain', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': freshClientIp() },
    body: JSON.stringify(body)
  }),
  env
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetCircuitForTests();
});

/**
 * mock：从 user prompt 里抽出基底 shotId，按 ID 回写润色文案。
 *
 * 注意 JSON.stringify 产出的是无空格格式 —— 正则必须匹配 {"shotId":"shot_1"}。
 * （6.8.8 的教训：计数正则漏掉 JSON 空格，会把「没测到」显示成「测到了」。）
 *
 * callsign 参数必须是真的名册代号：镜头的 radioVoice/action 台词带【代号】时，
 * 代号守卫会用基底名册核对。实测本地基底（热带雨林狙击手）名册含 ROMEO，
 * 策展影片《壮志凌云》含 TANGO / SIERRA —— 所以 mock 不能对所有片名共用
 * 同一个代号，否则会把「守卫正确拒绝」误读成「守卫误伤」。
 */
function makePolishFetch(extra = {}, callsign = 'ROMEO') {
  const seen = { system: '', user: '', url: '' };
  globalThis.fetch = async (url, options = {}) => {
    seen.url = String(url);
    const body = JSON.parse(options.body || '{}');
    seen.system = body.messages?.find(m => m.role === 'system')?.content || '';
    seen.user = body.messages?.find(m => m.role === 'user')?.content || '';
    const ids = [...seen.user.matchAll(/"shotId":"(shot_\d+)"/g)].map(m => m[1]);
    assert.ok(ids.length > 0, 'prompt 里必须带上基底 shotId（润色素材）');
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            recognized: false,
            dramaticConflict: '测试危机',
            visualGrammar: { cameraMotion: 'm', lightingTone: 'l', soundDesign: 's' },
            legoAdaptation: 'la',
            creatorTips: 'ct',
            originality: { logline: 'l', twist: 't', hook: 'h', homageNote: 'n' },
            proposedAssets: [{ name: 'Sonic Disruptor', nameZh: '声波压制器', group: 'weapons' }],
            shots: ids.map((id, i) => ({
              shotId: id,
              action: `【${callsign}】润色后的动作 ${id}（${i}）。`,
              audioCue: `润色音效 ${i}`,
              radioVoice: `【${callsign}】润色台词 ${i}`
            })),
            ...extra
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return seen;
}

/** 结构字段指纹：用于证明「润色不改结构」 */
const structuralFingerprint = shots => shots.map(s => JSON.stringify({
  shotId: s.shotId, phase: s.phase, fn: s.fn, shotType: s.shotType,
  subjects: s.subjects, environment: s.environment, camera: s.camera,
  lighting: s.lighting, colorGrade: s.colorGrade, fx: s.fx, audio: s.audio,
  duration: s.duration, story: s.story, beatId: s.beatId,
  screenDirection: s.screenDirection, damageState: s.damageState,
  continuityIn: s.continuityIn, continuityOut: s.continuityOut
}));

test('6.9.0 集成 · 转译 + 云端润色：结构逐字段冻结，只有三句文案换了', async () => {
  // 同一请求在无 Key 下跑一遍拿基线（本地基底 = 结构基准）
  resetCircuitForTests();
  const baseRes = await call({ query: '热带雨林狙击手生死对决', requestedShots: 4 });
  const baseData = await baseRes.json();
  const baseFingerprint = structuralFingerprint(baseData.shots);
  assert.equal(baseData.isAiGenerated, false, '无 Key 必须是本地基底');

  // 有 Key + mock 润色
  resetCircuitForTests();
  const seen = makePolishFetch();
  const res = await call({ query: '热带雨林狙击手生死对决', requestedShots: 4 }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.isAiGenerated, true);
  assert.match(data.engine, /Cloud Free AI \(Gemini/);
  assert.match(data.engine, /润色本地基底/);
  assert.equal(data.polish.merged, 4);
  assert.equal(data.polish.kept, 0);
  assert.deepEqual(data.polish.rejected, []);
  assert.equal(data.polish.callsignGuard, true);

  // 不变式 A：结构指纹逐字段一致
  assert.deepEqual(structuralFingerprint(data.shots), baseFingerprint,
    '润色后结构必须与本地基底完全一致 —— AI 无权碰结构');

  // 文本确实来自云端
  for (const shot of data.shots) {
    assert.match(shot.action, /润色后的动作/);
    assert.match(shot.audioCue, /润色音效/);
    assert.match(shot.radioVoice, /润色台词/);
  }

  // 6.8.9 防幻觉：未识别影片 → 元数据一律留空，但润色照常
  assert.equal(data.director, null);
  assert.equal(data.matchedMovie, null);
  assert.equal(data.aiStatus.reason, 'OK');
  assert.equal(data.aiStatus.unrecognized, true);

  // prompt 真的带了反幻觉纪律 + 基底素材 + 结构冻结指令
  assert.match(seen.system, /最高优先级零：真实性与署名纪律/);
  assert.match(seen.system, /结构冻结/);
  assert.match(seen.user, /分镜基底（结构已锁定，供润色）/);
  assert.match(seen.user, /识别判定/);

  // 模型建议的新资产仍然透传给前端进化引擎
  assert.equal(data.proposedAssets.length, 1);
  assert.equal(data.proposedAssets[0].nameZh, '声波压制器');
});

test('6.9.0 集成 · 转译 + 真实影片：元数据允许来自模型（recognized:true）', async () => {
  makePolishFetch({ recognized: true, matchedMovie: '狂怒 (Fury)', director: '大卫·阿耶', year: '2014', genre: '战争' });
  const res = await call({ query: '狂怒', requestedShots: 2 }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();
  assert.equal(data.isAiGenerated, true);
  assert.equal(data.matchedMovie, '狂怒 (Fury)');
  assert.equal(data.director, '大卫·阿耶');
  assert.equal(data.aiStatus.unrecognized, false);
  assert.equal(data.aiStatus.reason, 'OK');
});

test('6.9.0 集成 · plan 模式：前端基底 + 云端润色，结构逐字段冻结', async () => {
  // 先用无 Key 请求拿一个本地基底（模拟前端 planVariants 的产物）
  const baseRes = await call({ query: '雨林渗透作战', requestedShots: 3 });
  const baseData = await baseRes.json();
  const baseFingerprint = structuralFingerprint(baseData.shots);

  const seen = makePolishFetch();
  const res = await call({
    mode: 'plan',
    query: '雨林渗透作战',
    base: { shots: baseData.shots, roster: baseData.roster }
  }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.mode, 'plan');
  assert.equal(data.polish.merged, 3);
  assert.deepEqual(structuralFingerprint(data.shots), baseFingerprint, 'plan 模式同样结构冻结');
  for (const shot of data.shots) assert.match(shot.action, /润色后的动作/);
  assert.equal(data.aiStatus.reason, 'OK');

  // plan 模式的 prompt 不问影片元数据（自由模式是原创题材，不是电影）
  assert.match(seen.system, /不需要识别影片/);
  assert.ok(!seen.system.includes('输出 "recognized"'), 'plan 模式不得要求 identified 元数据');
});

test('6.9.0 集成 · plan 模式契约：坏基底直接 400，不劳烦云端', async () => {
  const res = await call({ mode: 'plan', query: 'x', base: { shots: [] } }, { GEMINI_API_KEY: 'k' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'INVALID_BASE');
});

test('6.9.0 集成 · 云端返回垃圾：POLISH_REJECTED 与成功/失败都不同', async () => {
  // 有 shots 但 shotId 全是幻觉 —— 一字段都不会合并
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      recognized: false,
      shots: [{ shotId: 'shot_99', action: '幻觉镜头的润色' }]
    }) } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  const res = await call({ query: '赛博朋克熊猫特工队', requestedShots: 2 }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.isAiGenerated, false, '一字段都没合并不许标成 AI 生成');
  assert.match(data.engine, /本地自主想象引擎/);
  assert.equal(data.aiStatus.reason, 'POLISH_REJECTED');
  assert.equal(data.polish.merged, 0);
  assert.equal(data.polish.kept, 2);
  assert.ok(data.polish.rejected.some(x => x.reason === 'UNMATCHED_SHOT'));
  assert.match(data.aiStatus.hint, /通过润色合并守卫/);
  // 基底内容完整交付
  assert.equal(data.shots.length, 2);
  assert.ok(data.shots[0].action.length > 10);
});

test('6.9.0 集成 · 熔断：第 2 次请求起云端零调用，本地基底毫秒级交付', async () => {
  let cloudCalls = 0;
  globalThis.fetch = async () => {
    cloudCalls += 1;
    return new Response('overloaded', { status: 503 });
  };

  // 第 1 次：3 个 gemini 候选全试（= 3 次连续失败 → 开闸）
  const first = await (await call({ query: '熔断测试一', requestedShots: 1 }, { GEMINI_API_KEY: 'k' })).json();
  assert.equal(first.aiStatus.reason, 'ALL_PROVIDERS_FAILED');
  assert.equal(cloudCalls, 3);
  assert.equal(circuitStatus('gemini').open, true);

  // 第 2 次：开闸期内零云调用，直接交付基底
  const mark = cloudCalls;
  const second = await (await call({ query: '熔断测试二', requestedShots: 1 }, { GEMINI_API_KEY: 'k' })).json();
  assert.equal(cloudCalls, mark, '熔断期内绝不再发起云端调用');
  assert.equal(second.aiStatus.reason, 'CIRCUIT_OPEN');
  assert.deepEqual(second.aiStatus.breakerSkipped, ['gemini']);
  assert.equal(second.isAiGenerated, false);
  assert.equal(second.shots.length, 1);
  assert.ok(second.shots[0].action.length > 10, '熔断回退也必须是完整分镜');
  assert.match(second.aiStatus.hint, /熔断冷却期/);
});

test('6.9.0 集成 · 敌方登场守卫作用在 AI 之前（不等模型补）', async () => {
  // 实测：本地规划器对「现代特战城市巷战」的原始名册敌方为 0。
  // 结构冻结后 AI 没机会补 —— 所以必须在基底阶段就补。
  makePolishFetch();
  const res = await call({ query: '现代特战城市巷战', requestedShots: 4 }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();
  const opposing = data.roster.filter(r => r.side === 'opposing').map(r => r.id);
  assert.ok(opposing.length > 0, '成片名册里必须有敌方角色（守卫必须在基底阶段补入）');
  assert.ok(
    data.shots.some(s => (s.subjects || []).some(id => opposing.includes(id))),
    '至少一个镜头必须真的让敌方资产登场'
  );
});

test('6.9.0 集成 · 策展影片：元数据只来自手写库，绝不让模型回忆事实', async () => {
  // TANGO 是《壮志凌云》手写名册的真实代号（实测 roster：TANGO / SIERRA）
  const seen = makePolishFetch({ recognized: true, matchedMovie: '模型乱编 (Fake)', director: '某位无辜导演', year: '1999' }, 'TANGO');
  const res = await call({ query: '壮志凌云', requestedShots: 4 }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();

  assert.equal(data.contentKind, 'curated');
  assert.equal(data.isAiGenerated, true, '策展复刻被润色后如实标注');
  assert.match(data.engine, /润色策展复刻/);
  // 手写库的事实优先于模型的「回忆」——即使模型自信地给了另一套
  assert.ok(data.matchedMovie.includes('壮志凌云'), `策展元数据必须来自手写库，实际：${data.matchedMovie}`);
  assert.ok(!data.matchedMovie.includes('模型乱编'), '模型编的片名不得覆盖手写库事实');
  assert.ok(data.director && !data.director.includes('无辜'), `导演必须来自手写库，实际：${data.director}`);
  assert.notEqual(data.year, '1999');
  // 润色仍然发生，且名册内代号（TANGO）被守卫放行
  assert.equal(data.polish.merged, 4);
  assert.deepEqual(data.polish.rejected, []);
  assert.equal(data.polish.callsignGuard, true);
  assert.match(data.shots[0].action, /【TANGO】润色后的动作/);
  assert.match(data.shots[0].radioVoice, /【TANGO】润色台词/);
});

test('6.9.0 集成 · 策展影片：名册外代号一律拒绝，不许模型给角色乱起代号', async () => {
  // GHOST 不在《壮志凌云》名册（TANGO / SIERRA）—— 按设计整字段拒绝，保留手写原文
  makePolishFetch({}, 'GHOST');
  const res = await call({ query: '壮志凌云', requestedShots: 2 }, { GEMINI_API_KEY: 'k' });
  const data = await res.json();

  assert.equal(data.polish.callsignGuard, true);
  assert.ok(data.polish.rejected.some(x => x.reason.startsWith('UNKNOWN_CALLSIGN(GHOST)')),
    `名册外代号必须被记账拒绝，实际 rejected：${JSON.stringify(data.polish.rejected)}`);
  // action/radioVoice 带代号被拒；audioCue 无代号照常落地
  assert.ok(data.polish.rejected.some(x => x.field === 'action'));
  assert.ok(data.polish.rejected.some(x => x.field === 'radioVoice'));
  assert.equal(data.polish.merged, 2, '每镜仅 audioCue 落地');
  assert.ok(!data.shots[0].action.includes('GHOST'), '被拒字段必须保留手写原文');
  assert.ok(data.shots[0].audioCue.startsWith('润色音效'), '无代号字段照常润色');
});

test('6.9.0 集成 · 无 Key：绝不触碰云端，本地基底完整交付', async () => {
  let cloudCalls = 0;
  globalThis.fetch = async () => { cloudCalls += 1; return new Response('should not happen', { status: 500 }); };
  const data = await (await call({ query: '深海古墓机械龙王', requestedShots: 3 })).json();
  assert.equal(cloudCalls, 0, '没配 Key 时一次云端调用都不该发生');
  assert.equal(data.isAiGenerated, false);
  assert.match(data.engine, /本地自主想象引擎/);
  assert.equal(data.aiStatus.reason, 'NO_KEYS_CONFIGURED');
  assert.equal(data.polish, null);
  assert.equal(data.shots.length, 3);
});

test('6.9.0 集成 · probe 自检必须报告熔断状态', async () => {
  resetCircuitForTests();
  const res = await onRequest({
    request: new Request('https://lwu.example/api/ai-brain?probe=1', { method: 'GET' }),
    env: { GEMINI_API_KEY: 'k' }
  });
  const data = await res.json();
  assert.ok(data.circuit, 'probe 必须带 circuit 字段');
  assert.equal(data.circuit.gemini.open, false);
  assert.equal(data.circuit.groq.open, false);
});

test('6.9.0 集成 · 静态防回归：契约与编排不得被静默删除', () => {
  const backend = readFileSync(new URL('../functions/api/ai-brain.js', import.meta.url), 'utf8');
  // 基底先行
  assert.match(backend, /const generated = generateLocally\(/, '必须先用本地引擎产基底');
  assert.match(backend, /ensureOpposingPresence\(generated\.shots, opposingIds\)/, '敌方守卫必须作用在基底上');
  // 润色契约真的被用上
  assert.match(backend, /mergePolish\(base\.shots, attempt\.result/, '必须走合并层');
  assert.match(backend, /callsignSetOfRoster\(base\.roster\)/, '必须启用代号守卫');
  // 熔断真的接进了调度链
  assert.match(backend, /recordCircuitOutcome\(provider\.id, true\)/);
  assert.match(backend, /recordCircuitOutcome\(provider\.id, false\)/);
  assert.match(backend, /const circuit = circuitStatus\(provider\.id\);/);
  // reason 口径
  assert.match(backend, /'CIRCUIT_OPEN'/);
  assert.match(backend, /'POLISH_REJECTED'/);
  // plan 模式入口
  assert.match(backend, /body\.mode === 'plan'/);

  // 前端：润色编排与三字段白名单
  const ui = readFileSync(new URL('../src/ui/app.js', import.meta.url), 'utf8');
  assert.match(ui, /polishVariantPlan/, '前端必须调用润色客户端');
  assert.match(ui, /requestPolishForActiveVariant\(themeText, requestedShots\);/, '生成后必须触发润色');
  assert.match(ui, /action: polished\.action,\s*\n\s*audioCue: polished\.audioCue,\s*\n\s*radioVoice: polished\.radioVoice/, '贴回只允许三个文本字段');
  const domain = readFileSync(new URL('../src/domain/ai-brain.js', import.meta.url), 'utf8');
  assert.match(domain, /mode: 'plan'/, '润色客户端必须走 plan 模式');
});
