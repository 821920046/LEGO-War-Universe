import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PHASES, FUNCTIONS, FOCUS_ROLES, PHASE_ARC,
  mulberry32, seedOf, seededShuffle, fillTemplate, tidySpacing, renderTemplate,
  selectBeats, beatsForPhase, phaseBeatPool, expandBeats, buildOriginality, diversifyShots,
  inferFunction, tagDramaticFunctions
} from '../src/domain/narrative.js';
import { hasHostileFraming } from '../src/domain/shot-spec.js';

/** 全量节拍（所有门控打开时，各阶段的池子即为该阶段全部节拍） */
const allBeats = () => PHASES.flatMap(p => phaseBeatPool(p, { seed: 1, hasEnemy: true, hasSupport: true, hasVehicle: true }));
/** 抽出一段文本里用到的所有占位符名 */
const placeholdersIn = (text) => [...String(text || '').matchAll(/\{(\w+)\}/g)].map(m => m[1]);

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

test('narrative: tidySpacing 清掉中文之间的空格，且一次扫干净连续空格', () => {
  // 模板写成 `{heroCallsign} 与 {enemyCallsign} 同时抬枪`，
  // 展开后是「【A】甲 与 【B】乙 同时抬枪」——中文之间不该有空格。
  assert.equal(
    renderTemplate('{h} 与 {e} 同时抬枪开火', { h: '【A】甲', e: '【B】乙' }),
    '【A】甲与【B】乙同时抬枪开火'
  );
  // 连续多处空格必须一次清完（早期用 `([CJK])\s+([CJK])` 会漏掉第二处，
  // 因为右侧字符被上一次匹配吃掉，导致「甲与 【B】」这种半拉子修复）
  assert.equal(tidySpacing('甲 与 乙 同时 推进'), '甲与乙同时推进');
  assert.equal(tidySpacing('街道 在 夜色里'), '街道在夜色里');
  // 中文标点前不留空格
  assert.equal(tidySpacing('推进 ！'), '推进！');
  // 中英混排完全不受影响
  assert.equal(tidySpacing('LEGO minifigure 与 AR-15 步枪'), 'LEGO minifigure 与 AR-15 步枪');
  assert.equal(tidySpacing(''), '');
  assert.equal(tidySpacing(null), '');
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
  const gates = { hasEnemy: false, hasSupport: false, hasVehicle: false };
  const pool = phaseBeatPool('build', { seed: 5, ...gates });
  assert.ok(pool.length >= 3, `build 阶段无敌人/无僚机/无载具时应有足够的 hero 节拍，实得 ${pool.length}`);

  const need = pool.length + 4;
  const out = expandBeats('build', { need, seed: 5, ...gates });
  assert.equal(out.length, need);
  assert.equal(new Set(out.map(b => b.id)).size, out.length);
  assert.equal(new Set(out.map(b => b.action)).size, out.length);

  // 溢出项必须标记来源，便于排查
  const derived = out.filter(b => b.derivedFrom);
  assert.equal(derived.length, 4);
  assert.ok(derived.every(b => b.id.startsWith(b.derivedFrom + '~v')));
  // 变奏必须继承原节拍的戏剧功能与时长，否则会破坏戏剧形状与节奏
  for (const b of derived) {
    const base = pool.find(p => p.id === b.derivedFrom);
    assert.equal(b.fn, base.fn);
    assert.equal(b.duration, base.duration);
  }

  const again = expandBeats('build', { need, seed: 5, ...gates });
  assert.deepEqual(again.map(b => b.id), out.map(b => b.id), '变奏必须确定性可复现');
});

// ---------------------------------------------------------------------------
// 戏剧功能（fn）—— 用户反馈「动作太单一，完全不能构成电影」的回归护栏。
// 根因：v1 节拍库只有 focus（谁在画面里），没有 fn（这一镜对故事做了什么），
// 于是每一镜都在干同一件戏剧上的事：「战斗员执行一个战斗动作」。
// ---------------------------------------------------------------------------

