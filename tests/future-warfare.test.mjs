/**
 * 6.7.2 回归测试：历史考据修复 + 现代 / 未来战争创作能力
 *
 * 这一轮的问题全部来自「把真实输出打印出来读」—— 不是来自猜测。
 * 因此每一条修复都配一条**基于成片正文**的断言，而不是基于内部字段的断言：
 * 字段对了但句子还是错的，才是这一轮反复踩到的坑。
 *
 * 覆盖：
 *   A. 历史战役年代识别（此前 8/20 个题材 era=null，静默回落现代）
 *   B. 战场域覆盖（此前 5/20 个题材 domain=null，环境退化成中东沙漠）
 *   C. 场景氛围词多样性与按域正确（此前 19/20 都是「尘雾」，且尘雾出现在轨道上）
 *   D. 场景名词的维度（此前「潜望深度在尘雾里被压成一条发白的线」）
 *   E. 收尾镜的焦点与主载具（此前「反潜护卫舰冲破海面，指挥塔舱盖打开」）
 *   F. 占位符与 focus 的一致性（此前 focus=hero 的 {enemyCallsign} 会渲染成主角自己）
 *   G. 6 个现代 / 未来战争原型的可达性与合规性
 *   H. 主角必须是指挥职务（此前「装填手沃尔科夫带着小队进入…」）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm } from '../src/domain/planner.js';
import { detectArc, buildStory, weatherFor } from '../src/domain/story.js';
import { validateFilmPlan } from '../src/domain/shot-spec.js';
import { parseIntent, parseIntentWithOverrides } from '../src/domain/intent.js';
import { domainOfText, buildRoster, ROLE_LABELS } from '../src/domain/roster.js';

const registry = createRegistry(assets, profiles, { references: [] });
const PROFILE = [...registry.profileById.keys()][0];

const plan = (theme, n = 12, era = null) =>
  planFilm({ theme, requestedShots: n, profileId: PROFILE, era }, registry).plan;

const allText = (p) => p.shots.map(s => `${s.action} ${s.audioCue} ${s.radioVoice}`).join('\n');

/* ───────────────────── A. 历史战役年代识别 ───────────────────── */

test('6.7.2 · 具体战役名必须识别出年代，不得静默回落现代', () => {
  // 修复前：这 6 个题材全部 era=null，成片直接变成「现代，中东沙漠」+ M1A2 + 无人战车，
  // 而库里明明有 WWII 池。这不是「不够好」，是**内容错误**。
  const cases = [
    ['库尔斯克坦克对决', 'WWII'],
    ['阿登森林冬季反击战', 'WWII'],
    ['斯大林格勒巷战', 'WWII'],
    ['诺曼底登陆抢滩', 'WWII'],
    ['中途岛航母对决', 'Pacific'],
    ['硫磺岛登陆战', 'Pacific'],
    ['富尔达缺口装甲对峙', 'Cold War'],
    ['费卢杰城区清剿', 'Iraq War']
  ];
  for (const [theme, want] of cases) {
    assert.equal(parseIntent(theme).era, want, `${theme} 的年代识别错误`);
  }
});

test('6.7.2 · 装备型号可以推断年代，且 T-34 / 零式不得被当成现代装备', () => {
  assert.equal(parseIntent('B-2 轰炸敌方雷达站').era, 'Modern');
  assert.equal(parseIntent('F-22 高空制空巡逻').era, 'Modern');
  assert.equal(parseIntent('核潜艇深海猎杀').era, 'Modern');
  assert.equal(parseIntent('T-34 坦克连冲击德军防线').era, 'WWII');
  assert.equal(parseIntent('零式战斗机护航轰炸机').era, 'WWII');
  // 年代来源必须可区分：UI 要能显示「识别为历史战役」还是「按现代兜底」
  assert.equal(parseIntent('库尔斯克坦克对决').eraSource, 'battle');
  assert.equal(parseIntent('F-22 高空制空巡逻').eraSource, 'platform');
  assert.equal(parseIntent('完全无法判断年代的一段文字').eraSource, 'none');
});

test('6.7.2 · 用户显式指定的时代优先于任何识别结果', () => {
  const forced = parseIntentWithOverrides('库尔斯克坦克对决', { era: 'Modern' });
  assert.equal(forced.era, 'Modern');
  assert.equal(forced.eraSource, 'override');
  assert.equal(forced.needsConfirmation, false, '用户已指定年代就不该再要求确认');
  // auto 表示不干预
  assert.equal(parseIntentWithOverrides('库尔斯克坦克对决', { era: 'auto' }).era, 'WWII');
});

