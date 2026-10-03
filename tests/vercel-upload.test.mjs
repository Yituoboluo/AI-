import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {BlobNotFoundError,BlobError} from '@vercel/blob';
import {getPayloadFromClientToken} from '@vercel/blob/client';
import {MockAgent,getGlobalDispatcher,setGlobalDispatcher} from 'undici';

const blobModule = await import('../server/vercel-blob.mjs').catch(() => ({}));
const uploadModule = await import('../server/vercel-upload.mjs').catch(() => ({}));
const {createBlobBucket} = blobModule;
const {uploadRoute} = uploadModule;
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=', 'base64');
const hash = value => createHash('sha256').update(value).digest('hex');
const owner = 'owner-a';
const key = `${hash(owner)}/assets/${hash(bytes)}.png`;
const token = 'vercel_blob_rw_teststore_testsecret';
const info = pathname => ({pathname, url:`https://teststore.private.blob.vercel-storage.com/${pathname}`, downloadUrl:`https://teststore.private.blob.vercel-storage.com/${pathname}?download=1`,contentType:'image/png',contentDisposition:'inline',size:bytes.length,uploadedAt:new Date(),etag:'test-etag'});

function blobStore() {
  const objects = new Map(), calls = {put:[],get:[],head:[],del:[]};
  const sdk = {
    async put(pathname, value, options) {
      calls.put.push({pathname,options});
      if(objects.has(pathname) && options.allowOverwrite===false)throw new BlobError('Blob already exists');
      objects.set(pathname,{bytes:new Uint8Array(value),contentType:options.contentType});
      return {...info(pathname),contentType:options.contentType,size:value.byteLength};
    },
    async get(pathname, options) {
      calls.get.push({pathname,options});
      const object = objects.get(pathname);
      return object ? {statusCode:200,stream:new Response(object.bytes).body,headers:new Headers({'Content-Type':object.contentType}),blob:{...info(pathname),size:object.bytes.length,contentType:object.contentType}} : null;
    },
    async head(pathname, options) {
      calls.head.push({pathname,options});
      const object = objects.get(pathname);
      if (!object) throw new BlobNotFoundError();
      return {...info(pathname),size:object.bytes.length,contentType:object.contentType};
    },
    async del(pathname, options) {calls.del.push({pathname,options});objects.delete(pathname);},
  };
  return {sdk,objects,calls};
}

async function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const ddl = await readFile(new URL('../server/vercel/uploads.sql', import.meta.url),'utf8');
  sqlite.exec(ddl);sqlite.exec(ddl);
  const DB = {prepare(sql) {let args=[];const query={bind(...values){args=values;return query;},async first(){return sqlite.prepare(sql).get(...args)||null;},async run(){const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}};return query;}};
  const store = blobStore();
  const env = {DB,BLOB_READ_WRITE_TOKEN:token};
  let authenticateCalls=0,workspaceCalls=0;
  const dependencies={async authenticate(request){authenticateCalls++;const id=request.headers.get('test-user');return id?{user:{id,email:id+'@example.test'},ownerId:id}:null;},async checkWorkspace(request,session){workspaceCalls++;if(request.headers.get('test-workspace')==='changed')throw Object.assign(new Error('changed'),{status:409,code:'WORKSPACE_CHANGED'});}};
  const call = async (path,body,options={}) => {
    const headers={'Content-Type':'application/json'};
    if(options.user!==null)headers['test-user']=options.user||owner;
    if(options.origin!==null)headers.Origin=options.origin||'https://studio.test';
    if(options.workspace)headers['test-workspace']=options.workspace;
    if(options.fetchSite)headers['sec-fetch-site']=options.fetchSite;
    if(options.signature)headers['x-vercel-signature']=options.signature;
    const response=await uploadRoute(new Request('https://studio.test'+path,{method:options.method||'POST',headers,body:JSON.stringify(body)}),env,dependencies,store.sdk);
    return {response,status:response?.status,data:response?await response.json():null};
  };
  const start=async()=>call('/api/uploads/start',{hash:hash(bytes),size:bytes.length,contentType:'image/png'});
  const stage=result=>store.objects.set(result.data.pathname,{bytes:new Uint8Array(bytes),contentType:'image/png'});
  const callback=result=>({type:'blob.upload-completed',payload:{blob:info(result.data.pathname),tokenPayload:JSON.stringify({uploadId:result.data.uploadId,ownerId:owner,pathname:result.data.pathname})}});
  return {...store,env,sqlite,call,start,stage,callback,counts:()=>({authenticateCalls,workspaceCalls})};
}

