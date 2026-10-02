import test from 'node:test';
import assert from 'node:assert/strict';

import { assets } from '../src/domain/assets-data.js';
import { createRegistry } from '../src/domain/registry.js';
import { profiles } from '../src/domain/assets-data.js';

import {
  buildAssetCatalog,
  formatCatalogForPrompt,
  collectValidIds,
  resolveShotAssets,
  extractAssetRefs
} from '../src/domain/asset-catalog.js';

import { forgeAssets, allocateForgedId, validateForgedAsset, FORGE_BLUEPRINTS } from '../src/domain/asset-forge.js';

import {
  createLedger,
  normalizeLedger,
  recordGeneration,
  decayScores,
  computePromotions,
  needsForge,
  evolve,
  ledgerStats,
  applyForgedAssets,
  enrichShotsWithForged,
  scoreOf,
  kindFromId
} from '../src/domain/evolution.js';

import { validateFilmPlan } from '../src/domain/shot-spec.js';
import { transpileMovieToLego } from '../src/domain/cinema-homage.js';

const registry = createRegistry(assets, profiles, { references: [] });
const validIds = collectValidIds(assets);

/* ── asset-catalog ───────────────────────────────────────────────────── */

test('Asset catalog: era + keyword scoring surfaces relevant real IDs', () => {
  const catalog = buildAssetCatalog(assets, { era: 'Modern High-Tech', keywords: '无人机蜂群 高超音速 激光' });
  assert.ok(catalog.groups.vehicles.length > 0);
  const vehicleIds = catalog.groups.vehicles.map(v => v.id);
  // 现代高科技相关载具必须进入候选池
  assert.ok(vehicleIds.includes('VEH-620') || vehicleIds.includes('AIR-620'));
  // 目录只包含真实存在的 ID
  for (const list of Object.values(catalog.groups)) {
    for (const item of list) assert.ok(validIds.has(item.id), `catalog leaked unknown id ${item.id}`);
  }
});

test('Asset catalog: prompt text embeds real IDs and group labels', () => {
  const text = formatCatalogForPrompt(buildAssetCatalog(assets, { era: 'Modern', keywords: '特战' }));
  assert.match(text, /CHR-\d{3}=/);
  assert.match(text, /【角色人仔】/);
});

test('Asset catalog: resolveShotAssets keeps valid ids and reports unknown ones', () => {
  const { refs, unknown } = resolveShotAssets({
    assets: {
      subjects: ['CHR-401', 'ZZZ-999'],
      environment: 'ENV-001',
      camera: 'CAM-000',
      lighting: 'LGT-001',
      colorGrade: 'CLR-001'
    }
  }, validIds);
  assert.deepEqual(refs.subjects, ['CHR-401']);
  assert.equal(refs.environment, 'ENV-001');
  assert.equal(refs.camera, '');
  assert.ok(unknown.includes('ZZZ-999'));
  assert.ok(unknown.includes('CAM-000'));
});

test('Asset catalog: extractAssetRefs tolerates flat and nested shapes', () => {
  assert.deepEqual(extractAssetRefs({ subjects: ['CHR-401'] }).subjects, ['CHR-401']);
  assert.deepEqual(extractAssetRefs({ assets: { subjects: ['VEH-620'] } }).subjects, ['VEH-620']);
});

/* ── asset-forge ─────────────────────────────────────────────────────── */

test('Asset forge: produces schema-valid, collision-free assets', () => {
  const forged = forgeAssets({
    theme: '现代战争 无人机蜂群 高超音速导弹 激光防空 电磁脉冲',
    era: 'Modern High-Tech',
    existingIds: [...validIds],
    count: 8
  });
  assert.ok(forged.length > 0);
  const ids = new Set();
  for (const a of forged) {
    const check = validateForgedAsset(a);
    assert.ok(check.ok, `${a.id}: ${check.errors.join(',')}`);
    assert.ok(!validIds.has(a.id), `forged id collided with canonical library: ${a.id}`);
    assert.ok(!ids.has(a.id), `duplicate forged id ${a.id}`);
    ids.add(a.id);
    assert.equal(a.origin, 'forge');
  }
});

test('Asset forge: is deterministic for the same theme and seed', () => {
  const opts = { theme: '未来都市巷战 外骨骼', era: 'Modern High-Tech', existingIds: [...validIds], count: 5, seed: 'fixed' };
  const a = forgeAssets(opts).map(x => `${x.id}:${x.nameZh}`);
  const b = forgeAssets(opts).map(x => `${x.id}:${x.nameZh}`);
  assert.deepEqual(a, b);
});

test('Asset forge: allocates the next free ID and never reuses occupied ones', () => {
  const used = new Set(['AIR-800', 'AIR-801']);
  assert.equal(allocateForgedId('AIR', used), 'AIR-802');
  used.add('AIR-802');
  assert.equal(allocateForgedId('AIR', used), 'AIR-803');
});

test('Asset forge: blueprints cover modern-warfare categories', () => {
  const groups = new Set(FORGE_BLUEPRINTS.map(b => b.group));
  for (const g of ['characters', 'vehicles', 'weapons', 'props', 'fx', 'environments', 'cameras', 'lighting', 'audio']) {
    assert.ok(groups.has(g), `forge blueprints missing group ${g}`);
  }
});

/* ── evolution: ledger ───────────────────────────────────────────────── */

test('Evolution: needsForge only fires for modern / future warfare themes', () => {
  assert.equal(needsForge({ theme: '无人机蜂群突袭', era: 'Modern High-Tech' }), true);
  assert.equal(needsForge({ theme: '未来太空轨道战', era: 'Orbital' }), true);
  assert.equal(needsForge({ theme: '诺曼底登陆', era: 'WWII' }), false);
});

