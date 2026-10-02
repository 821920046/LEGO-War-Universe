import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { isEraCompatible } from '../src/domain/shot-spec.js';
import {
  FRIENDLY_FACTIONS, ENEMY_FACTIONS, sideOf, fnv1a, archetypeOf,
  assignCallsign, buildRoster, rosterToJSON, rosterFromJSON,
  labelFor, aliasLabel, callsignOf, selectCast, rosterPromptLines,
  domainOfText, themeMatch, taskAffinity
} from '../src/domain/roster.js';

const registry = createRegistry(assets, profiles, { references: [] });

test('roster: faction classification covers friendly / enemy / neutral', () => {
  assert.ok(FRIENDLY_FACTIONS.has('Coalition'));
  assert.ok(ENEMY_FACTIONS.has('Opposing Force'));
  assert.equal(sideOf({ faction: 'Coalition' }), 'coalition');
  assert.equal(sideOf({ faction: 'Axis' }), 'opposing');
  assert.equal(sideOf({ faction: 'Civilian' }), 'neutral');
  assert.equal(sideOf({}), 'neutral');
  assert.equal(sideOf(null), 'neutral');
});

test('roster: fnv1a is deterministic and non-negative', () => {
  assert.equal(fnv1a('CHR-401'), fnv1a('CHR-401'));
  assert.notEqual(fnv1a('CHR-401'), fnv1a('CHR-402'));
  assert.ok(fnv1a('') >= 0);
  assert.equal(fnv1a(null), fnv1a(''));
});

test('roster: archetype detection maps units to distinct pools', () => {
  assert.equal(archetypeOf({ unit: 'Sniper Team' }), 'sniper');
  assert.equal(archetypeOf({ unit: 'Combat Medic' }), 'medical');
  assert.equal(archetypeOf({ unit: 'Armour Crew' }), 'armor');
  assert.equal(archetypeOf({ name: 'Astronaut EVA Specialist' }), 'orbital');
  assert.equal(archetypeOf({ unit: 'Infantry Rifleman' }), 'infantry');
  assert.equal(archetypeOf({ unit: 'Unknown Widget' }), 'default');
});

test('roster: assignCallsign never collides and never crosses factions', () => {
  const used = new Set();
  const out = [];
  for (const a of registry.byKind.get('character').slice(0, 40)) {
    out.push(assignCallsign(a, sideOf(a) === 'opposing' ? 'opposing' : 'coalition', used));
  }
  assert.equal(new Set(out).size, out.length, '代号必须唯一');
  for (const cs of out) assert.ok(cs && typeof cs === 'string');
});

test('roster: buildRoster only contains real asset IDs and assigns unique callsigns', () => {
  const shots = [
    { subjects: ['CHR-401', 'CHR-412'] },
    { subjects: ['CHR-401', 'VEH-602'] },
    { subjects: ['CHR-999', 'NOPE-1'] } // 不存在 / 非角色：必须被忽略
  ];
  const roster = buildRoster(shots, registry);

  assert.ok(roster.all.length > 0);
  for (const e of roster.all) {
    assert.ok(registry.byId.has(e.id), `名册里的 ${e.id} 必须真实存在于资产库`);
    assert.ok(e.callsign && e.name);
  }
  const callsigns = roster.all.map(e => e.callsign);
  assert.equal(new Set(callsigns).size, callsigns.length);
  assert.ok(!roster.byId.has('CHR-999'));
  assert.ok(!roster.byId.has('NOPE-1'));
});

test('roster: callsign assignment is independent of shot order', () => {
  const a = buildRoster([{ subjects: ['CHR-401'] }, { subjects: ['CHR-412'] }], registry);
  const b = buildRoster([{ subjects: ['CHR-412'] }, { subjects: ['CHR-401'] }], registry);
  for (const id of ['CHR-401', 'CHR-412']) {
    assert.equal(a.byId.get(id).callsign, b.byId.get(id).callsign);
  }
});

test('roster: prior roster freezes callsigns so later additions cannot steal them', () => {
  const before = buildRoster([{ subjects: ['CHR-401', 'CHR-412'] }], registry);
  const frozen = before.byId.get('CHR-401').callsign;

  // 自我进化往镜头里补了一批新资产 —— 老角色的代号必须原地不动
  const after = buildRoster(
    [{ subjects: ['CHR-401', 'CHR-412', 'CHR-630', 'CHR-619', 'VEH-602'] }],
    registry,
    { prior: before }
  );

  assert.equal(after.byId.get('CHR-401').callsign, frozen);
  assert.equal(after.byId.get('CHR-412').callsign, before.byId.get('CHR-412').callsign);
  const all = after.all.map(e => e.callsign);
  assert.equal(new Set(all).size, all.length, '冻结后仍必须全局唯一');
});

