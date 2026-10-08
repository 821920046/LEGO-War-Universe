/**
 * 剧本内核（src/domain/story.js）回归测试
 *
 * 这组测试针对的是一条真实的用户反馈：
 *   「这个项目生成的视频脚本完全没有什么可观赏的价值，内容太单一，就是简单的拼凑，没有剧情。」
 *
 * 它把「可观赏性」拆成可断言的四件事，防止修复被后续改动悄悄回退：
 *   1. 有剧情   —— 每个原型都有完整骨架，且镜头之间必须有因果连接词；
 *   2. 有题材   —— 正文里必须出现该题材的具体名词（目标物 / 地点）；
 *   3. 有对抗   —— focus 为 clash / enemy 的节拍必须通过交战语义校验；
 *   4. 不成拼凑 —— 不同原型的正文不得逐字相同，占位符不得泄漏到成片。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm } from '../src/domain/planner.js';
import { buildStory, detectArc, linkFor, vocabFor, storySteps, shotTypeFor } from '../src/domain/story.js';
import { selectCast, nationOf, rosterToJSON } from '../src/domain/roster.js';
import { transpileMovieToLego } from '../src/domain/cinema-homage.js';
import { COMBAT_ACTION_REGEX, hasHostileFraming } from '../src/domain/shot-spec.js';
import { parseIntent } from '../src/domain/intent.js';

const registry = createRegistry(assets, profiles, { references: [] });

/** 覆盖全部 10 个任务原型 + 5 个战场域的代表性题材 */
const THEMES = [
  '诺曼底登陆抢滩',            // beach-landing
  '中途岛航母对决',            // fleet-ops
  '库尔斯克坦克对决',          // armor-clash
  '斯大林格勒巷战',            // urban-raid（ground）
  'F-22 制空巡逻',             // air-superiority
  'B-2 轰炸敌方雷达站',        // strategic-strike
  '核潜艇深海猎杀',            // submarine-hunt
  '轨道空间站失压事故',        // orbital-ops
  '跳伞飞行员敌后营救',        // rescue-extract
  '海湾战争夜战防空导弹阵地伏击', // general-combat（兜底）
  '现代特战小队城市废墟夜间突袭',
  '二战北非沙漠装甲追击',
  '太平洋热带岛屿滩头两栖登陆作战'
];

/** 展开全部门控，拿到某个题材的完整骨架（测试专用，不影响生产路径） */
function fullSlots(theme) {
  const intent = parseIntent(theme);
  const story = buildStory({
    theme,
    intent,
    cast: {},
    env: null,
    gates: { hasEnemy: true, hasSupport: true, hasVehicle: true }
  });
  return story;
}

const PLACEHOLDER_RE = /\{[a-zA-Z][a-zA-Z0-9_.]*\}/g;

/* ───────────────────────── 1. 骨架自洽 ───────────────────────── */

test('story: 每个原型的骨架都具备全部必需节拍，且字段完整', () => {
  const REQUIRED = ['goal', 'plan', 'contact', 'escalate', 'reveal', 'decision',
    'reversal', 'clash', 'cost', 'aftermath', 'close'];
  const PHASES = new Set(['establish', 'build', 'climax', 'resolve']);
  const FOCUS = new Set(['hero', 'squad', 'vehicle', 'clash', 'enemy']);

  for (const theme of THEMES) {
    const story = fullSlots(theme);
    for (const fn of REQUIRED) {
      const steps = story.slots[fn];
      assert.ok(Array.isArray(steps) && steps.length > 0,
        `${theme}/${story.arc} 缺少戏剧功能 ${fn} 的骨架步骤`);
    }
    for (const [fn, steps] of Object.entries(story.slots)) {
      for (const s of steps) {
        assert.equal(s.fn, fn, `${theme}: 步骤 fn 与所在槽位不一致`);
        assert.ok(PHASES.has(s.phase), `${theme}/${fn}: 非法阶段 ${s.phase}`);
        assert.ok(FOCUS.has(s.focus), `${theme}/${fn}: 非法 focus ${s.focus}`);
        assert.ok(typeof s.action === 'string' && s.action.length > 10,
          `${theme}/${fn}: action 缺失或过短`);
      }
    }
  }
});

test('story: 同题材同门控下骨架完全确定（可复现）', () => {
  for (const theme of THEMES.slice(0, 5)) {
    const a = fullSlots(theme);
    const b = fullSlots(theme);
    assert.deepEqual(a.slots, b.slots, `${theme} 两次构建结果不一致`);
    assert.equal(a.premise, b.premise, `${theme} premise 不稳定`);
  }
});

