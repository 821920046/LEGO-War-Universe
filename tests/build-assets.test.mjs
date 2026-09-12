import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildAssets, canonicalJson, countAssets, readEmbeddedRegistry } from '../scripts/build-assets.mjs';

const root = resolve(import.meta.dirname, '..');

test('build embeds the complete external registry and reports the exact asset count', async () => {
  const result = await buildAssets({ root, write: false });
  const external = JSON.parse(await readFile(join(root, '02_Assets/assets.json'), 'utf8'));
  assert.equal(result.assetCount, countAssets(external));
  assert.equal(canonicalJson(result.registry), canonicalJson(external));
});

test('generated fallback and manifest match the external registry', async () => {
  await buildAssets({ root });
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const external = JSON.parse(await readFile(join(root, '02_Assets/assets.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(root, 'public/build-manifest.json'), 'utf8'));
  assert.equal(canonicalJson(readEmbeddedRegistry(html)), canonicalJson(external));
  assert.equal(manifest.assetCount, countAssets(external));
  assert.match(manifest.assetSha256, /^[a-f0-9]{64}$/);
});