test('Vercel storage modules expose the adapter and upload route',()=>{
  assert.equal(typeof createBlobBucket,'function');assert.equal(typeof uploadRoute,'function');
});

test('canonical private writes validate bytes, expose no provider URL and stream reads',async()=>{
  const store=blobStore(), bucket=createBlobBucket({BLOB_READ_WRITE_TOKEN:token},store.sdk);
  const result=await bucket.put(key,bytes,{httpMetadata:{contentType:'image/png'}});
  assert.equal(JSON.stringify(result).includes('vercel-storage.com'),false);
  assert.equal(store.calls.put[0].options.access,'private');
  assert.equal(store.calls.put[0].options.addRandomSuffix,false);
  assert.equal(store.calls.put[0].options.token,token);
  const object=await bucket.get(key);
  assert.ok(object.body instanceof ReadableStream);
  assert.deepEqual(Buffer.from(await new Response(object.body).arrayBuffer()),bytes);
  assert.equal(object.httpMetadata.contentType,'image/png');
  assert.equal(store.calls.get[0].options.access,'private');assert.equal(store.calls.get[0].options.useCache,false);
});

test('adapter rejects unsafe paths and mismatched content before any write',async()=>{
  const store=blobStore(),bucket=createBlobBucket({BLOB_READ_WRITE_TOKEN:token},store.sdk);
  for(const invalid of ['../secret','https://other.private.blob.vercel-storage.com/a',`${hash(owner)}/assets/${'0'.repeat(64)}.png`]){
    await assert.rejects(()=>bucket.put(invalid,bytes,{httpMetadata:{contentType:'image/png'}}));
  }
  await assert.rejects(()=>bucket.put(key,bytes,{httpMetadata:{contentType:'image/jpeg'}}));
  assert.equal(store.calls.put.length,0);
});

test('adapter returns null only for missing objects and propagates provider outages',async()=>{
  const store=blobStore(),bucket=createBlobBucket({BLOB_READ_WRITE_TOKEN:token},store.sdk);
  assert.equal(await bucket.get(key),null);assert.equal(await bucket.head(key),null);
  const failure=new Error('network unavailable');
  const failing=createBlobBucket({BLOB_READ_WRITE_TOKEN:token},{...store.sdk,head:async()=>{throw failure;},get:async()=>{throw failure;}});
  await assert.rejects(()=>failing.head(key),error=>error===failure);await assert.rejects(()=>failing.get(key),error=>error===failure);
});

test('all browser upload operations enforce authentication, workspace and exact origin',async t=>{
  const s=await setup(t);
  for(const path of ['/api/uploads/start','/api/uploads/token','/api/uploads/finish']){
    assert.equal((await s.call(path,{}, {user:null})).status,401);
    assert.equal((await s.call(path,{}, {origin:null})).status,403);
    assert.equal((await s.call(path,{}, {origin:'https://evil.test'})).status,403);
    assert.equal((await s.call(path,{}, {workspace:'changed'})).data.error.code,'WORKSPACE_CHANGED');
  }
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM asset_uploads').get().n,0);
  assert.equal(s.calls.put.length,0);
});

