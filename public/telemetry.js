import {api} from './cloud.js';
import {accountContext,assertAccountActive} from './auth.js';

let databasePromise,identityPromise,identity=null,flushing=false,retryTimer=null,observer;
const deliveredViews=new Set(),failedViews=new Set();
const database=()=>databasePromise||(databasePromise=new Promise((resolve,reject)=>{
 const account=accountContext(),name=account.mode==='independent'?'zaowu-telemetry-outbox:'+(account.user?.id||'anonymous'):'zaowu-telemetry-outbox';
 const request=indexedDB.open(name,1);
 request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'key'});
 request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
}));
async function storage(action,value){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('pending',action==='getAll'?'readonly':'readwrite'),store=tx.objectStore('pending'),r=action==='getAll'?store.getAll():store[action](value);let result;r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);});}
async function owner(){assertAccountActive();const account=accountContext();if(account.mode==='independent'&&!account.user)throw new Error('登录后记录云端使用情况');if(identity)return identity;if(!identityPromise)identityPromise=api('/quality/identity').then(x=>identity=x.identity).finally(()=>{identityPromise=null;});return identityPromise;}
export async function queueTelemetry(event){
 try{const account=await owner(),body={id:crypto.randomUUID(),occurredAt:new Date().toISOString(),...event};
  await storage('put',{key:account+':'+body.id,owner:account,body});void flushTelemetry();
 }catch{document.dispatchEvent(new CustomEvent('telemetry-status',{detail:{pending:true}}));}
}
export async function flushTelemetry(){
 const session=accountContext();if(flushing||session.frozen||session.mode==='independent'&&!session.user)return;flushing=true;let pending=false;
 try{const account=await owner(),events=(await storage('getAll')).filter(x=>x.owner===account);
  for(const item of events){try{await api('/telemetry',item.body);await storage('delete',item.key);}catch(e){
   if([400,404,409].includes(e.status)&&e.code!=='WORKSPACE_CHANGED'){await storage('delete',item.key);continue;}
   pending=true;break;
  }}
 }catch{pending=true;}finally{flushing=false;try{pending=pending||(await storage('getAll')).some(x=>x.owner===identity);}catch{pending=true;}clearTimeout(retryTimer);if(pending&&!accountContext().frozen)retryTimer=setTimeout(flushTelemetry,15000);document.dispatchEvent(new CustomEvent('telemetry-status',{detail:{pending}}));}
}
window.addEventListener('online',flushTelemetry);
document.addEventListener('account-frozen',()=>{clearTimeout(retryTimer);identity=null;observer?.disconnect();});

export function observeResultTelemetry(root,jobs){
 observer?.disconnect();
 const index=new Map(jobs.map(j=>[j.id,j]));
 const capture=image=>{
  if(document.visibilityState!=='visible'||!image.complete||!image.naturalWidth)return;
  const rect=image.getBoundingClientRect();if(rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)return;
  const job=index.get(image.dataset.viewJob),assetId=image.dataset.viewAsset;
  if(!job||!assetId||!job.taskId||deliveredViews.has(assetId))return;
  deliveredViews.add(assetId);void queueTelemetry({name:'result_viewed',stage:'display',status:'succeeded',projectId:job.projectId,jobId:job.id,inputRevision:job.sourceRevision,assetId,assetVersion:job.result.compositionVersion});
 };
 observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)capture(entry.target);},{threshold:0.5});
 for(const image of root.querySelectorAll('img[data-view-asset]')){
  observer.observe(image);image.addEventListener('load',()=>capture(image),{once:true});
  image.addEventListener('error',()=>{const job=index.get(image.dataset.viewJob),assetId=image.dataset.viewAsset;if(!job?.taskId||!assetId||failedViews.has(assetId))return;failedViews.add(assetId);void queueTelemetry({name:'result_load_failed',status:'failed',projectId:job.projectId,jobId:job.id,inputRevision:job.sourceRevision,assetId,assetVersion:job.result.compositionVersion,data:{errorCode:'IMAGE_LOAD_FAILED'}});},{once:true});
 }
}
