import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {localStore} from '../scripts/local-store.mjs';
import {createVercelHandler} from '../server/vercel-entry.mjs';

test('the public Vercel entry ignores forged platform identity and binds every business response to its session workspace',async()=>{
 const env={...await localStore(fileURLToPath(new URL('..',import.meta.url))),AI_ENABLED:'false',AUTH_INVITE_CODE:'entry-test-invitation'};
 env.sqlite.exec(await readFile(new URL('../server/vercel/auth.sql',import.meta.url),'utf8'));
 const handler=createVercelHandler(env),base='https://studio.test';
 const call=(path,body,extra={})=>handler(new Request(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:base}:{}),...extra},body:body?JSON.stringify(body):undefined}));
 try{
  assert.equal((await call('/api/status',null,{'oai-authenticated-user-id':'forged-owner'})).status,401);
  const signup=await call('/api/auth/register',{email:'entry@example.com',password:'entry-test-password',inviteCode:env.AUTH_INVITE_CODE});
  assert.equal(signup.status,201);
  const user=(await signup.json()).user,cookie=signup.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('/api/status',null,{Cookie:cookie})).status,409);
  const wrong=await call('/api/projects',null,{Cookie:cookie,'X-Zaowu-Workspace':'old-tab-account'});
  assert.equal(wrong.status,409);assert.equal((await wrong.json()).error.code,'WORKSPACE_CHANGED');
  const status=await call('/api/status',null,{Cookie:cookie,'X-Zaowu-Workspace':user.id,'oai-authenticated-user-id':'another-owner'});
  assert.equal(status.status,200);assert.equal((await status.json()).cloud,true);
  const rewritten=await call('/api/index?__path=projects',null,{Cookie:cookie,'X-Zaowu-Workspace':user.id});
  assert.equal(rewritten.status,200);assert.deepEqual((await rewritten.json()).projects,[]);
  assert.match(rewritten.headers.get('cache-control'),/no-store/);
 }finally{env.sqlite.close();}
});
