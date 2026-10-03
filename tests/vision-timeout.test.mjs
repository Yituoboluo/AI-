import test from 'node:test';
import assert from 'node:assert/strict';
import {generateCreativePlan} from '../server/providers.mjs';

const options={ratio:'square',customBackground:false,backgroundPrompt:'',customCopy:false,title:'',subtitle:'',customLayout:false,layout:'center'};
const classic={copyStyle:'minimal',backgroundPrompt:'浅灰无缝背景，柔和侧光',layout:'center',textColor:'dark'};
const category={category:'general',confidence:0.8,concepts:[
  {scene:'自然窗边的安静桌面',lighting:'左侧柔和日光',accent:'#936547',title:'让美好走近'},
  {scene:'温暖木纹的材质静物',lighting:'右侧柔和侧光',accent:'#BD864B',title:'日常中的格调'},
  {scene:'米白图形层次背景',lighting:'均匀柔光',accent:'#476682',title:'简约，自有风格'},
]};

function captureDeadlines(t) {
  const original=AbortSignal.timeout,deadlines=new WeakMap();
  // Preserve real AbortSignals; intercept only the clock duration rather than
  // sleeping for a minute or contacting a paid provider.
  t.mock.method(AbortSignal,'timeout',milliseconds=>{const signal=original(milliseconds);deadlines.set(signal,milliseconds);return signal;});
  return deadlines;
}

async function run(configuration,visual,deadlines,{failure=false}={}) {
  let calls=0,deadline;
  const operation=generateCreativePlan({DASHSCOPE_API_KEY:'test-only',...configuration},'data:image/png;base64,test',{...options,...(visual?{visualVersion:2,conceptCount:1}: {})},async(url,init)=>{
    calls++;deadline=deadlines.get(init.signal);assert.ok(init.signal instanceof AbortSignal);assert.equal(init.signal.aborted,false);
    if(failure)throw new DOMException('controlled timeout','TimeoutError');
    const body=JSON.parse(init.body);assert.equal(body.enable_thinking,false);assert.equal(body.stream,false);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(visual?category:classic)}}],usage:{prompt_tokens:20,completion_tokens:10}});
  });
  if(failure)await assert.rejects(operation,{code:'PROVIDER_TIMEOUT'});
  else{const result=await operation;assert.equal(result.usage.visionPlanSource,'model');}
  assert.equal(calls,1,'A different deadline must never introduce another paid call');
  return deadline;
}

test('both vision planning paths keep the default 60-second request deadline',async t=>{
  const deadlines=captureDeadlines(t);
  for(const visual of [false,true])assert.equal(await run({},visual,deadlines),60000);
});

test('both vision planning paths accept a server configured safe 90-second deadline',async t=>{
  const deadlines=captureDeadlines(t);
  for(const visual of [false,true])for(const value of ['90000',90000,'60000','75000'])assert.equal(await run({QWEN_VISION_TIMEOUT_MS:value},visual,deadlines),Number(value));
});

test('invalid or out-of-budget vision deadlines fall back to 60 seconds',async t=>{
  const deadlines=captureDeadlines(t);
  for(const visual of [false,true])for(const value of ['',null,true,{},[],59999,'90001','90000.5','bad',Infinity,Number.MAX_SAFE_INTEGER+1]){
    assert.equal(await run({QWEN_VISION_TIMEOUT_MS:value},visual,deadlines),60000,String(value));
  }
});

test('longer vision deadlines still return uncertain timeout errors without retries',async t=>{
  const deadlines=captureDeadlines(t);
  for(const visual of [false,true])assert.equal(await run({QWEN_VISION_TIMEOUT_MS:'90000'},visual,deadlines,{failure:true}),90000);
});
