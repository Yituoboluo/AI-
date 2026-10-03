import test from 'node:test';
import assert from 'node:assert/strict';
import {generateProductScene} from '../server/providers.mjs';
import {buildVisualPlan,productScenePrompt} from '../server/creative-rules.mjs';
import {drawVisualCreative} from '../public/visual-layout.js';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=';
const bytes=Uint8Array.from(atob(png),c=>c.charCodeAt(0));
const env={IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'test-portdan-only',DASHSCOPE_API_KEY:'test-qwen-only'};
const concept=(ratio='square')=>buildVisualPlan(null,{category:'food',conceptCount:1,ratio}).concepts[0];

test('scene editing sends the actual product file once, retains the selected model, and never exposes a private asset URL',async()=>{
 for(const ratio of ['square','portrait']){
  let calls=0;
  const result=await generateProductScene(env,{subjectBytes:bytes,subjectType:'image/png',visualConcept:concept(ratio)},async(url,init)=>{
   calls++;assert.equal(url,'https://portdan.com/v1/images/edits');assert.equal(init.redirect,'manual');
   assert.equal(init.headers.Authorization,'Bearer test-portdan-only');assert.equal(init.headers['Content-Type'],undefined);
   assert.ok(init.body instanceof FormData);assert.deepEqual(new Uint8Array(await init.body.get('image').arrayBuffer()),bytes);
   assert.equal(init.body.get('model'),'gpt-image-2.5-flare【1k快速1毛】');assert.equal(init.body.get('n'),'1');
   assert.equal(init.body.get('size'),ratio==='portrait'?'1024x1536':'1024x1024');
   assert.match(init.body.get('prompt'),/接触阴影/);assert.match(init.body.get('prompt'),/品牌标识/);
   assert.doesNotMatch(init.body.get('prompt'),/api\/assets|不要生成要售卖的商品/);
   return Response.json({data:[{b64_json:png}]});
  });
  assert.equal(calls,1);assert.equal(result.renderMode,'integrated');assert.equal(result.usage.images,1);
 }
 assert.match(productScenePrompt({...concept(),category:'apparel'}),/不生成模特/);
});

test('failed fusion never silently switches provider, retries or returns a pasted-on fallback',async()=>{
 for(const status of [400,401,402,403,429,500,307]){
  let calls=0;await assert.rejects(()=>generateProductScene(env,{subjectBytes:bytes,visualConcept:concept()},async()=>{calls++;return new Response('private upstream diagnostics',{status});}),e=>e.code.startsWith('PROVIDER_')&&!e.message.includes('private'));
  assert.equal(calls,1);
 }
 let calls=0;
 await assert.rejects(()=>generateProductScene(env,{subjectBytes:bytes,visualConcept:concept()},async()=>{calls++;throw new DOMException('secret upstream','TimeoutError');}),{code:'PROVIDER_TIMEOUT'});
 assert.equal(calls,1);
 await assert.rejects(()=>generateProductScene({...env,IMAGE_PROVIDER:'qwen'},{subjectBytes:bytes,visualConcept:concept()},()=>{throw Error('must not fetch');}),{code:'PROVIDER_CONFIG'});
 await assert.rejects(()=>generateProductScene(env,{subjectBytes:new Uint8Array(),visualConcept:concept()},()=>{throw Error('must not fetch');}),{code:'IMAGE_MISSING'});
 await assert.rejects(()=>generateProductScene(env,{subjectBytes:bytes,visualConcept:concept()},async()=>Response.json({data:[{url:'https://untrusted.example/image.png'}]})),{code:'INVALID_IMAGE'});
});

test('integrated composition keeps the generated product exactly once and text edits do not add a product overlay or a rectangular veil',()=>{
 const images=[],rects=[],texts=[],background={width:1024,height:1024};
 const context={drawImage:(...args)=>images.push(args),save(){},restore(){},getImageData:()=>({data:new Uint8ClampedArray([230,225,215,255])}),measureText:t=>({width:Array.from(t).length*50}),fillText:(...args)=>texts.push(args),fillRect:(...args)=>rects.push(args)};
 const forbiddenProduct={get width(){throw Error('Do not draw the cutout over an integrated scene');}};
 drawVisualCreative(context,background,forbiddenProduct,concept(),'清晨，刚刚好','',1080,1080,{integrated:true});
 assert.equal(images.length,1);assert.equal(images[0][0],background);assert.ok(texts.length>0);
 assert.ok(rects.every(r=>r[3]<=5),'Only the small accent rule may be drawn, never a text backing rectangle');
});
