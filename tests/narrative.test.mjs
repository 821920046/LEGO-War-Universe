import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, mulberry32, seedOf, seededShuffle, fillTemplate,
  selectBeats, beatsForPhase, phaseBeatPool, expandBeats, buildOriginality, diversifyShots
} from '../src/domain/narrative.js';
import { hasHostileFraming } from '../src/domain/shot-spec.js';

test('narrative: mulberry32 and seededShuffle are deterministic', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = [a(), a(), a()];
  const seqB = [b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);

  const list = [1, 2, 3, 4, 5, 6, 7, 8];
  const s1 = seededShuffle(list, 999);
  const s2 = seededShuffle(list, 999);
  assert.deepEqual(s1, s2);
  assert.deepEqual([...s1].sort((x, y) => x - y), list, '洗牌必须是同一集合的置换');
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8], '不得就地修改原数组');
});

test('narrative: seedOf is stable across calls', () => {
  assert.equal(seedOf('黑鹰坠落|8'), seedOf('黑鹰坠落|8'));
  assert.notEqual(seedOf('黑鹰坠落|8'), seedOf('黑鹰坠落|12'));
});

test('narrative: fillTemplate substitutes known keys and preserves unknown ones', () => {
  assert.equal(fillTemplate('{a} 与 {b}', { a: 'X', b: 'Y' }), 'X 与 Y');
  assert.equal(fillTemplate('{a} {missing}', { a: 'X' }), 'X {missing}');
  assert.equal(fillTemplate('{a}', { a: '' }), '{a}', '空值视为未提供，保留占位符便于排查');
  assert.equal(fillTemplate(null, {}), '');
});

test('narrative: selectBeats returns n distinct beats covering all four phases', () => {
  for (const n of [4, 6, 8, 12]) {
    const beats = selectBeats({ n, seed: seedOf(`t|${n}`), hasEnemy: true, hasSupport: true, hasVehicle: true });
    assert.equal(beats.length, n);
    assert.ok(beats.every(b => b && b.id && b.action));
    // 同一阶段内绝不允许复用同一节拍 —— 这正是用户反馈的「重复」
    for (const phase of PHASES) {
      const ids = beats.filter(b => b.phase === phase).map(b => b.id);
      assert.equal(new Set(ids).size, ids.length, `${phase} 阶段出现重复节拍`);
    }
  }
});

test('narrative: selectBeats never emits enemy beats when the roster has no enemy', () => {
  const beats = selectBeats({ n: 12, seed: 42, hasEnemy: false, hasSupport: true, hasVehicle: true });
  assert.ok(beats.every(b => b.focus !== 'enemy' && b.focus !== 'clash'));
});

test('narrative: selectBeats respects support / vehicle availability', () => {
  const beats = selectBeats({ n: 12, seed: 7, hasEnemy: true, hasSupport: false, hasVehicle: false });
  assert.ok(beats.every(b => b.focus !== 'squad' && b.focus !== 'vehicle'));
});

test('narrative: selectBeats degrades safely when n is huge or invalid', () => {
  const big = selectBeats({ n: 150, seed: 1, hasEnemy: true, hasSupport: true, hasVehicle: true });
  assert.equal(big.length, 150);
  assert.ok(big.every(b => b && b.action));
  const zero = selectBeats({ n: 0, seed: 1 });
  assert.equal(zero.length, 1, '至少产出 1 个镜头，绝不返回空计划');
});

test('narrative: beatsForPhase excludes already-used beats', () => {
  const pool = beatsForPhase('build', { seed: 3, hasEnemy: true, hasSupport: true, hasVehicle: true, limit: 4 });
  assert.ok(pool.length > 0);
  const excluded = pool[0].id;
  const next = beatsForPhase('build', {
    seed: 3, hasEnemy: true, hasSupport: true, hasVehicle: true, limit: 4, excludeIds: [excluded]
  });
  assert.ok(!next.some(b => b.id === excluded));
});

// ---------------------------------------------------------------------------
// 对抗审查补测：以下三条来自「对抗审查」阶段真实撞出来的缺陷，属永久回归护栏。
// ---------------------------------------------------------------------------