test('6.7.2 · 历史题材成片里不得出现跨时代装备', () => {
  // 这是年代识别错误的**可见后果**：修复前「库尔斯克坦克对决」的收尾镜头是
  // 「无人战斗车（UGV）缓缓驶过烧毁的敌车」—— 一辆 UGV 出现在 1943 年的坦克会战里。
  const p = plan('库尔斯克坦克对决', 12);
  const text = allText(p);
  for (const modern of ['M1A2', 'M1A1', '无人战斗车', 'UGV', '艾布拉姆斯', '斯特赖克', 'MRAP']) {
    assert.ok(!text.includes(modern), `库尔斯克片里出现了现代装备「${modern}」`);
  }
  assert.ok(/T-34|谢尔曼|虎式|IS-2|四号|黑豹/.test(text), '二战坦克片里应当出现二战坦克');
});

/* ───────────────────── B. 战场域覆盖 ───────────────────── */

test('6.7.2 · 每个题材都必须能判出战场域，环境不得退化成「资产库第一项」', () => {
  const themes = [
    '诺曼底登陆抢滩', '阿登森林冬季反击战', '敌后渗透破坏桥梁',
    '护航编队反潜警戒', '跳伞飞行员敌后营救'
  ];
  for (const theme of themes) {
    assert.ok(domainOfText(theme), `${theme} 判不出战场域（修复前为 null）`);
    const p = plan(theme, 8);
    assert.ok(p.story.domain, `${theme} 的计划里没有战场域`);
  }
});

test('6.7.2 · 环境要优先选题材点名的那个', () => {
  // 修复前「库尔斯克坦克对决」拿到的是 ENV-107 北非沙漠绿洲 —— 它只是恰好排在
  // ENV-109 库尔斯克草原之前。现在按题材点名度排序。
  const p = plan('库尔斯克坦克对决', 8);
  const env = registry.byId.get(p.shots[0].environment);
  assert.ok(/库尔斯克|草原|东线/.test(`${env.nameZh}${env.kw || ''}`),
    `库尔斯克题材拿到了不相干的环境：${env.nameZh}`);
});

/* ───────────────────── C. 场景氛围词 ───────────────────── */

test('6.7.2 · 场景氛围词必须有真实多样性（修复前 19/20 都是「尘雾」）', () => {
  const themes = [
    '核潜艇深海猎杀', '中途岛航母对决', '诺曼底登陆抢滩', 'F-22 制空巡逻',
    '库尔斯克坦克对决', '轨道空间站失压事故', '跳伞飞行员敌后营救',
    '现代特战小队城市废墟夜间突袭', 'B-2 轰炸敌方雷达站', '斯大林格勒巷战',
    '海湾战争夜战防空导弹阵地伏击', '太平洋热带岛屿滩头两栖登陆作战',
    '沙漠风暴装甲突击', '伊拉克战争城市清剿', '二战北非沙漠装甲追击',
    '航母战斗群远海编队作战', '阿登森林冬季反击战', '敌后渗透破坏桥梁',
    '护航编队反潜警戒', '近地轨道卫星争夺战'
  ];
  const counts = new Map();
  for (const theme of themes) {
    // 必须用**整片 12 镜**：承载 {weather} 的是质感节拍（{place}在{weather}里…），
    // 8 镜的精简版根本选不到它们，用 8 镜量出来是 0 命中 —— 那是在量一个不存在的句子。
    const p = plan(theme, 12);
    for (const s of p.shots) {
      const m = String(s.action).match(/在([\u4e00-\u9fa5]{2,6})里(?:铺开|无声自转|被压成|安静得)/);
      if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    }
  }
  const distinct = counts.size;
  const top = Math.max(...counts.values());
  assert.ok(distinct >= 4, `场景氛围词只有 ${distinct} 种：${[...counts.keys()].join('/')}`);
  assert.ok(top / themes.length < 0.5,
    `单一氛围词占比过高（${top}/${themes.length}）：${[...counts].sort((a, b) => b[1] - a[1])[0]?.[0]}`);
});