test('start validates hash, type and upload bounds before reserving a path',async t=>{
  const s=await setup(t);
  for(const changed of [{hash:'bad'},{hash:hash(bytes).toUpperCase()},{size:0},{size:12*1024*1024+1},{size:1.5},{contentType:'image/svg+xml'}]){
    const result=await s.call('/api/uploads/start',{hash:hash(bytes),size:bytes.length,contentType:'image/png',...changed});
    assert.equal(result.status,400);
  }
  const start=await s.start();assert.equal(start.status,200);
  assert.match(start.data.pathname,new RegExp(`^${hash(owner)}/staging/[a-f0-9-]+\\.png$`));
  assert.equal(JSON.stringify(start.data).includes('vercel-storage.com'),false);
});

test('start reuses an existing canonical asset without handing browser canonical write access',async t=>{
  const s=await setup(t);s.objects.set(key,{bytes:new Uint8Array(bytes),contentType:'image/png'});
  const result=await s.start();assert.deepEqual(result.data,{assetUrl:'/api/assets/'+key});
  assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM asset_uploads').get().n,0);
});

test('real SDK token binds stage path, precise permissions and server trusted identity',async t=>{
  const s=await setup(t),start=await s.start();
  const issued=await s.call('/api/uploads/token',{type:'blob.generate-client-token',payload:{pathname:start.data.pathname,multipart:false,clientPayload:JSON.stringify({uploadId:start.data.uploadId,ownerId:'owner-b'})}});
  assert.equal(issued.status,200);
  const permissions=getPayloadFromClientToken(issued.data.clientToken);
  assert.equal(permissions.pathname,start.data.pathname);assert.equal(permissions.maximumSizeInBytes,bytes.length);
  assert.deepEqual(permissions.allowedContentTypes,['image/png']);assert.equal(permissions.addRandomSuffix,false);assert.equal(permissions.allowOverwrite,false);
  assert.ok(permissions.validUntil>Date.now());assert.ok(permissions.validUntil<=Date.now()+15*60*1000);
  assert.deepEqual(JSON.parse(permissions.onUploadCompleted.tokenPayload),{uploadId:start.data.uploadId,ownerId:owner,pathname:start.data.pathname});
  assert.equal(permissions.onUploadCompleted.callbackUrl,'https://studio.test/api/uploads/token');
});

test('token rejects cross account, replaced stage pathname and expired reservations',async t=>{
  const s=await setup(t),start=await s.start();
  const event={type:'blob.generate-client-token',payload:{pathname:start.data.pathname,multipart:false,clientPayload:JSON.stringify({uploadId:start.data.uploadId})}};
  assert.equal((await s.call('/api/uploads/token',event,{user:'owner-b'})).status,404);
  assert.equal((await s.call('/api/uploads/token',{...event,payload:{...event.payload,pathname:key}})).status,400);
  s.sqlite.prepare('UPDATE asset_uploads SET expires_at=0 WHERE id=?').run(start.data.uploadId);
  assert.equal((await s.call('/api/uploads/token',event)).status,410);
  assert.equal(s.calls.put.length,0);
});

test('finish promotes verified bytes before callback and repeated finish returns identical asset URL',async t=>{
  const s=await setup(t),start=await s.start();s.stage(start);
  const first=await s.call('/api/uploads/finish',{uploadId:start.data.uploadId,url:'https://evil.test'});
  assert.equal(first.status,200);assert.deepEqual(first.data,{assetUrl:'/api/assets/'+key});
  assert.deepEqual(Buffer.from(s.objects.get(key).bytes),bytes);assert.equal(s.objects.has(start.data.pathname),false);
  assert.equal(s.sqlite.prepare('SELECT status FROM asset_uploads WHERE id=?').get(start.data.uploadId).status,'ready');
  const second=await s.call('/api/uploads/finish',{uploadId:start.data.uploadId});assert.deepEqual(second.data,first.data);
  assert.equal(s.calls.put.length,1);
  assert.equal((await s.call('/api/uploads/finish',{uploadId:start.data.uploadId},{user:'owner-b'})).status,404);
});

