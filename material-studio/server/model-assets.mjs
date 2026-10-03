const modelAssets={
 '/vendor/u2netp.onnx':{url:'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',sha:'309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8',size:4574861,type:'application/octet-stream'},
 '/vendor/ort-1.22.0/ort-wasm-simd-threaded.wasm':{url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort-wasm-simd-threaded.wasm',sha:'71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4',size:11210254,type:'application/wasm'}
};
export async function serveModelAsset(request,env){
 const asset=modelAssets[new URL(request.url).pathname];if(!asset)return null;
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const headers={'Content-Type':asset.type,'Cache-Control':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'};
 if(request.method==='HEAD')return new Response(null,{headers});
 const key='runtime-models/'+asset.sha;const cached=await env.BUCKET.get(key);if(cached)return new Response(cached.body,{headers});
 try{
  // Only these pinned public artifacts may be downloaded; callers cannot select a URL.
  const remote=await fetch(asset.url,{redirect:'follow',signal:AbortSignal.timeout(60000)});
  if(!remote.ok||!remote.body)throw new Error('asset unavailable');
  const reader=remote.body.getReader(),chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>asset.size){await reader.cancel();throw new Error('size mismatch');}chunks.push(value);}
  if(length!==asset.size)throw new Error('size mismatch');
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const digest=await crypto.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==asset.sha)throw new Error('integrity mismatch');
  await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:asset.type}});
  return new Response(bytes,{headers});
 }catch{console.warn('cutout_asset_unavailable',asset.sha);return new Response('抠图组件暂时无法载入，请重试。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
}
