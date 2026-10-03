import {providerStatus,providerEnvironment,generateCopy,generateBackground,generateProductScene,downloadQwenImage,generateCreativePlan,ProviderError} from './providers.mjs';
import {taskIdentity,acceptedTelemetryStatement,telemetryEvent,executionTrace,persistQualityAssets,qualityAssetId,qualityFailure,qualityRoute} from './telemetry.mjs';
import {exportJob,langfuseJobStatus,langfuseConnectionStatus} from './langfuse.mjs';

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
class ApiError extends Error{constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
const now=()=>new Date().toISOString();
const validId=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(v);
const stmt=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const all=async q=>(await q.all()).results||[];
const first=q=>q.first();
async function readJson(request,max=24*1024*1024){if(!request.headers.get('content-type')?.includes('application/json'))fail(415,'JSON_REQUIRED','请求格式需要为 JSON。');const reader=request.body?.getReader();if(!reader)fail(400,'EMPTY_BODY','请求内容为空。');const chunks=[];let size=0;while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>max){await reader.cancel();fail(413,'TOO_LARGE','内容过大，请压缩图片后再保存。');}chunks.push(item.value);}const bytes=new Uint8Array(size);let i=0;for(const b of chunks){bytes.set(b,i);i+=b.length;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'INVALID_JSON','请求格式无效。');}}
function requireUser(request){const user=request.headers.get('oai-authenticated-user-id');if(!user||user.length>200)fail(401,'SIGN_IN_REQUIRED','请登录后使用云端工作区。');return user;}
function checkWrite(request){if(request.method==='GET'||request.method==='HEAD')return;const origin=request.headers.get('origin');if(origin!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')fail(403,'ORIGIN_REJECTED','请从当前工作区执行操作。');}
async function userPrefix(owner){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');}
const assetUrl=key=>key?'/api/assets/'+key:null;
async function putImage(env,owner,value,oldKey=null){if(!value)return null;const prefix=await userPrefix(owner);if(typeof value==='string'&&value.startsWith('/api/assets/')){const key=value.slice(12);if(!key.startsWith(prefix+'/')||!/^[a-f0-9]{64}\/assets\/[a-f0-9]{64}\.(png|jpeg|webp)$/.test(key))fail(400,'INVALID_IMAGE','图片引用不属于当前工作区。');if(!await env.BUCKET.head(key))fail(400,'IMAGE_MISSING','引用的商品图片已不可用，请重新上传。');return key;}if(typeof value!=='string')fail(400,'INVALID_IMAGE','图片格式不正确。');const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);if(!match||match[2].length>16*1024*1024)fail(400,'INVALID_IMAGE','图片过大或格式不支持。');let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{fail(400,'INVALID_IMAGE','图片编码无效。');}const validMagic=match[1]==='png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes[0]===82&&bytes[1]===73&&bytes[2]===70&&bytes[3]===70&&bytes[8]===87&&bytes[9]===69&&bytes[10]===66&&bytes[11]===80;if(!validMagic)fail(400,'INVALID_IMAGE','图片内容与文件类型不一致。');if(bytes.length>12*1024*1024)fail(413,'IMAGE_TOO_LARGE','图片大小超过保存上限。');const digest=await crypto.subtle.digest('SHA-256',bytes);const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');const key=`${prefix}/assets/${hash}.${match[1]}`;if(key!==oldKey)await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:'image/'+match[1]}});return key;}
function cleanQuickSettings(q={}){
 const text=(key,max)=>{const value=q[key]??'';if(typeof value!=='string'||Array.from(value).length>max)fail(400,'INVALID_QUICK_SETTINGS','自定义内容格式或长度不正确。');return value.trim();};
 if(!['square','portrait'].includes(q.ratio||'square')||!['center','right'].includes(q.layout||'center'))fail(400,'INVALID_QUICK_SETTINGS','图片尺寸或排版选项无效。');
 if(q.visualVersion!==undefined&&q.visualVersion!==2)fail(400,'INVALID_QUICK_SETTINGS','创作策略版本无效。');
 const visual=q.visualVersion===2?{visualVersion:2,conceptCount:q.conceptCount??3,category:q.category??'auto',direction:q.direction??'auto'}:{};
 if(visual.visualVersion&&(![1,3].includes(visual.conceptCount)||!['auto','food','electronics','apparel','home','general'].includes(visual.category)||!['auto','scene','studio','graphic'].includes(visual.direction)))fail(400,'INVALID_QUICK_SETTINGS','品类或样稿数量无效。');
 return {...visual,ratio:q.ratio||'square',customBackground:q.customBackground===true,backgroundPrompt:text('backgroundPrompt',500),customCopy:q.customCopy===true,title:text('title',18),subtitle:text('subtitle',40),customLayout:q.customLayout===true,layout:q.layout||'center'};
}
export function cleanDraft(d){if(!d||typeof d!=='object')fail(400,'INVALID_DRAFT','缺少商品资料。');const quick=d.creationMode==='quick'?{creationMode:'quick',quick:{inputId:validId(d.quick?.inputId)?d.quick.inputId:null,settings:cleanQuickSettings(d.quick?.settings),segmentation:['automatic','transparent','original'].includes(d.quick?.segmentation)?d.quick.segmentation:'original'}}:{};const limits={productName:30,sellingPoint:60,campaign:18,headline:18,price:20,originalPrice:20,startDate:10,endDate:10,imageName:200};const out={...quick};for(const [k,max]of Object.entries(limits)){if(typeof d[k]!=='string'||Array.from(d[k]).length>max)fail(400,'INVALID_FIELD','商品字段格式不正确：'+k);out[k]=d[k];}if(!['blue','white','pink'].includes(d.background)||!['airy','focus'].includes(d.template)||!['square','portrait'].includes(d.size)||!Number.isSafeInteger(d.revision)||d.revision<1)fail(400,'INVALID_DRAFT','版式或版本参数无效。');Object.assign(out,{background:d.background,template:d.template,size:d.size,revision:d.revision,approvedRevision:d.approvedRevision===d.revision?d.revision:null,generated:d.generated===true,isExample:d.isExample===true,submitted:d.submitted===true,everApproved:d.everApproved===true,exportedRevision:d.exportedRevision===d.revision?d.revision:null,candidate:Number.isInteger(d.candidate)?d.candidate:-1,copySource:d.copySource==='ai'?'ai':'preset',backgroundSource:d.backgroundSource==='ai'?'ai':'preset',copyJobId:validId(d.copyJobId)?d.copyJobId:null,backgroundJobId:validId(d.backgroundJobId)?d.backgroundJobId:null});out.candidates=Array.isArray(d.candidates)?d.candidates.slice(0,3).map(c=>({tag:String(c.tag||'').slice(0,20),text:String(c.text||'').slice(0,18)})):[];out.history=Array.isArray(d.history)?d.history.slice(0,150).map(h=>({revision:Number(h.revision)||1,action:String(h.action||'').slice(0,200),time:typeof h.time==='string'?h.time.slice(0,40):now()})):[];return out;}
function projectView(row){const draft=JSON.parse(row.draft_json);return {id:row.id,name:row.name,createdAt:row.created_at,updatedAt:row.updated_at,serverVersion:row.version,thumbnail:assetUrl(row.thumbnail_key),deletedAt:draft.deletedAt||null,demoRetired:draft.demoRetired===true,draft:{...draft,imageData:assetUrl(row.image_key),backgroundData:assetUrl(row.background_key)},cloud:true};}
const getProject=(env,owner,id)=>first(stmt(env,'SELECT * FROM projects WHERE id = ? AND owner_id = ?',id,owner));
function pendingImage(row){return row.result_json?JSON.parse(row.result_json).pendingImage:null;}
function recoverable(row){const pending=pendingImage(row);return row.kind==='image'&&row.provider==='千问'&&['failed','interrupted'].includes(row.status)&&Boolean(pending?.url)&&Date.now()-Date.parse(pending.createdAt)<24*60*60*1000&&!['IMAGE_LINK_EXPIRED','IMAGE_REDIRECT_REJECTED','INVALID_IMAGE'].includes(row.error_code);}
function jobView(row){
 const input=JSON.parse(row.input_json),flow=input.flow||'legacy',stored=row.result_json?JSON.parse(row.result_json):null,visual=stored?.quick?.visualVersion===2;
 const result=visual?visualPublicResult(stored):row.status==='succeeded'?(row.kind==='image'?{imageUrl:stored?.imageUrl,...(stored?.quick?{quick:stored.quick,compositions:stored.compositions||[],compositionVersion:stored.compositionVersion||0}:{})}:{candidates:stored?.candidates}):null;
 if(result?.compositions)result.compositions=result.compositions.map((image,index)=>({...image,assetId:qualityAssetId(row.id,result.compositionVersion,index)}));
 return {id:row.id,projectId:row.project_id,taskId:row.task_id||null,parentJobId:row.parent_job_id||null,attemptNo:row.attempt_no||null,environment:row.environment||'legacy',evaluation:row.evaluation_json?JSON.parse(row.evaluation_json):null,workflowVersion:row.workflow_version||null,flow,visualVersion:input.options?.visualVersion||1,nextStep:stored?.nextStep||0,progress:visual?{completed:stored.backgrounds?.length||0,total:stored.quick.concepts.length,active:stored.nextStep||0}:null,stage:row.status==='running'?(stored?.pendingImage?'saving':stored?.quick?'generating':'analyzing'):null,strategySource:stored?.quick?.strategySource||null,kind:row.kind,sourceRevision:row.source_revision,sourceVersion:row.source_version,provider:row.provider,model:row.model,status:row.status,createdAt:row.created_at,startedAt:row.started_at,finishedAt:row.finished_at,result,canRecover:recoverable(row),error:row.error_code?{code:row.error_code,message:row.error_code==='INVALID_PLAN'?'AI 搭配方案返回格式异常，背景尚未生成。商品图片已保留，无需更换图片。':row.error_message}:null,usage:row.usage_json?JSON.parse(row.usage_json):null,feedback:row.feedback,feedbackReason:row.feedback_reason};
}
function validateFacts(d){if(!d.productName.trim()||!d.sellingPoint.trim())fail(400,'FACTS_REQUIRED','请先填写商品名称和已确认卖点。');}
async function saveProject(request,env,owner,id){const input=await readJson(request);if(!validId(id)||input.project?.id!==id)fail(400,'INVALID_ID','创作标识无效。');const existing=await first(stmt(env,'SELECT * FROM projects WHERE id = ?',id));if(existing&&existing.owner_id!==owner)fail(404,'NOT_FOUND','未找到创作。');if(existing&&JSON.parse(existing.draft_json).deletedAt)fail(409,'PROJECT_DELETED','创作已删除，请先从最近删除中恢复。');const expected=Number(input.expectedVersion)||0;if((existing?.version||0)!==expected)fail(409,'VERSION_CONFLICT','云端已有较新修改。本机内容已保留，请另存副本或重新载入云端。');const d=cleanDraft(input.project.draft);if(existing&&JSON.parse(existing.draft_json).demoRetired)d.demoRetired=true;if(existing){const old=JSON.parse(existing.draft_json);const changed=['productName','sellingPoint','campaign','headline','price','originalPrice','startDate','endDate','background','template'].some(k=>old[k]!==d[k]);if(changed&&d.revision<=old.revision)fail(409,'REVISION_CONFLICT','内容版本不连续，请重新载入或另存。');}
  const imageKey=await putImage(env,owner,input.project.draft.imageData,existing?.image_key),backgroundKey=await putImage(env,owner,input.project.draft.backgroundData,existing?.background_key),thumbnailKey=await putImage(env,owner,input.project.thumbnail,existing?.thumbnail_key);if(d.creationMode==='quick')d.quick.originalImageData=assetUrl(await putImage(env,owner,input.project.draft.quick?.originalImageData||input.project.draft.imageData));
  if(existing){const old=JSON.parse(existing.draft_json);const factsChanged=['productName','sellingPoint','campaign','headline','price','originalPrice','startDate','endDate','background','template'].some(k=>old[k]!==d[k]);if(factsChanged||imageKey!==existing.image_key||backgroundKey!==existing.background_key){if(d.revision<=old.revision)fail(409,'REVISION_CONFLICT','素材已变化，请提升版本并重新审核。');d.approvedRevision=null;d.exportedRevision=null;}}
  if(d.approvedRevision!==null&&(!imageKey||!d.productName.trim()||!d.sellingPoint.trim()||!d.campaign.trim()||!d.headline.trim()||!d.generated||!(Number(d.price)>0&&Number(d.price)<=Number(d.originalPrice))||!/^\d{4}-\d{2}-\d{2}$/.test(d.startDate)||!/^\d{4}-\d{2}-\d{2}$/.test(d.endDate)||d.startDate>d.endDate))fail(400,'REVIEW_REQUIRED','基础资料不完整，无法保存为已审核版本。');const stamp=now();let result;if(existing)result=await stmt(env,'UPDATE projects SET name=?, draft_json=?, image_key=?, background_key=?, thumbnail_key=?, version=version+1, updated_at=? WHERE id=? AND owner_id=? AND version=?',d.campaign||'未命名创作',JSON.stringify(d),imageKey,backgroundKey,thumbnailKey,stamp,id,owner,expected).run();else result=await stmt(env,'INSERT OR IGNORE INTO projects (id,owner_id,name,draft_json,image_key,background_key,thumbnail_key,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)',id,owner,d.campaign||'未命名创作',JSON.stringify(d),imageKey,backgroundKey,thumbnailKey,stamp,stamp).run();if(!result.meta.changes)fail(409,'VERSION_CONFLICT','云端版本已变化，本机内容已保留。');return json({project:projectView(await getProject(env,owner,id))});}
