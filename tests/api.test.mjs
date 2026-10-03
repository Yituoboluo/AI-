import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {localStore} from '../scripts/local-store.mjs';
import {handleApi} from '../server/worker.mjs';
import {generateCopy,generateBackground,generateCreativePlan} from '../server/providers.mjs';
import {activeProjects,isLegacyDemo} from '../public/draft-lifecycle.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=';
const draft=()=>({productName:'随行杯',sellingPoint:'450mL 容量',campaign:'秋日上新',headline:'轻便随行',price:'69',originalPrice:'89',startDate:'2025-09-20',endDate:'2025-10-07',imageName:'test',background:'blue',template:'airy',size:'square',revision:1,imageData:png,generated:true,isExample:true,history:[]});
async function setup(){const env={...await localStore(root),AI_ENABLED:'false'};const call=async(path,body,method=body?'POST':'GET',owner='owner-a',origin='https://studio.test')=>{const headers={};if(owner)headers['oai-authenticated-user-id']=owner;if(body){headers['Content-Type']='application/json';headers.Origin=origin;}const response=await handleApi(new Request('https://studio.test/api'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);const data=await response.json();return {status:response.status,data};};const project={id:'project-0001',name:'test',draft:draft(),thumbnail:png};return {env,call,project,save:()=>call('/projects/'+project.id,{project,expectedVersion:0},'PUT')};}
const success=()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({candidates:[{title:'轻便随行'},{title:'随行好物'},{title:'秋日上新'}]})}}],usage:{prompt_tokens:20,completion_tokens:30}}),{headers:{'Content-Type':'application/json'}});
const imageResult=()=>Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/test.png?Signature=private-test-signature'}]}}]},request_id:'test-image-request'});
const imageBytes=()=>Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0));
async function imageSetup(){const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DASHSCOPE_API_KEY:'test-qwen-placeholder',AI_IMAGE_DAILY_LIMIT:'2'});await s.save();await s.call('/jobs',{id:'job-image-01',projectId:s.project.id,kind:'image',sourceVersion:1});return s;}
const quickSettings=()=>({ratio:'portrait',customBackground:false,backgroundPrompt:'',customCopy:false,title:'',subtitle:'',customLayout:false,layout:'center'});
async function quickSetup(options={}){const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DASHSCOPE_API_KEY:'test-qwen-placeholder',AI_IMAGE_DAILY_LIMIT:'2'});Object.assign(s.project.draft,{productName:'',sellingPoint:'',campaign:'商品快捷创作',price:'',originalPrice:'',startDate:'',endDate:'',headline:'',creationMode:'quick',quick:{originalImageData:png,segmentation:'automatic',settings:{...quickSettings(),...options}}});await s.save();return s;}
const visualResult=()=>Response.json({choices:[{message:{content:JSON.stringify({copyStyle:'elegant',backgroundPrompt:'温暖的浅灰色空背景，柔和侧光',layout:'right',textColor:'dark'})}}],usage:{prompt_tokens:123,completion_tokens:45}});

async function completedQuickFixture(){
 const s=await quickSetup(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;return url.includes('/chat/completions')?visualResult():Response.json({data:[{b64_json:png.split(',')[1]}]});};
 try{
  Object.assign(s.env,{IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'portdan-test-only'});
  await s.call('/jobs',{id:'job-feedback-01',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});
  assert.equal((await s.call('/jobs/job-feedback-01/run',{})).data.job.status,'succeeded');
  assert.equal(calls,2);
  return {...s,id:'job-feedback-01',composition:{images:[0,1].map(()=>({data:png,title:'简约好物',subtitle:'',layout:'center'})),expectedVersion:0}};
 }finally{globalThis.fetch=original;}
}

test('quick feedback belongs to saved compositions and is cleared only when their version changes',async()=>{
 const s=await completedQuickFixture(),path='/jobs/'+s.id;
 try{
  const feedback={feedback:'adopted',reason:'',compositionVersion:1};
  assert.equal((await s.call(path+'/feedback',feedback)).data.error.code,'COMPOSITION_REQUIRED');
  await s.call(path+'/compose',s.composition);
  assert.equal((await s.call(path+'/feedback',feedback,'POST','owner-b')).status,404);
  assert.equal((await s.call(path+'/feedback',feedback,'POST','owner-a','https://evil.test')).status,403);
  assert.equal((await s.call(path+'/feedback',{...feedback,compositionVersion:0})).status,409);
  assert.equal((await s.call(path+'/feedback',{...feedback,reason:'x'.repeat(501)})).status,400);
  assert.equal((await s.call(path+'/feedback',feedback)).data.job.feedback,'adopted');
  assert.equal((await s.call(path+'/compose',s.composition)).data.job.feedback,'adopted');
  const changed={images:s.composition.images.map(image=>({...image,title:'新版标题'})),expectedVersion:1};
  const job=(await s.call(path+'/compose',changed)).data.job;
  assert.equal(job.result.compositionVersion,2);assert.equal(job.feedback,null);assert.equal(job.feedbackReason,null);
  assert.equal((await s.call(path+'/feedback',feedback)).status,409);
  const rejected=(await s.call(path+'/feedback',{feedback:'rejected',reason:'背景不合适：希望光线更柔和',compositionVersion:2})).data.job;
  assert.equal(rejected.feedback,'rejected');assert.equal(rejected.feedbackReason,'背景不合适：希望光线更柔和');
  assert.equal((await s.call('/status')).data.providers.image.usedToday,1);
  await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1});
  assert.equal((await s.call(path+'/feedback',{...feedback,compositionVersion:2})).status,409);
 }finally{s.env.sqlite.close();}
});

