import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {localStore} from '../scripts/local-store.mjs';
import {handleApi} from '../server/worker.mjs';
import {buildVisualPlan,visualBackgroundPrompt} from '../server/creative-rules.mjs';
import {generateCreativePlan,providerStatus} from '../server/providers.mjs';
import {visualFrame} from '../public/visual-layout.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=';
const options={visualVersion:2,conceptCount:3,category:'auto',direction:'auto',ratio:'square',customBackground:false,backgroundPrompt:'',customCopy:false,title:'',subtitle:'',customLayout:false,layout:'center'};
const rawPlan={category:'food',confidence:.95,concepts:[{scene:'清晨餐桌，边缘早餐道具',title:'清晨，刚刚好',accent:'#876343'},{scene:'暖白色曲面展台，侧光',title:'看见细节',accent:'#BE9144'},{scene:'紫色与绿色层次色块',title:'给生活一点新意',accent:'#6B3C81'}]};
const analysis=(content=JSON.stringify(rawPlan),finish_reason='stop')=>Response.json({choices:[{finish_reason,message:{content}}],usage:{prompt_tokens:123,completion_tokens:45}});
const imageResult=()=>Response.json({data:[{b64_json:png.split(',')[1]}]});
async function setup(settings={},limit='unlimited',provider='portdan'){
 const env={...await localStore(root),AI_ENABLED:'true',AI_IMAGE_DAILY_LIMIT:limit,DASHSCOPE_API_KEY:'test-only',IMAGE_PROVIDER:provider,PORTDAN_API_KEY:'test-only-portdan'};
 const call=async(path,body,method=body?'POST':'GET',owner='visual-owner')=>{
  const response=await handleApi(new Request('https://studio.test/api'+path,{method,headers:{'oai-authenticated-user-id':owner,...(body?{'Content-Type':'application/json',Origin:'https://studio.test'}:{})},body:body?JSON.stringify(body):undefined}),env);
  return {status:response.status,data:await response.json()};
 };
 const project={id:'visual-project-01',thumbnail:png,draft:{productName:'',sellingPoint:'',campaign:'商品快捷创作',headline:'',price:'',originalPrice:'',startDate:'',endDate:'',imageName:'test',background:'white',template:'airy',size:'square',revision:1,imageData:png,creationMode:'quick',quick:{originalImageData:png,segmentation:'transparent',settings:{...options,...settings}}}};
 assert.equal((await call('/projects/'+project.id,{project,expectedVersion:0},'PUT')).status,200);
 const create=(id='visual-job-01')=>call('/jobs',{id,projectId:project.id,flow:'quick',kind:'image',sourceVersion:1});
 const compose=job=>call('/jobs/'+job.id+'/compose',{images:job.result.backgrounds.map(b=>{const c=job.result.quick.concepts.find(c=>c.id===b.conceptId);return {data:png,conceptId:c.id,layout:c.layout,title:c.title,subtitle:c.subtitle};}),expectedVersion:job.result.compositionVersion});
 return {env,call,create,compose,project};
}

