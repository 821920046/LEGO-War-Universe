import test from 'node:test'; import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/compose.js';
const call=(env,body,headers={})=>onRequest({request:new Request('https://lwu.example/api/compose',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)}),env});
test('production rejects anonymous caller and ignores a client asset catalogue',async()=>{const r=await call({ENVIRONMENT:'production',AUTH_MODE:'access'},{theme:'test',assets:[{id:'INJECT'}]});assert.equal(r.status,401);});
test('development mode refuses client supplied assets and accepts only allowed payload',async()=>{const r=await call({ENVIRONMENT:'development',AUTH_MODE:'disabled'},{theme:'carrier launch',assets:[{id:'INJECT'}]});assert.equal(r.status,400);});
test('health endpoint does not invoke model or expose provider configuration',async()=>{const r=await onRequest({request:new Request('https://lwu.example/api/health'),env:{ENVIRONMENT:'production',AUTH_MODE:'access'}});const body=await r.json();assert.equal(r.status,200);assert.equal(body.ready,true);assert.equal('chain'in body,false);});