test('narrative: 每个节拍都声明了合法的戏剧功能、时长与镜头类型', () => {
  const beats = allBeats();
  assert.ok(beats.length >= 35, `节拍库规模过小（${beats.length}），难以支撑长片`);
  for (const b of beats) {
    assert.ok(FUNCTIONS[b.fn], `${b.id} 的 fn "${b.fn}" 不在 FUNCTIONS 中`);
    assert.ok([4, 6, 8].includes(b.duration), `${b.id} 的 duration ${b.duration} 不在模型支持的档位 [4,6,8] 内`);
    assert.ok(b.shotType && b.action, `${b.id} 缺少 shotType 或 action`);
  }
});

test('narrative: 节拍只使用其 focus 声明过的占位符（防止自指错句）', () => {
  // 背景：focus=hero 的节拍只有主角在画面里，若 action 里写 {enemyCallsign}，
  // 规划器会退化成用主角自己的代号去填敌人位，生成
  // 「【A】抓住唯一的窗口，一发命中【A】的火力点」这种自指错句（v1 真实存在过）。
  for (const b of allBeats()) {
    const allowed = new Set(FOCUS_ROLES[b.focus]);
    assert.ok(allowed.size > 0, `${b.id} 的 focus "${b.focus}" 未在 FOCUS_ROLES 中声明`);
    for (const ph of placeholdersIn(b.action)) {
      assert.ok(allowed.has(ph), `${b.id} (focus=${b.focus}) 使用了不允许的占位符 {${ph}}`);
    }
  }
});

test('narrative: 节拍库覆盖足够多的戏剧功能，且每个阶段都有非战斗功能', () => {
  const beats = allBeats();
  const fns = new Set(beats.map(b => b.fn));
  assert.ok(fns.size >= 12, `戏剧功能种类过少（${fns.size}）：这正是「动作单一」的根因`);

  // 必须存在「不靠开枪推进故事」的功能
  for (const required of ['goal', 'character', 'quiet', 'reaction', 'reveal', 'decision', 'cost', 'reversal']) {
    assert.ok(fns.has(required), `缺少关键戏剧功能 ${required}`);
  }

  // 每个阶段的弧线都要指向真实存在的功能
  for (const phase of PHASES) {
    assert.ok(PHASE_ARC[phase]?.length, `${phase} 缺少戏剧弧线`);
    for (const fn of PHASE_ARC[phase]) {
      assert.ok(
        beats.some(b => b.phase === phase && b.fn === fn),
        `${phase} 弧线引用了不存在的功能 ${fn}`
      );
    }
    // 每阶段至少要有一个「非战斗」功能（clash/contact/escalate/observe 之外的）
    const nonCombat = PHASE_ARC[phase].filter(fn => !['clash', 'contact', 'escalate'].includes(fn));
    assert.ok(nonCombat.length >= 2, `${phase} 的弧线几乎全是战斗功能`);
  }
});

test('narrative: 短片的戏剧弧线是完整的（每一镜都在推进故事，而不是重复同一动作）', () => {
  // 这是「能不能构成电影」的核心断言：4/8/12 镜的片子，
  // 每一镜都必须承担**互不相同**的戏剧功能，且功能要落在正确的叙事阶段里。
  const expectations = {
    4: ['goal', 'plan', 'escalate', 'aftermath'],
    8: ['goal', 'character', 'plan', 'contact', 'escalate', 'clash', 'aftermath', 'reaction']
  };
  for (const [n, expected] of Object.entries(expectations)) {
    const beats = selectBeats({ n: Number(n), seed: seedOf(`arc|${n}`), hasEnemy: true, hasSupport: true, hasVehicle: true });
    assert.equal(beats.length, Number(n));
    assert.deepEqual(
      beats.map(b => b.fn),
      expected,
      `${n} 镜的戏剧功能序列不符（得到 ${beats.map(b => b.fn).join(' → ')}）`
    );
  }
});