test('narrative: 每个 clash/enemy 节拍的 action 必须含敌对语义（否则编译期必抛 FACTION_CONFLICT_INVALID）', () => {
  // 背景：clash/enemy 节拍会把正反双方同时写进 subjects。而 shot-spec 的校验规则是
  // 「对立阵营同框时，action 必须含交战语义，且不得是协同语义」。此前 clx-clash-1 写作
  // 「双方火力在几米内对轰」、clx-clash-2 写作「贴身缠斗…硬撼」，都不含校验器认得的
  // 关键词，于是镜头数一多（n=12 起）选中它们，compileShot 直接抛错、整个脚本面板崩掉。
  const source = phaseBeatPool('climax', { seed: 1, hasEnemy: true, hasSupport: true, hasVehicle: true });
  const all = [...source, ...phaseBeatPool('build', { seed: 1, hasEnemy: true, hasSupport: true, hasVehicle: true }),
    ...phaseBeatPool('establish', { seed: 1, hasEnemy: true, hasSupport: true, hasVehicle: true }),
    ...phaseBeatPool('resolve', { seed: 1, hasEnemy: true, hasSupport: true, hasVehicle: true })];

  const risky = all.filter(b => b.focus === 'clash' || b.focus === 'enemy');
  assert.ok(risky.length >= 6, 'clash/enemy 节拍数量异常，测试本身可能失效');
  for (const b of risky) {
    assert.ok(
      hasHostileFraming(b.action),
      `${b.id} 会让正反双方同框却缺少敌对语义，编译期必抛 FACTION_CONFLICT_INVALID：${b.action}`
    );
  }
});

test('narrative: selectBeats 在任意门控组合与任意镜头数下都不重复（含溢出变奏）', () => {
  // 背景：早期实现在阶段池被用尽时用 `pool[k % pool.length]` 循环取用，
  // 导致同一阶段出现**完全相同的 action 文本** —— 正是用户反馈的「脚本重复」。
  // 例：无敌人/无僚机/无载具时 build 阶段只有 bld-hero-1 一条，n>=7 必重复。
  const combos = [
    { hasEnemy: false, hasSupport: false, hasVehicle: false },
    { hasEnemy: false, hasSupport: true, hasVehicle: true },
    { hasEnemy: true, hasSupport: false, hasVehicle: false },
    { hasEnemy: true, hasSupport: true, hasVehicle: true }
  ];
  for (const gates of combos) {
    for (let n = 1; n <= 40; n++) {
      const beats = selectBeats({ n, seed: seedOf(`sweep|${n}`), ...gates });
      assert.equal(beats.length, n, `n=${n} 长度不符`);
      assert.ok(beats.every(b => b && b.id && b.action), `n=${n} 存在空洞节拍`);

      const ids = beats.map(b => b.id);
      assert.equal(new Set(ids).size, ids.length, `n=${n} ${JSON.stringify(gates)} 出现重复节拍 id`);

      // 同一阶段内 action 文本也必须两两不同（id 不同但文本相同同样是「重复」）
      for (const phase of PHASES) {
        const actions = beats.filter(b => b.phase === phase).map(b => b.action);
        assert.equal(new Set(actions).size, actions.length, `${phase} 阶段 n=${n} 出现重复 action 文本`);
      }
    }
  }
});

test('narrative: expandBeats 池耗尽后派生变奏，且变奏保持确定性', () => {
  const pool = phaseBeatPool('build', { seed: 5, hasEnemy: false, hasSupport: false, hasVehicle: false });
  assert.equal(pool.length, 3, 'build 阶段无敌人/无僚机/无载具时应有 3 条 hero 节拍');
  const out = expandBeats('build', { need: pool.length + 4, seed: 5, hasEnemy: false, hasSupport: false, hasVehicle: false });
  assert.equal(out.length, pool.length + 4);
  assert.equal(new Set(out.map(b => b.id)).size, out.length);
  assert.equal(new Set(out.map(b => b.action)).size, out.length);
  // 溢出项必须标记来源，便于排查
  const derived = out.filter(b => b.derivedFrom);
  assert.equal(derived.length, 4);
  assert.ok(derived.every(b => b.id.startsWith(b.derivedFrom + '~v')));

  const again = expandBeats('build', { need: pool.length + 4, seed: 5, hasEnemy: false, hasSupport: false, hasVehicle: false });
  assert.deepEqual(again.map(b => b.id), out.map(b => b.id), '变奏必须确定性可复现');
});

test('narrative: buildOriginality derives an independent logline / twist / hook', () => {
  const intent = { era: 'Modern', setting: 'urban', task: 'combat' };
  const a = buildOriginality({ theme: '黑鹰坠落', intent, reference: { title: '黑鹰坠落', director: '雷德利·斯科特' }, seed: 11 });
  const b = buildOriginality({ theme: '黑鹰坠落', intent, reference: { title: '黑鹰坠落', director: '雷德利·斯科特' }, seed: 11 });

  assert.ok(a.logline && a.twist && a.hook);
  assert.deepEqual(a, b, '同种子必须产出完全一致');
  // 参考片只贡献视听语言：致敬说明必须点明「情节为独立原创」
  assert.ok(a.homageNote.includes('黑鹰坠落'));
  assert.ok(a.homageNote.includes('独立原创'));
  // logline 必须把转折写进去，而不是复述原作桥段
  assert.ok(a.logline.includes(a.twist.replace(/。$/, '')));

  const noRef = buildOriginality({ theme: '自定义主题', intent, reference: null, seed: 11 });
  assert.ok(noRef.homageNote.includes('完全原创'));
});

