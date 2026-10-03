import {accountContext,accountHeaders,assertAccountActive,handleAccountError} from './auth.js';
const MAX=12*1024*1024;
export function dataUriFile(value){
 const match=typeof value==='string'&&value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/);
 if(!match||match[2].length>16*1024*1024)throw new Error('图片格式不支持或超过 12 MB。');
 let decoded;try{decoded=atob(match[2]);}catch{throw new Error('图片编码无效，请重新选择图片。');}
 if(!decoded.length||decoded.length>MAX)throw new Error('图片大小超过 12 MB。');
 return new Blob([Uint8Array.from(decoded,c=>c.charCodeAt(0))],{type:match[1]});
}
export function createImageUploader(options={}){
 const context=options.context||accountContext,headers=options.headers||accountHeaders,onError=options.onError||handleAccountError,request=options.fetch||globalThis.fetch;
 const active=options.context?()=>{}:assertAccountActive;
 const pending=new Map();
 async function post(path,body){
  const response=await request('/api/uploads/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...headers()},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
  const value=await response.json();if(!response.ok){const error=Object.assign(new Error(value.error?.message||'图片上传失败，请重试。'),{status:response.status,code:value.error?.code});onError(error);throw error;}active();return value;
 }
 return async function uploadImage(value){
  if(!value||typeof value!=='string'||!value.startsWith('data:'))return value;
  const account=context();if(account.mode==='legacy')return value;
  active();if(!account.user)throw new Error('请先登录后同步图片。');
  const file=dataUriFile(value),bytes=await file.arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes),hash=[...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
  const key=account.user.id+':'+file.type+':'+hash;
  if(!pending.has(key)){
   const transfer=(async()=>{
    const start=await post('start',{hash,size:file.size,contentType:file.type});if(start.assetUrl)return start.assetUrl;
    const upload=options.upload||(await import('/vendor/blob-client.js')).upload;
    await upload(start.pathname,file,{access:'private',contentType:file.type,handleUploadUrl:'/api/uploads/token',clientPayload:JSON.stringify({uploadId:start.uploadId}),headers:headers(),multipart:false});
    for(let retry=0;;retry++){
     try{return (await post('finish',{uploadId:start.uploadId})).assetUrl;}
     catch(error){if(error.code!=='UPLOAD_PENDING'||retry>=3)throw error;await new Promise(resolve=>setTimeout(resolve,400*(retry+1)));}
    }
   })();pending.set(key,transfer);transfer.catch(()=>pending.delete(key));
  }
  const result=await pending.get(key);active();return result;
 };
}
export const uploadImage=createImageUploader();
export async function transformProjectImages(project,upload=uploadImage){
 const copy=structuredClone(project),fields=[[copy,'thumbnail'],[copy.draft,'imageData'],[copy.draft,'backgroundData'],[copy.draft?.quick,'originalImageData']];
 await Promise.all(fields.filter(([object])=>object).map(async([object,key])=>{if(object[key])object[key]=await upload(object[key]);}));return copy;
}
export async function transformCompositionImages(body,upload=uploadImage){
 const copy=structuredClone(body);if(Array.isArray(copy.images))await Promise.all(copy.images.map(async image=>{image.data=await upload(image.data);}));return copy;
}