test('narrative: 相邻两镜不承担同一戏剧功能，且整片功能多样性达标', () => {
  for (const n of [4, 6, 8, 12, 16, 24]) {
    const beats = selectBeats({ n, seed: seedOf(`diversity|${n}`), hasEnemy: true, hasSupport: true, hasVehicle: true });
    for (let i = 1; i < beats.length; i++) {
      assert.notEqual(beats[i].fn, beats[i - 1].fn, `n=${n} 第 ${i + 1} 镜与前一镜功能相同（${beats[i].fn}）`);
    }
    const distinct = new Set(beats.map(b => b.fn)).size;
    assert.ok(distinct >= Math.min(6, n), `n=${n} 只覆盖了 ${distinct} 种戏剧功能，过于单调`);
  }
});

test('narrative: 战斗与非战斗镜头混合，且非战斗镜头占比可观', () => {
  // 「完全不能构成电影」的直接量化指标：不能全是战斗镜头。
  const COMBAT_FNS = new Set(['clash', 'contact', 'escalate']);
  for (const n of [8, 12, 16]) {
    const beats = selectBeats({ n, seed: seedOf(`mix|${n}`), hasEnemy: true, hasSupport: true, hasVehicle: true });
    const nonCombat = beats.filter(b => !COMBAT_FNS.has(b.fn)).length;
    assert.ok(
      nonCombat / n >= 0.3,
      `n=${n} 非战斗镜头仅占 ${Math.round((nonCombat / n) * 100)}%，全片仍是一段战斗蒙太奇`
    );
  }
});

test('narrative: 节奏有起伏（不是全片等权重的 8 秒）', () => {
  for (const n of [8, 12]) {
    const beats = selectBeats({ n, seed: seedOf(`pacing|${n}`), hasEnemy: true, hasSupport: true, hasVehicle: true });
    const durations = new Set(beats.map(b => b.duration));
    assert.ok(durations.size >= 2, `n=${n} 全片时长单一（${[...durations].join(',')}），没有节奏差`);
    assert.ok(beats.some(b => b.duration === 4), `n=${n} 缺少快切镜头`);
    assert.ok(beats.some(b => b.duration === 8), `n=${n} 缺少长镜头`);
  }
});