test('narrative: logline 把长主题当背景句，绝不拼出病句', () => {
  // 背景：早期实现无条件把主题当成句子的主语，于是
  // 「特战小队在…营救被困飞行员」+「被投入一场搜救任务」
  // 拼成「…营救被困飞行员被投入一场…」这种病句。
  const longTheme = '特战小队在城市废墟中执行夜间突袭，营救被困飞行员';
  const long = buildOriginality({ theme: longTheme, intent: { era: 'Modern', setting: 'urban', task: 'rescue' }, seed: 3 });
  assert.ok(long.logline.includes(longTheme), '长主题必须被保留');
  assert.ok(long.logline.includes('这支小队被投入'), '长主题应以背景句 + 独立主句呈现');
  assert.ok(!/飞行员被投入/.test(long.logline), '长主题不得被直接当成主语');

  // 短主题仍可作为主语，读起来自然
  const short = buildOriginality({ theme: '黑鹰坠落', intent: { era: 'Modern', setting: 'urban', task: 'combat' }, seed: 3 });
  assert.ok(short.logline.includes('黑鹰坠落被投入'), '短主题应直接作主语');

  // 无主题时也必须给出完整通顺的句子
  const none = buildOriginality({ theme: '', intent: { era: 'Modern', setting: 'urban', task: 'combat' }, seed: 3 });
  assert.ok(none.logline.includes('一支小队被投入'));

  // 任何情况下都必须把转折写进去
  for (const o of [long, short, none]) {
    assert.ok(o.logline.includes(o.twist.replace(/。$/, '')));
  }
});

test('narrative: buildOriginality varies across themes (not a fixed template)', () => {
  const intent = { era: 'Modern', setting: 'urban', task: 'combat' };
  const seen = new Set();
  for (const theme of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel']) {
    seen.add(buildOriginality({ theme, intent, reference: null, seed: seedOf(theme) }).twist);
  }
  assert.ok(seen.size > 1, '不同主题不应拿到完全相同的转折');
});

test('narrative: logline uses a Chinese era label, never the raw enum', () => {
  const cases = [
    ['Modern', '现代'],
    ['Modern High-Tech', '现代高科技战场'],
    ['WWII', '二战'],
    ['Orbital', '近地轨道']
  ];
  for (const [era, zh] of cases) {
    const o = buildOriginality({ theme: '测试主题', intent: { era, setting: 'urban', task: 'combat' }, seed: 5 });
    assert.ok(o.logline.includes(zh), `${era} 应渲染为中文「${zh}」`);
    // 早期直接把 intent.era 拼进中文句子，写出「Modern的城市废墟」这种中英混排
    assert.ok(!o.logline.includes(era), `logline 不应出现英文枚举 ${era}`);
  }
});

test('narrative: diversifyShots rewrites duplicate actions into unique variants', () => {
  const shots = [
    { action: '小队推进。' },
    { action: '小队推进。' },
    { action: '小队推进。' },
    { action: '完全不同的镜头。' }
  ];
  const res = diversifyShots(shots);

  assert.equal(res.fixed, 2);
  assert.equal(res.duplicates.length, 2);
  const actions = res.shots.map(s => s.action);
  assert.equal(new Set(actions).size, actions.length, '去重后 action 必须两两不同');
  assert.equal(res.shots[3].action, '完全不同的镜头。', '非重复镜头不得被改动');
  assert.equal(res.shots[0].action, '小队推进。', '首个出现的镜头保持原样');
  assert.equal(res.shots[1].variationOf, 0, '必须记录它重复自哪一镜');
});

test('narrative: diversifyShots is a no-op on already-unique scripts', () => {
  const shots = [{ action: 'A' }, { action: 'B' }, { action: 'C' }];
  const res = diversifyShots(shots);
  assert.equal(res.fixed, 0);
  assert.deepEqual(res.shots.map(s => s.action), ['A', 'B', 'C']);
});

test('narrative: diversifyShots survives empty and malformed input', () => {
  assert.deepEqual(diversifyShots([]), { shots: [], fixed: 0, duplicates: [] });
  assert.equal(diversifyShots(null).shots.length, 0);
  const res = diversifyShots([{ action: '' }, { action: '' }]);
  assert.equal(res.fixed, 0, '空 action 不参与去重，避免产出无意义变奏');
});