test('finish refuses bad magic, unexpected size and hash without creating an asset',async t=>{
  const s=await setup(t);
  for(const bad of [new Uint8Array(bytes.length),Buffer.concat([bytes,Buffer.from([1])]),Buffer.from(bytes)]){
    if(Buffer.from(bad).equals(bytes))bad[bad.length-1]^=1;
    const start=await s.start();s.objects.set(start.data.pathname,{bytes:bad,contentType:'image/png'});
    const result=await s.call('/api/uploads/finish',{uploadId:start.data.uploadId});assert.equal(result.status,400);
  }
  assert.equal(s.objects.has(key),false);assert.equal(s.calls.put.length,0);
});

test('signed callback uses the real SDK without cookie or Origin and duplicate callback is safe',async t=>{
  const s=await setup(t),start=await s.start();s.stage(start);
  const body=s.callback(start),signature=createHmac('sha256',token).update(JSON.stringify(body)).digest('hex');
  const result=await s.call('/api/uploads/token',body,{signature,user:null,origin:null});
  assert.equal(result.status,200);assert.deepEqual(result.data,{type:'blob.upload-completed',response:'ok'});
  assert.equal(s.counts().authenticateCalls,1);assert.equal(s.counts().workspaceCalls,1);
  assert.ok(s.objects.has(key));assert.equal(s.objects.has(start.data.pathname),false);
  assert.equal((await s.call('/api/uploads/token',body,{signature,user:null,origin:null})).status,200);
  assert.equal(s.calls.put.length,1);
});

test('invalid callback signatures cannot read staging objects or mutate upload state',async t=>{
  const s=await setup(t),start=await s.start();s.stage(start);const body=s.callback(start);
  for(const signature of [undefined,'0'.repeat(64),'garbage'])assert.equal((await s.call('/api/uploads/token',body,{signature,user:null,origin:null})).status,403);
  assert.equal(s.calls.get.length,0);assert.equal(s.calls.put.length,0);assert.equal(s.calls.del.length,0);
  assert.equal(s.sqlite.prepare('SELECT status FROM asset_uploads WHERE id=?').get(start.data.uploadId).status,'pending');
});

test('signed callback must match recorded owner, pathname and current private store',async t=>{
  const s=await setup(t),start=await s.start();s.stage(start);
  for(const mutate of [body=>body.payload.blob.url=body.payload.blob.url.replace('teststore.private','other.private'),body=>body.payload.blob.pathname=key,body=>body.payload.tokenPayload=JSON.stringify({uploadId:start.data.uploadId,ownerId:'owner-b',pathname:start.data.pathname})]){
    const body=s.callback(start);mutate(body);const signature=createHmac('sha256',token).update(JSON.stringify(body)).digest('hex');
    assert.equal((await s.call('/api/uploads/token',body,{signature,user:null,origin:null})).status,400);
  }
  assert.equal(s.calls.put.length,0);assert.equal(s.calls.get.length,0);
});

test('verified callback checks actual staged magic, size and SHA-256 before marking ready',async t=>{
  const s=await setup(t);
  for(const damaged of [new Uint8Array(bytes.length),Buffer.concat([bytes,Buffer.from([1])]),Buffer.from(bytes)]) {
    if(Buffer.from(damaged).equals(bytes))damaged[damaged.length-1]^=1;
    const start=await s.start();s.objects.set(start.data.pathname,{bytes:damaged,contentType:'image/png'});
    const body=s.callback(start),signature=createHmac('sha256',token).update(JSON.stringify(body)).digest('hex');
    assert.equal((await s.call('/api/uploads/token',body,{signature,user:null,origin:null})).status,400);
    assert.equal(s.sqlite.prepare('SELECT status FROM asset_uploads WHERE id=?').get(start.data.uploadId).status,'pending');
  }
  assert.equal(s.objects.has(key),false);assert.equal(s.calls.put.length,0);
});

