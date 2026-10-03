import {randomUUID} from 'node:crypto';
import {handleUpload} from '@vercel/blob/client';
import {createBlobBucket,defaultBlobSdk,blobToken,privateGet,imageBytes,ownerPrefix,IMAGE_TYPES,MAX_IMAGE_BYTES} from './vercel-blob.mjs';

const EXPIRY_MS=15*60*1000;
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const find=(env,id)=>stmt(env,'SELECT * FROM asset_uploads WHERE id=?',id).first();
const assetUrl=row=>'/api/assets/'+row.canonical_key;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});

class UploadError extends Error {
  constructor(status,code,message){super(message);this.status=status;this.code=code;}
}
const fail=(status,code,message)=>{throw new UploadError(status,code,message);};
const invalid=()=>fail(400,'INVALID_UPLOAD','上传信息无效，请重新选择图片。');

async function readJson(request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))invalid();
  const declared=Number(request.headers.get('content-length'));
  if(declared>32*1024)invalid();
  if(!request.body)invalid();
  const reader=request.body.getReader(),parts=[];let size=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>32*1024){await reader.cancel();invalid();}parts.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try {const value=JSON.parse(new TextDecoder().decode(bytes));if(!value || Array.isArray(value) || typeof value!=='object')invalid();return value;}
  catch(error){if(error instanceof UploadError)throw error;invalid();}
}

function requireLive(row) {
  if(row.status!=='pending')fail(409,'UPLOAD_COMPLETED','图片上传已完成。');
  if(row.expires_at<=Date.now())fail(410,'UPLOAD_EXPIRED','上传已过期，请重新选择图片。');
}

function assertRecord(row) {
  const prefix=ownerPrefix(row.owner_id),extension=IMAGE_TYPES[row.content_type];
  if(!ID.test(row.id) || !extension || !/^[a-f0-9]{64}$/.test(row.content_hash) || !Number.isInteger(row.size_bytes) || row.size_bytes<1 || row.size_bytes>MAX_IMAGE_BYTES || row.pathname!==`${prefix}/staging/${row.id}.${extension}` || row.canonical_key!==`${prefix}/assets/${row.content_hash}.${extension}`)invalid();
}

async function readStage(object,row) {
  if(object.statusCode!==200 || !object.stream || object.blob?.pathname!==row.pathname || object.blob.contentType!==row.content_type)invalid();
  if(object.blob.size && object.blob.size!==row.size_bytes)invalid();
  const reader=object.stream.getReader(),parts=[];let size=0;
  try {
    while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>row.size_bytes || size>MAX_IMAGE_BYTES){await reader.cancel();invalid();}parts.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
  try {return imageBytes(bytes,row.content_type,row.content_hash,row.size_bytes);}catch{invalid();}
}

async function cleanStage(sdk,env,row) {
  // Only the registry's server generated stage pathname can be deleted. Completion
  // has already been committed; cleanup failure must not lose the ready asset.
  try {await sdk.del(row.pathname,{token:blobToken(env)});}catch{}
}

async function finalize(env,sdk,row) {
  assertRecord(row);
  if(row.status==='ready'){await cleanStage(sdk,env,row);return assetUrl(row);}
  requireLive(row);
  const object=await privateGet(sdk,env,row.pathname);
  if(!object){const current=await find(env,row.id);if(current?.status==='ready')return assetUrl(current);fail(409,'UPLOAD_PENDING','图片尚未上传完成，请稍后重试。');}
  const bytes=await readStage(object,row);
  await createBlobBucket(env,sdk).put(row.canonical_key,bytes,{httpMetadata:{contentType:row.content_type}});
  await stmt(env,"UPDATE asset_uploads SET status='ready',ready_at=? WHERE id=? AND owner_id=? AND status='pending'",new Date().toISOString(),row.id,row.owner_id).run();
  await cleanStage(sdk,env,row);
  return assetUrl(row);
}

function currentStoreBlob(blob,env,pathname) {
  if(!blob || blob.pathname!==pathname || typeof blob.url!=='string')invalid();
  const store=blobToken(env).split('_')[3];
  if(blob.url!==`https://${store}.private.blob.vercel-storage.com/${pathname}`)invalid();
}

async function verifiedCallback(body,request,env,sdk) {
  const signature=request.headers.get('x-vercel-signature');
  if(!signature || !/^[a-f0-9]{64}$/i.test(signature))fail(403,'INVALID_CALLBACK','上传回调无效。');
  let verified=false;
  try {
    return await sdk.handleUpload({token:blobToken(env),request,body,
      onBeforeGenerateToken:async()=>invalid(),
      onUploadCompleted:async payload=>{
        verified=true;
        let trusted;try{trusted=JSON.parse(payload.tokenPayload);}catch{invalid();}
        if(!trusted || !ID.test(trusted.uploadId) || typeof trusted.ownerId!=='string')invalid();
        const row=await find(env,trusted.uploadId);
        if(!row || row.owner_id!==trusted.ownerId || row.pathname!==trusted.pathname)invalid();
        assertRecord(row);currentStoreBlob(payload.blob,env,row.pathname);
        await finalize(env,sdk,row);
      },
    });
  }catch(error){if(!verified && !(error instanceof UploadError))fail(403,'INVALID_CALLBACK','上传回调无效。');throw error;}
}

