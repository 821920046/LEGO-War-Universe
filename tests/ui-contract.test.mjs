import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
test('page mounts only the module workbench and contains no stale asset count',async()=>{const html=await readFile('index.html','utf8');assert.match(html,/type="module" src="\.\/src\/ui\/app\.js"/);assert.doesNotMatch(html,/资产 392|V6\.0/);assert.doesNotMatch(html,/innerHTML/);});

/**
 * 6.8.0：app.js 里 `$('xxx')` 拿到的每一个 id 都必须在 index.html 里真的存在。
 *
 * 为什么值得单独立一条：多方案切换器是**新加的 DOM 锚点**（`#variant-picker`），
 * 而 `renderVariantPicker()` 对缺失节点是「静默 return」的 —— 挂错 id 不会报错，
 * 只会让切换器永远不出现，而界面上没有任何提示。
 */
test('6.8.0 · app.js 引用的每个 DOM id 都必须在 index.html 里存在',async()=>{
  const html=await readFile('index.html','utf8');
  const app=await readFile('src/ui/app.js','utf8');
  const ids=new Set([...app.matchAll(/\$\('([A-Za-z][\w-]*)'\)/g)].map(m=>m[1]));
  assert.ok(ids.size>10,`至少要解析出十几个 id，实际 ${ids.size} 个（正则失效？）`);
  const present=new Set([...html.matchAll(/id="([A-Za-z][\w-]*)"/g)].map(m=>m[1]));
  const missing=[...ids].filter(id=>!present.has(id));
  assert.deepEqual(missing,[],`这些 id 在 index.html 里不存在：${missing.join(', ')}`);
  // 多方案切换器的锚点必须存在（否则备选方案永远无法显示）
  assert.ok(present.has('variant-picker'),'index.html 必须提供 #variant-picker');
});

