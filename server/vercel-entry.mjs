import {handleApi} from './worker.mjs';
import {authRoute,authenticateSession,requireWorkspace,AuthError} from './vercel-auth.mjs';
import {uploadRoute} from './vercel-upload.mjs';
import {createRemoteDB} from './vercel-db.mjs';
import {createBlobBucket} from './vercel-blob.mjs';

const json=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
function routedRequest(request){
 const url=new URL(request.url);
 if(url.pathname==='/api/index'&&url.searchParams.has('__path')){
  const route=url.searchParams.get('__path');
  if(!route||route.includes('..')||route.startsWith('/'))throw new AuthError(404,'NOT_FOUND','接口不存在。');
  url.pathname='/api/'+route;url.searchParams.delete('__path');
  return new Request(url,request);
 }
 return request;
}

export function createVercelHandler(environment=process.env,context){
 let remote,bucket;
 const runtime=()=>{
  if(environment.DB&&environment.BUCKET)return environment;
  remote||=createRemoteDB(environment);bucket||=createBlobBucket(environment);
  return {...environment,DB:remote.DB,BUCKET:bucket};
 };
 return async original=>{
  try{
   const request=routedRequest(original),env=runtime();
   const auth=await authRoute(request,env);if(auth)return auth;
   // Blob completion callbacks carry an SDK-verified signature, not a browser
   // cookie. The upload module protects token/finish requests separately.
   const upload=await uploadRoute(request,env,{authenticate:authenticateSession,checkWorkspace:requireWorkspace});
   if(upload)return upload;
   const session=await authenticateSession(request,env);
   if(!session)throw new AuthError(401,'SIGN_IN_REQUIRED','请登录后使用云端工作区。');
   const asset=new URL(request.url).pathname.startsWith('/api/assets/');
   if(!asset)requireWorkspace(request,session);
   const headers=new Headers(request.headers);
   for(const name of [...headers.keys()])if(name.startsWith('oai-'))headers.delete(name);
   headers.set('oai-authenticated-user-id',session.ownerId);
   const response=await handleApi(new Request(request,{headers}),env,context);
   response.headers.set('Cache-Control','private, no-store');
   response.headers.set('X-Content-Type-Options','nosniff');
   return response;
  }catch(error){
   if(error instanceof AuthError)return json({code:error.code,message:error.message},error.status);
   console.error('vercel_request_failed',error?.name||'Error');
   return json({code:'SERVICE_UNAVAILABLE',message:'服务暂不可用，原有草稿已保留。'},503);
  }
 };
}
