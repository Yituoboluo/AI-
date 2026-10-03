import {readFile,writeFile,mkdir,cp,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.join(root,'dist');
await mkdir(path.join(out,'server'),{recursive:true});
await mkdir(path.join(out,'.openai'),{recursive:true});
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.mjs':'text/javascript; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const assets={};
async function walk(dir,base=''){for(const entry of await readdir(dir,{withFileTypes:true})){const rel=base+entry.name,file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file,rel+'/');else{if(/\.(onnx|wasm)$/.test(file))continue;const data=await readFile(file),ext=path.extname(file);assets['/'+rel]={type:types[ext]||'application/octet-stream',base64:ext==='.png',data:ext==='.png'?data.toString('base64'):data.toString('utf8')};}}}
await walk(path.join(root,'public'));
const rules=await readFile(path.join(root,'server/creative-rules.mjs'),'utf8');
const providers=(await readFile(path.join(root,'server/providers.mjs'),'utf8')).replace(/^import .*?;\r?\n/,'');
const telemetry=await readFile(path.join(root,'server/telemetry.mjs'),'utf8');
const langfuse=await readFile(path.join(root,'server/langfuse.mjs'),'utf8');
let api=await readFile(path.join(root,'server/worker.mjs'),'utf8');
api=api.replace(/^import .*?;\r?\n/gm,'').replace(/export default[\s\S]*$/,'');
const modelAssets=await readFile(path.join(root,'server/model-assets.mjs'),'utf8');
const entry=rules+'\n'+providers+'\n'+modelAssets+'\n'+telemetry+'\n'+langfuse+'\n'+api+'\nconst staticAssets='+JSON.stringify(assets)+';\n'+`
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);if(url.pathname.startsWith('/vendor/')){const model=await serveModelAsset(request,env);if(model)return model;}if(url.pathname.startsWith('/api/'))return handleApi(request,env,ctx);
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const asset=staticAssets[url.pathname==='/'?'/index.html':url.pathname];if(!asset)return new Response('Not found',{status:404});
 const body=asset.base64?Uint8Array.from(atob(asset.data),c=>c.charCodeAt(0)):asset.data;
 return new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':asset.type,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'}});
}};`;
await writeFile(path.join(out,'server/index.js'),entry);
await cp(path.join(root,'drizzle'),path.join(out,'.openai/drizzle'),{recursive:true});
await cp(path.join(root,'.openai/hosting.json'),path.join(out,'.openai/hosting.json'));
await import('file:///'+path.join(out,'server/index.js').replaceAll('\\','/'));
console.log('Built Worker with '+Object.keys(assets).length+' assets; '+Math.round(Buffer.byteLength(entry)/1024)+' KB. D1 migrations included.');