test('narrative: 无敌军时弧线自动降级，clash 不会被硬塞', () => {
  // 没有敌军资产时，clash / contact 这类需要正反同框的功能必须让位给其它功能，
  // 而不是生成一个「双方对轰」却没有敌人的镜头。
  const beats = selectBeats({ n: 12, seed: seedOf('no-enemy'), hasEnemy: false, hasSupport: true, hasVehicle: true });
  assert.equal(beats.length, 12);
  assert.ok(beats.every(b => b.focus !== 'clash' && b.focus !== 'enemy'));
  const fns = new Set(beats.map(b => b.fn));
  assert.ok(fns.size >= 5, `降级后功能反而更单调了（${[...fns].join(',')}）`);
  assert.ok(fns.has('character') || fns.has('quiet'), '降级后应更多依赖非战斗功能');
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

test('narrative: inferFunction maps combat text to clash and reads phase for fallback', () => {
  assert.equal(inferFunction({ phase: 'climax', action: '双方在几米内直接交战对轰。' }), 'clash');
  assert.equal(inferFunction({ phase: 'build', action: '他掀开伪装网，情报错了。' }), 'reveal');
  assert.equal(inferFunction({ phase: 'resolve', action: '他摘下耳机，准备收队返航。' }), 'close');
  // 无任何关键词命中时，回退到该阶段弧线首项
  assert.equal(inferFunction({ phase: 'establish', action: '……' }), PHASE_ARC.establish[0]);
  assert.equal(inferFunction({}), PHASE_ARC.build[0], '缺省阶段按 build 处理');
});

test('narrative: tagDramaticFunctions respects a model-declared legal fn', () => {
  const shots = [
    { phase: 'establish', fn: 'goal', action: '任务简报。' },
    { phase: 'climax', fn: 'clash', action: '正面交战。' }
  ];
  const res = tagDramaticFunctions(shots);
  assert.deepEqual(res.functions, ['goal', 'clash']);
  assert.equal(res.monotone, false);
});

test('narrative: tagDramaticFunctions breaks adjacent duplicate functions', () => {
  const shots = [
    { phase: 'build', fn: 'clash', action: 'A 开火。' },
    { phase: 'build', fn: 'clash', action: 'B 开火。' },
    { phase: 'build', fn: 'clash', action: 'C 开火。' }
  ];
  const res = tagDramaticFunctions(shots);
  for (let i = 1; i < res.functions.length; i++) {
    assert.notEqual(res.functions[i], res.functions[i - 1], '相邻两镜不得同功能');
  }
});

test('narrative: tagDramaticFunctions monotone guard rescues an all-combat script', () => {
  // 典型的「8 镜全程对轰」——文字不同但戏剧功能全同，正是用户抱怨的「不能构成电影」
  const shots = Array.from({ length: 8 }, (_, i) => ({
    phase: PHASES[Math.floor(i / 2)],
    action: `第 ${i + 1} 镜：双方持续交战对轰，弹壳四溅。`
  }));
  const res = tagDramaticFunctions(shots);
  assert.equal(res.monotone, true, '必须识别出单调脚本');
  const distinct = new Set(res.functions).size;
  assert.ok(distinct >= 4, `单调兜底后应长出至少 4 种戏剧功能，实际 ${distinct}`);
  for (let i = 1; i < res.functions.length; i++) {
    assert.notEqual(res.functions[i], res.functions[i - 1]);
  }
  // 节奏：模型没给时长时应按功能补出多种时长，而不是全片同一个长度
  const durations = res.shots.map(s => s.duration);
  assert.ok(new Set(durations).size >= 2, `补出的时长应有起伏，实际 ${durations.join('/')}`);
  assert.ok(durations.every(d => [4, 6, 8].includes(d)), '时长必须是 4/6/8 档位');
});

test('narrative: tagDramaticFunctions keeps a model-supplied duration', () => {
  const shots = [
    { phase: 'build', fn: 'clash', duration: 6, action: 'A 开火。' },
    { phase: 'resolve', fn: 'close', duration: 8, action: 'B 收队。' }
  ];
  const res = tagDramaticFunctions(shots);
  assert.deepEqual(res.shots.map(s => s.duration), [6, 8], '模型给了时长就必须尊重');
});

test('narrative: tagDramaticFunctions supplies a duration when the model omits it', () => {
  const res = tagDramaticFunctions([{ phase: 'climax', fn: 'clash', action: '开火。' }]);
  assert.equal(res.shots[0].duration, 4, '正面交锋默认快切 4s');
});

test('narrative: tagDramaticFunctions never mutates input and survives bad input', () => {
  const shots = [{ phase: 'build', action: '开火。' }];
  const copy = JSON.parse(JSON.stringify(shots));
  const res = tagDramaticFunctions(shots);
  assert.deepEqual(shots, copy, '不得就地修改原数组');
  assert.notEqual(res.shots, shots);
  assert.deepEqual(tagDramaticFunctions([]).functions, []);
  assert.equal(tagDramaticFunctions(null).shots.length, 0);
});

test('narrative: every inferred fn is a member of FUNCTIONS', () => {
  for (const phase of PHASES) {
    for (const beat of phaseBeatPool(phase, { seed: 3, hasEnemy: true, hasSupport: true, hasVehicle: true })) {
      const fn = inferFunction(beat);
      assert.ok(FUNCTIONS[fn], `推断出的 fn 必须是合法功能：${fn}`);
    }
  }
});
