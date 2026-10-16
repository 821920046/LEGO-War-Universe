import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildAssets, canonicalJson, countAssets, readEmbeddedRegistry } from '../scripts/build-assets.mjs';
import { assets as generatedAssets, profiles as generatedProfiles } from '../src/domain/assets-data.js';

const root = resolve(import.meta.dirname, '..');

test('build embeds the complete external registry and reports the exact asset count', async () => {
  const result = await buildAssets({ root, write: false });
  const external = JSON.parse(await readFile(join(root, '02_Assets/assets.json'), 'utf8'));
  assert.equal(result.assetCount, countAssets(external));
  assert.equal(canonicalJson(result.registry), canonicalJson(external));
});

test('generated fallback and manifest match the external registry', async () => {
  // 6.8.8：这个测试原先调用的是 buildAssets({ root })（write 默认 true）——
  // 在 npm test 并行跑的时候**非原子重写** 375KB 的 src/domain/assets-data.js，
  // 别的测试进程正好 import 到写一半的文件，整文件 SyntaxError 失败：
  //   "The requested module './assets-data.js' does not provide an export named 'assets'"
  // 而且「先重写再比对」意味着产物永远新鲜，这个测试**永远抓不到漂移** ——
  // 一个恒绿的门禁比没有门禁更危险。
  //
  // 现在只读不写：校验的是仓库里真正提交的那份产物。生成由发布门禁第二道
  // （scripts/build-assets.mjs）负责，与测试顺序执行、不再并行；
  // 生成器本身也改成了原子写（临时文件 + rename），双保险。
  const external = JSON.parse(await readFile(join(root, '02_Assets/assets.json'), 'utf8'));
  const externalCanonical = canonicalJson(external);

  // index.html 里的 #lwu-data 兜底注册表
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.equal(canonicalJson(readEmbeddedRegistry(html)), externalCanonical);

  // public/build-manifest.json：数量与签名必须与源一致
  const manifest = JSON.parse(await readFile(join(root, 'public/build-manifest.json'), 'utf8'));
  assert.equal(manifest.assetCount, countAssets(external));
  assert.equal(
    manifest.assetSha256,
    createHash('sha256').update(externalCanonical).digest('hex'),
    'build-manifest 的签名与 02_Assets/assets.json 不一致：先跑 scripts/build-assets.mjs'
  );

  // 前端真正 import 的那份生成模块也必须在列：它就是写竞争里被撕半的那个文件。
  assert.equal(canonicalJson(generatedAssets), externalCanonical);
  const profiles = JSON.parse(await readFile(join(root, '02_Assets/model-profiles.json'), 'utf8'));
  assert.equal(canonicalJson(generatedProfiles), canonicalJson(profiles));
});
