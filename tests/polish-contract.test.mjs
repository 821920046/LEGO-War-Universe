/**
 * 6.9.0 润色契约门禁（本地打底 + AI 润色的安全核心）
 *
 * 背景：6.9.0 把云端 AI 从「生成整部电影」改造成「只润色三个文本字段」，
 * 结构（资产 ID / 机位 / 节拍 / 戏剧功能 / 连续性 / 角色代号）永远来自
 * 确定性本地基底。本文件钉住这份契约的四条不变式：
 *
 *   1. 结构永不由 AI 提供 —— AI 响应里除三个白名单字段外的一切（包括它
 *      自创的 subjects / phase / fn）被静默丢弃，基底结构逐字段不变；
 *   2. 未提供 / 空白的字段保留基底原文 —— 「润色失败一镜」≠「这一镜没了」；
 *   3. 代号守卫 —— 润色文本出现名册外的【代号】即整字段拒绝（防名册漂移）；
 *   4. 一切拒绝都记账 —— merged / kept / rejected 是响应体里可见的统计，
 *      静默吞掉拒绝就等于把「AI 没润成」显示成「润色成功」。
 *
 * 另有两道 prompt 门禁：反幻觉纪律与「结构冻结」指令必须真的在 prompt 文本里
 * （直接断言字符串，杜绝「规则写在注释里却没进 prompt」）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POLISHABLE_FIELDS,
  POLISH_FIELD_MAX_CHARS,
  mergePolish,
  callsignsInText,
  callsignSetOfRoster,
  baseMaterialForPrompt,
  buildPolishSystemPrompt,
  buildPolishUserPrompt
} from '../src/domain/polish-contract.js';

const baseShots = () => [
  {
    shotId: 'shot_1',
    phase: 'establish',
    fn: 'goal',
    shotType: '人物时刻特写',
    subjects: ['CHR-405'],
    environment: 'ENV-604',
    camera: 'CAM-803',
    lighting: 'LGT-102',
    colorGrade: 'CLR-001',
    fx: ['FX-801'],
    audio: ['AUD-801'],
    duration: 6,
    story: { arc: 'armor-clash', purpose: 'character' },
    beatId: 'est-goal-1',
    action: '【ROMEO】米勒把弹匣一个一个插回胸挂。',
    audioCue: '卡扣逐声到位',
    radioVoice: '【无线电】（没有按下通话键）',
    continuityIn: { previousShotId: null },
    continuityOut: { screenDirection: 'left-to-right' }
  },
  {
    shotId: 'shot_2',
    phase: 'build',
    fn: 'contact',
    shotType: '中景跟拍',
    subjects: ['CHR-405', 'CHR-630'],
    environment: 'ENV-604',
    action: '【ROMEO】与【VIPER】交替掩护前进。',
    audioCue: '脚步声与虫鸣',
    radioVoice: '【VIPER】左翼安全。'
  }
];

const roster = () => [
  { id: 'CHR-405', callsign: 'ROMEO', side: 'coalition' },
  { id: 'CHR-630', callsign: 'VIPER', side: 'opposing' }
];

const aiPolishOk = () => ({
  shots: [
    {
      shotId: 'shot_1',
      action: '【ROMEO】指节压着弹匣底盖，一声脆响卡进胸挂，尼龙织带被重新拉紧。',
      audioCue: '弹匣卡榫咬合的金属声混着雨林远处的雷声',
      radioVoice: '【ROMEO】（压低）弹已压满，等我信号。'
    },
    {
      shotId: 'shot_2',
      action: '【ROMEO】与【VIPER】在泥水里交替掩护，枪口始终朝着坡上方。',
      // 故意不提供 audioCue / radioVoice：基底原文必须保留
    }
  ]
});

test('6.9.0 契约 · 正常润色：只改写三个文本字段，结构逐字段不变', () => {
  const base = baseShots();
  const structuralSnapshot = JSON.stringify(base);
  const { shots, merged, kept, applied, rejected } = mergePolish(base, aiPolishOk(), {
    allowedCallsigns: callsignSetOfRoster(roster())
  });

  assert.equal(merged, 2);
  assert.equal(kept, 0);
  assert.deepEqual(applied, { action: 2, audioCue: 1, radioVoice: 1 });
  assert.deepEqual(rejected, []);

  // 文本确实换了
  assert.equal(shots[0].action, '【ROMEO】指节压着弹匣底盖，一声脆响卡进胸挂，尼龙织带被重新拉紧。');
  assert.equal(shots[1].action, '【ROMEO】与【VIPER】在泥水里交替掩护，枪口始终朝着坡上方。');

  // 结构一个字节都没动（整对象深比较，除三个文本字段外）
  const structuralOf = list => list.map(s => {
    const { action, audioCue, radioVoice, ...rest } = s;
    return rest;
  });
  assert.deepEqual(structuralOf(shots), structuralOf(base));

  // 基底对象本身未被就地修改（合并必须返回副本）
  assert.equal(JSON.stringify(base), structuralSnapshot, 'mergePolish 不得就地改写基底');

  // AI 没提供的字段保留基底原文
  assert.equal(shots[1].audioCue, '脚步声与虫鸣');
  assert.equal(shots[1].radioVoice, '【VIPER】左翼安全。');
});

test('6.9.0 契约 · 结构冻结：AI 响应里的结构字段被静默丢弃', () => {
  const hostile = {
    shots: [{
      shotId: 'shot_1',
      action: '润色后的动作。',
      // 以下全是 AI 自创的结构字段，一个都不许进最终分镜
      subjects: ['ZZZ-999'],
      phase: 'climax',
      fn: 'clash',
      shotType: '自创景别',
      environment: 'ENV-999',
      camera: 'CAM-999',
      duration: 99,
      story: { arc: 'fake' }
    }]
  };
  const { shots } = mergePolish(baseShots(), hostile, { allowedCallsigns: callsignSetOfRoster(roster()) });
  assert.deepEqual(shots[0].subjects, ['CHR-405']);
  assert.equal(shots[0].phase, 'establish');
  assert.equal(shots[0].fn, 'goal');
  assert.equal(shots[0].shotType, '人物时刻特写');
  assert.equal(shots[0].environment, 'ENV-604');
  assert.equal(shots[0].camera, 'CAM-803');
  assert.equal(shots[0].duration, 6);
  assert.deepEqual(shots[0].story, { arc: 'armor-clash', purpose: 'character' });
  assert.equal(shots[0].action, '润色后的动作。');
});

test('6.9.0 契约 · 代号守卫：名册外【代号】整字段拒绝并记账', () => {
  const { shots, merged, rejected } = mergePolish(
    baseShots(),
    { shots: [{ shotId: 'shot_1', action: '【GHOST】自创代号进场。' }] },
    { allowedCallsigns: callsignSetOfRoster(roster()) }
  );
  assert.equal(merged, 0, '含名册外代号的字段必须被整字段拒绝');
  assert.equal(shots[0].action, '【ROMEO】米勒把弹匣一个一个插回胸挂。', '拒绝后保留基底原文');
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason, /UNKNOWN_CALLSIGN\(GHOST\)/);
  assert.equal(rejected[0].field, 'action');
  assert.equal(rejected[0].shotId, 'shot_1');
});

test('6.9.0 契约 · 代号守卫：名册内代号与无代号文本照常放行', () => {
  const { shots, merged } = mergePolish(
    baseShots(),
    { shots: [{ shotId: 'shot_1', action: '没有代号的纯环境描写，雨滴打在积木搭成的阔叶上。' }] },
    { allowedCallsigns: callsignSetOfRoster(roster()) }
  );
  assert.equal(merged, 1);
  assert.match(shots[0].action, /雨滴/);
});

test('6.9.0 契约 · 幻觉镜头 / 空响应 / 坏类型：全部记账且基底不受损', () => {
  const base = baseShots();
  const allowed = { allowedCallsigns: callsignSetOfRoster(roster()) };

  // AI 自创 shotId：记 UNMATCHED_SHOT，基底保留
  let r = mergePolish(base, { shots: [{ shotId: 'shot_99', action: '幻觉镜头' }] }, allowed);
  assert.equal(r.merged, 0);
  assert.equal(r.kept, 2);
  assert.ok(r.rejected.some(x => x.reason === 'UNMATCHED_SHOT' && x.shotId === 'shot_99'));
  assert.equal(r.shots[0].action, base[0].action);

  // 空 shots：NO_AI_SHOTS
  r = mergePolish(base, { shots: [] }, allowed);
  assert.equal(r.merged, 0);
  assert.equal(r.kept, 2);
  assert.deepEqual(r.rejected, [{ reason: 'NO_AI_SHOTS' }]);

  // 整个 result 不是对象
  r = mergePolish(base, null, allowed);
  assert.equal(r.kept, 2);
  assert.deepEqual(r.rejected, [{ reason: 'NO_AI_SHOTS' }]);

  // 字段类型错误：NOT_A_STRING，保留基底
  r = mergePolish(base, { shots: [{ shotId: 'shot_1', action: 12345, audioCue: {} }] }, allowed);
  assert.equal(r.merged, 0);
  assert.equal(r.rejected.filter(x => x.reason === 'NOT_A_STRING').length, 2);
  assert.equal(r.shots[0].action, base[0].action);

  // 条目本身不是对象：NOT_AN_OBJECT
  r = mergePolish(base, { shots: ['not-an-object'] }, allowed);
  assert.ok(r.rejected.some(x => x.reason === 'NOT_AN_OBJECT'));
  assert.equal(r.shots[0].action, base[0].action);
});

test('6.9.0 契约 · 超长字段拒绝（不截断）并记账', () => {
  const long = 'x'.repeat(POLISH_FIELD_MAX_CHARS + 1);
  const { shots, rejected } = mergePolish(
    baseShots(),
    { shots: [{ shotId: 'shot_1', action: long }] },
    { allowedCallsigns: callsignSetOfRoster(roster()) }
  );
  assert.match(rejected[0].reason, /TOO_LONG/);
  assert.equal(shots[0].action, '【ROMEO】米勒把弹匣一个一个插回胸挂。', '超长不得截断进半句话');
});

test('6.9.0 契约 · 两种落地语义：全带 shotId 按 ID 合并，全不带才按位置合并', () => {
  const base = baseShots();
  const allowed = { allowedCallsigns: callsignSetOfRoster(roster()) };

  // 全带 shotId：顺序打乱也按 ID 对
  const r1 = mergePolish(base, { shots: [
    { shotId: 'shot_2', action: '二号先到。' },
    { shotId: 'shot_1', action: '一号后到。' }
  ] }, allowed);
  assert.equal(r1.shots[0].action, '一号后到。');
  assert.equal(r1.shots[1].action, '二号先到。');
  assert.equal(r1.merged, 2);

  // 全不带 shotId：按数组位置落地
  const r2 = mergePolish(base, { shots: [
    { action: '位置一号。' },
    { action: '位置二号。' }
  ] }, allowed);
  assert.equal(r2.shots[0].action, '位置一号。');
  assert.equal(r2.shots[1].action, '位置二号。');
  assert.equal(r2.merged, 2);

  // 混合（有的带有的不带）：无 ID 条目一律拒绝，绝不猜位置
  // （猜错会把 B 镜的文案贴到 A 镜上，比不润色更糟）
  const r3 = mergePolish(base, { shots: [
    { shotId: 'shot_2', action: '显式二号。' },
    { action: '无 ID 条目' }
  ] }, allowed);
  assert.equal(r3.merged, 1);
  assert.equal(r3.shots[1].action, '显式二号。');
  assert.equal(r3.shots[0].action, base[0].action, '无 ID 条目不得按位置猜');
  assert.ok(r3.rejected.some(x => x.reason === 'UNMATCHED_SHOT'));
});

test('6.9.0 契约 · AI 少给镜头：缺的镜头保留基底，不补不编', () => {
  const base = baseShots();
  const r = mergePolish(base, { shots: [{ shotId: 'shot_1', action: '只润一镜。' }] }, {
    allowedCallsigns: callsignSetOfRoster(roster())
  });
  assert.equal(r.merged, 1);
  assert.equal(r.kept, 1);
  assert.equal(r.shots[1].action, base[1].action);
  assert.equal(r.shots[1].fn, 'contact');
});

test('6.9.0 契约 · 无基底 / 无名册时不崩且如实记账', () => {
  const r1 = mergePolish([], { shots: [{ shotId: 'shot_1', action: 'x' }] }, {});
  assert.deepEqual(r1.shots, []);
  assert.ok(r1.rejected.some(x => x.reason === 'NO_BASE'));

  // 没有名册 → 代号守卫关闭，但 callsignGuard 如实报 false
  const r2 = mergePolish(baseShots(), { shots: [{ shotId: 'shot_1', action: '【任意】文本' }] }, {});
  assert.equal(r2.callsignGuard, false);
  assert.equal(r2.merged, 1);
});

test('6.9.0 契约 · 代号抽取与名册集合', () => {
  assert.deepEqual(callsignsInText('【ROMEO】和【VIPER-2】对话，【小写】不算'), ['ROMEO', 'VIPER-2']);
  assert.deepEqual(callsignsInText(null), []);
  const set = callsignSetOfRoster(roster());
  assert.ok(set.has('ROMEO') && set.has('VIPER'));
  assert.equal(callsignSetOfRoster([]), null);
  assert.equal(callsignSetOfRoster(null), null);
  assert.equal(callsignSetOfRoster([{ id: 'CHR-1' }]), null, '无代号条目不构成可用名册');
});

test('6.9.0 契约 · 基底素材序列化只含润色需要的上下文', () => {
  const material = baseMaterialForPrompt(baseShots());
  assert.equal(material.length, 2);
  assert.deepEqual(Object.keys(material[0]).sort(), [
    'action', 'audioCue', 'environment', 'fn', 'phase', 'radioVoice', 'shotId', 'shotType', 'subjects'
  ]);
});

test('6.9.0 契约 · prompt 必须含反幻觉纪律与结构冻结指令（直接断文本）', () => {
  const system = buildPolishSystemPrompt({
    catalogText: 'CHR-405=狙击手(Modern)',
    era: 'Modern',
    castText: '【本片固定阵容】\nCOALITION CAST: [ROMEO] 狙击手 (CHR-405)',
    recognize: true
  });
  // 6.8.9 反幻觉纪律一条不少
  assert.match(system, /最高优先级零：真实性与署名纪律/);
  assert.match(system, /recognized/);
  assert.match(system, /绝不允许把用户自编的题材挂到任何真实在世导演名下/);
  assert.match(system, /绝不写成导演署名/);
  // 6.9.0 润色纪律
  assert.match(system, /润色，不是重写/);
  assert.match(system, /结构冻结/);
  assert.match(system, /shotId 逐字一致/);
  assert.match(system, /action \/ audioCue \/ radioVoice/);
  assert.match(system, /【代号】/);
  assert.match(system, /时代与装备必须与基底一致/);
  // 资产清单与时代仍然注入（润色描写要与真实资产对得上）
  assert.match(system, /CHR-405=狙击手/);
  assert.match(system, /Modern/);
  // recognize:false（策展 / 自由模式）时不问影片元数据、不提导演
  const noRecognize = buildPolishSystemPrompt({ catalogText: 'x', era: 'WWII', castText: '', recognize: false });
  assert.match(noRecognize, /不需要识别影片/);
  assert.ok(noRecognize.includes('你**不要**输出 recognized'), '必须声明不要输出元数据字段');
  assert.ok(noRecognize.includes('也不要提任何导演姓名'), '必须禁止润色文案里出现导演姓名');
});

test('6.9.0 契约 · user prompt 必须把基底素材原样带上', () => {
  const user = buildPolishUserPrompt({
    query: '雨林狙击手生死对决',
    requestedShots: 2,
    baseShots: baseShots(),
    recognize: true
  });
  assert.match(user, /分镜基底（结构已锁定，供润色）/);
  assert.match(user, /shot_1/);
  assert.match(user, /shot_2/);
  assert.match(user, /一镜一条、shotId 与基底逐字一致/);
  assert.match(user, /识别判定/);
  assert.match(user, /雨林狙击手生死对决/);
  // recognize:false 时不出识别判定
  const plain = buildPolishUserPrompt({ query: 'q', requestedShots: 2, baseShots: baseShots(), recognize: false });
  assert.ok(!plain.includes('识别判定'));
});

test('6.9.0 契约 · 白名单只有三个文本字段', () => {
  assert.deepEqual(POLISHABLE_FIELDS, ['action', 'audioCue', 'radioVoice']);
  // 任何结构字段都不在白名单里（这一条是「结构冻结」的最直白表述）
  for (const structural of ['subjects', 'phase', 'fn', 'shotId', 'shotType', 'environment', 'camera', 'lighting', 'colorGrade', 'fx', 'audio', 'duration', 'story', 'continuityIn']) {
    assert.ok(!POLISHABLE_FIELDS.includes(structural), `${structural} 不得可被 AI 改写`);
  }
});
