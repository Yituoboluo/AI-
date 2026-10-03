import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {localStore} from '../scripts/local-store.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const auth=await import('../server/vercel-auth.mjs').catch(error=>{
 if(error.code==='ERR_MODULE_NOT_FOUND')return null;
 throw error;
});
const password='correct horse battery staple';
const cookieName='__Host-zaowu_session';
const email='person@example.test';
const invited={email,password,inviteCode:'test-invite-secret'};
function request(route,body,options={}){
 const method=options.method||(body===undefined?'GET':'POST');
 const headers={'x-forwarded-for':'203.0.113.10'};
 if(body!==undefined){headers['Content-Type']='application/json';headers.Origin='https://studio.test';}
 Object.assign(headers,options.headers);
 if(options.origin!==undefined)headers.Origin=options.origin;
 return new Request('https://studio.test'+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}
async function setup(t,options={}){
 assert.ok(auth,'Independent authentication module must exist');
 const store=await localStore(root,options.filename);
 store.sqlite.exec(await readFile(path.join(root,'server/vercel/auth.sql'),'utf8'));
 const env={...store,AUTH_INVITE_CODE:'test-invite-secret',...options.env};
 t.after(()=>store.sqlite.close());
 const call=async(route,body,options)=>{
  const response=await auth.authRoute(request('/api/auth/'+route,body,options),env);
  return {response,status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 return {env,call};
}
async function registered(t,options){const s=await setup(t,options);const account=await s.call('register',invited);assert.equal(account.status,201);return {...s,...account,user:account.data.user};}

test('session advertises independent auth and ignores forged hosted-user headers',async t=>{
 const {env,call}=await setup(t);
 const result=await call('session',undefined,{headers:{'oai-authenticated-user-id':'forged','oai-user-email':email}});
 assert.deepEqual(result.data,{mode:'independent',user:null,registration:'invite',upload:'blob'});
 assert.equal(await auth.authenticateSession(request('/api/projects',undefined,{headers:{'oai-authenticated-user-id':'forged'}}),env),null);
 assert.equal(await auth.authRoute(request('/api/projects'),env),null);
 assert.match(result.response.headers.get('cache-control'),/no-store/);
});

test('invite registration normalizes email and stores salted passwords and only session digests',async t=>{
 const {env,call}=await setup(t);
 const rejected=await call('register',{...invited,inviteCode:'wrong'});
 assert.equal(rejected.status,403);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,0);
 const result=await call('register',{...invited,email:'  Person@Example.Test  '});
 assert.equal(result.status,201);assert.equal(result.data.user.email,email);
 assert.match(result.data.user.id,/^[0-9a-f-]{36}$/);
 const header=result.response.headers.get('set-cookie');
 assert.match(header,/^__Host-zaowu_session=[A-Za-z0-9_-]{43};/);
 for(const attribute of ['HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=604800'])assert.ok(header.includes(attribute));
 const user=env.sqlite.prepare('SELECT * FROM auth_users').get();
 assert.equal(user.data_owner_id,result.data.user.id);
 assert.ok(!JSON.stringify(user).includes(password));
 const token=result.cookie.split('=')[1];
 const session=env.sqlite.prepare('SELECT * FROM auth_sessions').get();
 assert.equal(session.token_hash,createHash('sha256').update(token).digest('hex'));
 assert.ok(!JSON.stringify(session).includes(token));
 assert.equal(JSON.stringify(result.data).includes('test-invite-secret'),false);
 const signedIn=await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:result.cookie,'oai-authenticated-user-id':'other'}}),env);
 assert.deepEqual(signedIn.user,result.data.user);assert.equal(signedIn.ownerId,user.data_owner_id);
 env.sqlite.prepare('UPDATE auth_users SET data_owner_id=? WHERE id=?').run('migrated-owner',user.id);
 assert.equal((await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:result.cookie}}),env)).ownerId,'migrated-owner');
 assert.deepEqual((await call('session',undefined,{headers:{Cookie:result.cookie}})).data.user,result.data.user);
});