/* ───────────────────────── 2. 有剧情：因果链 ───────────────────────── */

test('story: 承接类节拍必须拿到非空因果连接词，开场类节拍不得凭空连接', () => {
  // 开场 / 收束类节拍不需要承接上一镜
  for (const fn of ['goal', 'world', 'character', 'aftermath', 'close', 'reaction']) {
    assert.equal(linkFor('clash', fn), '', `${fn} 不应携带承接词`);
  }
  // 真正的推进类节拍必须承接
  for (const fn of ['plan', 'contact', 'escalate', 'reveal', 'decision', 'reversal', 'clash', 'cost']) {
    assert.ok(linkFor('contact', fn).length > 0, `${fn} 缺少承接上一镜的连接词`);
  }
  assert.equal(linkFor(null, 'plan'), '', '首镜不得有承接词');
});

test('story: 成片里至少三镜带因果连接词，且连接词随上一镜功能变化', () => {
  const { plan } = planFilm({ theme: '诺曼底登陆抢滩', requestedShots: 12, profileId: 'veo-3.1-lite' }, registry);
  const withLink = plan.shots.filter(s => /[，。]/.test(s.action) && /^[^【]/.test(s.action) && /(之后|于是|因为|所以|代价|接着|紧接着|枪声|情报|计划|压力|敌人|代价)/.test(s.action));
  assert.ok(withLink.length >= 3,
    `12 镜里只有 ${withLink.length} 镜带因果承接，剧本读起来仍是一叠卡片`);
});

/* ───────────────────────── 3. 有对抗：交战语义 ───────────────────────── */

test('story: focus 为 clash / enemy 的骨架步骤必须通过交战语义校验', () => {
  // 这条是真实回归：新增「敌方观察」节拍时写成「没有下令攻击」，
  // 「攻击」不在 COMBAT_ACTION_REGEX 里，于是 n=24 的诺曼底片在编译期整片抛错
  // （FACTION_CONFLICT_INVALID）。
  for (const theme of THEMES) {
    const story = fullSlots(theme);
    for (const [fn, steps] of Object.entries(story.slots)) {
      for (const s of steps) {
        if (s.focus !== 'clash' && s.focus !== 'enemy') continue;
        assert.ok(COMBAT_ACTION_REGEX.test(s.action),
          `${theme}/${fn}: focus=${s.focus} 的正文缺少交战语义 → ${s.action}`);
        assert.ok(hasHostileFraming(s.action),
          `${theme}/${fn}: focus=${s.focus} 的正文被判为「非对抗」→ ${s.action}`);
      }
    }
  }
});

/* ───────────────────────── 4. 有题材：具体名词 ───────────────────────── */

test('story: 成片正文必须出现该题材解析出的具体名词', () => {
  for (const theme of THEMES) {
    const { plan } = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
    const nouns = plan.story.nouns;
    const text = plan.shots.map(s => s.action).join('\n');
    const hit = [nouns.target, nouns.place, nouns.threat].filter(Boolean)
      .some(n => text.includes(n));
    assert.ok(hit, `${theme}: 正文里没有出现任何具体名词（target=${nouns.target} place=${nouns.place}）`);
  }
});

test('story: 时代词汇按时代取词，二战与五代机不共用同一套装备名词', () => {
  const ww2 = vocabFor('WWII');
  const hi = vocabFor('Modern High-Tech');
  assert.equal(ww2.antiship, '鱼雷');
  assert.equal(hi.antiship, '高超音速反舰导弹');
  assert.notEqual(ww2.interceptor, hi.interceptor);
  assert.deepEqual(vocabFor('不存在的时代'), vocabFor('Modern'), '未知时代应回退到现代词表');
});

/* ───────────────────────── 5. 不成拼凑 ───────────────────────── */

