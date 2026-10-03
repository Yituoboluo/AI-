import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {deflateSync} from 'node:zlib';
import {localStore} from '../scripts/local-store.mjs';
import {handleApi} from '../server/worker.mjs';
import {qualityWeekStart} from '../server/telemetry.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const tiny='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=';
function validPng(width=1080,height=1080){
 const chunk=(type,data)=>{const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const byte of content){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([size,content,sum]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return 'data:image/png;base64,'+Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc((width*4+1)*height))),chunk('IEND',Buffer.alloc(0))]).toString('base64');
}
const full=validPng();
const review={gates:{facts:true,requirements:true,delivery:true},scores:{composition:2,style:2,light:1,text:1},editLevel:'direct',editMinutes:0};
async function fixture(t,{compose=true,bytes=full,evaluation}={}){
 const env={...await localStore(root),AI_ENABLED:'true',DASHSCOPE_API_KEY:'test-only',IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'test-only',AI_IMAGE_DAILY_LIMIT:'unlimited'};
 t.after(()=>env.sqlite.close());
 const call=async(path,body,method=body?'POST':'GET',owner='owner-a',origin='https://studio.test')=>{
  const headers={'oai-authenticated-user-id':owner};if(body){headers['Content-Type']='application/json';headers.Origin=origin;}
  const response=await handleApi(new Request('https://studio.test/api'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);return {status:response.status,data:await response.json()};
 };
 const project={id:'project-quality-01',name:'质量验证',draft:{productName:'',sellingPoint:'',campaign:'商品快捷创作',headline:'',price:'',originalPrice:'',startDate:'',endDate:'',imageName:'test',background:'white',template:'airy',size:'square',revision:1,imageData:tiny,creationMode:'quick',quick:{inputId:'input-quality-01',originalImageData:tiny,segmentation:'transparent',settings:{ratio:'square',customBackground:false,backgroundPrompt:'',customCopy:false,title:'',subtitle:'',customLayout:false,layout:'center'}}},thumbnail:tiny};
 assert.equal((await call('/projects/'+project.id,{project,expectedVersion:0},'PUT')).status,200);
 const id='job-quality-0001',input={id,projectId:project.id,kind:'image',flow:'quick',sourceVersion:1,...(evaluation?{evaluation}:{})};
 const created=await call('/jobs',input);assert.equal(created.status,201,JSON.stringify(created.data));
 const original=globalThis.fetch;let modelCalls=0;
 globalThis.fetch=async url=>{modelCalls++;return url.includes('/chat/completions')?Response.json({choices:[{message:{content:JSON.stringify({copyStyle:'elegant',backgroundPrompt:'温暖浅灰空背景',layout:'right',textColor:'dark'})}}]}):Response.json({data:[{b64_json:tiny.split(',')[1]}]});};
 try{const run=await call('/jobs/'+id+'/run',{});assert.equal(run.data.job.status,'succeeded',JSON.stringify(run.data));}finally{globalThis.fetch=original;}
 const composition={images:[0,1].map(()=>({data:bytes,title:'简约好物',subtitle:'',layout:'center'})),expectedVersion:0};
 if(compose)assert.equal((await call('/jobs/'+id+'/compose',composition)).status,200);
 const detail=()=>call('/quality/jobs/'+id),overview=()=>call('/quality/overview');
 const result=await detail();return {env,call,id,input,project,composition,detail,overview,job:created.data.job,assets:result.data.assets,modelCalls};
}

test('server trace, immutable assets and automatic checks persist without implying human approval',async t=>{
 const s=await fixture(t),d=(await s.detail()).data;
 assert.equal(s.modelCalls,2);assert.equal(d.assets.length,2);assert.ok(d.assets.every(a=>a.version===1&&a.current));
 assert.ok(d.events.some(e=>e.stage==='plan'&&e.status==='succeeded'&&Number.isInteger(e.duration_ms)));
 assert.ok(d.events.some(e=>e.stage==='generate'&&e.status==='succeeded'));
 assert.ok(d.events.some(e=>e.name==='asset_persisted'));
 assert.ok(d.assets.every(a=>a.reviews[0].passed===1&&a.reviews[0].kind==='automatic'));
 const summary=(await s.overview()).data.summary;
 assert.equal(summary.weeklyAdoptedTasks,0);assert.equal(summary.firstAttempt.pending,1);assert.equal(summary.firstAttempt.rate,null);
 assert.equal((await s.call('/quality/jobs/'+s.id,undefined,'GET','owner-b')).status,404);
});

test('task identity groups unchanged briefs across saves and separates evaluation variants',async t=>{
 const s=await fixture(t);
 assert.equal((await s.call('/jobs',s.input)).status,200);
 const copy={...s.project,draft:{...s.project.draft,productName:'模型自动标题',headline:'自动内容',revision:2}};
 assert.equal((await s.call('/projects/'+copy.id,{project:copy,expectedVersion:1},'PUT')).status,200);
 const retry=(await s.call('/jobs',{...s.input,id:'job-quality-0002',sourceVersion:2})).data.job;
 assert.equal(retry.taskId,s.job.taskId);assert.equal(retry.attemptNo,2);assert.equal(retry.parentJobId,s.id);
 s.env.sqlite.prepare("UPDATE generation_jobs SET status='failed' WHERE id=?").run(retry.id);
 const evalA=(await s.call('/jobs',{...s.input,id:'job-evaluate-001',sourceVersion:2,evaluation:{batchId:'eval-quality-01',caseId:'C01',variant:'A'}})).data.job;
 s.env.sqlite.prepare("UPDATE generation_jobs SET status='failed' WHERE id=?").run(evalA.id);
 const evalB=(await s.call('/jobs',{...s.input,id:'job-evaluate-002',sourceVersion:2,evaluation:{variant:'B',caseId:'C01',batchId:'eval-quality-01'}})).data.job;
 assert.equal(evalA.attemptNo,1);assert.equal(evalB.attemptNo,1);assert.notEqual(evalA.taskId,evalB.taskId);assert.notEqual(evalA.taskId,s.job.taskId);
 assert.equal((await s.call('/jobs',{...s.input,id:'job-invalid-001',sourceVersion:2,evaluation:{variant:'MOCK'}})).status,400);
 assert.equal((await s.overview()).data.summary.jobs,2);
});

test('upload and display events are validated, owner scoped and idempotent under concurrent delivery',async t=>{
 const s=await fixture(t),event={id:'event-display-0001',projectId:s.project.id,jobId:s.id,inputRevision:1,assetId:s.assets[0].id,assetVersion:1,name:'result_viewed',status:'succeeded',occurredAt:new Date().toISOString(),data:{prompt:'must not persist',secret:'must not persist'}};
 const results=await Promise.all([s.call('/telemetry',event),s.call('/telemetry',event)]);assert.ok(results.every(r=>r.status===200));
 assert.equal(s.env.sqlite.prepare("SELECT COUNT(*) n FROM telemetry_events WHERE name='result_viewed'").get().n,1);
 assert.equal((await s.call('/telemetry',{...event,assetId:s.assets[1].id})).status,409);
 assert.equal((await s.call('/telemetry',{...event,id:'event-stale-0001',inputRevision:2})).status,409);
 assert.equal((await s.call('/telemetry',{...event,id:'event-spoof-0001',name:'image_generation_completed'})).status,400);
 assert.equal((await s.call('/telemetry',event,'POST','owner-b')).status,404);
 assert.equal((await s.call('/telemetry',event,'POST','owner-a','https://evil.test')).status,403);
 assert.ok(!JSON.stringify((await s.detail()).data.events).includes('must not persist'));
 const upload={id:'event-upload-0001',projectId:s.project.id,inputRevision:1,name:'product_input_ready',status:'succeeded',durationMs:4,data:{inputId:'input-quality-01'}};
 assert.equal((await s.call('/telemetry',upload)).status,200);assert.ok((await s.detail()).data.events.some(e=>e.id===upload.id));
 assert.equal((await s.overview()).data.summary.displaySamples,1);
});

test('per-image feedback retains versions, retries once and distinguishes adoption from evaluated adoption',async t=>{
 const s=await fixture(t),asset=s.assets[0],path='/quality/assets/'+asset.id+'/feedback';
 const basic={id:'feedback-adopt-001',feedback:'adopted'};
 const results=await Promise.all([s.call(path,basic),s.call(path,basic)]);assert.ok(results.every(r=>r.status===200),JSON.stringify(results));
 let m=(await s.overview()).data.summary;assert.equal(m.weeklyAdoptedTasks,1);assert.equal(m.firstAttempt.numerator,0);assert.equal(m.firstAttempt.pending,1);
 assert.equal((await s.call(path,{...basic,feedback:'revoked'})).status,409);
 assert.equal((await s.call(path,{id:'feedback-undo-001',feedback:'revoked'})).status,200);
 assert.equal((await s.overview()).data.summary.weeklyAdoptedTasks,0);
 assert.equal((await s.call(path,{id:'feedback-review-001',feedback:'adopted',review:{...review,gates:{...review.gates,facts:false}}})).status,400);
 assert.equal((await s.call(path,{id:'feedback-review-002',feedback:'adopted',review})).status,200);
 m=(await s.overview()).data.summary;assert.equal(m.firstAttempt.numerator,1);assert.equal(m.firstAttempt.pending,0);assert.equal(m.firstAttempt.rate,1);
 assert.equal((await s.call('/jobs/'+s.id+'/compose',{...s.composition,expectedVersion:1,images:s.composition.images.map(x=>({...x,title:'新版标题'}))})).status,200);
 const d=(await s.detail()).data;assert.equal(d.assets.length,4);assert.equal(d.assets.filter(a=>a.current).length,2);assert.equal(d.assets.find(a=>a.id===asset.id).feedback.feedback,'adopted');
 assert.equal((await s.call(path,{id:'feedback-stale-001',feedback:'revoked'})).status,409);
 assert.equal((await s.call(path,basic)).status,200);
 assert.equal((await s.overview()).data.summary.firstAttempt.rate,1);
});

test('rejected image creates real Badcase atomically; new evidence is required and later changes invalidate closure',async t=>{
 const s=await fixture(t),asset=s.assets[0];
 const rejected={id:'feedback-reject-001',feedback:'rejected',reasonCode:'排版不满意',note:'文字层级不清'};
 assert.equal((await s.call('/quality/assets/'+asset.id+'/feedback',rejected)).status,200);
 assert.equal((await s.call('/quality/assets/'+asset.id+'/feedback',rejected)).status,200);
 let b=(await s.call('/quality/badcases')).data.badcases[0];assert.equal(b.kind,'feedback');
 assert.equal((await s.call('/quality/badcases/'+b.id,{version:b.version,status:'closed',hypothesis:'文字层级',fix:'调整模板'})).status,409);
 b=(await s.call('/quality/badcases/'+b.id,{version:b.version,status:'investigating',hypothesis:'主次层级不足',fix:'调整 V2 模板'})).data.badcase;
 const invalid=await s.call('/quality/badcases/'+b.id+'/regressions',{id:'regression-old-001',jobId:s.id,assetId:asset.id});assert.equal(invalid.data.outcome,'failed');
 await s.call('/jobs/'+s.id+'/compose',{...s.composition,expectedVersion:1,images:s.composition.images.map(x=>({...x,title:'新版标题'}))});
 const next=(await s.detail()).data.assets.find(a=>a.current);
 await s.call('/quality/assets/'+next.id+'/feedback',{id:'feedback-good-001',feedback:'adopted',review});
 const good={id:'regression-new-001',jobId:s.id,assetId:next.id};assert.equal((await s.call('/quality/badcases/'+b.id+'/regressions',good)).data.outcome,'passed');
 assert.equal((await s.call('/quality/badcases/'+b.id+'/regressions',good)).data.outcome,'passed');
 await s.call('/quality/assets/'+next.id+'/feedback',{id:'feedback-revoke-001',feedback:'revoked'});
 assert.equal((await s.call('/quality/badcases/'+b.id,{version:b.version,status:'closed',hypothesis:b.hypothesis,fix:b.fix})).data.error.code,'REGRESSION_STALE');
 await s.call('/quality/assets/'+next.id+'/feedback',{id:'feedback-good-002',feedback:'adopted',review});
 assert.equal((await s.call('/quality/badcases/'+b.id+'/regressions',{...good,id:'regression-new-002'})).data.outcome,'passed');
 assert.equal((await s.call('/quality/badcases/'+b.id,{version:b.version,status:'closed',hypothesis:b.hypothesis,fix:b.fix})).data.badcase.status,'closed');
});

test('rule failure is separate from human scoring and diversity requires two actual differences',async t=>{
 const s=await fixture(t,{bytes:tiny}),d=(await s.detail()).data;
 assert.equal(d.badcases.length,2);assert.ok(d.assets.every(a=>a.reviews[0].passed===0));
 const path='/quality/jobs/'+s.id+'/diversity';
 assert.equal((await s.call(path,{id:'diversity-test-01',version:1,passed:true,axes:['palette']})).status,400);
 const input={id:'diversity-test-02',version:1,passed:true,axes:['palette','scene'],note:'两项变化'};
 const results=await Promise.all([s.call(path,input),s.call(path,input)]);assert.ok(results.every(r=>r.status===200));
 assert.equal((await s.detail()).data.reviews.length,1);
 assert.equal((await s.call(path,{...input,passed:false})).status,409);
});

test('cohort metrics count beyond recent 60; first attempts include technical failures and exclude evaluation/legacy',async t=>{
 const s=await fixture(t);const first=s.env.sqlite.prepare('SELECT * FROM generation_jobs WHERE id=?').get(s.id);
 const cols=Object.keys(first),insert=s.env.sqlite.prepare(`INSERT INTO generation_jobs (${cols.join(',')}) VALUES (${cols.map(()=>'?').join(',')})`);
 for(let i=0;i<70;i++){const item={...first,id:'failure-'+String(i).padStart(8,'0'),task_id:'task-fail-'+i,status:'failed',result_json:null};insert.run(...cols.map(k=>item[k]));}
 for(const environment of ['evaluation','legacy']){const item={...first,id:'excluded-'+environment,task_id:'excluded-'+environment,environment,status:'failed',result_json:null};insert.run(...cols.map(k=>item[k]));}
 const summary=(await s.overview()).data.summary;assert.equal(summary.jobs,71);assert.equal(summary.firstAttempt.denominator,71);assert.equal(summary.firstAttempt.pending,1);assert.equal(summary.fullyDelivered,1);
});

test('China natural week boundary remains correct on Sunday UTC',()=>{
 assert.equal(qualityWeekStart(new Date('2026-09-27T15:59:59Z')),'2026-09-20T16:00:00.000Z');
 assert.equal(qualityWeekStart(new Date('2026-09-27T16:00:00Z')),'2026-09-27T16:00:00.000Z');
});

test('download failure and free recovery retain one attempt and support an evidence-based Badcase closure',async t=>{
 const s=await fixture(t);s.env.IMAGE_PROVIDER='qwen';const id='job-recovery-0001';
 assert.equal((await s.call('/jobs',{...s.input,id})).status,201);
 const original=globalThis.fetch;let imageCalls=0,downloads=0;
 globalThis.fetch=async url=>{
  if(url.includes('/chat/completions'))return Response.json({choices:[{message:{content:JSON.stringify({copyStyle:'elegant',backgroundPrompt:'温暖空背景',layout:'right',textColor:'dark'})}}]});
  if(url.includes('.oss-')){downloads++;return new Response('unavailable',{status:503});}
  imageCalls++;return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/test.png?Signature=test-only'}]}}]}});
 };
 try{
  const failed=(await s.call('/jobs/'+id+'/run',{})).data.job;assert.equal(failed.status,'failed');
  const d=(await s.call('/quality/jobs/'+id)).data;let b=d.badcases.find(b=>b.stage==='download');assert.ok(b);
  b=(await s.call('/quality/badcases/'+b.id,{version:b.version,status:'investigating',hypothesis:'图片下载请求失败，生成已完成',fix:'从已有检查点恢复保存'})).data.badcase;
  globalThis.fetch=async()=>{downloads++;return new Response(Buffer.from(tiny.split(',')[1],'base64'),{headers:{'Content-Type':'image/png'}});};
  assert.equal((await s.call('/jobs/'+id+'/recover',{})).data.job.status,'succeeded');
  assert.equal((await s.call('/jobs/'+id+'/compose',s.composition)).status,200);
  assert.equal(imageCalls,1);assert.equal(downloads,2);
  const done=await s.call('/quality/badcases/'+b.id+'/regressions',{id:'regression-recovery-01',jobId:id});
  assert.equal(done.data.outcome,'passed',JSON.stringify(done.data));
  const detail=(await s.call('/quality/jobs/'+id)).data;assert.equal(detail.job.attemptNo,2);assert.ok(detail.events.some(e=>e.name==='recovery_requested'));
 }finally{globalThis.fetch=original;}
});

test('interrupted jobs create one timeout event and Badcase, without inventing a completed stage duration',async t=>{
 const s=await fixture(t),id='job-timeout-0001';
 await s.call('/jobs',{...s.input,id});s.env.sqlite.prepare('UPDATE generation_jobs SET created_at=? WHERE id=?').run(new Date(Date.now()-7*60000).toISOString(),id);
 await s.call('/jobs/'+id);await s.call('/jobs/'+id);
 const d=(await s.call('/quality/jobs/'+id)).data;assert.equal(d.job.status,'interrupted');assert.equal(d.badcases.length,1);
 const events=d.events.filter(e=>e.name==='generation_interrupted');assert.equal(events.length,1);assert.equal(events[0].duration_ms,null);
});

test('configured Langfuse runs after product response, respects owner and fails open without leaking keys',async t=>{
 const s=await fixture(t),original=globalThis.fetch,works=[];
 Object.assign(s.env,{LANGFUSE_BASE_URL:'https://langfuse.example.test',LANGFUSE_PUBLIC_KEY:'pk-lf-test-only',LANGFUSE_SECRET_KEY:'sk-lf-test-only'});
 globalThis.fetch=async()=>{throw new Error('private credential error must not escape');};
 try{
  const request=new Request('https://studio.test/api/quality/jobs/'+s.id,{headers:{'oai-authenticated-user-id':'owner-a'}});
  const response=await handleApi(request,s.env,{waitUntil(work){works.push(work);}});
  assert.equal(response.status,200);assert.equal(works.length,1);await Promise.all(works);
  const status=await s.call('/quality/jobs/'+s.id+'/langfuse');assert.equal(status.status,200);assert.equal(status.data.configured,true);assert.ok(status.data.counts.uncertain>0);
  assert.ok(!JSON.stringify(status.data).includes('sk-lf-'));
  assert.equal((await s.call('/quality/jobs/'+s.id+'/langfuse',undefined,'GET','owner-b')).status,404);
 }finally{globalThis.fetch=original;}
});
