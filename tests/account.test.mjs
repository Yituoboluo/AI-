import test from 'node:test';
import assert from 'node:assert/strict';

const auth=await import('../public/auth.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
const available=()=>assert.ok(auth,'Frontend account module must exist');
test('independent signed-in and anonymous workspaces never open the legacy database',()=>{
 available();
 assert.equal(auth.contextForSession({mode:'independent',user:null,registration:'invite',upload:'blob'}).workspaceName,'zaowu-studio:anonymous');
 assert.equal(auth.contextForSession({mode:'independent',user:{id:'user-a',email:'a@example.test'}}).workspaceName,'zaowu-studio:user-a');
 assert.equal(auth.contextForSession({mode:'independent',user:{id:'user-b',email:'b@example.test'}}).workspaceName,'zaowu-studio:user-b');
 assert.equal(auth.contextForSession({mode:'legacy'}).workspaceName,'zaowu-studio');
});
test('workspace headers identify the expected account and remain absent in legacy mode',()=>{
 available();
 assert.deepEqual(auth.headersForContext({mode:'independent',user:{id:'user-a'}}),{'X-Zaowu-Workspace':'user-a'});
 assert.deepEqual(auth.headersForContext({mode:'independent',user:null}),{'X-Zaowu-Workspace':'anonymous'});
 assert.deepEqual(auth.headersForContext({mode:'legacy',user:null}),{});
});
test('only identity or deployment-mode changes require a fresh workspace',()=>{
 available();
 const first=auth.contextForSession({mode:'independent',user:{id:'user-a',email:'a@example.test'}});
 assert.equal(auth.workspaceChanged(first,auth.contextForSession({mode:'independent',user:{id:'user-a',email:'updated@example.test'}})),false);
 assert.equal(auth.workspaceChanged(first,auth.contextForSession({mode:'independent',user:{id:'user-b',email:'b@example.test'}})),true);
 assert.equal(auth.workspaceChanged(first,auth.contextForSession({mode:'independent',user:null})),true);
 assert.equal(auth.workspaceChanged(auth.contextForSession({mode:'legacy'}),auth.contextForSession({mode:'independent',user:null})),true);
});
test('invalid session shapes fail closed rather than claiming legacy authentication',()=>{
 available();
 assert.throws(()=>auth.contextForSession({}),/登录服务/);
 assert.throws(()=>auth.contextForSession({mode:'independent',user:{email:'missing-id'}}),/登录服务/);
 assert.equal(auth.contextForSession({mode:'independent',user:null,registration:'wrong'}).registration,'disabled');
});
test('session discovery falls back to legacy only for a real 404',async()=>{
 available();const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>new Response('Not found',{status:404});
  assert.equal((await auth.initializeAccount()).workspaceName,'zaowu-studio');
  globalThis.fetch=async()=>Response.json({error:{code:'AUTH_UNAVAILABLE'}},{status:503});
  assert.equal((await auth.initializeAccount()).workspaceName,'zaowu-studio:anonymous');
  assert.equal(auth.accountContext().mode,'independent');
 }finally{globalThis.fetch=original;}
});
test('workspace rejection freezes subsequent requests without changing local database identity',async()=>{
 available();const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>Response.json({mode:'independent',user:{id:'user-a',email:'a@example.test'},registration:'invite',upload:'blob'});
  await auth.initializeAccount();
  assert.equal(auth.handleAccountError({status:409,code:'VERSION_CONFLICT'}),false);
  assert.equal(auth.handleAccountError({status:409,code:'WORKSPACE_CHANGED'}),true);
  assert.equal(auth.accountContext().workspaceName,'zaowu-studio:user-a');
  assert.throws(()=>auth.accountHeaders(),error=>error.code==='WORKSPACE_CHANGED');
 }finally{globalThis.fetch=original;}
});

test('anonymous and frozen accounts skip background cloud refresh while legacy previews remain connected',async()=>{
 available();const original=globalThis.fetch;
 try{
  assert.equal(typeof auth.cloudAccountReady,'function');
  globalThis.fetch=async()=>Response.json({mode:'independent',user:null,registration:'invite'});
  await auth.initializeAccount();assert.equal(auth.cloudAccountReady(),false);
  globalThis.fetch=async()=>Response.json({mode:'independent',user:{id:'user-a',email:'a@example.test'},registration:'invite'});
  await auth.initializeAccount();assert.equal(auth.cloudAccountReady(),true);
  auth.handleAccountError({status:401});assert.equal(auth.cloudAccountReady(),false);
  globalThis.fetch=async()=>new Response('Not found',{status:404});
  await auth.initializeAccount();assert.equal(auth.cloudAccountReady(),true);
 }finally{globalThis.fetch=original;}
});

test('account reload waits for local writes before closing the workspace or navigating',async()=>{
 available();assert.equal(typeof auth.reloadAccount,'function');
 const originalWindow=globalThis.window,originalDocument=globalThis.document;
 let release,reloaded=false;const events=[];
 globalThis.window={location:{reload(){reloaded=true;}}};
 globalThis.document={dispatchEvent(event){events.push(event.type);},querySelectorAll(){return[];},getElementById(){return null;}};
 try{
  auth.setAccountSaveHook(()=>new Promise(resolve=>{release=resolve;}));
  const pending=auth.reloadAccount();
  assert.equal(reloaded,false);assert.deepEqual(events,[]);
  release();await pending;
  assert.deepEqual(events,['account-reload']);assert.equal(reloaded,true);
 }finally{auth.setAccountSaveHook(null);globalThis.window=originalWindow;globalThis.document=originalDocument;}
});

test('failed local writes keep the original workspace frozen without closing or navigating',async()=>{
 available();const originalFetch=globalThis.fetch,originalWindow=globalThis.window,originalDocument=globalThis.document;
 let reloaded=false;const events=[];
 try{
  globalThis.fetch=async()=>Response.json({mode:'independent',user:{id:'user-a',email:'a@example.test'},registration:'invite'});
  await auth.initializeAccount();
  globalThis.window={location:{reload(){reloaded=true;}}};
  globalThis.document={dispatchEvent(event){events.push(event.type);},querySelectorAll(){return[];},getElementById(){return null;}};
  auth.setAccountSaveHook(async()=>{throw new Error('Storage unavailable');});
  await auth.reloadAccount();
  assert.equal(reloaded,false);assert.equal(events.includes('account-reload'),false);
  assert.equal(auth.accountContext().workspaceName,'zaowu-studio:user-a');
  assert.throws(()=>auth.accountHeaders(),error=>error.code==='WORKSPACE_CHANGED');
 }finally{auth.setAccountSaveHook(null);globalThis.fetch=originalFetch;globalThis.window=originalWindow;globalThis.document=originalDocument;}
});