test('roster: serialization round-trips through JSON (localStorage safe)', () => {
  const roster = buildRoster([{ subjects: ['CHR-401', 'CHR-412', 'VEH-602'] }], registry);
  const json = JSON.parse(JSON.stringify(rosterToJSON(roster)));
  const restored = rosterFromJSON(json);

  assert.ok(restored);
  assert.equal(restored.all.length, roster.all.length);
  for (const e of roster.all) {
    assert.equal(restored.byId.get(e.id).callsign, e.callsign);
  }
  assert.ok(restored.byId instanceof Map);
  // 损坏输入必须安全返回 null，而不是抛错拖崩界面
  assert.equal(rosterFromJSON(null), null);
  assert.equal(rosterFromJSON('garbage'), null);
  assert.equal(rosterFromJSON([{ id: 'CHR-401' }]), null); // 无代号条目全部被丢弃
});

test('roster: labels degrade gracefully without a roster hit', () => {
  const roster = buildRoster([{ subjects: ['CHR-401'] }], registry);
  assert.match(labelFor(roster, 'CHR-401'), /^【.+】.+/);
  assert.ok(labelFor(roster, 'CHR-401').includes('CHR-401'));
  assert.equal(labelFor(roster, 'CHR-401', { withId: false }).includes('CHR-401'), false);
  assert.equal(labelFor(roster, 'MISSING'), 'MISSING');
  assert.equal(aliasLabel(roster, 'MISSING', '兜底名'), '兜底名');
  assert.equal(callsignOf(roster, 'MISSING'), '');
  assert.ok(callsignOf(roster, 'CHR-401'));
});

test('roster: selectCast never casts an era-incompatible actor', () => {
  for (const era of ['WWII', 'Cold War', 'Modern', 'Modern High-Tech', 'Orbital']) {
    const cast = selectCast(registry, { era, task: 'combat' });
    for (const a of [...cast.heroes, ...cast.enemies, ...cast.vehicles]) {
      assert.ok(isEraCompatible(a.series, era), `${a.id}(${a.series}) 不该出现在 ${era} 题材`);
    }
  }
});

test('roster: selectCast honestly reports eras with no opposing assets', () => {
  const orbital = selectCast(registry, { era: 'Orbital', task: 'rescue' });
  assert.ok(orbital.heroes.length > 0);
  if (orbital.enemies.length === 0) {
    assert.equal(orbital.enemyFallback, true);
  }
  const modern = selectCast(registry, { era: 'Modern', task: 'combat' });
  assert.ok(modern.heroes.length > 0);
  assert.ok(modern.vehicles.length > 0);
});

test('roster: prompt lines list both sides in English for the LLM', () => {
  const roster = buildRoster([{ subjects: ['CHR-401', 'CHR-412'] }], registry);
  const lines = rosterPromptLines(roster);
  assert.ok(lines.some(l => l.startsWith('COALITION CAST:')));
  assert.ok(lines.some(l => l.startsWith('OPPOSING CAST:')));
  for (const l of lines) assert.match(l, /\[[A-Z0-9-]+\] .+ \([A-Z]+-\d+\) — .+/);
});

/* ───────────────────── 现代战争资产扩充（6.5.0）回归 ───────────────────── */

test('roster: taskAffinity 的 combat 不再把「空中加油机」当成「坦克」', () => {
  // 早期裸 `tank` 命中 "KC-46 Tanker"，于是空中加油机成了所有战斗题材排名第一的载具。
  const tanker = { unit: 'Tanker Crew', name: 'KC-46 Pegasus Aerial Refueling Tanker', nameZh: 'KC-46 空中加油机' };
  assert.equal(taskAffinity(tanker, 'combat'), false, 'KC-46 Tanker 不该命中 combat');
  assert.equal(taskAffinity({ nameZh: 'M1A2 艾布拉姆斯主战坦克' }, 'combat'), true, '真坦克必须命中');
  assert.equal(taskAffinity({ name: 'Armour Crew' }, 'combat'), true);
});

test('roster: domainOfText 把题材路由到正确的战场域', () => {
  assert.equal(domainOfText('核潜艇在深海猎杀敌方舰队')?.key, 'naval');
  assert.equal(domainOfText('驱逐舰编队防空反导作战')?.key, 'naval');
  assert.equal(domainOfText('F-22 战斗机高空制空巡逻')?.key, 'air');
  assert.equal(domainOfText('洲际弹道导弹发射井战备值班')?.key, 'strategic');
  assert.equal(domainOfText('现代城市巷战清剿')?.key, 'ground');
  assert.equal(domainOfText(''), null);
  assert.equal(domainOfText('完全无关的一段文字'), null);
});

