import test from 'node:test';
import assert from 'node:assert/strict';
import {generateBackground,providerStatus} from '../server/providers.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1sAAAAASUVORK5CYII=';
const env={IMAGE_PROVIDER:'portdan',PORTDAN_API_KEY:'portdan-test-only',DASHSCOPE_API_KEY:'qwen-test-only',AI_ENABLED:'true',AI_IMAGE_DAILY_LIMIT:'2',AI_COPY_DAILY_LIMIT:'5'};

test('Portdan uses its own credential and the exact Image2.5 model for one inline PNG',async()=>{
 let calls=0;
 const result=await generateBackground(env,{prompt:'浅米色柔光'},async(url,options)=>{
  calls++;assert.equal(url,'https://portdan.com/v1/images/generations');assert.equal(options.headers.Authorization,'Bearer portdan-test-only');assert.equal(options.redirect,'manual');
  const body=JSON.parse(options.body);assert.equal(body.model,'gpt-image-2.5-flare【1k快速1毛】');assert.equal(body.n,1);assert.equal(body.size,'1024x1024');assert.equal(body.response_format,'b64_json');assert.equal(body.output_format,'png');assert.match(body.prompt,/浅米色柔光/);
  return Response.json({data:[{b64_json:png}]});
 });
 assert.equal(calls,1);assert.deepEqual(result.bytes,Uint8Array.from(atob(png),c=>c.charCodeAt(0)));assert.deepEqual(result.usage,{images:1});
 const status=providerStatus(env);assert.equal(status.image.provider,'Portdan');assert.equal(status.copy.provider,'千问');assert.equal(status.image.enabled,true);assert.equal(JSON.stringify(status).includes('test-only'),false);
 assert.equal(providerStatus({...env,PORTDAN_API_KEY:''}).image.configured,false);
});

test('Portdan rejects missing, multiple, malformed, non-PNG and URL-only images without extra calls',async()=>{
 const payloads=[null,{}, {data:[]},{data:[{b64_json:png},{b64_json:png}]},{data:[{b64_json:''}]},{data:[{b64_json:'???='}]},{data:[{b64_json:'YWJj'}]},{data:[{url:'https://untrusted.example/image.png'}]}];
 for(const payload of payloads){let calls=0;await assert.rejects(()=>generateBackground(env,{},async()=>{calls++;return Response.json(payload);}),{code:'INVALID_IMAGE'});assert.equal(calls,1);}
});

test('Portdan rejects oversized response streams before decoding',async()=>{
 let calls=0;
 await assert.rejects(()=>generateBackground(env,{},async()=>{calls++;return new Response(new Uint8Array(16*1024*1024+1));}),{code:'RESULT_TOO_LARGE'});assert.equal(calls,1);
});

test('Portdan errors and timeouts do not retry, fall back, follow redirects or expose upstream details',async()=>{
 for(const [status,code] of [[401,'PROVIDER_AUTH'],[402,'PROVIDER_BALANCE'],[429,'PROVIDER_LIMIT'],[500,'PROVIDER_UNAVAILABLE'],[307,'PROVIDER_UNAVAILABLE']]){
  let calls=0;await assert.rejects(()=>generateBackground(env,{},async(_url,options)=>{calls++;assert.equal(options.redirect,'manual');return new Response('private-provider-debug',{status,headers:{Location:'https://untrusted.example/'}});}),error=>{assert.equal(error.code,code);assert.equal(error.message.includes('private-provider-debug'),false);return true;});assert.equal(calls,1);
 }
 let calls=0;await assert.rejects(()=>generateBackground(env,{},async()=>{calls++;throw new DOMException('private-provider-debug','TimeoutError');}),{code:'PROVIDER_TIMEOUT'});assert.equal(calls,1);
});