test('login verifies passwords with the same public error for unknown and existing emails',async t=>{
 const {env,call,user}=await registered(t);
 const wrong=await call('login',{email,password:'incorrect-password-123'});
 const missing=await call('login',{email:'nobody@example.test',password:'incorrect-password-123'});
 assert.equal(wrong.status,401);assert.deepEqual(wrong.data,missing.data);
 const login=await call('login',{email:'PERSON@EXAMPLE.TEST',password});
 assert.equal(login.status,200);assert.deepEqual(login.data,{user});
 assert.ok(login.cookie);
 const row=env.sqlite.prepare('SELECT password_hash FROM auth_users').get();
 assert.match(row.password_hash,/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
 assert.equal(JSON.stringify(login.data).includes(row.password_hash),false);
});

test('identical passwords get different salts',async t=>{
 const {env,call}=await setup(t,{env:{AUTH_REGISTRATION_MODE:'open'}});
 assert.equal((await call('register',{email,password})).status,201);
 assert.equal((await call('register',{email:'second@example.test',password})).status,201);
 const rows=env.sqlite.prepare('SELECT password_hash FROM auth_users').all();
 assert.notEqual(rows[0].password_hash,rows[1].password_hash);
});

test('expired and malformed session cookies cannot authenticate',async t=>{
 const {env,cookie}=await registered(t);
 const opts={headers:{Cookie:cookie}};
 env.sqlite.prepare('UPDATE auth_sessions SET expires_at=?').run(Math.floor(Date.now()/1000)-1);
 assert.equal(await auth.authenticateSession(request('/api/projects',undefined,opts),env),null);
 assert.equal(await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:cookie+'; '+cookieName+'=another'}}),env),null);
 assert.equal(await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:cookieName+'=untrusted'}}),env),null);
});

test('workspace mismatch prevents logout and a matching logout revokes the session',async t=>{
 const {env,call,cookie,user}=await registered(t);
 const session=await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:cookie}}),env);
 for(const expected of [undefined,'other-user'])assert.throws(()=>auth.requireWorkspace(request('/api/projects',undefined,{headers:expected?{'X-Zaowu-Workspace':expected}:{}}),session),error=>error instanceof auth.AuthError&&error.status===409&&error.code==='WORKSPACE_CHANGED');
 assert.doesNotThrow(()=>auth.requireWorkspace(request('/api/projects',undefined,{headers:{'X-Zaowu-Workspace':user.id}}),session));
 const wrong=await call('logout',{}, {headers:{Cookie:cookie,'X-Zaowu-Workspace':'other-user'}});
 assert.equal(wrong.status,409);assert.equal(wrong.data.error.code,'WORKSPACE_CHANGED');
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,1);
 const result=await call('logout',{}, {headers:{Cookie:cookie,'X-Zaowu-Workspace':user.id}});
 assert.equal(result.status,200);assert.match(result.response.headers.get('set-cookie'),/Max-Age=0/);
 assert.equal(await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:cookie}}),env),null);
 assert.equal((await call('logout',{})).status,200);
});

test('auth writes reject foreign origins and cross-site requests before changing state',async t=>{
 const {env,call}=await setup(t);
 const invalid=[{origin:'https://evil.test'},{origin:'null'},{origin:''},{headers:{'Sec-Fetch-Site':'cross-site'}}];
 for(const options of invalid){const response=await call('register',invited,options);assert.equal(response.status,403);assert.equal(response.data.error.code,'ORIGIN_REJECTED');}
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,0);
});

test('registration defaults to invite, supports disabled, and fails closed without a configured invitation',async t=>{
 const {env,call}=await setup(t);
 delete env.AUTH_INVITE_CODE;
 assert.equal((await call('register',invited)).status,503);
 env.AUTH_REGISTRATION_MODE='disabled';
 assert.equal((await call('session')).data.registration,'disabled');
 assert.equal((await call('register',invited)).status,403);
 env.AUTH_REGISTRATION_MODE='unexpected';
 assert.equal((await call('session')).data.registration,'disabled');
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,0);
});