// Restore bounded app trial slots affected by the 2026-09-23 incidents.
// This does not refund or hide provider billing; the original failed jobs remain.
async function imageSaveCredits(env,owner,day){
 if(day!=='2026-09-23')return 0;
 const row=await first(stmt(env,"SELECT COUNT(*) AS count FROM generation_jobs WHERE owner_id=? AND kind='image' AND provider='千问' AND status='failed' AND error_code='IMAGE_DOWNLOAD_FAILED' AND error_message='图片已生成，但保存中断。请勿立即重复生成。' AND result_json IS NULL AND usage_json IS NULL AND substr(created_at,1,10)=?",owner,day));
 // One pre-fix analysis failure is eligible. A fixed cutoff and a cap prevent
 // future failures or retries from granting an unlimited paid-call budget.
 const analysis=await first(stmt(env,"SELECT COUNT(*) AS count FROM generation_jobs WHERE owner_id=? AND kind='image' AND provider='千问' AND status='failed' AND error_code='INVALID_PLAN' AND error_message='商品分析未返回可用方案，请调整图片后再试。' AND json_extract(input_json,'$.flow')='quick' AND result_json IS NULL AND usage_json IS NULL AND created_at>=? AND finished_at<=?",owner,day+'T00:00:00.000Z','2026-09-23T12:41:03.891Z'));
 return Math.min(2,row?.count||0)+Math.min(1,analysis?.count||0);
}
function sameJobRequest(job,input){
 const old=JSON.parse(job.input_json),evaluation=input.evaluation?{batchId:input.evaluation.batchId,caseId:input.evaluation.caseId,variant:input.evaluation.variant}:null;
 return (old.flow||'legacy')===(input.flow||'legacy')&&job.project_id===input.projectId&&job.kind===input.kind&&job.source_version===input.sourceVersion&&old.prompt===(input.prompt||'').trim()&&(job.evaluation_json||'null')===JSON.stringify(evaluation);
}
async function createJob(request,env,owner){
 const input=await readJson(request,12000);
 if(!validId(input.id)||!validId(input.projectId)||!['copy','image'].includes(input.kind)||input.prompt!==undefined&&typeof input.prompt!=='string')fail(400,'INVALID_JOB','生成任务参数不正确。');
 const existing=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=?',input.id));
 if(existing){if(existing.owner_id!==owner)fail(404,'NOT_FOUND','任务不存在。');if(!sameJobRequest(existing,input))fail(409,'IDEMPOTENCY_CONFLICT','任务标识已用于不同请求。');return json({job:jobView(existing)},200);}
 const project=await getProject(env,owner,input.projectId);if(!project)fail(404,'NOT_FOUND','请先把当前创作保存到云端。');
 if(project.version!==input.sourceVersion)fail(409,'STALE_SOURCE','商品资料已更新，请保存后重新生成。');
 const facts=JSON.parse(project.draft_json);if(facts.deletedAt)fail(409,'PROJECT_DELETED','该创作已删除，请先恢复。');
 const quick=input.flow==='quick'&&facts.creationMode==='quick';if(quick){if(input.kind!=='image'||!project.image_key)fail(400,'IMAGE_REQUIRED','请先上传商品图片。');}else validateFacts(facts);
 const config=providerStatus(env)[input.kind];if(!config.configured)fail(503,'MODEL_NOT_CONFIGURED',config.provider+' 密钥尚未配置。');if(!config.enabled)fail(403,'BUDGET_NOT_ENABLED','试用调用额度尚未开启。');
 if(quick&&(!env.DASHSCOPE_API_KEY||!['千问','Portdan'].includes(config.provider)))fail(503,'QUICK_NOT_CONFIGURED','图片创作需要已配置的商品分析服务和生图服务。');
 const prompt=(input.prompt||'').trim();if(prompt.length>1500)fail(400,'PROMPT_TOO_LONG','需求描述请控制在 1500 字以内。');
 const identity=await taskIdentity(env,owner,input,project,facts),day=now().slice(0,10),quotaId=owner+':'+day+':'+input.kind,stamp=now();
 if(input.kind==='image'&&!config.unlimited)config.dailyLimit+=await imageSaveCredits(env,owner,day);
 const quotaCost=quick&&facts.quick.settings.visualVersion===2?facts.quick.settings.conceptCount:1;
 const snapshot=JSON.stringify({inputId:validId(facts.quick?.inputId)?facts.quick.inputId:null,facts:{productName:facts.productName,sellingPoint:facts.sellingPoint,campaign:facts.campaign},prompt,...(quick?{flow:'quick',subjectKey:project.image_key,originalKey:facts.quick.originalImageData?.slice(12)||project.image_key,options:cleanQuickSettings(facts.quick.settings),...(facts.quick.settings.visualVersion===2&&config.provider==='Portdan'?{renderRoute:'reference_scene_edit'}:{})}:{})});
 // Keep quota UPDATE and changes()-guarded INSERT adjacent in this atomic batch.
 const results=await env.DB.batch([
  stmt(env,'INSERT OR IGNORE INTO daily_quota (id,owner_id,day,kind,used) VALUES (?,?,?,?,0)',quotaId,owner,day,input.kind),
  stmt(env,"UPDATE daily_quota SET used=used+? WHERE id=? AND (?=1 OR used+?<=?) AND NOT EXISTS (SELECT 1 FROM generation_jobs WHERE id=?) AND (SELECT COUNT(*) FROM generation_jobs WHERE owner_id=? AND status IN ('queued','running'))<2 AND EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=? AND version=?)",quotaCost,quotaId,config.unlimited?1:0,quotaCost,config.dailyLimit||0,input.id,owner,project.id,owner,project.version),
  stmt(env,`INSERT INTO generation_jobs (id,owner_id,project_id,kind,source_revision,source_version,provider,model,status,input_json,created_at,task_id,parent_job_id,attempt_no,input_fingerprint,environment,evaluation_json,workflow_version)
   SELECT ?,?,?,?,?,?,?,?,'queued',?,?,?,(SELECT id FROM generation_jobs WHERE owner_id=? AND task_id=? ORDER BY attempt_no DESC LIMIT 1),(SELECT COALESCE(MAX(attempt_no),0)+1 FROM generation_jobs WHERE owner_id=? AND task_id=?),?,?,?,? WHERE changes()=1`,
   input.id,owner,project.id,input.kind,facts.revision,project.version,config.provider,config.model,snapshot,stamp,identity.taskId,owner,identity.taskId,owner,identity.taskId,identity.fingerprint,identity.environment,identity.evaluation?JSON.stringify(identity.evaluation):null,identity.workflowVersion),
  acceptedTelemetryStatement(env,owner,input.id)
 ]);
 if(!results[2].meta.changes){const duplicate=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',input.id,owner));if(duplicate){if(!sameJobRequest(duplicate,input))fail(409,'IDEMPOTENCY_CONFLICT','任务标识已用于不同请求。');return json({job:jobView(duplicate)});}fail(429,'TRIAL_LIMIT','今日调用次数已用完、资料版本已变化，或已有两个任务进行中。');}
 const job=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',input.id,owner));
 if(job.parent_job_id)await telemetryEvent(env,owner,job,{id:job.id+':retry',name:'retry_requested',stage:'queue',status:'succeeded',data:{parentJobId:job.parent_job_id,attemptNo:job.attempt_no}});
 return json({job:jobView(job)},201);
}
async function expireStaleJobs(env,owner){
 const cutoff=new Date(Date.now()-6*60000).toISOString();
 const expired=await all(stmt(env,"UPDATE generation_jobs SET status='interrupted',error_code='RESULT_UNCONFIRMED',error_message='请求中断或超时，结果尚未确认。再次生成将创建新调用。',finished_at=? WHERE owner_id=? AND ((status='queued' AND json_extract(input_json,'$.options.visualVersion') IS NOT 2 AND COALESCE(started_at,created_at)<?) OR (status='running' AND started_at<?)) RETURNING *",now(),owner,cutoff,cutoff));
 for(const job of expired){
  const last=await first(stmt(env,"SELECT stage,span_id FROM telemetry_events WHERE owner_id=? AND job_id=? AND source='server' AND status='started' ORDER BY received_at DESC,rowid DESC LIMIT 1",owner,job.id));
  const stage=last?.stage||'queue';
  await telemetryEvent(env,owner,job,{id:job.id+':interrupted:'+job.started_at,name:'generation_interrupted',stage,status:'failed',spanId:last?.span_id||null,data:{errorCode:'RESULT_UNCONFIRMED',resultConfirmed:false}});
  await qualityFailure(env,owner,job,stage,'RESULT_UNCONFIRMED',{resultConfirmed:false});
 }
}
function visualStored(job){return job.result_json?JSON.parse(job.result_json):{backgrounds:[],conceptErrors:[],nextStep:0,compositions:[],compositionVersion:0};}
function hasCompositions(result){return result?.quick?.visualVersion===2?Boolean(result.backgrounds?.length&&result.compositions?.length===result.backgrounds.length):result?.compositions?.length===2;}
function visualPublicResult(stored){return {quick:stored.quick,imageUrl:stored.backgrounds?.[0]?.imageUrl||null,backgrounds:stored.backgrounds||[],conceptErrors:stored.conceptErrors||[],nextStep:stored.nextStep||0,compositions:stored.compositions||[],compositionVersion:stored.compositionVersion||0};}
async function runVisualJob(request,env,owner,job){
 const input=await readJson(request,1500),stored=visualStored(job),step=stored.nextStep||0;
 // The step token makes retries of the same HTTP request harmless. Polling is read-only.
 if(!Number.isSafeInteger(input.step)||input.step<0||input.step>2)fail(400,'STEP_REQUIRED','请从图片创作页继续该方向。');
 if(job.status!=='queued'||input.step!==step)return json({job:jobView(job)});
 const project=await getProject(env,owner,job.project_id);
 if(!project||JSON.parse(project.draft_json).deletedAt)fail(409,'PROJECT_DELETED','创作已删除，请先恢复。');
 if(!stored.quick&&project.version!==job.source_version){
  await stmt(env,"UPDATE generation_jobs SET status='failed',error_code='STALE_SOURCE',error_message='商品资料已更新，未调用模型。',finished_at=? WHERE id=? AND owner_id=? AND status='queued' AND result_json IS ?",now(),job.id,owner,job.result_json).run();
  return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});
 }
 if(!providerStatus(providerEnvironment(env,job)).image.enabled)fail(503,'MODEL_NOT_CONFIGURED','这条任务使用的生成服务尚未启用。');
 const startedAt=new Date(Math.max(Date.now(),(Date.parse(job.started_at)||0)+1)).toISOString();
 const locked=await stmt(env,"UPDATE generation_jobs SET status='running',started_at=?,finished_at=NULL WHERE id=? AND owner_id=? AND status='queued' AND result_json IS ? AND EXISTS (SELECT 1 FROM projects WHERE id=generation_jobs.project_id AND owner_id=? AND (?=1 OR version=generation_jobs.source_version) AND json_extract(draft_json,'$.deletedAt') IS NULL)",startedAt,job.id,owner,job.result_json,owner,stored.quick?1:0).run();
 if(!locked.meta.changes)return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});
 return executeVisualStep(env,owner,job,startedAt,false);
}
async function recoverVisualJob(env,owner,job){
 if(['queued','running','succeeded'].includes(job.status))return json({job:jobView(job)});
 if(!recoverable(job))fail(409,'RECOVERY_UNAVAILABLE','没有可恢复的原图片。已完成的样稿会保留。');
 const startedAt=new Date(Math.max(Date.now(),(Date.parse(job.started_at)||0)+1)).toISOString();
 const locked=await stmt(env,"UPDATE generation_jobs SET status='running',started_at=?,finished_at=NULL,error_code=NULL,error_message=NULL WHERE id=? AND owner_id=? AND status IN ('failed','interrupted') AND result_json=? AND started_at IS ? AND EXISTS (SELECT 1 FROM projects WHERE id=generation_jobs.project_id AND owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NULL)",startedAt,job.id,owner,job.result_json,job.started_at,owner).run();
 if(!locked.meta.changes)return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});
 await telemetryEvent(env,owner,job,{name:'recovery_requested',stage:'queue',status:'succeeded',data:{executionId:startedAt,paidGeneration:false}});
 return executeVisualStep(env,owner,job,startedAt,true);
}
async function executeVisualStep(env,owner,job,startedAt,recovery){
 const input=JSON.parse(job.input_json),frozen=providerEnvironment(env,job),state=visualStored(job);
 const trace=executionTrace(env,owner,job,job.id+':'+startedAt+':'+(state.nextStep||0),recovery);
 let usage=JSON.parse(job.usage_json||'{}'),stage='analysis';
 const persist=async(status='running',error=null)=>{
  const saved=await stmt(env,"UPDATE generation_jobs SET status=?,result_json=?,usage_json=?,error_code=?,error_message=?,finished_at=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",status,JSON.stringify(state),JSON.stringify(usage),error?.code||null,error?.message||null,['running','queued'].includes(status)?null:now(),job.id,owner,startedAt).run();
  if(!saved.meta.changes)throw new ProviderError('ATTEMPT_REPLACED','任务状态已变化，请刷新记录。');
 };
 try{
  if(!state.quick){
   await trace.start('plan',{promptVersion:'visual-plan-v2',actualModel:frozen.QWEN_VISION_MODEL||'qwen3-vl-plus'});
   const original=await env.BUCKET.get(input.originalKey);if(!original)throw new ProviderError('IMAGE_MISSING','商品原图无法读取，请重新上传。');
   const bytes=new Uint8Array(await new Response(original.body).arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   const analysis=await generateCreativePlan(frozen,'data:'+(original.httpMetadata?.contentType||'image/png')+';base64,'+btoa(binary),input.options);
   state.quick={...analysis.plan,subjectImageUrl:assetUrl(input.subjectKey),...(input.renderRoute==='reference_scene_edit'?{renderRoute:input.renderRoute,rulesVersion:'category-0.2',productLocks:[],referenceConstraints:analysis.plan.productLocks}: {})};usage={...usage,...analysis.usage};await persist();
   await trace.end('succeeded',{strategySource:analysis.plan.strategySource||'model',rulesVersion:analysis.plan.rulesVersion||null,providerRequestId:analysis.usage?.requestId||null,actualModel:analysis.usage.visionModel,usage:{input_tokens:analysis.usage.visionInputTokens,output_tokens:analysis.usage.visionOutputTokens}});
  }
  const concept=state.quick.concepts[state.nextStep||0];if(!concept)throw new ProviderError('INVALID_PLAN','本组设计方向已处理，请刷新记录。');
  const integrated=state.quick.renderRoute==='reference_scene_edit';let subjectInput;
  if(integrated&&!recovery){
   const subject=await env.BUCKET.get(input.subjectKey);if(!subject)throw new ProviderError('IMAGE_MISSING','商品参考图无法读取，未调用生图模型。请重新上传。');
   subjectInput={subjectBytes:new Uint8Array(await new Response(subject.body).arrayBuffer()),subjectType:subject.httpMetadata?.contentType||'image/png'};
  }
  stage=recovery?'download':'generation';
  if(!recovery){usage.imageCalls=(usage.imageCalls||0)+1;await persist();}
  await trace.start(recovery?'download':'generate',{conceptId:concept.id});
  const checkpoint=async pending=>{await trace.move('checkpoint',{providerRequestId:pending.usage?.requestId||null,conceptId:concept.id});state.pendingImage=pending;state.pendingConceptId=concept.id;stage='download';await persist();await trace.move('download');};
  const value=recovery?await downloadQwenImage(state.pendingImage):integrated?await generateProductScene(frozen,{visualConcept:concept,...subjectInput}):await generateBackground(frozen,{visualConcept:concept,prompt:concept.backgroundPrompt},fetch,checkpoint);
  stage='storage';
  await trace.move('persist',{providerRequestId:value.usage?.requestId||null,conceptId:concept.id});
  if(!(usage.confirmedConcepts||[]).includes(concept.id)){usage.images=(usage.images||0)+(value.usage.images||0);for(const key of ['inputTokens','outputTokens'])if(Number.isFinite(value.usage[key]))usage[key]=(usage[key]||0)+value.usage[key];usage.confirmedConcepts=[...(usage.confirmedConcepts||[]),concept.id];}
  await persist();
  const prefix=await userPrefix(owner),digest=await crypto.subtle.digest('SHA-256',value.bytes),hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),key=`${prefix}/assets/${hash}.png`;
  await env.BUCKET.put(key,value.bytes,{httpMetadata:{contentType:'image/png'}});
  state.backgrounds.push({conceptId:concept.id,imageUrl:assetUrl(key),...(integrated?{renderMode:'integrated'}:{})});state.imageUrl=state.backgrounds[0].imageUrl;
  state.conceptErrors=state.conceptErrors.filter(x=>x.conceptId!==concept.id);
  delete state.pendingImage;delete state.pendingConceptId;state.nextStep=(state.nextStep||0)+1;
  // Adding a recovered background changes the output set; previously saved images
  // remain visible until the client composes the full set again.
  const more=state.nextStep<state.quick.concepts.length;
  await persist(more?'queued':'succeeded');
  await trace.end('succeeded',{conceptId:concept.id});
 }catch(error){
  if(error.code==='ATTEMPT_REPLACED'){await trace.end('cancelled',{errorCode:'ATTEMPT_REPLACED'});return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});}
  if(error.usage)usage={...usage,...error.usage};
  const code=error instanceof ProviderError?error.code:'SAVE_FAILED',message=error instanceof ProviderError?error.message:'本方向结果未能保存，已完成的样稿仍会保留。请勿立即重复生成。';
  const concept=state.quick?.concepts[state.nextStep||0];
  if(!trace.stage)await trace.start(stage==='analysis'?'plan':stage==='storage'?'persist':'generate');
  await trace.end('failed',{errorCode:code,conceptId:concept?.id||null});
  await telemetryEvent(env,owner,job,{name:'generation_failed',stage:stage==='analysis'?'plan':stage==='storage'?'persist':stage,status:'failed',data:{errorCode:code,recovery,conceptId:concept?.id||null}});
  if(concept){state.conceptErrors=state.conceptErrors.filter(x=>x.conceptId!==concept.id);state.conceptErrors.push({conceptId:concept.id,name:concept.name,code,message});}
  const fatal=stage==='analysis'||['PROVIDER_AUTH','PROVIDER_PERMISSION','PROVIDER_BALANCE','PROVIDER_CONFIG','PROVIDER_INPUT','IMAGE_MISSING','PLAN_REJECTED','SAVE_FAILED'].includes(code);
  if(!fatal&&!state.pendingImage)state.nextStep=(state.nextStep||0)+1;
  const more=!fatal&&!state.pendingImage&&state.nextStep<(state.quick?.concepts.length||0);
  const terminal=state.pendingImage?'failed':state.backgrounds.length?'succeeded':['PROVIDER_NETWORK','PROVIDER_TIMEOUT'].includes(code)?'interrupted':'failed';
  console.warn('visual_direction_failed',JSON.stringify({jobId:job.id,code,stage}));
  await persist(more?'queued':terminal,more?null:{code,message});
 }
 return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});
}
async function executeJob(env,owner,job,startedAt,recovery=false){
 let stage=recovery?'download':'model';
 const trace=executionTrace(env,owner,job,job.id+':'+startedAt,recovery);
 try{
  const input=JSON.parse(job.input_json),frozen=providerEnvironment(env,job);
  let result,usage,creative=recovery?JSON.parse(job.result_json).quick:null,planUsage=recovery?(JSON.parse(job.usage_json||'{}')):{};
  if(job.kind==='copy'){
   await trace.start('copy');
   const value=await generateCopy(frozen,input);stage='storage';
   await trace.move('persist',{providerRequestId:value.usage?.requestId||null});
   await stmt(env,"UPDATE generation_jobs SET usage_json=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",JSON.stringify({...planUsage,...value.usage,providerCompleted:true}),job.id,owner,startedAt).run();
   result={candidates:value.candidates};usage=value.usage;
  }else{
   if(input.flow==='quick'&&!recovery){
    await trace.start('plan',{promptVersion:'quick-plan-v1',actualModel:frozen.QWEN_VISION_MODEL||'qwen-vl-plus'});
    stage='analysis';const image=await env.BUCKET.get(input.originalKey);if(!image)throw new ProviderError('IMAGE_MISSING','商品图片无法读取，请重新上传。');
    const bytes=new Uint8Array(await new Response(image.body).arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
    const analyzed=await generateCreativePlan(frozen,'data:'+(image.httpMetadata?.contentType||'image/png')+';base64,'+btoa(binary),input.options);
    creative={...analyzed.plan,subjectImageUrl:assetUrl(input.subjectKey)};planUsage=analyzed.usage;
    const saved=await stmt(env,"UPDATE generation_jobs SET result_json=?,usage_json=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",JSON.stringify({quick:creative}),JSON.stringify(planUsage),job.id,owner,startedAt).run();
    if(!saved.meta.changes)throw new ProviderError('ATTEMPT_REPLACED','任务状态已变化，请刷新记录。');
    input.prompt=creative.backgroundPrompt;
    await trace.end('succeeded',{strategySource:creative.strategySource||'model',actualModel:planUsage.visionModel,usage:{input_tokens:planUsage.visionInputTokens,output_tokens:planUsage.visionOutputTokens}});
   }
   const checkpoint=async pending=>{
    await trace.move('checkpoint',{providerRequestId:pending.usage?.requestId||null});
    stage='checkpoint';
    const saved=await stmt(env,"UPDATE generation_jobs SET result_json=?,usage_json=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",JSON.stringify({pendingImage:pending,...(creative?{quick:creative}:{})}),JSON.stringify({...planUsage,...pending.usage,providerCompleted:true}),job.id,owner,startedAt).run();
    if(!saved.meta.changes)throw new ProviderError('ATTEMPT_REPLACED','此任务的执行状态已变化，请刷新任务状态。');
    stage='download';
    await trace.move('download');
   };
   stage=recovery?'download':'generation';
   await trace.start(recovery?'download':'generate');
   const value=recovery?await downloadQwenImage(pendingImage(job)):await generateBackground(frozen,input,fetch,checkpoint);
   stage='storage';
   await trace.move('persist',{providerRequestId:value.usage?.requestId||null});
   await stmt(env,"UPDATE generation_jobs SET usage_json=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",JSON.stringify({...planUsage,...value.usage,providerCompleted:true}),job.id,owner,startedAt).run();
   const prefix=await userPrefix(owner),digest=await crypto.subtle.digest('SHA-256',value.bytes),hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join(''),key=`${prefix}/assets/${hash}.png`;
   await env.BUCKET.put(key,value.bytes,{httpMetadata:{contentType:'image/png'}});
   result={imageUrl:assetUrl(key),...(creative?{quick:creative,compositions:[],compositionVersion:0}:{})};usage={...planUsage,...value.usage};
  }
  const written=await stmt(env,"UPDATE generation_jobs SET status='succeeded',result_json=?,usage_json=?,error_code=NULL,error_message=NULL,finished_at=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",JSON.stringify(result),JSON.stringify(usage),now(),job.id,owner,startedAt).run();
  await trace.end(written.meta.changes?'succeeded':'cancelled',written.meta.changes?{}:{errorCode:'ATTEMPT_REPLACED'});
 }catch(e){
  if(e.code==='ATTEMPT_REPLACED'){await trace.end('cancelled',{errorCode:e.code});return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});}
  const uncertain=['PROVIDER_TIMEOUT','PROVIDER_NETWORK'].includes(e.code),code=e instanceof ProviderError?e.code:'GENERATION_FAILED';
  await trace.end('failed',{errorCode:code});
  await telemetryEvent(env,owner,job,{name:'generation_failed',stage:trace.stage||stage,status:'failed',data:{errorCode:code,recovery}});
  console.warn('generation_job_failed',JSON.stringify({jobId:job.id,code,stage,recovery}));
  if(e instanceof ProviderError&&e.usage)await stmt(env,"UPDATE generation_jobs SET usage_json=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",JSON.stringify(e.usage),job.id,owner,startedAt).run();
  await stmt(env,"UPDATE generation_jobs SET status=?,error_code=?,error_message=?,finished_at=? WHERE id=? AND owner_id=? AND status='running' AND started_at=?",uncertain?'interrupted':'failed',code,e instanceof ProviderError?e.message:'模型可能已完成调用并产生费用，但结果保存失败。原有素材已保留。',now(),job.id,owner,startedAt).run();
 }
 return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job.id,owner)))});
}
async function runJob(request,env,owner,id){
 const job=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner));
 if(!job)fail(404,'NOT_FOUND','任务不存在。');if(JSON.parse(job.input_json).options?.visualVersion===2)return runVisualJob(request,env,owner,job);if(job.status!=='queued')return json({job:jobView(job)});
 const current=await getProject(env,owner,job.project_id);
 if(!current||JSON.parse(current.draft_json).deletedAt||current.version!==job.source_version){
  await stmt(env,"UPDATE generation_jobs SET status='failed',error_code='STALE_SOURCE',error_message='商品资料已更新，未调用模型。',finished_at=? WHERE id=? AND status='queued'",now(),id).run();
  return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner)))});
 }
 if(!providerStatus(providerEnvironment(env,job))[job.kind].enabled)fail(503,'MODEL_NOT_CONFIGURED','这条任务使用的生成服务尚未启用。');
 const startedAt=now(),start=await stmt(env,"UPDATE generation_jobs SET status='running',started_at=? WHERE id=? AND owner_id=? AND status='queued' AND EXISTS (SELECT 1 FROM projects WHERE id=generation_jobs.project_id AND owner_id=? AND version=generation_jobs.source_version AND json_extract(draft_json,'$.deletedAt') IS NULL)",startedAt,id,owner,owner).run();
 if(!start.meta.changes)return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner)))});
 return executeJob(env,owner,job,startedAt);
}
async function recoverJob(env,owner,id){
 const job=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner));
 if(!job)fail(404,'NOT_FOUND','任务不存在。');
 if(JSON.parse(job.input_json).options?.visualVersion===2)return recoverVisualJob(env,owner,job);
 if(['succeeded','running'].includes(job.status))return json({job:jobView(job)});
 if(!recoverable(job))fail(409,'RECOVERY_UNAVAILABLE','此任务没有可用的原图片下载链接，无法重新保存。重新生成会发起新的模型调用。');
 const startedAt=new Date(Math.max(Date.now(),(Date.parse(job.started_at)||0)+1)).toISOString(),start=await stmt(env,"UPDATE generation_jobs SET status='running',started_at=?,finished_at=NULL,error_code=NULL,error_message=NULL WHERE id=? AND owner_id=? AND kind='image' AND provider='千问' AND status IN ('failed','interrupted') AND result_json=? AND started_at IS ? AND EXISTS (SELECT 1 FROM projects WHERE id=generation_jobs.project_id AND owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NULL)",startedAt,id,owner,job.result_json,job.started_at,owner).run();
 if(!start.meta.changes){const current=await getProject(env,owner,job.project_id);if(!current||JSON.parse(current.draft_json).deletedAt)fail(409,'PROJECT_DELETED','请先恢复该创作，再重新保存图片。');return json({job:jobView(await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner)))});}
 await telemetryEvent(env,owner,job,{name:'recovery_requested',stage:'queue',status:'succeeded',data:{executionId:startedAt,paidGeneration:false}});
 return executeJob(env,owner,job,startedAt,true);
}