test('story: 不同任务原型的正文绝不逐字相同（含收尾特写）', () => {
  // 收尾反应特写（reaction）此前是**共享质感节拍**，同战场域的两个原型可能抽到同一句。
  // 6.7.1 起每个原型都单写了自己的 reaction，因此逐字重复应当是 0 ——
  // 这条断言从「≤1 且只允许 reaction」收紧为「必须为 0」。
  const perArc = new Map();
  for (const theme of THEMES) {
    const { plan } = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
    const arc = plan.story.arc;
    if (!perArc.has(arc)) perArc.set(arc, new Map());
    const bucket = perArc.get(arc);
    for (const shot of plan.shots) {
      if (!bucket.has(shot.fn)) bucket.set(shot.fn, new Set());
      bucket.get(shot.fn).add(shot.action);
    }
  }

  const arcs = [...perArc.keys()];
  assert.ok(arcs.length >= 8, `样本应覆盖至少 8 个原型，实际 ${arcs.length}`);

  for (let i = 0; i < arcs.length; i += 1) {
    for (let j = i + 1; j < arcs.length; j += 1) {
      let shared = 0;
      for (const [fn, actions] of perArc.get(arcs[i])) {
        const other = perArc.get(arcs[j]).get(fn);
        if (!other) continue;
        for (const a of actions) {
          if (!other.has(a)) continue;
          shared += 1;
          assert.fail(`${arcs[i]} 与 ${arcs[j]} 在 ${fn} 节拍上逐字重复：${a}`);
        }
      }
      assert.equal(shared, 0,
        `${arcs[i]} 与 ${arcs[j]} 共用了 ${shared} 句正文，骨架已经退回通用模板`);
    }
  }
});

test('story: 成片里不得残留任何占位符', () => {
  for (const theme of THEMES) {
    const { plan } = planFilm({ theme, requestedShots: 12, profileId: 'veo-3.1-lite' }, registry);
    for (const [i, shot] of plan.shots.entries()) {
      for (const field of ['action', 'audioCue', 'radioVoice', 'shotType']) {
        const v = shot[field];
        if (typeof v !== 'string') continue;
        const leaked = v.match(PLACEHOLDER_RE);
        assert.equal(leaked, null,
          `${theme} shot${i + 1}.${field} 残留占位符 ${leaked && leaked.join(',')}：${v}`);
      }
    }
  }
});

test('story: 同一战场域的不同原型不得共用同一句质感节拍', () => {
  // 潜艇片与制空片如果都写「镜头缓缓升起，…铺开成一片灰色」，
  // 用户看到的就是「换个题材、句子一模一样」的拼凑感。
  const byDomain = new Map();
  for (const theme of THEMES) {
    const { plan } = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
    const dom = plan.story.domain || 'generic';
    const key = `${dom}|${plan.story.arc}`;
    if (byDomain.has(key)) continue;
    byDomain.set(key, plan.shots.map(s => s.action));
  }
  const naval = byDomain.get('naval|submarine-hunt') || [];
  const air = byDomain.get('air|air-superiority') || [];
  assert.ok(naval.length && air.length, '缺少 naval / air 样本');
  const shared = naval.filter(a => air.includes(a));
  assert.equal(shared.length, 0, `海军片与空战片共用正文：${shared.join(' / ')}`);
});