test('authentication rejects invalid JSON, invalid fields, and oversized bodies',async t=>{
 const {env,call}=await setup(t);
 for(const body of [{...invited,password:'short'},{...invited,password:'a'.repeat(129)},{...invited,email:'invalid'},[],{...invited,extra:'unexpected'}])assert.equal((await call('register',body)).status,400);
 const malformed=await auth.authRoute(new Request('https://studio.test/api/auth/login',{method:'POST',headers:{Origin:'https://studio.test','Content-Type':'application/json'},body:'{'}),env);
 assert.equal(malformed.status,400);
 const huge=await auth.authRoute(new Request('https://studio.test/api/auth/login',{method:'POST',headers:{Origin:'https://studio.test','Content-Type':'application/json'},body:' '.repeat(5000)}),env);
 assert.equal(huge.status,413);
 assert.equal((await call('login',{email,password},{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_users').get().n,0);
});

test('email rate limits survive new env instances and cover all sessions and auth actions',async t=>{
 const folder=await mkdtemp(path.join(tmpdir(),'zaowu-auth-'));
 const filename=path.join(folder,'shared.sqlite');
 const first=await setup(t,{filename,env:{AUTH_RATE_EMAIL_LIMIT:'2'}});
 const second=await setup(t,{filename,env:{AUTH_RATE_EMAIL_LIMIT:'2'}});
 t.after(()=>rm(folder,{recursive:true,force:true}));
 assert.equal((await first.call('login',{email,password})).status,401);
 assert.equal((await second.call('login',{email:'PERSON@EXAMPLE.TEST',password},{headers:{'x-forwarded-for':'203.0.113.20',Cookie:cookieName+'=forged'}})).status,401);
 const blocked=await first.call('register',invited,{headers:{'x-forwarded-for':'203.0.113.30'}});
 assert.equal(blocked.status,429);assert.ok(Number(blocked.response.headers.get('retry-after'))>0);
 first.env.sqlite.prepare('UPDATE auth_rate_limits SET expires_at=?').run(Math.floor(Date.now()/1000)-1);
 assert.equal((await second.call('register',invited)).status,201);
});

test('IP rate limits are atomic under concurrent requests using different emails',async t=>{
 const {env,call}=await setup(t,{env:{AUTH_RATE_IP_LIMIT:'2'}});
 const responses=await Promise.all([1,2,3,4].map(n=>call('login',{email:'n'+n+'@example.test',password})));
 assert.deepEqual(responses.map(r=>r.status).sort(),[401,401,429,429]);
 assert.equal(env.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_rate_limits WHERE rate_key LIKE 'ip:%'").get().n,1);
});

test('session TTL is clamped and existing schemas can be initialized twice',async t=>{
 const {env,call}=await setup(t,{env:{AUTH_SESSION_TTL_SECONDS:'1'}});
 env.sqlite.exec(await readFile(path.join(root,'server/vercel/auth.sql'),'utf8'));
 const registered=await call('register',invited);
 assert.match(registered.response.headers.get('set-cookie'),/Max-Age=300/);
 env.AUTH_SESSION_TTL_SECONDS='99999999';
 const login=await call('login',{email,password});
 assert.match(login.response.headers.get('set-cookie'),/Max-Age=2592000/);
});

test('administrator password reset revokes every session and accepts only the new password',async t=>{
 const {env,call,cookie,user}=await registered(t);
 const second=await call('login',{email,password});assert.equal(second.status,200);
 const replacement='a completely different secret';
 assert.equal(typeof auth.resetPassword,'function','Administrators need an explicit password reset method');
 assert.deepEqual(await auth.resetPassword(env,email,replacement),user);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
 for(const oldCookie of [cookie,second.cookie])assert.equal(await auth.authenticateSession(request('/api/projects',undefined,{headers:{Cookie:oldCookie}}),env),null);
 assert.equal((await call('login',{email,password})).status,401);
 assert.equal((await call('login',{email,password:replacement})).status,200);
});

test('a concurrent password reset prevents a login verified against the former password',async t=>{
 const {env,call}=await registered(t);
 assert.equal(typeof auth.resetPassword,'function','Administrators need an explicit password reset method');
 const originalPrepare=env.DB.prepare;
 let reset=false;
 env.DB.prepare=sql=>{
  const query=originalPrepare(sql);
  if(sql==='SELECT id,email,password_hash FROM auth_users WHERE email=?'){
   const first=query.first.bind(query);
   query.first=async()=>{const row=await first();if(!reset){reset=true;await auth.resetPassword(env,email,'a completely different secret');}return row;};
  }
  return query;
 };
 assert.equal((await call('login',{email,password})).status,401);
 assert.equal(env.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);
});