test('6.7.2 · 氛围词必须与战场域物理相容：轨道不得出现地面气象', () => {
  // 修复前轨道片的正文是「核心舱检修口在尘雾里无声自转」—— 真空里起不了尘雾。
  const p = plan('近地轨道卫星争夺战', 12);
  const text = allText(p);
  for (const ground of ['尘雾', '扬尘', '硝烟', '沙尘', '海雾', '风雪', '暴雨', '薄雾']) {
    assert.ok(!text.includes(ground), `轨道片里出现了地面/海洋气象「${ground}」`);
  }
  // 气象池本身也要正确：轨道没有气象，只有光照与可见性
  const w = weatherFor({ domain: 'orbital', intent: { weather: 'snow', lightingCondition: 'night' }, seed: 0 });
  assert.ok(!/风雪|雨幕|夜色/.test(w), `轨道氛围词不应受地面气象影响：${w}`);
  assert.equal(weatherFor({ domain: 'naval', intent: { weather: 'snow' }, seed: 0 }), '风雪');
  assert.equal(weatherFor({ domain: 'ground', intent: { lightingCondition: 'night' }, seed: 0 }), '夜色');
});

/* ───────────────────── D. 场景名词的维度 ───────────────────── */

test('6.7.2 · 场景名词必须是一个「区域」，不能是深度值或零件名', () => {
  // 「潜望深度在尘雾里被压成一条发白的线」把深度当成了区域；
  // 「核心舱检修口在尘雾里无声自转」把零件当成了区域。
  const bad = [/^潜望深度$/, /^核心舱检修口$/, /^对接舱$/, /^外部桁架$/];
  for (const theme of ['核潜艇深海猎杀', '轨道空间站失压事故', '中途岛航母对决', 'F-22 制空巡逻']) {
    const p = plan(theme, 12);
    for (const loc of p.story.locations) {
      for (const re of bad) {
        assert.ok(!re.test(loc), `${theme} 的场景名词「${loc}」不是区域，无法与「在…里 / 在…边缘」搭配`);
      }
    }
  }
  // 成片正文里不得出现「检修口在…自转」这类主谓错配
  assert.ok(!/检修口在/.test(allText(plan('轨道空间站失压事故', 12))));
});

/* ───────────────────── E. 收尾镜的焦点与主载具 ───────────────────── */

test('6.7.2 · 收尾镜必须用本原型写的句子，不得回退通用模板', () => {
  // 修复前 20 个题材里有 10 个的收尾是通用节拍模板
  // 「衣阿华级战列舰载着归队的队员缓缓驶离太平洋」—— 一句与原型无关的拼凑句。
  const themes = [
    '核潜艇深海猎杀', '中途岛航母对决', '诺曼底登陆抢滩', 'F-22 制空巡逻',
    '库尔斯克坦克对决', '轨道空间站失压事故', '跳伞飞行员敌后营救',
    '现代特战小队城市废墟夜间突袭', 'B-2 轰炸敌方雷达站', '斯大林格勒巷战',
    '海湾战争夜战防空导弹阵地伏击', '太平洋热带岛屿滩头两栖登陆作战',
    '沙漠风暴装甲突击', '伊拉克战争城市清剿', '二战北非沙漠装甲追击',
    '航母战斗群远海编队作战', '阿登森林反击战', '敌后渗透破坏桥梁',
    '护航编队反潜警戒', '近地轨道卫星争夺战'
  ];
  for (const theme of themes) {
    const p = plan(theme, 12);
    const closes = p.shots.filter(s => s.fn === 'close');
    assert.equal(closes.length, 1, `${theme} 缺少收尾镜`);
    assert.ok(!/载着归队的队员/.test(closes[0].action),
      `${theme} 的收尾回退到了通用模板：${closes[0].action}`);
    assert.ok(!/\{[^}]*\}/.test(closes[0].action), `${theme} 收尾残留占位符`);
  }
});

test('6.7.2 · 收尾镜的载具必须是本片主载具，而不是轮转抽到的那台', () => {
  // 修复前「核潜艇深海猎杀」的收尾是反潜护卫舰、「F-22 制空巡逻」的收尾是 V-22 鱼鹰。
  const p = plan('F-22 高空制空巡逻', 12);
  const close = p.shots.find(s => s.fn === 'close');
  const lead = p.cast.vehicles[0];
  assert.ok(close.subjects.includes(lead),
    `收尾镜没有用主载具 ${lead}：${close.subjects.join(',')} — ${close.action}`);
});