async function composeJob(request,env,owner,id){
 const row=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner));
 if(!row)fail(404,'NOT_FOUND','任务不存在。');
 const trace=executionTrace(env,owner,row,crypto.randomUUID());await trace.start('save');
 try{return await composeJobBody(request,env,owner,id,trace);}catch(error){await trace.end(error.status>=400&&error.status<500?'cancelled':'failed',{errorCode:error.code||'COMPOSITION_SAVE_FAILED'});throw error;}
}
async function composeJobBody(request,env,owner,id,trace){
 const job=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner));
 if(!job||!['succeeded','failed','interrupted'].includes(job.status))fail(404,'NOT_FOUND','未找到可合成的创作结果。');
 const result=JSON.parse(job.result_json);if(!result?.quick)fail(400,'INVALID_JOB','此任务不属于快捷图片创作。');
 if(result.quick.visualVersion!==2&&job.status!=='succeeded')fail(404,'NOT_FOUND','未找到可合成的创作结果。');
 const project=await getProject(env,owner,job.project_id);if(!project||JSON.parse(project.draft_json).deletedAt)fail(409,'PROJECT_DELETED','创作已删除，请先恢复。');
 const input=await readJson(request),visual=result.quick.visualVersion===2,expectedCount=visual?result.backgrounds.length:2;
 if(!expectedCount||!Array.isArray(input.images)||input.images.length!==expectedCount)fail(400,'INVALID_COMPOSITION','请保存本组已完成的全部样稿。');
 const images=[];
 for(const item of input.images){
  if(typeof item?.data!=='string'||!item.data.startsWith('data:image/png;base64,'))fail(400,'INVALID_COMPOSITION','成品必须是 PNG 图片。');
  if(typeof item.title!=='string'||Array.from(item.title).length>18||typeof item.subtitle!=='string'||Array.from(item.subtitle).length>40||!(visual?['left','center','right']:['center','right']).includes(item.layout))fail(400,'INVALID_COMPOSITION','成品文字或排版格式不正确。');
  const concept=visual?result.quick.concepts.find(c=>c.id===result.backgrounds[images.length]?.conceptId):null;
  if(visual&&(!concept||item.conceptId!==concept.id||item.layout!==concept.layout))fail(400,'INVALID_COMPOSITION','样稿方向与背景不匹配。');
  images.push({imageUrl:assetUrl(await putImage(env,owner,item.data)),title:item.title,subtitle:item.subtitle,layout:item.layout,...(concept?{conceptId:concept.id,name:concept.name}: {})});
 }
 if(JSON.stringify(images)===JSON.stringify(result.compositions)){await trace.end('succeeded',{unchanged:true});try{await persistQualityAssets(env,owner,job);}catch{console.warn('quality_snapshot_failed');}return json({job:jobView(job)});}
 if(input.expectedVersion!==(result.compositionVersion||0))fail(409,'VERSION_CONFLICT','成品已有新的修改，请刷新记录。');
 const next={...result,compositions:images,compositionVersion:(result.compositionVersion||0)+1};
 const updated=await stmt(env,"UPDATE generation_jobs SET result_json=?,feedback=NULL,feedback_reason=NULL,feedback_at=NULL WHERE id=? AND owner_id=? AND status IN ('succeeded','failed','interrupted') AND result_json=? AND EXISTS (SELECT 1 FROM projects WHERE id=generation_jobs.project_id AND owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NULL)",JSON.stringify(next),id,owner,job.result_json,owner).run();
 if(!updated.meta.changes)fail(409,'VERSION_CONFLICT','创作状态已变化，请刷新记录。');
 await trace.end('succeeded',{compositionVersion:next.compositionVersion,assetCount:images.length});
 try{await persistQualityAssets(env,owner,{...job,result_json:JSON.stringify(next)});}catch{console.warn('quality_snapshot_failed');}
 return json({job:jobView({...job,result_json:JSON.stringify(next),feedback:null,feedback_reason:null,feedback_at:null})});
}
async function recordFeedback(request,env,owner,id){
 const data=await readJson(request,5000);
 if(!['adopted','rejected'].includes(data.feedback)||typeof data.reason!=='string'||Array.from(data.reason).length>500)fail(400,'INVALID_FEEDBACK','请填写有效的采用反馈。');
 const job=await first(stmt(env,"SELECT * FROM generation_jobs WHERE id=? AND owner_id=? AND (status='succeeded' OR (status IN ('failed','interrupted') AND json_extract(result_json,'$.quick.visualVersion')=2))",id,owner));
 if(!job)fail(404,'NOT_FOUND','未找到可反馈的生成结果。');
 const result=JSON.parse(job.result_json),quick=JSON.parse(job.input_json).flow==='quick';
 if(quick){
  if(!hasCompositions(result))fail(409,'COMPOSITION_REQUIRED','请先完成排版并保存成品，再评价效果。');
  if(data.compositionVersion!==result.compositionVersion)fail(409,'VERSION_CONFLICT','这组图已有新的修改，请刷新后重新评价。');
 }
 const updated=await stmt(env,"UPDATE generation_jobs SET feedback=?,feedback_reason=?,feedback_at=? WHERE id=? AND owner_id=? AND status IN ('succeeded','failed','interrupted') AND result_json=? AND EXISTS (SELECT 1 FROM projects WHERE id=generation_jobs.project_id AND owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NULL)",data.feedback,data.reason.trim(),now(),id,owner,job.result_json,owner).run();
 if(!updated.meta.changes)fail(409,'VERSION_CONFLICT','创作状态已变化，请刷新记录后重试。');
  await telemetryEvent(env,owner,job,{name:'group_feedback_saved',stage:'feedback',status:'succeeded',data:{feedback:data.feedback,compositionVersion:result.compositionVersion||0,scope:'group'}});
 return json({saved:true,job:jobView({...job,feedback:data.feedback,feedback_reason:data.reason.trim()})});
}
async function recordQuickExport(request,env,owner,id){
 const input=await readJson(request,1500);
 if(!validId(input.id)||![0,1,2].includes(input.outputIndex)||!Number.isSafeInteger(input.compositionVersion))fail(400,'INVALID_EXPORT','下载记录无效。');
 const job=await first(stmt(env,"SELECT * FROM generation_jobs WHERE id=? AND owner_id=? AND (status='succeeded' OR (status IN ('failed','interrupted') AND json_extract(result_json,'$.quick.visualVersion')=2))",id,owner));
 if(!job)fail(404,'NOT_FOUND','未找到可下载的成品。');
 const result=JSON.parse(job.result_json);if(input.outputIndex>=(result.quick?.visualVersion===2?(result.compositions?.length||result.backgrounds?.length||0):2))fail(400,'INVALID_EXPORT','下载记录无效。');
 const payload={outcome:'quick-download',jobId:id,compositionVersion:input.compositionVersion,outputIndex:input.outputIndex};
 const previous=await first(stmt(env,'SELECT owner_id,project_id,kind,payload_json FROM workspace_events WHERE id=?',input.id));
 if(previous){if(previous.owner_id!==owner||previous.project_id!==job.project_id||previous.kind!=='export'||previous.payload_json!==JSON.stringify(payload))fail(409,'IDEMPOTENCY_CONFLICT','下载记录标识已用于其他操作。');return json({saved:true});}
 if(JSON.parse(job.input_json).flow!=='quick'||!hasCompositions(result))fail(409,'COMPOSITION_REQUIRED','成品尚未保存。');
 if(result.compositionVersion!==input.compositionVersion)fail(409,'VERSION_CONFLICT','这组图已更新，本次下载记录未写入。');
 const saved=await stmt(env,"INSERT OR IGNORE INTO workspace_events (id,owner_id,project_id,kind,revision,payload_json,created_at) SELECT ?,?,?,'export',?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NULL) AND EXISTS (SELECT 1 FROM generation_jobs WHERE id=? AND owner_id=? AND status IN ('succeeded','failed','interrupted') AND result_json=?)",input.id,owner,job.project_id,job.source_revision,JSON.stringify(payload),now(),job.project_id,owner,id,owner,job.result_json).run();
 if(!saved.meta.changes){const duplicate=await first(stmt(env,'SELECT owner_id,payload_json FROM workspace_events WHERE id=?',input.id));if(duplicate?.owner_id!==owner||duplicate.payload_json!==JSON.stringify(payload))fail(409,'VERSION_CONFLICT','创作状态已变化，本次下载记录未写入。');}
 return json({saved:true});
}
async function quickMetrics(env,owner){
 const recent=await all(stmt(env,"SELECT id,status,feedback,result_json FROM generation_jobs WHERE owner_id=? AND json_extract(input_json,'$.flow')='quick' ORDER BY created_at DESC LIMIT 60",owner));
 const exports=await all(stmt(env,"SELECT json_extract(payload_json,'$.jobId') AS jobId,COUNT(*) AS count FROM workspace_events WHERE owner_id=? AND kind='export' AND json_extract(payload_json,'$.outcome')='quick-download' GROUP BY json_extract(payload_json,'$.jobId')",owner));
 const ids=new Set(recent.map(j=>j.id)),downloads=exports.filter(e=>ids.has(e.jobId));
 return {scope:'最近 60 次图片创作；下载记录表示已向浏览器发起下载。',tasks:recent.length,ready:recent.filter(j=>['succeeded','failed','interrupted'].includes(j.status)&&hasCompositions(JSON.parse(j.result_json))).length,adopted:recent.filter(j=>j.feedback==='adopted').length,needsWork:recent.filter(j=>j.feedback==='rejected').length,downloadRequests:downloads.reduce((sum,e)=>sum+e.count,0),downloadedTasks:downloads.length};
}
async function changeTrash(request,env,owner,id){
 const input=await readJson(request,1000);if(typeof input.deleted!=='boolean'||!Number.isSafeInteger(input.expectedVersion))fail(400,'INVALID_STATE','删除状态或版本无效。');
 const row=await getProject(env,owner,id);if(!row)fail(404,'NOT_FOUND','创作不存在。');const d=JSON.parse(row.draft_json);
 if(row.version!==input.expectedVersion){if(row.version===input.expectedVersion+1&&Boolean(d.deletedAt)===input.deleted)return json({project:projectView(row)});fail(409,'VERSION_CONFLICT','云端已有较新修改，请刷新云端后重试。');}
 await expireStaleJobs(env,owner);
 if(input.deleted&&await first(stmt(env,"SELECT id FROM generation_jobs WHERE project_id=? AND owner_id=? AND status IN ('queued','running') LIMIT 1",id,owner)))fail(409,'ACTIVE_JOB','生成任务仍在进行，请结束后删除。');
 d.deletedAt=input.deleted?now():null;d.demoRetired=true;
 const result=await stmt(env,"UPDATE projects SET draft_json=?,version=version+1,updated_at=? WHERE id=? AND owner_id=? AND version=? AND (?=0 OR NOT EXISTS (SELECT 1 FROM generation_jobs WHERE project_id=? AND owner_id=? AND status IN ('queued','running')))",JSON.stringify(d),now(),id,owner,input.expectedVersion,input.deleted?1:0,id,owner).run();
 if(!result.meta.changes)fail(409,'VERSION_CONFLICT','云端版本已变化，请刷新后重试。');return json({project:projectView(await getProject(env,owner,id))});
}