test('roster: themeMatch 让题材点名的型号压过泛类别', () => {
  const f22 = registry.byId.get('AIR-402');
  const f35 = registry.byId.get('AIR-401');
  const theme = 'F-22 战斗机高空制空巡逻';
  // 两者同属「战斗机」，只靠泛类别命中会并列 —— 型号点名必须把 F-22 顶上去
  assert.ok(themeMatch(f22, theme) > themeMatch(f35, theme), 'F-22 必须高于 F-35A');

  // 边界保护：题材写 B-2，不能命中 B-21
  const b2 = registry.byId.get('AIR-901');
  const b21 = registry.byId.get('AIR-903');
  const bTheme = 'B-2 隐形轰炸机深入敌后战略打击';
  assert.ok(themeMatch(b2, bTheme) > themeMatch(b21, bTheme), 'B-2 必须高于 B-21');

  // 无型号的题材仍能靠通用最长公共子串点名
  assert.ok(themeMatch(registry.byId.get('SHP-904'), '驱逐舰编队防空反导作战') > 0);
  assert.equal(themeMatch(registry.byId.get('SHP-904'), ''), 0);
});

test('roster: selectCast 按战场域选出正确的领头载具', () => {
  const lead = (theme) => {
    const cast = selectCast(registry, { era: 'Modern', task: 'combat', theme });
    assert.ok(cast.vehicles.length > 0, `${theme} 必须至少选出一件载具`);
    return cast.vehicles[0];
  };
  assert.ok(['ship', 'submarine'].includes(lead('核潜艇在深海猎杀敌方舰队').class));
  assert.ok(['ship', 'submarine'].includes(lead('驱逐舰编队防空反导作战').class));
  assert.ok(['aircraft', 'helicopter', 'drone'].includes(lead('B-2 隐形轰炸机深入敌后战略打击').class));
  assert.equal(lead('现代城市巷战清剿').class, 'ground');
});

test('roster: 用户点名的现代装备都能被对应题材选中', () => {
  const cases = [
    ['F-22 战斗机高空制空巡逻', /F-22/i],
    ['B-2 隐形轰炸机深入敌后战略打击', /B-2/i],
    ['洲际弹道导弹发射井战备值班', /洲际|ICBM/i],
    ['航母战斗群在远海风暴中放飞舰载机', /航母|母舰/],
    ['驱逐舰编队防空反导作战', /驱逐舰/],
    ['核潜艇在深海猎杀敌方舰队', /潜艇/]
  ];
  for (const [theme, want] of cases) {
    const cast = selectCast(registry, { era: 'Modern', task: 'combat', theme });
    const pool = [...cast.heroes, ...cast.vehicles, ...cast.enemies];
    assert.ok(
      pool.some(a => want.test(`${a.name} ${a.nameZh}`)),
      `题材「${theme}」必须能选出 ${want}`
    );
  }
});

test('roster: 潜艇是合法载具类别且不再是死代码', () => {
  const subs = [...registry.byKind.get('vehicle')].filter(a => a.class === 'submarine');
  assert.ok(subs.length >= 3, `资产库应有潜艇资产，实际 ${subs.length}`);
  // 战略/海军题材必须真的把潜艇选上镜
  const cast = selectCast(registry, { era: 'Modern', task: 'combat', theme: '核潜艇在深海猎杀敌方舰队' });
  assert.ok(cast.vehicles.some(a => a.class === 'submarine'), '核潜艇题材必须选出潜艇');
});

test('roster: 现代战争扩充包把资产库扩到 576+ 且 ID 全局唯一', () => {
  const groups = ['characters', 'vehicles', 'weapons', 'props', 'fx', 'environments', 'cameras', 'lighting', 'colorGrades', 'audio'];
  const total = groups.reduce((n, g) => n + (assets[g]?.length || 0), 0);
  assert.ok(total >= 576, `资产总数应 >= 576，实际 ${total}`);

  const ids = [];
  for (const g of groups) for (const a of assets[g] || []) ids.push(a.id);
  assert.equal(new Set(ids).size, ids.length, '资产 ID 必须全局唯一');
  for (const id of ids) assert.match(id, /^[A-Z]{2,5}-\d{3}$/);

  // CHR-999 必须保持空缺：有测试断言它是未知资产
  assert.equal(ids.includes('CHR-999'), false);

  // 用户点名的装备必须在库
  const names = [...(assets.vehicles || []), ...(assets.weapons || [])].map(a => `${a.name} ${a.nameZh}`).join(' | ');
  for (const want of [/F-22/i, /B-2/i, /洲际/, /航母|母舰/, /驱逐舰/, /潜艇/]) {
    assert.ok(want.test(names), `资产库必须包含 ${want}`);
  }
});