test('category plans keep three distinct routes, manual choices, and safe low-confidence fallback',()=>{
 for(const category of ['food','electronics','apparel','home','general']){
  const plan=buildVisualPlan(rawPlan,{...options,category});
  assert.equal(plan.category,category);assert.equal(plan.categorySource,'user');
  assert.equal(new Set(plan.concepts.map(c=>c.backgroundPrompt)).size,3);
  assert.equal(new Set(plan.concepts.map(c=>c.layout)).size,3);assert.equal(new Set(plan.concepts.map(c=>c.font)).size,3);
  for(const c of plan.concepts)assert.match(visualBackgroundPrompt(c),/商品预留区/);
 }
 assert.equal(buildVisualPlan({...rawPlan,confidence:.4},options).category,'general');
 assert.equal(buildVisualPlan({...rawPlan,category:'invented'},options).category,'general');
 const manual=buildVisualPlan(rawPlan,{...options,category:'apparel',conceptCount:1,direction:'graphic',customCopy:true,title:'',subtitle:'我的文案',customLayout:true,layout:'center',customBackground:true,backgroundPrompt:'用户指定的蓝色纸质空间'});
 assert.equal(manual.concepts.length,1);assert.equal(manual.concepts[0].id,'graphic');assert.equal(manual.concepts[0].title,'');assert.equal(manual.concepts[0].subtitle,'我的文案');assert.equal(manual.concepts[0].layout,'center');assert.equal(manual.concepts[0].backgroundPrompt,'用户指定的蓝色纸质空间');
 assert.match(visualBackgroundPrompt(manual.concepts[0]),/不生成模特/);
 const claim=buildVisualPlan({...rawPlan,concepts:rawPlan.concepts.map(c=>({...c,title:'续航30小时防水认证'}))},options);assert.ok(claim.concepts.every(c=>!/30|防水|认证/.test(c.title)));
 const repaint=buildVisualPlan({...rawPlan,concepts:rawPlan.concepts.map(c=>({...c,scene:'牛奶瓶放在桌面上，重新绘制瓶身',lighting:'照亮瓶盖'}))},options);assert.ok(repaint.concepts.every(c=>!/瓶身|瓶盖|牛奶瓶/.test(c.backgroundPrompt)));
});

test('truncated visual analysis uses category rules once; refusal stops before image generation',async()=>{
 let calls=0;
 const fallback=await generateCreativePlan({DASHSCOPE_API_KEY:'test-only'},png,{...options,category:'electronics'},async()=>{calls++;return analysis('{"category":','length');});
 assert.equal(calls,1);assert.equal(fallback.plan.category,'electronics');assert.equal(fallback.plan.strategySource,'preset');assert.equal(fallback.plan.concepts.length,3);assert.equal(fallback.usage.visionOutputTokens,45);
 await assert.rejects(()=>generateCreativePlan({DASHSCOPE_API_KEY:'test-only'},png,options,async()=>analysis(null,'content_filter')),{code:'PLAN_REJECTED'});
});