test('download records are owner scoped, version checked, and idempotent without model calls',async()=>{
 const s=await completedQuickFixture(),path='/jobs/'+s.id+'/export',entry={id:'download-event-01',compositionVersion:1,outputIndex:0};
 try{
  assert.equal((await s.call(path,entry)).data.error.code,'COMPOSITION_REQUIRED');
  await s.call('/jobs/'+s.id+'/compose',s.composition);
  assert.equal((await s.call(path,entry,'POST','owner-b')).status,404);
  assert.equal((await s.call(path,entry,'POST','owner-a','https://evil.test')).status,403);
  assert.equal((await s.call(path,{...entry,outputIndex:2})).status,400);
  assert.equal((await s.call(path,{...entry,compositionVersion:0})).status,409);
  const repeated=await Promise.all([s.call(path,entry),s.call(path,entry)]);
  assert.ok(repeated.every(response=>response.status===200));
  assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_events').get().n,1);
  assert.equal((await s.call(path,{...entry,outputIndex:1})).status,409);
  await s.call('/jobs/'+s.id+'/compose',{images:s.composition.images.map(image=>({...image,title:'新版标题'})),expectedVersion:1});
  assert.equal((await s.call(path,entry)).status,200);
  assert.equal((await s.call(path,{...entry,id:'download-event-02'})).status,409);
  assert.equal((await s.call(path,{...entry,id:'download-event-02',compositionVersion:2})).status,200);
  assert.equal((await s.call('/status')).data.providers.image.usedToday,1);
  await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1});
  assert.equal((await s.call(path,{...entry,id:'download-event-03',compositionVersion:2})).status,409);
  assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM workspace_events').get().n,2);
 }finally{s.env.sqlite.close();}
});

test('quick metrics distinguish generated backgrounds, saved outputs, latest feedback, and download requests',async()=>{
 const s=await completedQuickFixture(),path='/jobs/'+s.id;
 try{
  let metrics=(await s.call('/metrics')).data.quick;
  assert.equal(metrics.tasks,1);assert.equal(metrics.ready,0);assert.equal(metrics.downloadRequests,0);
  await s.call(path+'/compose',s.composition);
  await s.call(path+'/feedback',{feedback:'adopted',reason:'',compositionVersion:1});
  await s.call(path+'/export',{id:'download-event-01',compositionVersion:1,outputIndex:0});
  await s.call(path+'/export',{id:'download-event-02',compositionVersion:1,outputIndex:1});
  metrics=(await s.call('/metrics')).data.quick;
  assert.deepEqual({...metrics,scope:undefined},{scope:undefined,tasks:1,ready:1,adopted:1,needsWork:0,downloadRequests:2,downloadedTasks:1});
  await s.call(path+'/feedback',{feedback:'rejected',reason:'排版不满意',compositionVersion:1});
  metrics=(await s.call('/metrics')).data.quick;assert.equal(metrics.adopted,0);assert.equal(metrics.needsWork,1);
  const other=(await s.call('/metrics',undefined,'GET','owner-b')).data.quick;
  assert.equal(other.tasks,0);assert.equal(other.downloadRequests,0);assert.equal(other.adopted,0);
  const legacy=await s.call('/events',{id:'legacy-export-01',projectId:s.project.id,kind:'export',revision:1,outcome:'exported'});
  assert.equal(legacy.status,200);assert.equal((await s.call('/metrics')).data.quick.downloadRequests,2);
 }finally{s.env.sqlite.close();}
});