test('6.7.2 · 收尾镜的物理动作必须与载具型号相容', () => {
  // 「反潜护卫舰冲破海面，指挥塔舱盖打开」：护卫舰没有指挥塔，也不会从水下上浮。
  const p = plan('核潜艇深海猎杀', 12);
  const close = p.shots.find(s => s.fn === 'close');
  assert.ok(!/冲破海面/.test(close.action) || /潜艇/.test(close.action),
    `护卫舰不该有「冲破海面」的动作：${close.action}`);
});

/* ───────────────────── F. 占位符与 focus 的一致性 ───────────────────── */

test('6.7.2 · 骨架里的占位符必须与 focus 匹配（否则会静默指错人）', () => {
  // 这是本轮发现的**系统性缺陷**：planner 按 focus 决定 subjects 顺序，
  // supportId / enemyId / vehicleId 都是「subjects[1] 或塌回 subjects[0]」。
  // 于是 focus 写错时占位符会静默渲染成错的人：
  //   focus='hero'  + {enemyCallsign} → 主角自己（「沃尔科夫看见沃尔科夫的指挥车」）
  //   focus='clash' + {supportCallsign} → 敌人
  //   focus='hero'  + {vehicle}        → 主角
  const src = readFileSync(new URL('../src/domain/story.js', import.meta.url), 'utf8');
  const rules = [
    ['{supportCallsign}', (f) => f === 'squad'],
    ['{enemyCallsign}', (f) => f === 'clash' || f === 'enemy'],
    ['{vehicle}', (f) => f === 'vehicle']
  ];
  const re = /\{\s*fn:\s*'(\w+)'[^}]*?focus:\s*'(\w+)'[^}]*?action:\s*'((?:[^'\\]|\\.)*)'/g;
  const offenders = [];
  let m;
  while ((m = re.exec(src))) {
    const [, fn, focus, action] = m;
    for (const [ph, ok] of rules) {
      if (action.includes(ph) && !ok(focus)) offenders.push(`${fn}/${focus} 用了 ${ph}`);
    }
  }
  assert.deepEqual(offenders, [], `占位符与 focus 不匹配：\n${offenders.join('\n')}`);
});

test('6.7.2 · 成片里同一镜不得把同一个人当成两个人写', () => {
  // 「佩德罗蹲下把佩德罗的铭牌收进口袋」是 focus 写错的可见后果。
  const themes = [
    '诺曼底登陆抢滩', '库尔斯克坦克对决', '中途岛航母对决', '核潜艇深海猎杀',
    '现代特战小队城市废墟夜间突袭', '动力外骨骼小队突击城市废墟'
  ];
  for (const theme of themes) {
    for (const s of plan(theme, 12).shots) {
      const calls = s.action.match(/【([A-Z]+)】([\u4e00-\u9fa5]{2,4})/g) || [];
      const pairs = calls.map(c => c.replace(/[【】]/g, '|'));
      // 同一个「代号+人名」在一句里出现两次，且句式是「A 把 A 的…」→ 必然是错配
      const seen = new Map();
      for (const p of pairs) seen.set(p, (seen.get(p) || 0) + 1);
      for (const [p, n] of seen) {
        assert.ok(n < 2 || !new RegExp(`${p.split('|')[2]}[^。]{0,12}${p.split('|')[2]}的`).test(s.action),
          `${theme}: 同一镜把同一人写成两人：${s.action}`);
      }
    }
  }
});

/* ───────────────────── G. 现代 / 未来战争原型 ───────────────────── */

const FUTURE_ARCS = [
  ['反无人机阵地防御', 'counter-uas', 'Modern High-Tech'],
  ['无人机蜂群突防压制敌方雷达', 'swarm-strike', 'Modern High-Tech'],
  ['高超音速滑翔弹打击敌方反导阵地', 'hypersonic-strike', 'Modern High-Tech'],
  ['电子战与网络战压制敌方指挥节点', 'ew-cyber', 'Modern High-Tech'],
  ['动力外骨骼小队突击城市废墟', 'mech-assault', 'Modern High-Tech'],
  ['使馆撤侨掩护平民撤离', 'embassy-evac', 'Modern']
];