test('three backgrounds use one analysis and distinct step tokens; duplicate clicks never buy another image',async()=>{
 const s=await setup(),original=globalThis.fetch;let visions=0,images=0;const prompts=[];
 globalThis.fetch=async(url,init)=>{if(url.includes('/chat/completions')){visions++;return analysis();}images++;assert.equal(url,'https://portdan.com/v1/images/edits');assert.ok(init.body instanceof FormData);assert.equal(await init.body.get('image').text(),Buffer.from(png.split(',')[1],'base64').toString());prompts.push(init.body.get('prompt'));return imageResult();};
 try{
  assert.equal((await s.create()).status,201);assert.equal((await s.create()).status,200);
  assert.equal((await s.call('/jobs/visual-job-01/run',{})).data.error.code,'STEP_REQUIRED');
  assert.equal((await s.call('/jobs/visual-job-01/run',{step:1})).data.job.nextStep,0);assert.equal(images,0);
  const doubled=await Promise.all([s.call('/jobs/visual-job-01/run',{step:0}),s.call('/jobs/visual-job-01/run',{step:0})]);
  assert.ok(doubled.every(r=>r.status===200));assert.equal(visions,1);assert.equal(images,1);
  assert.equal((await s.call('/jobs/visual-job-01/run',{step:0})).data.job.nextStep,1);assert.equal(images,1);
  s.env.sqlite.prepare("UPDATE generation_jobs SET started_at='2020-01-01T00:00:00.000Z' WHERE id='visual-job-01'").run();
  assert.equal((await s.call('/jobs/visual-job-01')).data.job.status,'queued','Unexecuted directions must survive closing the page');
  await s.call('/jobs/visual-job-01/run',{step:1});
  const result=await s.call('/jobs/visual-job-01/run',{step:2}),job=result.data.job;
  assert.equal(job.status,'succeeded');assert.equal(job.result.backgrounds.length,3);assert.equal(job.usage.imageCalls,3);assert.equal(job.usage.images,3);assert.equal(visions,1);assert.equal(new Set(prompts).size,3);
  assert.equal(job.result.quick.renderRoute,'reference_scene_edit');assert.ok(job.result.backgrounds.every(b=>b.renderMode==='integrated'));assert.deepEqual(job.result.quick.productLocks,[]);
  assert.ok(prompts.every(p=>!p.includes('场景里没有任何商品或物体')),'Old empty-everything wrapper must not override the art direction');
  await s.call('/jobs/visual-job-01/run',{step:2});assert.equal(images,3);
  const saved=(await s.compose(job)).data.job;assert.equal(saved.result.compositions.length,3);
  assert.equal((await s.call('/jobs/'+job.id+'/export',{id:'visual-download-03',outputIndex:2,compositionVersion:1})).status,200);
  assert.equal((await s.call('/jobs/'+job.id+'/export',{id:'other-owner-download',outputIndex:2,compositionVersion:1},'POST','someone-else')).status,404);
  assert.equal((await s.call('/jobs/'+job.id+'/feedback',{feedback:'adopted',reason:'',compositionVersion:1})).status,200);
  const edited={images:saved.result.compositions.map((c,i)=>({...c,data:png,title:i===1?'只改第二张':c.title})),expectedVersion:1};
  const updated=(await s.call('/jobs/'+job.id+'/compose',edited)).data.job;
  assert.equal(updated.result.compositions[0].title,saved.result.compositions[0].title);assert.equal(updated.result.compositions[1].title,'只改第二张');assert.equal(updated.result.compositionVersion,2);assert.equal(updated.feedback,null);assert.equal(images,3);
  assert.equal((await s.call('/jobs/'+job.id+'/compose',{...edited,images:edited.images.map(c=>({...c,conceptId:'wrong'})),expectedVersion:2})).status,400);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('queued pre-fusion Portdan jobs keep their original background route and remain composable',async()=>{
 const s=await setup({conceptCount:1}),original=globalThis.fetch;let images=0;
 globalThis.fetch=async(url,init)=>{
  if(url.includes('/chat/completions'))return analysis();
  images++;assert.equal(url,'https://portdan.com/v1/images/generations');
  assert.equal(typeof init.body,'string');assert.equal(JSON.parse(init.body).n,1);return imageResult();
 };
 try{
  await s.create();
  const input=JSON.parse(s.env.sqlite.prepare('SELECT input_json FROM generation_jobs WHERE id=?').get('visual-job-01').input_json);
  delete input.renderRoute;
  s.env.sqlite.prepare('UPDATE generation_jobs SET input_json=? WHERE id=?').run(JSON.stringify(input),'visual-job-01');
  const job=(await s.call('/jobs/visual-job-01/run',{step:0})).data.job;
  assert.equal(job.status,'succeeded');assert.equal(job.result.quick.renderRoute,'locked_product_composite');
  assert.equal(job.result.backgrounds[0].renderMode,undefined);assert.equal(images,1);
  assert.equal((await s.compose(job)).data.job.result.compositions.length,1);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('daily unlimited remains enabled above 100; finite budgets reserve the whole group atomically',async()=>{
 const s=await setup(),finite=await setup({},'2');
 try{
  const config=providerStatus(s.env).image;assert.equal(config.unlimited,true);assert.equal(config.dailyLimit,null);assert.equal(config.enabled,true);
  s.env.sqlite.prepare('INSERT INTO daily_quota (id,owner_id,day,kind,used) VALUES (?,?,?,?,?)').run('visual-owner:'+new Date().toISOString().slice(0,10)+':image','visual-owner',new Date().toISOString().slice(0,10),'image',120);
  assert.equal((await s.create()).status,201);assert.equal((await s.call('/status')).data.providers.image.usedToday,123);
  assert.equal((await finite.create()).status,429);assert.equal((await finite.call('/status')).data.providers.image.usedToday,0);
  finite.env.AI_IMAGE_DAILY_LIMIT='3';assert.equal((await finite.create()).status,201);assert.equal((await finite.call('/status')).data.providers.image.usedToday,3);
 }finally{s.env.sqlite.close();finite.env.sqlite.close();}
});

test('one failed direction preserves other outputs and can be composed, exported and reviewed',async()=>{
 const s=await setup(),original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{if(url.includes('/chat/completions'))return analysis();calls++;if(calls===2)throw new TypeError('private network details');return imageResult();};
 try{
  await s.create();for(let step=0;step<3;step++)await s.call('/jobs/visual-job-01/run',{step});
  const job=(await s.call('/jobs/visual-job-01')).data.job;
  assert.equal(job.status,'succeeded');assert.equal(job.result.backgrounds.length,2);assert.equal(job.result.conceptErrors[0].conceptId,'studio');assert.equal(calls,3);assert.equal(JSON.stringify(job).includes('private network details'),false);
  const saved=(await s.compose(job)).data.job;assert.deepEqual(saved.result.compositions.map(c=>c.conceptId),['scene','graphic']);
  assert.equal((await s.call('/jobs/'+job.id+'/export',{id:'partial-download-02',outputIndex:1,compositionVersion:1})).status,200);
  assert.equal((await s.call('/jobs/'+job.id+'/export',{id:'partial-download-03',outputIndex:2,compositionVersion:1})).status,400);
  assert.equal((await s.call('/metrics')).data.quick.ready,1);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('Qwen recovery saves the original direction without another model call and retains partial composition',async()=>{
 const s=await setup({},'unlimited','qwen'),original=globalThis.fetch;let vision=0,images=0,downloads=0;
 globalThis.fetch=async url=>{
  if(url.includes('/chat/completions')){vision++;return analysis();}
  if(url.includes('/multimodal-generation/')){images++;return Response.json({output:{choices:[{message:{content:[{image:'https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/sample.png?Signature=private-test'}]}}]}});}
  downloads++;if(downloads===2)throw new TypeError('download disconnected');return new Response(Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
 };
 try{
  await s.create();await s.call('/jobs/visual-job-01/run',{step:0});
  const failed=(await s.call('/jobs/visual-job-01/run',{step:1})).data.job;
  assert.equal(failed.status,'failed');assert.equal(failed.canRecover,true);assert.equal(failed.result.backgrounds.length,1);assert.equal(JSON.stringify(failed).includes('Signature='),false);
  assert.equal((await s.compose(failed)).status,200);
  assert.equal((await s.call('/jobs/'+failed.id+'/feedback',{feedback:'adopted',reason:'',compositionVersion:1})).status,200);
  assert.equal((await s.call('/jobs/'+failed.id+'/export',{id:'recover-partial-01',outputIndex:0,compositionVersion:1})).status,200);
  const recovered=(await s.call('/jobs/'+failed.id+'/recover',{})).data.job;
  assert.equal(recovered.status,'queued');assert.equal(recovered.nextStep,2);assert.equal(recovered.result.backgrounds.length,2);assert.equal(recovered.result.compositions.length,1);assert.equal(images,2);assert.equal(vision,1);assert.equal(recovered.usage.images,2);
  // Reading state or replaying the recovery endpoint must not execute direction 3.
  await s.call('/jobs/'+failed.id);await s.call('/jobs/'+failed.id+'/recover',{});assert.equal(images,2);
  const complete=(await s.call('/jobs/'+failed.id+'/run',{step:2})).data.job;
  assert.equal(complete.status,'succeeded');assert.equal(complete.result.backgrounds.length,3);assert.equal(complete.result.conceptErrors.length,0);assert.equal(images,3);assert.equal(vision,1);assert.equal(complete.usage.images,3);
  assert.equal((await s.compose(complete)).data.job.result.compositionVersion,2);
 }finally{globalThis.fetch=original;s.env.sqlite.close();}
});

test('product and type stay inside the canvas without intersecting at both supported sizes',()=>{
 for(const h of [1080,1440])for(const layout of ['left','right','center']){
  const {product:p,text:t}=visualFrame(layout,1080,h);
  for(const r of [p,t]){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=1080&&r.y+r.h<=h);}
  assert.ok(p.x>=t.x+t.w||t.x>=p.x+p.w||p.y>=t.y+t.h||t.y>=p.y+p.h);
 }
});
