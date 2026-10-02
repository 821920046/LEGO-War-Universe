import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { parseIntent } from '../src/domain/intent.js';
import { selectCast, sideOf, themeNamesAsset } from '../src/domain/roster.js';

const registry = createRegistry(assets, profiles, { references: [] });

/** 取选角结果里的中文名，让失败信息可读。 */
const namesOf = (list) => list.map(a => a.nameZh || a.name).join(' | ');

// ─────────────────── 战区互斥 ───────────────────

test('历史资产：太平洋题材不得出现德军', () => {
  const GERMAN = /德军|德国|国防军|党卫/;
  // 补全前：Pacific 唯一的敌军是德军士兵 —— 「中途岛航母对决」里站着德国兵。
  for (const theme of ['太平洋热带岛屿滩头两栖登陆作战', '中途岛航母对决', '硫磺岛登陆战']) {
    const cast = selectCast(registry, { era: 'Pacific', task: 'combat', theme });
    assert.equal(GERMAN.test(namesOf(cast.enemies)), false, `太平洋题材出现德军：${namesOf(cast.enemies)}`);
    assert.ok(cast.enemies.length > 0, `${theme} 必须有敌军`);
  }
});

test('历史资产：欧洲战场不得出现日军，但中立题材（北非）不受战区互斥影响', () => {
  const JAPANESE = /日本|日军|帝国海军|帝国陆军/;
  const euro = selectCast(registry, { era: 'WWII', task: 'combat', theme: '诺曼底登陆抢滩' });
  assert.equal(JAPANESE.test(namesOf(euro.enemies)), false, `欧洲战场出现日军：${namesOf(euro.enemies)}`);

  const GERMAN = /德军|德国|国防军|党卫/;
  const afrika = selectCast(registry, { era: 'WWII', task: 'combat', theme: '北非沙漠装甲追击' });
  assert.ok(euro.enemies.length > 0);
  assert.ok(GERMAN.test(namesOf(afrika.enemies)), '北非题材应保留德军（非洲军团）');
});

// ─────────────────── 战场域感知选角 ───────────────────

test('历史资产：陆战题材不派舰艇，海战题材全派舰艇', () => {
  // 补全前 pickDiverse 只认类别不认域：陆战题材被硬塞一艘埃塞克斯级航母。
  const land = selectCast(registry, { era: 'WWII', task: 'combat', theme: '二战北非沙漠装甲追击' });
  assert.equal(land.domain, 'ground');
  assert.equal(land.vehicles.length, 3);
  assert.equal(land.vehicles.some(v => v.class === 'ship'), false,
    `陆战题材不得出现舰艇：${namesOf(land.vehicles)}`);

  // 中途岛是海战域：三件都应是舰艇（补全前是「一舰一坦一机」的伪多样性）
  const sea = selectCast(registry, { era: 'Pacific', task: 'combat', theme: '中途岛航母对决' });
  assert.equal(sea.domain, 'naval');
  assert.equal(sea.vehicles.length, 3);
  assert.equal(sea.vehicles.filter(v => v.class === 'ship').length, 3,
    `中途岛应全为舰艇：${namesOf(sea.vehicles)}`);
});

test('历史资产：选角结果内不得出现重复载具', () => {
  // 域内补位阶段曾把同一艘航母推两次（used 只登记了类别、没登记对象）。
  for (const [era, theme] of [
    ['Pacific', '中途岛航母对决'],
    ['WWII', '二战北非沙漠装甲追击'],
    ['Cold War', '冷战装甲集群野战快速推进'],
    ['Orbital', '近地轨道空间站陆战队突袭']
  ]) {
    const cast = selectCast(registry, { era, task: 'combat', theme });
    const ids = cast.vehicles.map(v => v.id);
    assert.equal(new Set(ids).size, ids.length, `${theme} 载具重复：${namesOf(cast.vehicles)}`);
  }
});

// ─────────────────── 每个时代都要有反派 ───────────────────

test('历史资产：每个时代都有反派，enemyFallback 不再为真', () => {
  // 补全前 Cold War / Orbital 敌军池为空、enemyFallback=true —— 整部片子没有对抗。
  for (const era of ['WWII', 'Pacific', 'Cold War', 'Gulf War', 'Iraq War', 'Modern High-Tech', 'Orbital']) {
    const cast = selectCast(registry, { era, task: 'combat', theme: `${era} 装甲对决` });
    assert.equal(cast.enemyFallback, false, `${era} 不应触发敌军降级`);
    assert.ok(cast.enemies.length > 0, `${era} 必须有敌军`);
  }
});

// ─────────────────── 敌方装备可达性 ───────────────────

test('历史资产：题材点名的敌方装备可上镜，阵营词不得误放行', () => {
  const t72 = registry.byKind.get('vehicle')
    .find(a => /T-72/i.test(a.name) && sideOf(a) === 'opposing');
  assert.ok(t72, '资产库应有敌方 T-72');

  // 题材点名 → 放行（否则虎式 / 零式 / 大和号 / 米格-29 永远拍不了）
  assert.equal(themeNamesAsset(t72, 'T-72 坦克战'), true);
  assert.equal(themeNamesAsset(t72, '大和号战列舰'), false);

  // 仅仅提到国名 → 不放行（否则伊军 T-72 会被当成英雄载具推上镜头）
  assert.equal(themeNamesAsset(t72, '伊拉克战争费卢杰巷战'), false);
  const iraq = selectCast(registry, { era: 'Iraq War', task: 'combat', theme: '伊拉克战争费卢杰巷战' });
  assert.equal(iraq.vehicles.some(v => sideOf(v) === 'opposing'), false,
    `联军题材不得出现敌方载具：${namesOf(iraq.vehicles)}`);
});

// ─────────────────── 时代识别顺序 ───────────────────

test('历史资产：泛化的「夜战/现代」不得抢走具体时代', () => {
  // 补全前 INTENT_RULES 把 Modern 排在 Gulf War / WWII / Pacific 之前，
  // 于是「海湾战争夜战…」因命中「夜战」被判成 Modern，整个海湾战争资产池进不了片。
  assert.equal(parseIntent('海湾战争夜战防空导弹阵地伏击').era, 'Gulf War');
  assert.equal(parseIntent('二战夜间空袭柏林').era, 'WWII');
  assert.equal(parseIntent('太平洋岛屿夜间登陆').era, 'Pacific');
  assert.equal(parseIntent('冷战夜间装甲对峙').era, 'Cold War');
  // 没有具体时代标记时才回落到 Modern
  assert.equal(parseIntent('现代城市夜间反恐作战').era, 'Modern');
});

// ─────────────────── 资产库规模与 schema ───────────────────

test('历史资产：扩充包把资产库扩到 770+，schemaVersion=3.6', () => {
  const groups = ['characters', 'vehicles', 'weapons', 'props', 'fx',
    'environments', 'cameras', 'lighting', 'colorGrades', 'audio'];
  const total = groups.reduce((n, g) => n + (assets[g]?.length || 0), 0);
  assert.ok(total >= 770, `资产总数应 >= 770，实际 ${total}`);
  assert.equal(assets.schemaVersion, '3.6');

  const pack = groups.flatMap(g => assets[g] || []).filter(a => a.origin === 'historical-warfare-pack');
  assert.ok(pack.length >= 150, `历史与轨道扩充包应 >= 150 项，实际 ${pack.length}`);
  for (const group of ['characters', 'vehicles', 'weapons', 'environments']) {
    assert.ok(pack.some(a => (assets[group] || []).includes(a)), `${group} 必须有新增资产`);
  }
});