test('expired and unfinished uploads cannot be finalized and unrelated routes are untouched',async t=>{
  const s=await setup(t),start=await s.start();
  assert.equal((await s.call('/api/uploads/finish',{uploadId:start.data.uploadId})).status,409);
  s.sqlite.prepare('UPDATE asset_uploads SET expires_at=0 WHERE id=?').run(start.data.uploadId);s.stage(start);
  assert.equal((await s.call('/api/uploads/finish',{uploadId:start.data.uploadId})).status,410);
  const before=s.counts();assert.equal((await s.call('/api/projects',{})).response,null);assert.deepEqual(s.counts(),before);
  assert.equal(s.calls.put.length,0);
});

test('concurrent callback and browser finish return the same ready asset',async t=>{
  const s=await setup(t),start=await s.start();s.stage(start);
  const body=s.callback(start),signature=createHmac('sha256',token).update(JSON.stringify(body)).digest('hex');
  const results=await Promise.all([s.call('/api/uploads/finish',{uploadId:start.data.uploadId}),s.call('/api/uploads/token',body,{signature,user:null,origin:null}),s.call('/api/uploads/finish',{uploadId:start.data.uploadId})]);
  assert.ok(results.every(result=>result.status===200));assert.equal(s.sqlite.prepare('SELECT status FROM asset_uploads WHERE id=?').get(start.data.uploadId).status,'ready');
  assert.equal(results[0].data.assetUrl,results[2].data.assetUrl);
});

test('provider failures stay retryable and never leak secret values in route errors',async t=>{
  const s=await setup(t),start=await s.start();s.stage(start);
  s.sdk.get=async()=>{throw new Error('private-token-secret https://secret.example')};
  const failure=await s.call('/api/uploads/finish',{uploadId:start.data.uploadId});assert.equal(failure.status,503);
  assert.equal(JSON.stringify(failure.data).includes('private-token-secret'),false);assert.equal(s.sqlite.prepare('SELECT status FROM asset_uploads WHERE id=?').get(start.data.uploadId).status,'pending');
});

test('cross-site browser requests are rejected even with a contradictory matching Origin',async t=>{
  const s=await setup(t);
  const result=await s.call('/api/uploads/start',{hash:hash(bytes),size:bytes.length,contentType:'image/png'},{fetchSite:'cross-site'});
  assert.equal(result.status,403);assert.equal(s.sqlite.prepare('SELECT COUNT(*) AS n FROM asset_uploads').get().n,0);
});

test('default SDK reads private streams from current store without cache and distinguishes real HTTP errors',async t=>{
  const previous=getGlobalDispatcher(),network=new MockAgent();network.disableNetConnect();setGlobalDispatcher(network);
  t.after(async()=>{setGlobalDispatcher(previous);await network.close();});
  const server=network.get('https://teststore.private.blob.vercel-storage.com');
  const path='/'+key+'?cache=0';
  server.intercept({path,method:'GET',headers:{authorization:'Bearer '+token}}).reply(200,bytes,{headers:{'content-type':'image/png','content-length':String(bytes.length)}});
  server.intercept({path,method:'GET'}).reply(404,'missing');
  server.intercept({path,method:'GET'}).reply(503,'secret upstream response');
  network.get('https://vercel.com').intercept({path:'/api/blob?url='+encodeURIComponent(key),method:'GET'}).reply(404,{error:{code:'not_found'}});
  const bucket=createBlobBucket({BLOB_READ_WRITE_TOKEN:token});
  const object=await bucket.get(key);assert.ok(object.body instanceof ReadableStream);
  assert.deepEqual(Buffer.from(await new Response(object.body).arrayBuffer()),bytes);assert.equal(object.httpMetadata.contentType,'image/png');
  assert.equal(await bucket.get(key),null);await assert.rejects(()=>bucket.get(key));assert.equal(await bucket.head(key),null);
  network.assertNoPendingInterceptors();
});
