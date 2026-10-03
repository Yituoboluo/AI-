import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {localStore} from '../scripts/local-store.mjs';
import {handleApi} from '../server/worker.mjs';

const owner='owner-a',id='job-compose-0001',projectId='project-compose-0001';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=';
const bytes=Buffer.from(png.split(',')[1],'base64');
const hash=value=>createHash('sha256').update(value).digest('hex');
const key=`${hash(owner)}/assets/${hash(bytes)}.png`,reference='/api/assets/'+key;

async function fixture(t,{visual=false}={}) {
  const env={...await localStore(fileURLToPath(new URL('..',import.meta.url))),AI_ENABLED:'false'};
  t.after(()=>env.sqlite.close());
  const objects=new Map([[key,{bytes,contentType:'image/png'}]]),reads=[],writes=[];
  env.BUCKET={
    async get(name){reads.push(name);const object=objects.get(name);return object?{body:new Response(object.bytes).body,httpMetadata:{contentType:object.contentType}}:null;},
    async head(name){return objects.has(name)?{}:null;},
    async put(name,value,options){writes.push(name);objects.set(name,{bytes:new Uint8Array(value),contentType:options.httpMetadata.contentType});},
  };
  const stamp=new Date().toISOString();
  env.sqlite.prepare('INSERT INTO projects(id,owner_id,name,draft_json,version,created_at,updated_at) VALUES(?,?,?,?,1,?,?)').run(projectId,owner,'Compose test',JSON.stringify({revision:1,size:'square'}),stamp,stamp);
  const quick=visual?{visualVersion:2,ratio:'square',concepts:[{id:'scene',name:'场景',layout:'right'}]}:{ratio:'square'};
  const result={quick,backgrounds:visual?[{conceptId:'scene',imageUrl:reference}]:[{imageUrl:reference},{imageUrl:reference}],imageUrl:reference,compositionVersion:0};
  env.sqlite.prepare('INSERT INTO generation_jobs(id,owner_id,project_id,kind,source_revision,source_version,provider,model,status,input_json,result_json,created_at) VALUES(?,?,?,?,1,1,?,?,?,?,?,?)').run(id,owner,projectId,'image','test-provider','test-model',visual?'failed':'succeeded',JSON.stringify({flow:'quick',options:{ratio:'square',...(visual?{visualVersion:2}:{})}}),JSON.stringify(result),stamp);
  const call=async(action,body,{account=owner,origin='https://studio.test'}={})=>{
    const response=await handleApi(new Request('https://studio.test/api/jobs/'+id+'/'+action,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'oai-authenticated-user-id':account},body:JSON.stringify(body)}),env);
    return {status:response.status,data:await response.json()};
  };
  const composition=(data=reference,expectedVersion=0,title='简约好物')=>({images:Array.from({length:visual?1:2},()=>({data,title,subtitle:'',layout:visual?'right':'center',...(visual?{conceptId:'scene'}:{})})),expectedVersion});
  const stored=()=>env.sqlite.prepare('SELECT result_json,feedback,feedback_reason FROM generation_jobs WHERE id=?').get(id);
  return {env,objects,reads,writes,call,composition,stored};
}

test('owner PNG asset references save compositions without copying bytes or buying model calls',async t=>{
  const s=await fixture(t),saved=await s.call('compose',s.composition());
  assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.job.result.compositionVersion,1);
  assert.deepEqual(saved.data.job.result.compositions.map(image=>image.imageUrl),[reference,reference]);
  assert.equal(s.writes.length,0);assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_quota').get().n,0);
  assert.ok(s.reads.includes(key));assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM creative_assets').get().n,2);
});

