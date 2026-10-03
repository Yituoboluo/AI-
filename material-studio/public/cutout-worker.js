import * as ort from './vendor/ort-1.22.0/ort.wasm.min.mjs';
ort.env.wasm.numThreads=1;
ort.env.wasm.proxy=false;
ort.env.wasm.wasmPaths=new URL('./vendor/ort-1.22.0/',self.location.href).href;
self.onmessage=async({data})=>{
 try{
  self.postMessage({phase:'loading'});
  const session=await ort.InferenceSession.create(new URL('./vendor/u2netp.onnx',self.location.href).href,{executionProviders:['wasm']});
  self.postMessage({phase:'processing'});
  const output=await session.run({[session.inputNames[0]]:new ort.Tensor('float32',new Float32Array(data.pixels),[1,3,320,320])});
  const mask=new Float32Array(output[session.outputNames[0]].data);
  self.postMessage({phase:'done',mask:mask.buffer},[mask.buffer]);
  await session.release();
 }catch{self.postMessage({phase:'error',message:'自动抠图暂未完成，可重试或改用原图。'});}
};