export async function uploadRoute(request,env,{authenticate,checkWorkspace},sdkOverrides={}) {
  const url=new URL(request.url),path=url.pathname;
  if(!path.startsWith('/api/uploads/'))return null;
  const sdk={...defaultBlobSdk,handleUpload,...sdkOverrides};
  try {
    if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','请求方法不支持。');
    const body=await readJson(request);
    if(path==='/api/uploads/token' && body.type==='blob.upload-completed')return json(await verifiedCallback(body,request,env,sdk));
    const session=await authenticate(request,env);
    if(!session?.ownerId)fail(401,'SIGN_IN_REQUIRED','请登录后上传图片。');
    await checkWorkspace(request,session);
    if(request.headers.get('origin')!==url.origin || request.headers.get('sec-fetch-site')==='cross-site')fail(403,'INVALID_ORIGIN','请求来源无效。');
    if(!env.DB)fail(503,'STORAGE_UNAVAILABLE','云端存储暂时不可用，请稍后重试。');
    blobToken(env);
    if(path==='/api/uploads/start') {
      const {hash,size,contentType}=body;
      if(typeof hash!=='string' || !/^[a-f0-9]{64}$/.test(hash) || !Number.isInteger(size) || size<1 || size>MAX_IMAGE_BYTES || !Object.hasOwn(IMAGE_TYPES,contentType))invalid();
      const canonical=`${ownerPrefix(session.ownerId)}/assets/${hash}.${IMAGE_TYPES[contentType]}`;
      if(await createBlobBucket(env,sdk).head(canonical))return json({assetUrl:'/api/assets/'+canonical});
      const id=randomUUID(),pathname=`${ownerPrefix(session.ownerId)}/staging/${id}.${IMAGE_TYPES[contentType]}`;
      await stmt(env,"INSERT INTO asset_uploads (id,owner_id,pathname,canonical_key,content_hash,content_type,size_bytes,status,expires_at,created_at) VALUES (?,?,?,?,?,?,?,'pending',?,?)",id,session.ownerId,pathname,canonical,hash,contentType,size,Date.now()+EXPIRY_MS,new Date().toISOString()).run();
      return json({uploadId:id,pathname});
    }
    if(path==='/api/uploads/token') {
      if(body.type!=='blob.generate-client-token' || !body.payload || body.payload.multipart!==false)invalid();
      return json(await sdk.handleUpload({token:blobToken(env),request,body,
        onBeforeGenerateToken:async(pathname,clientPayload)=>{
          let supplied;try{supplied=JSON.parse(clientPayload);}catch{invalid();}
          if(!supplied || !ID.test(supplied.uploadId))invalid();
          const row=await find(env,supplied.uploadId);
          if(!row || row.owner_id!==session.ownerId)fail(404,'UPLOAD_NOT_FOUND','上传记录不存在。');
          assertRecord(row);requireLive(row);if(pathname!==row.pathname)invalid();
          return {allowedContentTypes:[row.content_type],maximumSizeInBytes:row.size_bytes,validUntil:row.expires_at,addRandomSuffix:false,allowOverwrite:false,
            tokenPayload:JSON.stringify({uploadId:row.id,ownerId:row.owner_id,pathname:row.pathname}),callbackUrl:url.origin+'/api/uploads/token'};
        },
        onUploadCompleted:async()=>invalid(),
      }));
    }
    if(path==='/api/uploads/finish') {
      if(!ID.test(body.uploadId))invalid();
      const row=await find(env,body.uploadId);
      if(!row || row.owner_id!==session.ownerId)fail(404,'UPLOAD_NOT_FOUND','上传记录不存在。');
      return json({assetUrl:await finalize(env,sdk,row)});
    }
    fail(404,'NOT_FOUND','上传接口不存在。');
  }catch(error) {
    if(error instanceof UploadError)return json({error:{code:error.code,message:error.message}},error.status);
    if(error?.status===409 && error?.code==='WORKSPACE_CHANGED')return json({error:{code:'WORKSPACE_CHANGED',message:'工作区已变更，请刷新页面后重试。'}},409);
    return json({error:{code:'STORAGE_UNAVAILABLE',message:'云端存储暂时不可用，请稍后重试。'}},503);
  }
}
