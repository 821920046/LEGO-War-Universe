import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import schema from '../02_Assets/assets.schema.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { validateForgedAsset } from '../src/domain/asset-forge.js';

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
  assert.equal(assets.schemaVersion, '3.5');
  assert.ok(registry.byKind.get('vehicle').some(a => a.class === 'submarine'));
});
