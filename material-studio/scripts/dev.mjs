import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {localStore} from './local-store.mjs';
import {handleApi} from '../server/worker.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{process.loadEnvFile(path.join(root,'.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
// Local previews do not export telemetry unless explicitly enabled by the developer.
process.env.LANGFUSE_ENABLED??='false';
try{process.loadEnvFile(path.join(root,'.local/langfuse.env'));}catch(e){if(e.code!=='ENOENT')throw e;}
await mkdir(path.join(root,'.local'),{recursive:true});
const store=await localStore(root,path.join(root,'.local/workspace.sqlite'),path.join(root,'.local/assets'));
const env={...process.env,...store};
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.mjs':'text/javascript; charset=utf-8','.wasm':'application/wasm','.onnx':'application/octet-stream','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://127.0.0.1:4173');let response;
  if(url.pathname.startsWith('/api/')){
    // This loopback-only development identity is never bundled in the Worker.
    const headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(!key.startsWith('oai-')&&value)headers.set(key,String(value));
    headers.set('oai-authenticated-user-id','local-preview-owner');
    response=await handleApi(new Request(url,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Readable.toWeb(req),duplex:'half'})}),env,{waitUntil(work){void work.catch(()=>console.warn('background_work_failed'));}});
  }else{
    const rel=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1),base=path.join(root,'public'),file=path.resolve(base,rel);
    if(!file.startsWith(base+path.sep))throw new Error('Invalid path');
    response=new Response(await readFile(file),{headers:{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'}});
  }
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){res.writeHead(e.code==='ENOENT'?404:500,{'Content-Type':'text/plain'});res.end('Request unavailable');console.error(e.message);}});
server.listen(4173,'127.0.0.1',()=>console.log('造物营 local preview: http://127.0.0.1:4173 — model calls disabled unless .env explicitly enables them'));
