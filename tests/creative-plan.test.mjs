import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCreativePlan} from '../server/providers.mjs';

const options={ratio:'square',customBackground:false,backgroundPrompt:'',customCopy:false,title:'',subtitle:'',customLayout:false,layout:'center'};
const plan={copyStyle:'elegant',backgroundPrompt:'浅米白色无缝背景，柔和侧光',layout:'right',textColor:'dark'};
const response=(content,finish_reason='stop',extra={})=>({choices:[{finish_reason,message:{content,...extra}}],usage:{prompt_tokens:200,completion_tokens:50}});
async function run(data,overrides={}){
 let calls=0;
 const value=await generateCreativePlan({DASHSCOPE_API_KEY:'test-only'},'data:image/png;base64,test',{...options,...overrides},async(url,init)=>{
  calls++;const request=JSON.parse(init.body);assert.equal(request.enable_thinking,false);assert.equal(request.response_format.type,'json_object');
  return Response.json(data);
 });
 assert.equal(calls,1,'Parsing must never make a second paid call');return value;
}

test('creative plan accepts complete JSON, a fenced object, and text content parts',async()=>{
 for(const content of [JSON.stringify(plan),'\uFEFF  ```json\n'+JSON.stringify(plan)+'\n```  ',[{type:'text',text:JSON.stringify(plan)}]]){
  const result=await run(response(content));assert.equal(result.plan.strategySource,'model');assert.equal(result.plan.layout,'right');assert.equal(result.plan.title,'光影之间，自有风格');assert.equal(result.usage.visionInputTokens,200);
 }
 const strange=await run(response(JSON.stringify({...plan,copyStyle:{toString:null}})));assert.equal(strange.plan.title,'简约，自有格调');
});

test('invalid or truncated plans use an explicit preset and preserve all user choices and usage',async()=>{
 for(const data of [response(null),response(''),response('not JSON'),response('{"backgroundPrompt":"cut off','length'),response(JSON.stringify(plan),'length'),response('null'),response('[]'),response('{"backgroundPrompt":8}'),response(JSON.stringify({...plan,backgroundPrompt:'长'.repeat(301)})),response('Here is '+JSON.stringify(plan)),response(null,'stop',{reasoning_content:JSON.stringify(plan)})]){
  const result=await run(data,{customBackground:true,backgroundPrompt:'暖杏色渐变',customCopy:true,title:'',subtitle:'用户确认的内容',customLayout:true,layout:'right',ratio:'portrait'});
  assert.equal(result.plan.strategySource,'preset');assert.equal(result.plan.backgroundPrompt,'暖杏色渐变');assert.equal(result.plan.title,'');assert.equal(result.plan.subtitle,'用户确认的内容');assert.equal(result.plan.layout,'right');assert.equal(result.plan.ratio,'portrait');assert.equal(result.usage.visionOutputTokens,50);assert.ok(result.usage.visionPlanFallbackReason);
 }
 const result=await run(response('invalid'));assert.equal(result.plan.title,'简约，自有格调');assert.match(result.plan.backgroundPrompt,/空桌面/);
});

test('provider refusals, auth failures, and uncertain network calls never silently use a preset',async()=>{
 for(const data of [response(null,'content_filter'),response(null,'stop',{refusal:'blocked'}),{error:{message:'private-provider-details'}}])await assert.rejects(()=>run(data),e=>e.code==='PLAN_REJECTED'&&!e.message.includes('private-provider-details'));
 await assert.rejects(()=>generateCreativePlan({DASHSCOPE_API_KEY:'test-only'},'',options,async()=>new Response('private',{status:401})),{code:'PROVIDER_AUTH'});
 await assert.rejects(()=>generateCreativePlan({DASHSCOPE_API_KEY:'test-only'},'',options,async()=>{throw new TypeError('offline');}),{code:'PROVIDER_NETWORK'});
});