async function handleWorkspaceApi(request,env){try{const owner=requireUser(request);checkWrite(request);if(!env.DB||!env.BUCKET)fail(503,'STORAGE_UNAVAILABLE','云端存储尚未就绪，本机草稿仍可使用。');const path=new URL(request.url).pathname;const method=request.method;
 const lfPath=path.match(/^\/api\/quality\/jobs\/([\w-]+)\/langfuse$/);
 if(lfPath&&method==='GET'){const status=await langfuseJobStatus(env,owner,lfPath[1]);if(status.status==='not_found')fail(404,'NOT_FOUND','任务不存在。');return json(status);}
 if(path==='/api/telemetry'||path.startsWith('/api/quality/'))return json(await qualityRoute(request,env,owner,readJson));if(path==='/api/status'&&method==='GET'){const config=providerStatus(env),day=now().slice(0,10);const used=await all(stmt(env,'SELECT kind,used FROM daily_quota WHERE owner_id=? AND day=?',owner,day));for(const k of ['copy','image'])config[k].usedToday=used.find(x=>x.kind===k)?.used||0;config.image.restoredTrials=await imageSaveCredits(env,owner,day);if(!config.image.unlimited)config.image.dailyLimit+=config.image.restoredTrials;return json({authenticated:true,cloud:true,providers:config,quotaTimezone:'UTC',langfuse:langfuseConnectionStatus(env),features:{copy:true,image:true,video:false,cutout:true,quickCreate:true}});}
  if(path==='/api/projects'&&method==='GET'){
 const rows=await all(stmt(env,"SELECT * FROM projects WHERE owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NULL ORDER BY updated_at DESC LIMIT 100",owner));
 const deleted=await all(stmt(env,"SELECT * FROM projects WHERE owner_id=? AND json_extract(draft_json,'$.deletedAt') IS NOT NULL ORDER BY updated_at DESC",owner));
 return json({projects:[...rows,...deleted].map(projectView)});
 }
 const trash=path.match(/^\/api\/projects\/([a-zA-Z0-9_-]{8,100})\/trash$/);
 if(trash&&method==='POST')return await changeTrash(request,env,owner,trash[1]);
  const project=path.match(/^\/api\/projects\/([a-zA-Z0-9_-]{8,100})$/);if(project){if(method==='PUT')return await saveProject(request,env,owner,project[1]);if(method==='GET'){const row=await getProject(env,owner,project[1]);if(!row)fail(404,'NOT_FOUND','创作不存在。');return json({project:projectView(row)});}}
  if(path.startsWith('/api/assets/')&&method==='GET'){const key=path.slice(12),prefix=await userPrefix(owner);if(!key.startsWith(prefix+'/assets/')||!/^[a-f0-9]{64}\/assets\/[a-f0-9]{64}\.(png|jpeg|webp)$/.test(key))fail(404,'NOT_FOUND','素材不存在。');const obj=await env.BUCKET.get(key);if(!obj)fail(404,'NOT_FOUND','素材不存在。');return new Response(obj.body,{headers:{'Content-Type':obj.httpMetadata?.contentType||'image/png','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'}});}
  if(path==='/api/jobs'){await expireStaleJobs(env,owner);if(method==='POST')return await createJob(request,env,owner);if(method==='GET')return json({jobs:(await all(stmt(env,'SELECT * FROM generation_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 60',owner))).map(jobView)});}
  const job=path.match(/^\/api\/jobs\/([a-zA-Z0-9_-]{8,100})(?:\/(run|recover|compose|feedback|export))?$/);if(job){if(job[2]==='compose'&&method==='POST')return await composeJob(request,env,owner,job[1]);if(job[2]==='recover'&&method==='POST')return await recoverJob(env,owner,job[1]);if(job[2]==='run'&&method==='POST')return await runJob(request,env,owner,job[1]);if(job[2]==='feedback'&&method==='POST')return await recordFeedback(request,env,owner,job[1]);if(job[2]==='export'&&method==='POST')return await recordQuickExport(request,env,owner,job[1]);if(method==='GET'){await expireStaleJobs(env,owner);const row=await first(stmt(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',job[1],owner));if(!row)fail(404,'NOT_FOUND','任务不存在。');return json({job:jobView(row)});}}
  if(path==='/api/events'&&method==='POST'){const e=await readJson(request,6000);if(!validId(e.id)||!validId(e.projectId)||!['edit_session','review','export','adoption'].includes(e.kind)||!Number.isSafeInteger(e.revision))fail(400,'INVALID_EVENT','事件格式无效。');if(!await getProject(env,owner,e.projectId))fail(404,'NOT_FOUND','创作不存在。');const payload={activeSeconds:Math.max(0,Math.min(28800,Number(e.activeSeconds)||0)),outcome:String(e.outcome||'').slice(0,50)};await stmt(env,'INSERT OR IGNORE INTO workspace_events (id,owner_id,project_id,kind,revision,payload_json,created_at) VALUES (?,?,?,?,?,?,?)',e.id,owner,e.projectId,e.kind,e.revision,JSON.stringify(payload),now()).run();return json({saved:true});}
  if(path==='/api/metrics'&&method==='GET'){const jobs=await all(stmt(env,'SELECT status,kind,feedback,COUNT(*) AS count FROM generation_jobs WHERE owner_id=? GROUP BY status,kind,feedback',owner));const sessions=await all(stmt(env,'SELECT kind,payload_json FROM workspace_events WHERE owner_id=? ORDER BY created_at DESC LIMIT 1000',owner));return json({jobs,sessions,quick:await quickMetrics(env,owner),scope:'当前账户实际记录；不代表人工对照提效或投放收益'});}
  fail(404,'NOT_FOUND','接口不存在。');
}catch(e){if(e instanceof ApiError||e?.name==='QualityError')return json({error:{code:e.code,message:e.message}},e.status);console.error('workspace_request_failed',e?.name||'Error');return json({error:{code:'SERVICE_UNAVAILABLE',message:'服务暂时不可用，原有草稿已保留。'}},503);}}
async function exportForRequest(request,env,response){
 try{
  const owner=requireUser(request),path=new URL(request.url).pathname,ids=new Set();
  const direct=path.match(/^\/api\/(?:quality\/)?jobs\/([\w-]+)/);
  if(direct)ids.add(direct[1]);
  else if(path==='/api/jobs'||path==='/api/telemetry'){
   const payload=await response.json();if(payload.job?.id)ids.add(payload.job.id);if(payload.jobId)ids.add(payload.jobId);for(const j of (payload.jobs||[]).slice(0,2))ids.add(j.id);
  }else{
   const linked=path.match(/^\/api\/quality\/(assets|badcases)\/([\w-]+)/);
   if(linked){const table=linked[1]==='assets'?'creative_assets':'quality_badcases';const row=await first(stmt(env,`SELECT job_id FROM ${table} WHERE id=? AND owner_id=?`,linked[2],owner));if(row)ids.add(row.job_id);
    if(linked[1]==='badcases'&&path.endsWith('/regressions')){const target=await first(stmt(env,'SELECT job_id FROM quality_regressions WHERE badcase_id=? AND owner_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',linked[2],owner));if(target)ids.add(target.job_id);}
   }
  }
  await Promise.allSettled([...ids].slice(0,3).map(id=>exportJob(env,owner,id)));
 }catch{console.warn('langfuse_background_export_failed');}
}
export async function handleApi(request,env,ctx){
 const response=await handleWorkspaceApi(request,env);
 const exportable=/^\/api\/(jobs(?:\/|$)|telemetry$|quality\/(jobs|assets|badcases)\/)/.test(new URL(request.url).pathname);
 if(response.ok&&exportable&&langfuseConnectionStatus(env).configured){const work=exportForRequest(request,env,response.clone());if(ctx?.waitUntil)ctx.waitUntil(work);else await work;}
 return response;
}
export default {async fetch(request,env,ctx){if(new URL(request.url).pathname.startsWith('/api/'))return handleApi(request,env,ctx);return new Response('Not found',{status:404});}};
