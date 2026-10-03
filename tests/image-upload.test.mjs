import test from 'node:test';
import assert from 'node:assert/strict';
import {dataUriFile,transformProjectImages,transformCompositionImages,createImageUploader} from '../public/uploads.js';
const png='data:image/png;base64,iVBORw0KGgo=';
test('network image conversion preserves local draft and shares identical uploads',async()=>{
 const original={id:'project01',thumbnail:png,draft:{imageData:png,backgroundData:null,quick:{originalImageData:png},history:[{action:'unchanged'}]}};
 let transfers=0;const uploader=createImageUploader({context:()=>({mode:'independent',user:{id:'user-a'}}),headers:()=>({'X-Zaowu-Workspace':'user-a'}),onError:()=>{},fetch:async(url)=>Response.json(url.endsWith('/start')?{uploadId:'upload-a',pathname:'stage.png'}:{assetUrl:'/api/assets/owned.png'}),upload:async(path,file,options)=>{transfers++;assert.equal(file.type,'image/png');assert.equal(options.multipart,false);assert.equal(options.headers['X-Zaowu-Workspace'],'user-a');}});
 const network=await transformProjectImages(original,uploader);
 assert.equal(transfers,1);assert.equal(network.draft.imageData,'/api/assets/owned.png');assert.equal(network.draft.quick.originalImageData,network.thumbnail);assert.equal(original.thumbnail,png);assert.deepEqual(network.draft.history,original.draft.history);
});
test('only composition image fields change and legacy requests keep data URIs',async()=>{
 const body={expectedVersion:3,images:[{data:png,conceptId:'scene',title:'标题'}]};
 const copy=await transformCompositionImages(body,async()=>'/api/assets/owned.png');assert.equal(copy.expectedVersion,3);assert.equal(copy.images[0].title,'标题');assert.equal(body.images[0].data,png);
 const legacy=createImageUploader({context:()=>({mode:'legacy'}),fetch:()=>assert.fail('legacy must retain its transport')});assert.equal(await legacy(png),png);
 assert.equal(await legacy('/api/assets/existing.png'),'/api/assets/existing.png');
});
test('failed upload can retry and account errors freeze the account',async()=>{
 let attempt=0,errors=0;const uploader=createImageUploader({context:()=>({mode:'independent',user:{id:'user-a'}}),headers:()=>({}),onError:e=>{errors++;assert.equal(e.code,'WORKSPACE_CHANGED');},fetch:async()=>{if(attempt++===0)return Response.json({error:{code:'WORKSPACE_CHANGED',message:'changed'}},{status:409});return Response.json({assetUrl:'/api/assets/ready.png'});}});
 await assert.rejects(uploader(png),e=>e.status===409);assert.equal(errors,1);assert.equal(await uploader(png),'/api/assets/ready.png');
});
test('image decoding enforces supported type and maximum size before requesting a token',()=>{
 assert.equal(dataUriFile(png).size,8);assert.throws(()=>dataUriFile('data:text/html;base64,aGVsbG8='));assert.throws(()=>dataUriFile('data:image/png;base64,'+'A'.repeat(17*1024*1024)));
});