test('Portdan quick flow pins its provider/model, stores images and compositions, and never exposes credentials',async()=>{
 const s=await quickSetup(),original=globalThis.fetch;let visionCalls=0,imageCalls=0;
 Object.assign(s.env,{IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'portdan-test-only'});
 globalThis.fetch=async(url,options)=>{
  if(url.includes('/chat/completions')){visionCalls++;assert.equal(options.headers.Authorization,'Bearer test-qwen-placeholder');return visualResult();}
  imageCalls++;assert.equal(url,'https://portdan.com/v1/images/generations');assert.equal(options.headers.Authorization,'Bearer portdan-test-only');assert.equal(JSON.parse(options.body).model,'gpt-image-2.5-flare【1k快速1毛】');
  return Response.json({data:[{b64_json:png.split(',')[1]}]});
 };
 try{
  assert.equal((await s.call('/status')).data.providers.image.provider,'Portdan');
  assert.equal((await s.call('/jobs',{id:'job-portdan-01',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1})).status,201);
  s.env.IMAGE_PROVIDER='qwen';s.env.PORTDAN_IMAGE_MODEL='changed-after-queue';
  const job=(await s.call('/jobs/job-portdan-01/run',{})).data.job;assert.equal(job.status,'succeeded');assert.equal(job.provider,'Portdan');assert.equal(job.model,'gpt-image-2.5-flare【1k快速1毛】');assert.equal(job.usage.images,1);assert.equal(job.usage.visionInputTokens,123);assert.equal(job.usage.inputTokens,undefined);assert.match(job.result.imageUrl,/^\/api\/assets\//);assert.match(job.result.quick.subjectImageUrl,/^\/api\/assets\//);
  assert.equal((await s.call('/projects/'+s.project.id)).data.project.draft.revision,1);
  const saved=(await s.call('/jobs/job-portdan-01/compose',{images:[0,1].map(()=>({data:png,title:'简约，自有格调',subtitle:'',layout:'center'})),expectedVersion:0})).data.job;
  assert.equal(saved.result.compositions.length,2);await s.call('/jobs/job-portdan-01/run',{});assert.equal(visionCalls,1);assert.equal(imageCalls,1);assert.equal((await s.call('/status')).data.providers.image.usedToday,1);
  const publicData=JSON.stringify([saved,(await s.call('/status')).data]);assert.equal(publicData.includes('test-only'),false);assert.equal(publicData.includes('b64_json'),false);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('switching to Portdan preserves queued Qwen jobs and free recovery of their original images',async()=>{
 const s=await quickSetup(),original=globalThis.fetch;let visionCalls=0,imageCalls=0,downloads=0;
 globalThis.fetch=async(url,options)=>{
  if(url.includes('/chat/completions')){visionCalls++;return visualResult();}
  if(options.method==='POST'){imageCalls++;assert.ok(url.startsWith('https://dashscope.aliyuncs.com/'));assert.equal(JSON.parse(options.body).model,'qwen-image-2.0-pro');return imageResult();}
  downloads++;if(downloads===1)throw new TypeError('offline');return new Response(imageBytes());
 };
 try{
  await s.call('/jobs',{id:'job-before-switch',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});
  Object.assign(s.env,{IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'portdan-test-only',QWEN_IMAGE_MODEL:'changed-after-queue'});
  const failed=(await s.call('/jobs/job-before-switch/run',{})).data.job;assert.equal(failed.provider,'千问');assert.equal(failed.canRecover,true);
  delete s.env.DASHSCOPE_API_KEY;
  const recovered=(await s.call('/jobs/job-before-switch/recover',{})).data.job;assert.equal(recovered.status,'succeeded');assert.equal(recovered.model,'qwen-image-2.0-pro');assert.equal(visionCalls,1);assert.equal(imageCalls,1);assert.equal(downloads,2);assert.equal((await s.call('/status')).data.providers.image.usedToday,1);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('Portdan quick flow requires the separate analysis key before reserving any quota',async()=>{
 const s=await quickSetup();Object.assign(s.env,{IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'portdan-test-only'});delete s.env.DASHSCOPE_API_KEY;
 try{
  const response=await s.call('/jobs',{id:'job-no-analysis',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});assert.equal(response.status,503);assert.equal(response.data.error.code,'QUICK_NOT_CONFIGURED');assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_quota').get().n,0);
 }finally{s.env.sqlite.close();}
});

test('quick image-only flow creates a plan, respects user overrides and saves compositions without new calls',async()=>{
 const s=await quickSetup({customBackground:true,backgroundPrompt:'米白摄影棚',customCopy:true,title:'',subtitle:'用户确认的描述',customLayout:true,layout:'center'}),original=globalThis.fetch;let modelCalls=0;
 globalThis.fetch=async(url,options)=>{if(url.includes('/chat/completions')){modelCalls++;assert.equal(JSON.parse(options.body).model,'qwen-vl-plus');return visualResult();}if(options.method==='POST'){modelCalls++;assert.ok(JSON.parse(options.body).input.messages[0].content[0].text.includes('米白摄影棚'));return imageResult();}return new Response(imageBytes());};
 try{
  const created=await s.call('/jobs',{id:'job-quick-01',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});assert.equal(created.status,201);
  const job=(await s.call('/jobs/job-quick-01/run',{})).data.job;assert.equal(job.status,'succeeded');assert.equal(job.flow,'quick');assert.equal(job.result.quick.title,'');assert.equal(job.result.quick.subtitle,'用户确认的描述');assert.equal(job.result.quick.layout,'center');assert.equal(job.result.quick.lockedLayout,true);assert.equal(job.result.quick.ratio,'portrait');assert.equal(job.usage.visionInputTokens,123);
  assert.equal(JSON.stringify(job).includes('private-test-signature'),false);
  const body={images:[0,1].map(()=>({data:png,title:'用户修改',subtitle:'',layout:'center'})),expectedVersion:0};
  assert.equal((await s.call('/jobs/job-quick-01/compose',body,'POST','owner-b')).status,404);
  const saved=(await s.call('/jobs/job-quick-01/compose',body)).data.job;assert.equal(saved.result.compositions.length,2);assert.equal(saved.result.compositionVersion,1);
  assert.equal((await s.call('/jobs/job-quick-01/compose',body)).data.job.result.compositionVersion,1);
  assert.equal((await s.call('/jobs/job-quick-01/compose',{...body,images:body.images.map(i=>({...i,title:'过期修改'}))})).status,409);
  assert.equal(modelCalls,2);assert.equal(s.env.sqlite.prepare('SELECT used FROM daily_quota').get().used,1);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('quick recovery preserves the creative plan and actual vision usage without analyzing again',async()=>{
 const s=await quickSetup(),original=globalThis.fetch;let modelCalls=0,downloads=0;
 globalThis.fetch=async(url,options)=>{if(url.includes('/chat/completions')){modelCalls++;return visualResult();}if(options.method==='POST'){modelCalls++;return imageResult();}downloads++;if(downloads===1)throw new TypeError('offline');return new Response(imageBytes());};
 try{
  await s.call('/jobs',{id:'job-quick-02',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});const failed=(await s.call('/jobs/job-quick-02/run',{})).data.job;assert.equal(failed.canRecover,true);assert.equal(failed.result,null);assert.equal(failed.usage.visionInputTokens,123);
  const fixed=(await s.call('/jobs/job-quick-02/recover',{})).data.job;assert.equal(fixed.status,'succeeded');assert.equal(fixed.result.quick.title,'光影之间，自有风格');assert.equal(fixed.usage.visionInputTokens,123);assert.equal(fixed.usage.visionOutputTokens,45);assert.equal(modelCalls,2);assert.equal(downloads,2);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('a malformed analysis still completes one background call with a transparent preset and recorded usage',async()=>{
 const s=await quickSetup(),original=globalThis.fetch;let visionCalls=0,imageCalls=0;
 globalThis.fetch=async(url,options)=>{if(url.includes('/chat/completions')){visionCalls++;return Response.json({choices:[{finish_reason:'length',message:{content:'{"backgroundPrompt":"'}}],usage:{prompt_tokens:88,completion_tokens:1000}});}if(options.method==='POST'){imageCalls++;assert.equal(JSON.parse(options.body).model,'qwen-image-2.0-pro');return imageResult();}return new Response(imageBytes());};
 try{
  await s.call('/jobs',{id:'job-plan-fallback',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});
  const job=(await s.call('/jobs/job-plan-fallback/run',{})).data.job;
  assert.equal(job.status,'succeeded');assert.equal(job.result.quick.strategySource,'preset');assert.equal(job.strategySource,'preset');assert.equal(job.usage.visionInputTokens,88);assert.equal(job.usage.visionOutputTokens,1000);assert.equal(job.usage.visionPlanFallbackReason,'truncated');assert.equal(visionCalls,1);assert.equal(imageCalls,1);assert.equal((await s.call('/status')).data.providers.image.usedToday,1);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('a rejected analysis records token usage without calling the image model',async()=>{
 const s=await quickSetup(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;assert.ok(url.includes('/chat/completions'));return Response.json({choices:[{finish_reason:'content_filter',message:{content:null}}],usage:{prompt_tokens:98,completion_tokens:2}});};
 try{
  await s.call('/jobs',{id:'job-plan-refused',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1});
  const job=(await s.call('/jobs/job-plan-refused/run',{})).data.job;assert.equal(job.status,'failed');assert.equal(job.error.code,'PLAN_REJECTED');assert.equal(job.usage.visionInputTokens,98);assert.equal(job.usage.images,undefined);assert.equal(calls,1);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('analysis incident restores one bounded app slot, preserves attempt counts, and does not credit future failures',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,8,23,12,40)});
 const s=await quickSetup();
 try{
  for(let i=1;i<=4;i++){
   const id='job-credit-0'+i;assert.equal((await s.call('/jobs',{id,projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1})).status,201);
   const status=i===3?'succeeded':'failed',code=i<3?'IMAGE_DOWNLOAD_FAILED':i===4?'INVALID_PLAN':null,message=i<3?'图片已生成，但保存中断。请勿立即重复生成。':i===4?'商品分析未返回可用方案，请调整图片后再试。':null;
   s.env.sqlite.prepare('UPDATE generation_jobs SET status=?,error_code=?,error_message=?,finished_at=? WHERE id=?').run(status,code,message,'2026-09-23T12:41:03.891Z',id);
  }
  let provider=(await s.call('/status')).data.providers.image;assert.equal(provider.usedToday,4);assert.equal(provider.restoredTrials,3);assert.equal(provider.dailyLimit,5);
  assert.equal((await s.call('/status',undefined,'GET','owner-b')).data.providers.image.restoredTrials,0);
  const failed=(await s.call('/jobs/job-credit-04')).data.job;assert.match(failed.error.message,/无需更换图片/);
  t.mock.timers.tick(120000);
  assert.equal((await s.call('/jobs',{id:'job-credit-05',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1})).status,201);
  s.env.sqlite.prepare("UPDATE generation_jobs SET status='failed',error_code='INVALID_PLAN',error_message='商品分析未返回可用方案，请调整图片后再试。',finished_at=? WHERE id='job-credit-05'").run(new Date().toISOString());
  provider=(await s.call('/status')).data.providers.image;assert.equal(provider.usedToday,5);assert.equal(provider.restoredTrials,3);assert.equal(provider.dailyLimit,5);
  assert.equal((await s.call('/jobs',{id:'job-credit-06',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:1})).status,429);
  t.mock.timers.tick(24*60*60*1000);assert.equal((await s.call('/status')).data.providers.image.restoredTrials,0);
 }finally{s.env.sqlite.close();}
});

test('automatic photo-only copy discards unconfirmed function and category claims',async()=>{
 const mock=async()=>Response.json({choices:[{message:{content:JSON.stringify({productName:'蓝牙音箱',title:'超强降噪音响',subtitle:'续航72小时',copyStyle:'unknown',backgroundPrompt:'浅灰空背景'})}}]});
 const {plan}=await generateCreativePlan({DASHSCOPE_API_KEY:'test'},png,quickSettings(),mock);
 assert.equal(plan.productName,'商品创意');assert.equal(plan.title,'简约，自有格调');assert.equal(plan.subtitle,'');
 const custom=await generateCreativePlan({DASHSCOPE_API_KEY:'test'},png,{...quickSettings(),customCopy:true,title:'录音豆',subtitle:'用户确认文案'},mock);
 assert.equal(custom.plan.title,'录音豆');assert.equal(custom.plan.subtitle,'用户确认文案');
});

test('quick flow still requires an image; legacy drafts retain their facts requirement',async()=>{
 const s=await quickSetup();
 try{
  assert.equal((await s.call('/jobs',{id:'job-quick-03',projectId:s.project.id,kind:'image',sourceVersion:1})).data.error.code,'FACTS_REQUIRED');
  s.project.draft.imageData=null;s.project.draft.revision=2;await s.call('/projects/'+s.project.id,{project:s.project,expectedVersion:1},'PUT');
  assert.equal((await s.call('/jobs',{id:'job-quick-04',projectId:s.project.id,kind:'image',flow:'quick',sourceVersion:2})).data.error.code,'IMAGE_REQUIRED');
 }finally{s.env.sqlite.close();}
});

test('download failure keeps a private checkpoint; recovery never generates or consumes another slot',async()=>{
 const s=await imageSetup(),original=globalThis.fetch;let modelCalls=0,downloads=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST'){modelCalls++;return imageResult();}downloads++;if(downloads===1)throw new TypeError('network interrupted with secret URL');assert.equal(options.headers,undefined);assert.equal(options.redirect,'manual');return new Response(imageBytes());};
 try{
  const failed=(await s.call('/jobs/job-image-01/run',{})).data.job;assert.equal(failed.status,'failed');assert.equal(failed.canRecover,true);assert.equal(failed.result,null);assert.equal(failed.usage.providerCompleted,true);
  assert.equal(JSON.stringify((await s.call('/jobs')).data).includes('private-test-signature'),false);
  assert.equal((await s.call('/jobs/job-image-01/recover',{},'POST','owner-b')).status,404);
  assert.equal((await s.call('/jobs/job-image-01/recover',{},'POST','owner-a','https://evil.test')).status,403);
  s.env.AI_ENABLED='false';delete s.env.DASHSCOPE_API_KEY;
  const restored=(await s.call('/jobs/job-image-01/recover',{})).data.job;
  assert.equal(restored.status,'succeeded');assert.equal(restored.error,null);assert.equal(restored.canRecover,false);assert.match(restored.result.imageUrl,/^\/api\/assets\//);
  await s.call('/jobs/job-image-01/recover',{});await s.call('/jobs/job-image-01/run',{});
  assert.equal(modelCalls,1);assert.equal(downloads,2);assert.equal(s.env.sqlite.prepare('SELECT used FROM daily_quota').get().used,1);
  assert.equal(JSON.stringify(restored).includes('private-test-signature'),false);assert.equal(s.env.sqlite.prepare('SELECT result_json FROM generation_jobs').get().result_json.includes('private-test-signature'),false);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('concurrent recoveries download once and allow recovery after the source changes',async()=>{
 const s=await imageSetup(),original=globalThis.fetch;let downloads=0;
 globalThis.fetch=async(url,options)=>{if(options.method==='POST')return imageResult();throw new TypeError('offline');};
 try{
  await s.call('/jobs/job-image-01/run',{});s.project.draft.revision=2;s.project.draft.headline='更新后的标题';await s.call('/projects/'+s.project.id,{project:s.project,expectedVersion:1},'PUT');
  globalThis.fetch=async(url,options)=>{assert.equal(options.method,undefined);downloads++;await new Promise(resolve=>setTimeout(resolve,20));return new Response(imageBytes());};
  const results=await Promise.all([s.call('/jobs/job-image-01/recover',{}),s.call('/jobs/job-image-01/recover',{})]);
  assert.equal(downloads,1);assert.ok(results.some(r=>r.data.job.status==='succeeded'));
  const job=(await s.call('/jobs/job-image-01')).data.job;assert.equal(job.status,'succeeded');assert.equal(job.sourceRevision,1);assert.equal((await s.call('/projects/'+s.project.id)).data.project.draft.revision,2);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('expired links and deleted projects cannot cause paid regeneration during recovery',async()=>{
 const s=await imageSetup(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(url,options)=>{calls++;if(options.method==='POST')return imageResult();throw new TypeError('offline');};
 try{
  await s.call('/jobs/job-image-01/run',{});await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1});
  assert.equal((await s.call('/jobs/job-image-01/recover',{})).status,409);assert.equal(calls,2);
  await s.call('/projects/'+s.project.id+'/trash',{deleted:false,expectedVersion:2});
  globalThis.fetch=async(url,options)=>{assert.equal(options.method,undefined);calls++;return new Response('expired',{status:403});};
  const r=(await s.call('/jobs/job-image-01/recover',{})).data.job;assert.equal(r.status,'failed');assert.equal(r.error.code,'IMAGE_LINK_EXPIRED');assert.equal(r.canRecover,false);
  assert.equal((await s.call('/jobs/job-image-01/recover',{})).status,409);assert.equal(calls,3);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('an old execution cannot replace a newer recovery state',async()=>{
 const s=await imageSetup(),original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>options.method==='POST'?imageResult():Promise.reject(new TypeError('offline'));
 try{
  await s.call('/jobs/job-image-01/run',{});
  globalThis.fetch=async()=>{s.env.sqlite.prepare("UPDATE generation_jobs SET status='running',started_at=?,error_code=NULL,error_message=NULL WHERE id=?").run('2099-01-01T00:00:00.000Z','job-image-01');return new Response(imageBytes());};
  const r=(await s.call('/jobs/job-image-01/recover',{})).data.job;assert.equal(r.status,'running');assert.equal(r.startedAt,'2099-01-01T00:00:00.000Z');assert.equal(r.result,null);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('image redirect is rejected without following and failed checkpoint prevents download',async()=>{
 let calls=0,checkpointed=false;
 await assert.rejects(()=>generateBackground({DASHSCOPE_API_KEY:'test'},{facts:draft()},async(url,options)=>{calls++;if(options.method==='POST')return imageResult();assert.equal(checkpointed,true);assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{Location:'https://evil.example/private'}});},async()=>{checkpointed=true;}),{code:'IMAGE_REDIRECT_REJECTED'});
 assert.equal(calls,2);calls=0;
 await assert.rejects(()=>generateBackground({DASHSCOPE_API_KEY:'test'},{facts:draft()},async()=>{calls++;return imageResult();},async()=>{throw new Error('database unavailable');}),/database unavailable/);assert.equal(calls,1);
});

test('incident compensation returns at most two app slots only for legacy failures on the incident day',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,8,23,12)});
 const s=await imageSetup();
 try{
  const failLegacy=id=>s.env.sqlite.prepare("UPDATE generation_jobs SET status='failed',error_code='IMAGE_DOWNLOAD_FAILED',error_message='图片已生成，但保存中断。请勿立即重复生成。' WHERE id=?").run(id);
  failLegacy('job-image-01');await s.call('/jobs',{id:'job-image-02',projectId:s.project.id,kind:'image',sourceVersion:1});failLegacy('job-image-02');
  const status=(await s.call('/status')).data.providers.image;assert.equal(status.usedToday,2);assert.equal(status.restoredTrials,2);assert.equal(status.dailyLimit,4);
  assert.equal((await s.call('/status',undefined,'GET','owner-b')).data.providers.image.restoredTrials,0);
  for(const id of ['job-image-03','job-image-04']){assert.equal((await s.call('/jobs',{id,projectId:s.project.id,kind:'image',sourceVersion:1})).status,201);failLegacy(id);}
  assert.equal((await s.call('/status')).data.providers.image.restoredTrials,2);assert.equal((await s.call('/jobs',{id:'job-image-05',projectId:s.project.id,kind:'image',sourceVersion:1})).status,429);
  t.mock.timers.tick(24*60*60*1000);assert.equal((await s.call('/status')).data.providers.image.restoredTrials,0);
 }finally{s.env.sqlite.close();}
});

test('soft deletion persists, blocks stale saves and AI, and restores the same draft',async()=>{const s=await setup();await s.save();const trashed=await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1});assert.equal(trashed.status,200);assert.ok(trashed.data.project.deletedAt);assert.equal(trashed.data.project.serverVersion,2);assert.equal(activeProjects((await s.call('/projects')).data.projects).length,0);assert.equal((await s.call('/projects/'+s.project.id,{project:s.project,expectedVersion:2},'PUT')).data.error.code,'PROJECT_DELETED');assert.equal((await s.call('/jobs',{id:'job-delete-1',projectId:s.project.id,kind:'copy',sourceVersion:2})).data.error.code,'PROJECT_DELETED');const restored=await s.call('/projects/'+s.project.id+'/trash',{deleted:false,expectedVersion:2});assert.equal(restored.status,200);assert.equal(restored.data.project.deletedAt,null);assert.equal(restored.data.project.draft.headline,s.project.draft.headline);assert.equal(restored.data.project.serverVersion,3);s.env.sqlite.close();});
test('trash endpoints enforce owner, origin, CAS and active-job guards',async()=>{const s=await setup();await s.save();assert.equal((await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1},'POST','owner-b')).status,404);assert.equal((await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1},'POST','owner-a','https://evil.test')).status,403);assert.equal((await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:0})).status,409);Object.assign(s.env,{AI_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AI_COPY_DAILY_LIMIT:'5'});await s.call('/jobs',{id:'job-delete-2',projectId:s.project.id,kind:'copy',sourceVersion:1});assert.equal((await s.call('/projects/'+s.project.id+'/trash',{deleted:true,expectedVersion:1})).data.error.code,'ACTIVE_JOB');s.env.sqlite.close();});
test('old demo retirement preserves real creations and deliberately restored demos',()=>{const example={name:'秋日好物上新',draft:{isExample:true,productName:'轻量随行保温杯'}};assert.equal(isLegacyDemo(example),true);assert.equal(isLegacyDemo({...example,demoRetired:true}),false);assert.equal(isLegacyDemo({...example,draft:{...example.draft,isExample:false}}),false);assert.equal(isLegacyDemo({name:'MVP保存验证',draft:{productName:'我的真实商品'}}),false);assert.equal(isLegacyDemo({name:'MVP保存验证',draft:{}}),true);});
test('Qwen copy uses server credentials, workspace endpoint and JSON candidates',async()=>{let request;const value=await generateCopy({DASHSCOPE_API_KEY:'test-qwen-placeholder',QWEN_WORKSPACE_ID:'workspace-test'},{facts:draft(),prompt:'清晰简洁'},async(url,options)=>{assert.equal(url,'https://workspace-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');request=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer test-qwen-placeholder');return success();});assert.equal(request.model,'qwen-plus');assert.equal(request.enable_thinking,false);assert.equal('thinking' in request,false);assert.equal(value.candidates.length,3);});
test('Qwen image fetches PNG from official result host without forwarding API key',async()=>{let calls=0;const value=await generateBackground({DASHSCOPE_API_KEY:'test-qwen-placeholder'},{facts:draft(),prompt:'柔和米色背景'},async(url,options)=>{calls++;if(calls===1){assert.equal(url,'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');const body=JSON.parse(options.body);assert.equal(body.parameters.n,1);return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/test.png'}]}}]},request_id:'test-request'});}assert.equal(options.headers,undefined);assert.equal(options.redirect,'manual');return new Response(Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0)));});assert.equal(calls,2);assert.ok(value.bytes.length>0);await assert.rejects(()=>generateBackground({DASHSCOPE_API_KEY:'test'},{facts:draft()},async()=>Response.json({output:{choices:[{message:{content:[{image:'https://evil.example/test.png'}]}}]}})),{code:'INVALID_IMAGE'});});

test('authentication, CSRF, owner isolation and asset ownership',async()=>{const s=await setup();assert.equal((await s.call('/status',undefined,'GET',null)).status,401);assert.equal((await s.call('/projects/'+s.project.id,{project:s.project},'PUT','owner-a','https://evil.test')).status,403);const saved=await s.save();assert.equal(saved.status,200);assert.equal((await s.call('/projects/'+s.project.id,undefined,'GET','owner-b')).status,404);assert.equal((await s.call('/projects',undefined,'GET','owner-b')).data.projects.length,0);assert.equal((await s.call(saved.data.project.draft.imageData.slice(4),undefined,'GET','owner-b')).status,404);s.env.sqlite.close();});
test('stale writes return JSON conflict and cannot overwrite',async()=>{const s=await setup();await s.save();s.project.draft.headline='新标题';s.project.draft.revision=2;const stale=await s.save();assert.equal(stale.status,409);assert.equal(stale.data.error.code,'VERSION_CONFLICT');assert.equal((await s.call('/projects/'+s.project.id)).data.project.draft.headline,'轻便随行');s.env.sqlite.close();});
test('missing model configuration cannot create a job or use quota',async()=>{const s=await setup();await s.save();const r=await s.call('/jobs',{id:'job-00001',projectId:s.project.id,kind:'copy',sourceVersion:1});assert.equal(r.status,503);assert.equal(r.data.error.code,'MODEL_NOT_CONFIGURED');assert.equal(s.env.sqlite.prepare('SELECT COUNT(*) AS n FROM daily_quota').get().n,0);s.env.sqlite.close();});
test('idempotent task creation reserves quota once; limit rejects new task',async()=>{const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AI_COPY_DAILY_LIMIT:'1'});await s.save();const payload={id:'job-00001',projectId:s.project.id,kind:'copy',sourceVersion:1,prompt:''};assert.equal((await s.call('/jobs',payload)).status,201);assert.equal((await s.call('/jobs',payload)).status,200);assert.equal((await s.call('/jobs',{...payload,prompt:'different'})).status,409);assert.equal((await s.call('/jobs',{...payload,id:'job-00002'})).status,429);assert.equal(s.env.sqlite.prepare('SELECT used FROM daily_quota').get().used,1);s.env.sqlite.close();});
test('running a task twice calls provider once, records usage and leaves draft untouched',async()=>{const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AI_COPY_DAILY_LIMIT:'5'});await s.save();await s.call('/jobs',{id:'job-00001',projectId:s.project.id,kind:'copy',sourceVersion:1});const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return success();};try{const r=await s.call('/jobs/job-00001/run',{});assert.equal(r.data.job.status,'succeeded');assert.equal(r.data.job.usage.inputTokens,20);await s.call('/jobs/job-00001/run',{});assert.equal(calls,1);assert.equal((await s.call('/projects/'+s.project.id)).data.project.draft.headline,'轻便随行');assert.equal((await s.call('/jobs/job-00001/feedback',{feedback:'rejected',reason:'风格不符'})).status,200);}finally{globalThis.fetch=original;s.env.sqlite.close();}});
test('changed source fails before any model request',async()=>{const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AI_COPY_DAILY_LIMIT:'5'});await s.save();await s.call('/jobs',{id:'job-00001',projectId:s.project.id,kind:'copy',sourceVersion:1});s.project.draft.headline='新标题';s.project.draft.revision=2;await s.call('/projects/'+s.project.id,{project:s.project,expectedVersion:1},'PUT');const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Provider must not run');};try{const r=await s.call('/jobs/job-00001/run',{});assert.equal(r.data.job.status,'failed');assert.equal(r.data.job.error.code,'STALE_SOURCE');}finally{globalThis.fetch=original;s.env.sqlite.close();}});
test('queue age does not expire a recently started running task',async()=>{const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AI_COPY_DAILY_LIMIT:'5'});await s.save();await s.call('/jobs',{id:'job-00001',projectId:s.project.id,kind:'copy',sourceVersion:1});s.env.sqlite.prepare("UPDATE generation_jobs SET status='running',created_at=?,started_at=?").run(new Date(Date.now()-10*60000).toISOString(),new Date().toISOString());assert.equal((await s.call('/jobs/job-00001')).data.job.status,'running');s.env.sqlite.close();});
test('copy provider request contract and invalid result handling',async()=>{let body;await generateCopy({DEEPSEEK_API_KEY:'test-placeholder'},{facts:draft(),prompt:''},async(url,options)=>{assert.equal(url,'https://api.deepseek.com/chat/completions');body=JSON.parse(options.body);return success();});assert.equal(body.response_format.type,'json_object');assert.equal(body.thinking.type,'disabled');await assert.rejects(()=>generateCopy({},{facts:draft()},async()=>new Response(JSON.stringify({choices:[{finish_reason:'length'}]}))),{code:'TRUNCATED_RESULT'});});
test('body stream timeout is reported as an uncertain result',async()=>{const fetcher=async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException('timeout','AbortError'));}}));await assert.rejects(()=>generateCopy({},{facts:draft()},fetcher),{code:'PROVIDER_TIMEOUT'});});
test('Seedream receives PNG single-background contract and rejects invalid bytes',async()=>{let body;const result=await generateBackground({SEEDREAM_API_KEY:'test-placeholder'},{facts:draft(),prompt:'柔光'},async(url,options)=>{assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/images/generations');body=JSON.parse(options.body);return new Response(JSON.stringify({data:[{b64_json:png.split(',')[1]}]}));});assert.equal(body.response_format,'b64_json');assert.equal(body.output_format,'png');assert.equal(body.watermark,true);assert.equal('stream' in body,false);assert.ok(result.bytes.length>0);await assert.rejects(()=>generateBackground({},{facts:draft()},async()=>new Response(JSON.stringify({data:[{b64_json:'YWJj'}]}))),{code:'INVALID_IMAGE'});});
test('model errors are sanitized and preserve existing project',async()=>{const s=await setup();Object.assign(s.env,{AI_ENABLED:'true',DEEPSEEK_API_KEY:'test-placeholder',AI_COPY_DAILY_LIMIT:'5'});await s.save();await s.call('/jobs',{id:'job-00001',projectId:s.project.id,kind:'copy',sourceVersion:1});const original=globalThis.fetch;globalThis.fetch=async()=>new Response('secret-provider-debug',{status:401});try{const r=await s.call('/jobs/job-00001/run',{});assert.equal(r.data.job.status,'failed');assert.equal(r.data.job.error.code,'PROVIDER_AUTH');assert.equal(JSON.stringify(r).includes('secret-provider-debug'),false);assert.equal((await s.call('/projects/'+s.project.id)).data.project.draft.headline,'轻便随行');}finally{globalThis.fetch=original;s.env.sqlite.close();}});