test('6.7.2 · 6 个现代 / 未来战争原型必须可达且通过全部校验', () => {
  for (const [theme, arcId, era] of FUTURE_ARCS) {
    assert.equal(detectArc(theme, parseIntent(theme)).id, arcId, `${theme} 路由到了错误的原型`);
    const p = plan(theme, 12);
    assert.equal(p.intent.era, era, `${theme} 的时代识别错误`);
    const val = validateFilmPlan(p, registry);
    assert.equal(val.ok, true,
      `${theme} 校验失败：${val.errors.map(e => e.code).join(',')}`);
    // 每一镜都必须是本原型写的（12 镜 12 条不重复正文）
    assert.equal(new Set(p.shots.map(s => s.action)).size, 12, `${theme} 出现重复正文`);
    // 没有占位符泄漏
    assert.ok(!/\{[^}]*\}/.test(allText(p)), `${theme} 成片残留占位符`);
  }
});

test('6.7.2 · 未来战争原型不得抢走历史原型', () => {
  const cases = [
    ['核潜艇深海猎杀', 'submarine-hunt'],
    ['中途岛航母对决', 'fleet-ops'],
    ['F-22 制空巡逻', 'air-superiority'],
    ['B-2 轰炸敌方雷达站', 'strategic-strike'],
    ['诺曼底登陆抢滩', 'beach-landing'],
    ['库尔斯克坦克对决', 'armor-clash'],
    ['轨道空间站失压事故', 'orbital-ops'],
    ['跳伞飞行员敌后营救', 'rescue-extract'],
    ['现代特战小队城市废墟夜间突袭', 'urban-raid']
  ];
  for (const [theme, want] of cases) {
    assert.equal(detectArc(theme, parseIntent(theme)).id, want, `${theme} 被新原型抢走了`);
  }
});

test('6.7.2 · 现代高科技战场必须有敌方阵营（否则战争片没有对手）', () => {
  // 修复前 Modern High-Tech 一个敌方角色都没有，蜂群 / 外骨骼 / 电子战三个原型的
  // clash、reversal、cost 全部失去支点，只能靠借 Modern 的敌人。
  const opfor = (assets.characters || [])
    .filter(c => c.series === 'Modern High-Tech' && c.faction === 'Opposing Force');
  assert.ok(opfor.length >= 3, `Modern High-Tech 敌方角色只有 ${opfor.length} 个`);
  const p = plan('无人机蜂群突防压制敌方雷达', 12);
  assert.ok(p.cast.enemies.length > 0, '未来战争片没有敌方演员');
  const enemySeries = p.cast.enemies.map(id => registry.byId.get(id).series);
  assert.ok(enemySeries.every(s => s === 'Modern High-Tech' || s === 'Modern'),
    `敌方演员时代不兼容：${enemySeries.join(',')}`);
});

/* ───────────────────── H. 主角职务 ───────────────────── */

test('6.7.2 · 主角必须是指挥职务，不能是装填手 / 卫生员', () => {
  // 指挥类节拍（goal / plan / decision / close）全部由主角承担，
  // 他的职务就必须配得上「在镜头前布置战术」这件事。
  // 「军医」刻意不在白名单里：医疗兵该在主角负伤时上场，不是带着编队去打航母对决。
  const LEADER_ROLES = /队长|车长|舰长|机长|指挥官|指挥员|组长|主管|联络员|官$/;
  const themes = [
    '库尔斯克坦克对决', '核潜艇深海猎杀', '中途岛航母对决', 'F-22 制空巡逻',
    '动力外骨骼小队突击城市废墟', '使馆撤侨掩护平民撤离', '轨道空间站失压事故',
    // 下面三个在修复前的主角是「军医」—— 加进来是为了锁住这一类穿帮。
    '太平洋热带岛屿滩头两栖登陆作战', '近地轨道卫星争夺战', '航母战斗群远海编队作战',
    '无人机蜂群突防压制敌方雷达', '高超音速滑翔弹打击敌方反导阵地',
    '电子战与网络战压制敌方指挥节点', '反无人机阵地防御', '斯大林格勒巷战',
    '诺曼底登陆抢滩', 'B-2 轰炸敌方雷达站', '跳伞飞行员敌后营救', '敌后渗透破坏桥梁'
  ];
  for (const theme of themes) {
    const p = plan(theme, 12);
    const leadId = p.story.protagonist?.id;
    assert.ok(leadId, `${theme} 没有识别出主角`);
    const entry = p.roster.find(e => e.id === leadId);
    assert.ok(entry, `${theme} 主角不在名册里`);
    assert.ok(LEADER_ROLES.test(entry.personaRole || ''),
      `${theme} 的主角职务是「${entry.personaRole}」，不足以承担指挥类节拍`);
    // 而且这个名字必须真的出现在 logline 与 goal 镜里
    assert.ok(p.originality.logline.includes(entry.persona), `${theme} logline 里的主角对不上`);
    const goal = p.shots.find(s => s.fn === 'goal');
    assert.ok(goal.action.includes(entry.persona), `${theme} 任务简报镜的主角对不上`);
  }
});

