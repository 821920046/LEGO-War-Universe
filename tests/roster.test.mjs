import test from 'node:test';
import assert from 'node:assert/strict';
import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { isEraCompatible } from '../src/domain/shot-spec.js';
import {
  FRIENDLY_FACTIONS, ENEMY_FACTIONS, sideOf, fnv1a, archetypeOf,
  assignCallsign, buildRoster, rosterToJSON, rosterFromJSON,
  labelFor, aliasLabel, callsignOf, selectCast, rosterPromptLines
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