test('story: 轨道题材必须真的落进 orbital 战场域（此前该域不可达）', () => {
  // 回归：DOMAIN_RULES 早期只有 naval / air / strategic / ground 四个域，
  // 于是 story.js 里所有 domains:['orbital'] 的质感节拍是**不可达的死代码**，
  // 轨道片一直在用陆战通用池（「镜头缓缓升起，…铺开成一片没有尽头的灰色」）。
  const { plan } = planFilm({ theme: '轨道空间站失压事故', requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
  assert.equal(plan.story.domain, 'orbital', '轨道题材必须识别出 orbital 战场域');
  assert.equal(plan.story.arc, 'orbital-ops');

  // 本域节拍必须真的被用上：轨道域的世界镜头写的是舱体外壁与地球弧线
  const actions = plan.shots.map(s => s.action).join('\n');
  assert.ok(/舱体外壁|地球的弧线|真空/.test(actions),
    `轨道题材应当拿到本域质感节拍，实际正文：\n${actions}`);
});

/* ───────────────────────── 6. 选角一致性 ───────────────────────── */

test('story: 二战 / 太平洋题材的敌我必须分属不同国籍，且各自内部国籍统一', () => {
  const cases = [
    { theme: '诺曼底登陆抢滩', friendly: 'us', enemy: 'german' },
    { theme: '中途岛航母对决', friendly: 'us', enemy: 'japanese' },
    { theme: '斯大林格勒巷战', friendly: 'soviet', enemy: 'german' }
  ];
  for (const { theme, friendly, enemy } of cases) {
    const intent = parseIntent(theme);
    const cast = selectCast(registry, {
      era: intent.era || 'Modern', task: intent.task, theme, setting: intent.setting || ''
    });
    const heroNations = new Set(cast.heroes.map(a => nationOf(a)).filter(Boolean));
    const enemyNations = new Set(cast.enemies.map(a => nationOf(a)).filter(Boolean));
    assert.equal(heroNations.size, 1, `${theme}: 我方出现多个国籍 ${[...heroNations].join(',')}`);
    assert.equal(enemyNations.size, 1, `${theme}: 敌方出现多个国籍 ${[...enemyNations].join(',')}`);
    assert.equal([...heroNations][0], friendly, `${theme}: 我方国籍应为 ${friendly}`);
    assert.equal([...enemyNations][0], enemy, `${theme}: 敌方国籍应为 ${enemy}`);
  }
});

test('story: 敌我双方绝不共用同一个姓名（persona）', () => {
  for (const theme of THEMES) {
    const { plan } = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
    const roster = rosterToJSON(plan.roster).filter(e => e.kind === 'character');
    const coalition = new Set(roster.filter(e => e.side === 'coalition').map(e => e.persona).filter(Boolean));
    const opposing = new Set(roster.filter(e => e.side === 'opposing').map(e => e.persona).filter(Boolean));
    const overlap = [...coalition].filter(n => opposing.has(n));
    assert.equal(overlap.length, 0, `${theme}: 敌我共用姓名 ${overlap.join(',')}`);
    // 同一方内部也不得重名
    for (const side of ['coalition', 'opposing']) {
      const names = roster.filter(e => e.side === side).map(e => e.persona).filter(Boolean);
      assert.equal(new Set(names).size, names.length, `${theme}: ${side} 内部重名 ${names.join(',')}`);
    }
  }
});

/* ───────────────────────── 7. 现代敌方角色覆盖 ───────────────────────── */

test('story: 每个现代时代都必须有成建制的敌方角色（不再是「一个扛火箭筒的」）', () => {
  const MODERN_ERAS = ['Modern', 'Modern High-Tech', 'Iraq War', 'Gulf War'];
  for (const era of MODERN_ERAS) {
    const intent = parseIntent('现代城市巷战');
    const cast = selectCast(registry, { era, task: 'combat', theme: '现代城市巷战', setting: 'urban' });
    assert.ok(cast.enemies.length >= 3,
      `${era}: 敌方角色只有 ${cast.enemies.length} 个，撑不起一部片子`);
    assert.equal(cast.enemyFallback, false, `${era}: 不应退化为 enemyFallback`);
  }

  // 现代反方必须覆盖主要兵种，否则「核潜艇深海猎杀」的反派会是扛火箭筒的游击队员
  const opposing = (assets.characters || []).filter(a => a.series === 'Modern' && a.faction === 'Opposing Force');
  for (const unit of ['Aviation', 'Navy', 'Armor', 'Infantry', 'Command', 'Special Forces']) {
    assert.ok(opposing.some(a => a.unit === unit), `Modern 反方缺少 ${unit} 兵种`);
  }
});

/* ───────────────────────── 8. 原型识别顺序 ───────────────────────── */

test('story: 原型识别必须让更具体的原型赢过兜底原型', () => {
  const cases = [
    ['中途岛航母对决', 'fleet-ops'],
    ['诺曼底登陆抢滩', 'beach-landing'],
    ['核潜艇深海猎杀', 'submarine-hunt'],
    ['F-22 制空巡逻', 'air-superiority'],
    ['B-2 轰炸敌方雷达站', 'strategic-strike'],
    ['库尔斯克坦克对决', 'armor-clash'],
    ['轨道空间站失压事故', 'orbital-ops'],
    ['跳伞飞行员敌后营救', 'rescue-extract'],
    ['斯大林格勒巷战', 'urban-raid'],
    ['海湾战争夜战防空导弹阵地伏击', 'general-combat']
  ];
  for (const [theme, arcId] of cases) {
    assert.equal(detectArc(theme, parseIntent(theme)).id, arcId, `${theme} 原型识别错误`);
  }
});

/* ───────────────────────── 9. 镜头类型与 logline ───────────────────────── */

test('story: 镜头类型随 focus 变化，且载具镜 / 对峙镜有专属前缀', () => {
  const vehicle = shotTypeFor({ focus: 'vehicle', fn: 'escalate' });
  const clash = shotTypeFor({ focus: 'clash', fn: 'clash' });
  const enemy = shotTypeFor({ focus: 'enemy', fn: 'observe' });
  assert.ok(vehicle.includes('载具主导'), `载具镜缺少前缀：${vehicle}`);
  assert.ok(clash.includes('双人对轰'), `对峙镜缺少前缀：${clash}`);
  assert.ok(enemy.includes('敌方视角'), `敌方视角镜缺少前缀：${enemy}`);
  assert.notEqual(vehicle, clash);
});

test('story: logline 必须点出主角姓名、时限与赌注，且不得出现破损语法', () => {
  for (const theme of THEMES) {
    const { plan } = planFilm({ theme, requestedShots: 8, profileId: 'veo-3.1-lite' }, registry);
    const ll = plan.originality.logline;
    assert.ok(ll.includes('必须'), `${theme}: logline 缺少时限/任务：${ll}`);
    assert.ok(ll.includes('否则'), `${theme}: logline 缺少赌注：${ll}`);
    assert.ok(!/\{[^}]*\}/.test(ll), `${theme}: logline 残留占位符：${ll}`);
    // 赌注必须是一个完整小句，不能是光秃秃的名词短语
    assert.ok(!/——否则[^。，]{0,6}。/.test(ll), `${theme}: 赌注疑似名词短语，读不成句：${ll}`);
    const protagonist = plan.story.protagonist;
    assert.ok(protagonist && protagonist.name, `${theme}: 缺少主角`);
    assert.ok(ll.includes(protagonist.name), `${theme}: logline 里没有主角姓名：${ll}`);
  }
});

/* ───────────────────────── 10. 门控 ───────────────────────── */

test('story: 无反派 / 无支援 / 无载具时必须剔除对应 focus 的骨架步骤', () => {
  for (const theme of ['中途岛航母对决', '库尔斯克坦克对决', '核潜艇深海猎杀']) {
    const intent = parseIntent(theme);
    const bare = buildStory({
      theme, intent, cast: {}, env: null,
      gates: { hasEnemy: false, hasSupport: false, hasVehicle: false }
    });
    for (const [fn, steps] of Object.entries(bare.slots)) {
      for (const s of steps) {
        assert.notEqual(s.focus, 'clash', `${theme}/${fn}: 无反派时仍保留对峙节拍`);
        assert.notEqual(s.focus, 'enemy', `${theme}/${fn}: 无反派时仍保留敌方视角节拍`);
        assert.notEqual(s.focus, 'squad', `${theme}/${fn}: 无支援时仍保留双人节拍`);
        assert.notEqual(s.focus, 'vehicle', `${theme}/${fn}: 无载具时仍保留载具节拍`);
      }
    }
    // 兜底：即使门控全关，goal / close 这类基础节拍也必须还在
    assert.ok(bare.slots.goal?.length, `${theme}: 门控全关后连 goal 都没了`);
  }
});

test('story: storySteps 只返回门控允许的步骤，且不修改原始骨架', () => {
  const a = storySteps('beach-landing', 'clash', { hasEnemy: true });
  const b = storySteps('beach-landing', 'clash', { hasEnemy: false });
  assert.ok(a.length >= 1, '有反派时应返回对峙步骤');
  assert.equal(b.length, 0, '无反派时应返回空数组');
  // 连续两次调用结果一致（内部不得持有可变状态）
  assert.deepEqual(storySteps('beach-landing', 'clash', { hasEnemy: true }), a);
});

/* ───────────────────────── 11. 电影致敬路径 ───────────────────────── */

test('story: 电影致敬路径的 logline 同样以人物为锚点，且背景句不重复时代名', () => {
  // 两条路径（本地规划器 / 电影致敬）必须口径一致：早期只有规划器路径改写了 logline，
  // 致敬路径仍在输出「黑鹰坠落被投入一场高烈度正面交战」这种以主题为主语的公告句。
  for (const movie of ['黑鹰坠落', '地心引力', '敦刻尔克', '壮志凌云']) {
    const res = transpileMovieToLego(movie, 6, registry);
    assert.ok(res && !res.error, `${movie} 未命中电影库`);
    const ll = res.originality.logline;
    assert.ok(!/被投入一场/.test(ll), `${movie}: 致敬路径仍是旧版公告式 logline：${ll}`);
    assert.ok(ll.includes('带着小队'), `${movie}: logline 缺少人物主句：${ll}`);
    assert.ok(ll.includes('而'), `${movie}: logline 缺少转折：${ll}`);
    assert.ok(!/\{[^}]*\}/.test(ll), `${movie}: logline 残留占位符：${ll}`);
    // 背景句不得把时代名念两遍（「近地轨道，近地轨道空间站外壁…」）
    const head = ll.split('。')[0];
    const eraWords = head.match(/近地轨道|现代高科技战场|现代|二战|太平洋战场|冷战|海湾战争|伊拉克战争/g) || [];
    assert.equal(new Set(eraWords).size, eraWords.length, `${movie}: 背景句重复时代名：${head}`);
  }
});