test('inline PNG and uploaded references produce identical composition identity and preserve feedback on retries',async t=>{
  const s=await fixture(t),first=await s.call('compose',s.composition(png));assert.equal(first.status,200);
  assert.equal((await s.call('feedback',{feedback:'adopted',reason:'保留这组',compositionVersion:1})).status,200);
  const retried=await s.call('compose',s.composition(reference,0));
  assert.equal(retried.status,200,JSON.stringify(retried.data));assert.equal(retried.data.job.result.compositionVersion,1);
  assert.equal(retried.data.job.feedback,'adopted');assert.equal(retried.data.job.feedbackReason,'保留这组');
  assert.deepEqual(retried.data.job.result.compositions,first.data.job.result.compositions);
  assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM creative_assets').get().n,2);
});

test('reference edits retain compare-and-swap versions and clear only current group feedback',async t=>{
  const s=await fixture(t);assert.equal((await s.call('compose',s.composition(png))).status,200);
  await s.call('feedback',{feedback:'adopted',reason:'原版',compositionVersion:1});
  const original=s.stored();
  const stale=await s.call('compose',s.composition(reference,0,'新版标题'));assert.equal(stale.status,409);assert.deepEqual(s.stored(),original);
  const next=await s.call('compose',s.composition(reference,1,'新版标题'));assert.equal(next.status,200,JSON.stringify(next.data));
  assert.equal(next.data.job.result.compositionVersion,2);assert.equal(next.data.job.feedback,null);assert.equal(next.data.job.feedbackReason,null);
  const oldAssets=s.env.sqlite.prepare('SELECT title,version FROM creative_assets ORDER BY version,output_index').all();
  assert.deepEqual(oldAssets.map(row=>[row.title,row.version]),[['简约好物',1],['简约好物',1],['新版标题',2],['新版标题',2]]);
});

test('partial visual direction results accept verified PNG references and retain concept matching',async t=>{
  const s=await fixture(t,{visual:true});
  const saved=await s.call('compose',s.composition());assert.equal(saved.status,200,JSON.stringify(saved.data));
  assert.equal(saved.data.job.result.compositions[0].conceptId,'scene');
  const wrong=s.composition(reference,1);wrong.images[0].conceptId='other';
  assert.equal((await s.call('compose',wrong)).status,400);
});

test('references reject foreign owners, staging paths, URLs and non-PNG extensions before reading assets',async t=>{
  const s=await fixture(t);
  for(const invalid of [`/api/assets/${hash('owner-b')}/assets/${hash(bytes)}.png`,`/api/assets/${hash(owner)}/staging/anything.png`,'https://private.blob.vercel-storage.com/asset.png',reference.replace('.png','.jpeg'),reference+'?download=1']){
    const result=await s.call('compose',s.composition(invalid));assert.equal(result.status,400);
  }
  assert.equal(s.reads.length,0);assert.equal(s.writes.length,0);assert.equal(JSON.parse(s.stored().result_json).compositionVersion,0);
});

test('referenced objects must exist and match actual PNG type, signature and canonical SHA-256',async t=>{
  const s=await fixture(t);
  s.objects.delete(key);assert.equal((await s.call('compose',s.composition())).status,400);
  for(const object of [{bytes,contentType:'image/jpeg'},{bytes:Buffer.from('not an image'),contentType:'image/png'},{bytes:Buffer.from(bytes),contentType:'image/png'}]){
    if(object.contentType==='image/png' && Buffer.from(object.bytes).equals(bytes))object.bytes[object.bytes.length-1]^=1;
    s.objects.set(key,object);assert.equal((await s.call('compose',s.composition())).status,400);
  }
  assert.equal(s.writes.length,0);assert.equal(JSON.parse(s.stored().result_json).compositionVersion,0);
});

test('oversized referenced streams stop before updating the composition',async t=>{
  const s=await fixture(t),large=Buffer.alloc(12*1024*1024+1);bytes.copy(large);
  const largeKey=`${hash(owner)}/assets/${hash(large)}.png`;s.objects.set(largeKey,{bytes:large,contentType:'image/png'});
  assert.equal((await s.call('compose',s.composition('/api/assets/'+largeKey))).status,413);
  assert.equal(JSON.parse(s.stored().result_json).compositionVersion,0);assert.equal(s.writes.length,0);
});
