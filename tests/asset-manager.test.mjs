import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import schema from '../02_Assets/assets.schema.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { validateForgedAsset } from '../src/domain/asset-forge.js';
import { isEraCompatible } from '../src/domain/shot-spec.js';
import { sideOf } from '../src/domain/roster.js';

const registry = createRegistry(assets, profiles, { references: [] });

test('Asset manager data: registry contains standard asset categories and IDs', () => {
  const characters = registry.byKind.get('character') || [];
  const vehicles = registry.byKind.get('vehicle') || [];
  assert.ok(characters.length > 0);
  assert.ok(vehicles.length > 0);

  // Check ID format
  const validIdPattern = /^[A-Z]{2,5}-[0-9]{3}$/;
  assert.ok(validIdPattern.test(characters[0].id));
  assert.ok(validIdPattern.test(vehicles[0].id));
});

test('Asset manager data: 载具类别枚举在 schema / 锻造炉 / 实际数据三处保持一致', () => {
  // 三处硬编码的类别列表一旦漂移，就会产生「守卫永远不可达」的死代码
  // （例如 plannar 里守卫 class==='submarine'，但没有任何资产是潜艇）。
  const schemaClasses = schema.definitions.vehicle.properties.class.enum;
  assert.ok(schemaClasses.includes('submarine'), 'schema 必须允许 submarine');
  assert.ok(schemaClasses.includes('ship') && schemaClasses.includes('ugv'));

  const used = new Set((assets.vehicles || []).map(a => a.class));
  for (const cls of used) {
    assert.ok(schemaClasses.includes(cls), `资产数据里的类别 ${cls} 必须被 schema 接受`);
  }

  // 锻造炉的校验必须接受每一种真实存在的类别（否则自我进化会锻造出非法资产）
  for (const cls of used) {
    const { ok, errors } = validateForgedAsset({
      id: 'VEH-950', name: 'probe', class: cls, lines: ['x']
    });
    assert.ok(ok, `锻造校验必须接受 ${cls}：${errors.join(',')}`);
  }

  // 反向：真正的非法类别必须被拒
  assert.equal(validateForgedAsset({ id: 'VEH-950', name: 'x', class: 'starship', lines: ['x'] }).ok, false);
});

test('Asset manager data: 现代战争扩充包已并入注册表', () => {
  const GROUPS = ['characters', 'vehicles', 'weapons', 'props', 'fx',
    'environments', 'cameras', 'lighting', 'colorGrades', 'audio'];
  const pack = GROUPS.flatMap(g => assets[g] || []).filter(a => a.origin === 'modern-warfare-pack');
  assert.ok(pack.length >= 130, `现代战争扩充包应 >= 130 项，实际 ${pack.length}`);
  assert.equal(assets.schemaVersion, '3.7');
  assert.ok(registry.byKind.get('vehicle').some(a => a.class === 'submarine'));
});

test('Asset manager data: 现代敌方角色扩充包已并入注册表', () => {
  const GROUPS = ['characters', 'vehicles', 'weapons', 'props', 'fx',
    'environments', 'cameras', 'lighting', 'colorGrades', 'audio'];
  const all = GROUPS.flatMap(g => assets[g] || []);
  const pack = all.filter(a => a.origin === 'modern-opfor-pack');
  assert.ok(pack.length >= 16, `现代敌方角色扩充包应 >= 16 项，实际 ${pack.length}`);

  // 扩充前的实测基线：Modern 系列的反方角色只有 3 个（便携防空导弹射手 /
  // 游击火箭筒手 / 导弹发射控制军官），于是「核潜艇深海猎杀」的反派是一个
  // 扛火箭筒的游击队员 —— 观众一眼就知道这是机器拼出来的。
  // 这条断言把「现代题材必须有成建制的敌方角色」变成可回归的硬约束。
  const opposing = (assets.characters || []).filter(a => a.series === 'Modern' && a.faction === 'Opposing Force');
  assert.ok(opposing.length >= 15, `Modern 反方角色应 >= 15，实际 ${opposing.length}`);
  for (const unit of ['Aviation', 'Navy', 'Armor', 'Infantry', 'Command']) {
    assert.ok(opposing.some(a => a.unit === unit), `Modern 反方必须有 ${unit} 兵种`);
  }
});

test('Asset manager data: 历史与轨道战争扩充包已并入注册表', () => {
  const GROUPS = ['characters', 'vehicles', 'weapons', 'props', 'fx',
    'environments', 'cameras', 'lighting', 'colorGrades', 'audio'];
  const all = GROUPS.flatMap(g => assets[g] || []);
  const pack = all.filter(a => a.origin === 'historical-warfare-pack');
  assert.ok(pack.length >= 150, `历史与轨道战争扩充包应 >= 150 项，实际 ${pack.length}`);

  // 补全前的实测基线与本次修复目标（把一次性人工检查变成可回归断言）：
  //   WWII 可用载具 9 → 42；Pacific 唯一的敌军是德军士兵（太平洋战场出现德国兵）；
  //   Cold War 敌军 0、Orbital 敌军 0（enemyFallback=true，整部片子没有反派）。
  // 「每个时代都必须有反派」这条最关键：它一旦破，成片就只剩单方面行动，没有对抗。
  const eras = ['WWII', 'Pacific', 'Cold War', 'Gulf War', 'Iraq War', 'Modern', 'Orbital'];
  for (const era of eras) {
    const veh = registry.byKind.get('vehicle').filter(a => isEraCompatible(a.series, era) && a.class);
    const wpn = registry.byKind.get('weapon').filter(a => isEraCompatible(a.series, era));
    assert.ok(veh.length >= 7, `${era} 可用载具应 >= 7，实际 ${veh.length}`);
    assert.ok(wpn.length >= 5, `${era} 可用武器应 >= 5，实际 ${wpn.length}`);

    const chars = registry.byKind.get('character').filter(a => isEraCompatible(a.series, era));
    const foes = chars.filter(a => sideOf(a) === 'opposing');
    assert.ok(foes.length >= 1, `${era} 必须有可用的敌军角色，否则整部片子没有反派`);
  }
});