test('Evolution: recordGeneration tracks usage, themes and forged assets', () => {
  let ledger = createLedger();
  const shots = [{ subjects: ['CHR-401'], environment: 'ENV-001', camera: 'CAM-001', lighting: 'LGT-001', colorGrade: 'CLR-001', fx: [], audio: [] }];
  ledger = recordGeneration(ledger, { theme: 'A', engine: 'test', shots, forgedAssets: [] });
  ledger = recordGeneration(ledger, { theme: 'B', engine: 'test', shots, forgedAssets: [] });
  assert.equal(ledger.generations, 2);
  assert.equal(ledger.usage['CHR-401'].count, 2);
  assert.equal(ledger.usage['CHR-401'].themes.length, 2);
  assert.equal(ledger.history.length, 2);
});

test('Evolution: decay reduces stale scores but never below the memory floor', () => {
  const ledger = createLedger();
  ledger.usage['CHR-401'] = { count: 5, score: 100, themes: ['A'], lastUsed: new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString() };
  const decayed = decayScores(ledger, { halfLifeDays: 30 });
  assert.ok(decayed.usage['CHR-401'].score < 100);
  assert.ok(decayed.usage['CHR-401'].score >= 0.01);
});

test('Evolution: promotions require repeated use across multiple themes', () => {
  const ledger = createLedger();
  ledger.usage['CHR-401'] = { count: 3, score: 3, themes: ['A', 'B'], lastUsed: new Date().toISOString() };
  ledger.usage['CHR-402'] = { count: 5, score: 5, themes: ['A'], lastUsed: new Date().toISOString() };
  assert.deepEqual(computePromotions(ledger), ['CHR-401']);
});

test('Evolution: evolve forges, records, promotes and enriches end to end', () => {
  const theme = '现代战争：无人机蜂群与高超音速导弹突袭';
  const local = transpileMovieToLego(theme, 8);
  assert.equal(local.era, 'Modern High-Tech');

  let ledger = createLedger();
  let shots = local.shots;
  let lastApplied = [];
  for (let i = 0; i < 3; i++) {
    const ev = evolve({
      ledger,
      theme: `${theme} 变体${i}`,
      engine: 'Built-in',
      era: local.era,
      shots,
      registryData: assets,
      forgeCount: 6,
      now: Date.now() + i * 1000
    });
    ledger = ev.ledger;
    assert.ok(ev.forgedAssets.length > 0, 'modern theme should forge gap assets');
    applyForgedAssets(registry, ev.forgedAssets);
    const en = enrichShotsWithForged(shots, ev.forgedAssets, registry);
    shots = en.shots;
    lastApplied = en.applied;
  }

  assert.ok(ledger.generations === 3);
  assert.ok(ledger.forged.length > 0);
  assert.ok(ledger.promoted.length > 0, 'assets reused across themes should be promoted');
  assert.ok(lastApplied.length > 0, 'evolved assets should reach the storyboard');

  // 富化后的分镜必须仍然通过严格校验（含 180° 轴线与战损单调性）
  const val = validateFilmPlan({ shots, intent: { era: local.era } }, registry);
  assert.equal(val.ok, true, JSON.stringify(val.errors));
});

test('Evolution: forged IDs stay unique across different themes (no silent drops)', () => {
  const a = evolve({ ledger: createLedger(), theme: '无人机蜂群 电子战', era: 'Modern High-Tech', shots: [], registryData: assets, forgeCount: 6, seed: 'a' });
  const b = evolve({ ledger: a.ledger, theme: '高超音速 轨道 太空战', era: 'Orbital', shots: [], registryData: assets, forgeCount: 6, seed: 'b' });
  const ids = b.ledger.forged.map(x => x.id);
  assert.equal(new Set(ids).size, ids.length, 'forged ledger must not contain duplicate IDs');
  assert.equal(b.ledger.forged.length, a.ledger.forged.length + b.forgedAssets.length);
});

test('Evolution: applyForgedAssets merges into a runtime registry and skips duplicates', () => {
  const localRegistry = createRegistry(assets, profiles, { references: [] });
  const forged = forgeAssets({ theme: '无人机', era: 'Modern High-Tech', existingIds: [...validIds], count: 3 });
  const first = applyForgedAssets(localRegistry, forged);
  assert.equal(first.added, 3);
  const second = applyForgedAssets(localRegistry, forged);
  assert.equal(second.added, 0);
  assert.equal(second.skipped.length, 3);
  assert.equal(kindFromId(forged[0].id), localRegistry.byId.get(forged[0].id).kind);
});

test('Evolution: ledger normalization is corruption-proof', () => {
  const dirty = { generations: 'x', usage: { 'bad id': { count: 1 }, 'CHR-401': { count: 2, themes: 'nope' } }, forged: [null, { id: 'AIR-800' }] };
  const clean = normalizeLedger(dirty);
  assert.equal(clean.generations, 0);
  assert.ok(!clean.usage['bad id']);
  assert.ok(clean.usage['CHR-401']);
  assert.deepEqual(clean.usage['CHR-401'].themes, []);
  assert.equal(clean.forged.length, 1);
  assert.ok(scoreOf(clean, 'CHR-401') === 0);
});

test('Evolution: stats summarize the learning ledger for the UI', () => {
  const ev = evolve({ ledger: createLedger(), theme: '无人机蜂群', era: 'Modern High-Tech', shots: [], registryData: assets, forgeCount: 4 });
  const stats = ledgerStats(ev.ledger);
  assert.equal(stats.generations, 1);
  assert.equal(stats.forgedCount, ev.forgedAssets.length);
  assert.ok(stats.trackedAssets >= ev.forgedAssets.length);
});
