import test from'node:test';import assert from'node:assert/strict';import{checkRelease}from'../scripts/check-release.mjs';
test('release gate accepts the governed generated build',async()=>{const r=await checkRelease({root:process.cwd()});assert.equal(r.ok,true,JSON.stringify(r.violations));});