test('6.7.2 · 每个资产兵种都必须有专属职务池（不得静默退化成通用「队长」）', () => {
  // 修复前：资产用 `Navy`（6 个角色），ROLE_LABELS 只写了 `Naval`（0 个角色），
  // 两边永远对不上 —— 于是所有海军角色的职务都退化成通用池的「队长」。
  // 这类错不抛异常、不打日志，只让「弹道导弹核潜艇艇长」在成片里显示成「队长」。
  const units = [...new Set((assets.characters || []).map(c => c.unit))].sort();
  const missing = units.filter(u => !Object.prototype.hasOwnProperty.call(ROLE_LABELS, u));
  assert.deepEqual(missing, [], `以下兵种没有专属职务池，会退化成通用「队长」：${missing.join(' / ')}`);
});

test('6.7.2 · 海战题材的主角必须是海军兵种，不能是陆战队工兵', () => {
  // 修复前「中途岛航母对决」的主角是「美军海军陆战队喷火兵」——
  // 因为它的名字里有「海军陆战队」，在 domainScore 里拿到了与舰长同分的海军域加分。
  // 这是关键词判域第三次骗人（前两次：`\bcrew\b`、`战斗工兵`），因此改用显式兵种→域对照表。
  const cases = [
    ['中途岛航母对决', /Navy|Naval/],
    ['诺曼底登陆抢滩', /Navy|Naval/],
    ['护航编队反潜警戒', /Navy|Naval/],
    ['航母战斗群远海编队作战', /Navy|Naval/],
    ['核潜艇深海猎杀', /Navy|Naval/]
  ];
  for (const [theme, unitRe] of cases) {
    const p = plan(theme, 12);
    const lead = p.roster.find(e => e.id === p.story?.protagonist?.id);
    assert.ok(lead, `${theme} 没有识别出主角`);
    assert.ok(unitRe.test(lead.unit || ''),
      `${theme} 的主角兵种是 ${lead.unit}（${lead.personaRole}）—— 海战题材的主角不是海军`);
  }
});

test('6.7.2 · 主角职务在「规划器」与「事后重建名册」两条路径上必须一致', () => {
  // 规划器传的是只有 subjects 的草稿（必须显式给 leadId）；
  // UI / 导出传的是带 fn 的完整镜头（从 goal 镜反推 leadId）。
  // 两条路径若不一致，就会出现「脚本里是车长、定妆表里是装填手」。
  const p = plan('库尔斯克坦克对决', 12);
  const rebuilt = buildRoster(p.shots, registry);
  for (const e of p.roster) {
    const other = rebuilt.byId.get(e.id);
    assert.ok(other, `${e.id} 不在重建名册里`);
    assert.equal(other.callsign, e.callsign, `${e.id} 代号不一致`);
    assert.equal(other.personaRole, e.personaRole, `${e.id} 职务不一致`);
    assert.equal(other.persona, e.persona, `${e.id} 姓名不一致`);
  }
});

test('6.7.2 · 医疗兵永远不得占据主角位（结构性不变量）', () => {
  // 这不是「某个题材恰好没踩到」，而是一条不变量：主角承担全部指挥类节拍，
  // 所以非指挥兵种（医疗）不得排在 heroes[0]。修复前 26 个题材里有 3 个踩到。
  const themes = [
    '中途岛航母对决', '太平洋热带岛屿滩头两栖登陆作战', '近地轨道卫星争夺战',
    '航母战斗群远海编队作战', '核潜艇深海猎杀', '诺曼底登陆抢滩',
    '动力外骨骼小队突击城市废墟', '使馆撤侨掩护平民撤离'
  ];
  for (const theme of themes) {
    const p = plan(theme, 12);
    const leadId = p.story?.protagonist?.id;
    const lead = p.roster?.find(e => e.id === leadId);
    assert.ok(lead, `${theme} 主角不在名册里`);
    assert.notEqual(lead.unit, 'Medical',
      `${theme} 的主角是医疗兵（${lead.personaRole}）—— 他该救人，不该下命令`);
  }
});

