import test from 'node:test';import assert from 'node:assert/strict';import{readFile}from'node:fs/promises';
test('page mounts only the module workbench and contains no stale asset count',async()=>{const html=await readFile('index.html','utf8');assert.match(html,/type="module" src="\.\/src\/ui\/app\.js"/);assert.doesNotMatch(html,/资产 392|V6\.0/);assert.doesNotMatch(html,/innerHTML/);});