test('6.7.2 · logline 的移动从句必须与分镜指的是同一个地方', () => {
  // 修复前 logline 用的是**环境名**（「核潜艇控制舱」），分镜用的是 locations 里的区域
  // （「跃变层下的静默区」）—— 同一部片子的简介与正文指的不是一个地方；
  // 而且环境名已经在 premise 里出现过一次，读起来是重复。
  const themes = [
    '核潜艇深海猎杀', '中途岛航母对决', 'F-22 制空巡逻', '库尔斯克坦克对决',
    '轨道空间站失压事故', '使馆撤侨掩护平民撤离', '动力外骨骼小队突击城市废墟'
  ];
  for (const theme of themes) {
    const p = plan(theme, 12);
    const m = p.originality.logline.match(/带着小队(.+?)；/);
    assert.ok(m, `${theme} 的 logline 没有移动从句：${p.originality.logline}`);
    const target = m[1].replace(/^(?:潜入|驶入|飞向|前出到|进入)/, '');
    assert.ok(p.story.locations.includes(target),
      `${theme} 的 logline 去的是「${target}」，但它不在 locations 里：${p.story.locations.join(' / ')}`);
  }
});

test('6.7.2 · 移动动词必须与载具相容：潜艇「潜入」、水面舰艇「驶入」', () => {
  // 修复前 naval 域共用一个动词「潜入」（当初是为潜艇写的），于是
  // 「中途岛航母对决」的 logline 是「舰长佩德罗带着小队潜入太平洋」—— 航母不会下潜。
  assert.ok(plan('核潜艇深海猎杀', 12).originality.logline.includes('潜入'),
    '潜艇题材的 logline 应该用「潜入」');
  for (const theme of ['中途岛航母对决', '护航编队反潜警戒', '航母战斗群远海编队作战']) {
    const l = plan(theme, 12).originality.logline;
    assert.ok(!l.includes('潜入'), `${theme} 是水面舰艇题材，logline 不该用「潜入」：${l}`);
  }
});

/* ───────────────────── 附加：确定性与资产契约 ───────────────────── */

test('6.7.2 · 新增资产必须良构，且不破坏既有契约', () => {
  const groups = ['characters', 'vehicles', 'weapons', 'props', 'fx',
    'environments', 'cameras', 'lighting', 'colorGrades', 'audio'];
  const ids = new Set();
  for (const g of groups) {
    for (const a of assets[g] || []) {
      assert.ok(!ids.has(a.id), `资产 ID 重复：${a.id}`);
      ids.add(a.id);
      assert.match(a.id, /^[A-Z]{2,5}-[0-9]{3}$/, `ID 命名不合规：${a.id}`);
      assert.ok(Array.isArray(a.lines) && a.lines.length > 0, `${a.id} 缺少 lines`);
    }
  }
  const pack = groups.flatMap(g => assets[g] || []).filter(a => a.origin === 'future-warfare-pack');
  assert.ok(pack.length >= 10, `未来战争扩充包应 >= 10 项，实际 ${pack.length}`);
  assert.ok(pack.some(a => a.kind === undefined && (assets.characters || []).includes(a)), '扩充包必须含角色');
  assert.ok(pack.some(a => (assets.vehicles || []).includes(a)), '扩充包必须含载具');
  assert.ok(pack.some(a => (assets.environments || []).includes(a)), '扩充包必须含环境');
});

test('6.7.2 · 全流程仍然是确定性的', () => {
  for (const theme of ['无人机蜂群突防压制敌方雷达', '库尔斯克坦克对决', '使馆撤侨掩护平民撤离']) {
    const a = JSON.stringify(plan(theme, 12));
    const b = JSON.stringify(plan(theme, 12));
    assert.equal(a, b, `${theme} 两次生成结果不一致`);
  }
});

test('6.7.2 · 骨架与质感节拍在 12 镜以内不得出现逐字重复', () => {
  const themes = [...FUTURE_ARCS.map(x => x[0]), '诺曼底登陆抢滩', '库尔斯克坦克对决'];
  for (const theme of themes) {
    const p = plan(theme, 12);
    const actions = p.shots.map(s => s.action);
    assert.equal(new Set(actions).size, actions.length, `${theme} 出现重复正文`);
  }
});
