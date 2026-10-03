// Account-scoped product telemetry. No prompts, image bytes, keys or provider URLs in events.
const tq=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const ta=async q=>(await q.all()).results||[];
const tj=x=>JSON.parse(x||'null');
const tn=()=>new Date().toISOString();
const tid=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(x);
const T_WORKFLOW='creative-telemetry-v1';
const T_RUBRIC='quality-v1';
class QualityError extends Error{constructor(status,code,message){super(message);this.name='QualityError';Object.assign(this,{status,code});}}
const tf=(status,code,message)=>{throw new QualityError(status,code,message);};
const ttext=(x,n=500)=>typeof x==='string'?x.trim().slice(0,n):'';
async function thash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const tparseJob=row=>({...row,input:tj(row.input_json)||{},result:tj(row.result_json)||{}});
async function tjob(env,owner,id){const row=await tq(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',id,owner).first();if(!row)tf(404,'NOT_FOUND','任务不存在。');return tparseJob(row);}
async function tasset(env,owner,id){const row=await tq(env,'SELECT * FROM creative_assets WHERE id=? AND owner_id=?',id,owner).first();if(!row)tf(404,'NOT_FOUND','图片记录不存在。');return row;}
async function tactive(env,owner,job){const p=await tq(env,'SELECT draft_json FROM projects WHERE id=? AND owner_id=?',job.project_id,owner).first();if(!p||tj(p.draft_json)?.deletedAt)tf(409,'PROJECT_DELETED','创作已删除，请先恢复。');}

export async function taskIdentity(env,owner,input,project,facts){
 let evaluation=input.evaluation===undefined?null:input.evaluation;
 if(evaluation!==null&&(typeof evaluation!=='object'||Array.isArray(evaluation)||!tid(evaluation.batchId)||!['A','B'].includes(evaluation.variant)||!/^C\d{2,3}$/.test(evaluation.caseId||'')))tf(400,'INVALID_EVALUATION','评测需填写批次、用例编号和 A/B 版本。');
 if(evaluation)evaluation={batchId:evaluation.batchId,caseId:evaluation.caseId,variant:evaluation.variant};
 const environment=evaluation?'evaluation':'production';
 const brief=input.flow==='quick'?{image:facts.quick.originalImageData,subject:project.image_key,options:facts.quick.settings}:{image:project.image_key,facts:{productName:facts.productName,sellingPoint:facts.sellingPoint,campaign:facts.campaign,price:facts.price}};
 // Generated titles and cloud save versions are not a new user brief.
 const fingerprint=await thash(JSON.stringify({kind:input.kind,flow:input.flow||'legacy',brief,prompt:(input.prompt||'').trim()}));
 // A and B are independent first attempts within one evaluation case; fingerprint still compares their inputs.
 const taskId='task_'+await thash(JSON.stringify({owner,project:project.id,fingerprint,environment,evaluation}));
 return {taskId,fingerprint,environment,evaluation,workflowVersion:T_WORKFLOW};
}

export const qualityAssetId=(jobId,version,index)=>`asset_${jobId}_v${version}_${index}`;
export function acceptedTelemetryStatement(env,owner,id){
 return tq(env,`INSERT OR IGNORE INTO telemetry_events (id,owner_id,project_id,task_id,job_id,input_revision,trace_id,name,stage,status,source,environment,occurred_at,received_at,data_json)
  SELECT id||':accepted',owner_id,project_id,task_id,id,source_revision,id,'generation_accepted','queue','succeeded','server',environment,created_at,created_at,
  json_object('attemptNo',attempt_no,'parentJobId',parent_job_id,'workflowVersion',workflow_version,'model',model)
  FROM generation_jobs WHERE id=? AND owner_id=?`,id,owner);
}

function telemetryStatement(env,owner,event){
 return tq(env,'INSERT OR IGNORE INTO telemetry_events (id,owner_id,project_id,task_id,job_id,asset_id,asset_version,input_revision,trace_id,span_id,parent_span_id,name,stage,status,duration_ms,source,environment,occurred_at,received_at,data_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
 event.id,owner,event.projectId,event.taskId||null,event.jobId||null,event.assetId||null,event.assetVersion??null,event.inputRevision??null,event.traceId||event.jobId||event.projectId,event.spanId||null,event.parentSpanId||null,event.name,event.stage,event.status,event.durationMs??null,event.source||'server',event.environment||'legacy',event.occurredAt||tn(),event.receivedAt||tn(),JSON.stringify(event.data||{}));
}
export async function telemetryEvent(env,owner,job,details){
 const event={id:details.id||crypto.randomUUID(),projectId:job.project_id,taskId:job.task_id,jobId:job.id,inputRevision:job.source_revision,environment:job.environment||'legacy',...details};
 try{await telemetryStatement(env,owner,event).run();return event;}catch{console.warn('telemetry_write_failed',event.name);return null;}
}
const stageNames={plan:'creative_plan',generate:'image_generation',download:'image_download',persist:'background_persist',compose:'composition',save:'asset_persist',copy:'copy_generation'};
export function executionTrace(env,owner,job,executionId,recovery=false){
 let current=null,previous=job.id;
 return {
  async start(stage,data={}){
   current={stage,spanId:crypto.randomUUID(),parentSpanId:previous,started:Date.now()};
   await telemetryEvent(env,owner,job,{id:`${executionId}:${stage}:${current.spanId}:start`,name:(stageNames[stage]||stage)+'_started',stage,status:'started',spanId:current.spanId,parentSpanId:previous,data:{executionId,recovery,...(['generate','copy'].includes(stage)?{actualModel:job.model}:{}),workflowVersion:job.workflow_version||'legacy',...data}});
  },
  async end(status='succeeded',data={}){
   if(!current)return;const span=current;current=null;previous=span.spanId;
   await telemetryEvent(env,owner,job,{id:`${executionId}:${span.stage}:${span.spanId}:end`,name:(stageNames[span.stage]||span.stage)+'_completed',stage:span.stage,status,spanId:span.spanId,parentSpanId:span.parentSpanId,durationMs:Math.max(0,Date.now()-span.started),data:{executionId,recovery,...data}});
   if(status==='failed')await qualityFailure(env,owner,job,span.stage,data.errorCode||'UNKNOWN',{executionId,spanId:span.spanId,...data});
  },
  async move(stage,data={}){await this.end('succeeded',data);await this.start(stage);},
  get stage(){return current?.stage;}
 };
}

export async function qualityFailure(env,owner,job,stage,code,evidence={}){
 const id='bc_'+await thash([job.id,stage,code,evidence.conceptId||''].join(':'));
 try{await tq(env,"INSERT OR IGNORE INTO quality_badcases (id,owner_id,job_id,kind,stage,code,title,evidence_json,created_at,updated_at) VALUES (?,?,?,'execution',?,?,?,?,?,?)",id,owner,job.id,stage,code,`创作阶段异常 · ${code}`,JSON.stringify({stage,errorCode:code,...evidence}),tn(),tn()).run();}catch{console.warn('badcase_write_failed');}
}

const tdimensions=bytes=>{
 if(bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71)return null;
 const d=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return {width:d.getUint32(16),height:d.getUint32(20)};
};
export async function persistQualityAssets(env,owner,row){
 const job=tparseJob(row),version=job.result.compositionVersion;
 if(!version||!job.result.compositions?.length)return;
 for(const [index,image] of job.result.compositions.entries()){
  const id=qualityAssetId(job.id,version,index),createdAt=tn();
  await tq(env,'INSERT OR IGNORE INTO creative_assets (id,owner_id,job_id,task_id,version,output_index,concept_id,image_url,title,subtitle,layout,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',id,owner,job.id,job.task_id||null,version,index,image.conceptId||null,image.imageUrl,image.title||'',image.subtitle||'',image.layout,JSON.stringify({ratio:job.result.quick.ratio,workflowVersion:job.workflow_version||'legacy',model:job.model,sourceRevision:job.source_revision}),createdAt).run();
  await telemetryEvent(env,owner,job,{id:`${id}:persisted`,assetId:id,assetVersion:version,name:'asset_persisted',stage:'save',status:'succeeded',data:{outputIndex:index,conceptId:image.conceptId||null}});
  await automaticReview(env,owner,job,await tasset(env,owner,id));
 }
}

async function automaticReview(env,owner,job,asset,force=false){
 const existing=await tq(env,"SELECT * FROM quality_reviews WHERE owner_id=? AND asset_id=? AND kind='automatic' AND rubric_version=? ORDER BY created_at DESC,rowid DESC LIMIT 1",owner,asset.id,T_RUBRIC).first();
 if(existing&&!force)return existing;
 let bytes=null;try{const obj=await env.BUCKET.get(asset.image_url.slice(12));if(obj)bytes=new Uint8Array(await new Response(obj.body).arrayBuffer());}catch{}
 const size=bytes?tdimensions(bytes):null,expectedHeight=job.result.quick?.ratio==='portrait'?1440:1080;
 const checks=[
  {code:'FILE_READABLE',label:'文件可读取',passed:Boolean(bytes?.length)},
  {code:'PNG_HEADER',label:'PNG 文件头与尺寸可识别',passed:Boolean(size?.width&&size?.height)},
  {code:'OUTPUT_SIZE',label:`尺寸 1080 × ${expectedHeight}`,passed:Boolean(size?.width===1080&&size?.height===expectedHeight)},
  {code:'COPY_LENGTH',label:'标题与副标题长度',passed:Array.from(asset.title).length<=18&&Array.from(asset.subtitle).length<=40}
 ];
 if(job.input.options?.customCopy&&asset.version===1)checks.push({code:'CUSTOM_COPY',label:'自定义文案一致',passed:asset.title===job.input.options.title&&asset.subtitle===job.input.options.subtitle});
 const passed=checks.every(x=>x.passed),score=Math.round(100*checks.filter(x=>x.passed).length/checks.length),id=force?crypto.randomUUID():'auto_'+asset.id;
 const report={checks,dimensions:size,scope:'文件、尺寸与文本规则；商品一致性、光影与设计感由人工评审',rubricVersion:T_RUBRIC};
 await tq(env,'INSERT OR IGNORE INTO quality_reviews (id,owner_id,job_id,asset_id,kind,rubric_version,passed,score,report_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',id,owner,job.id,asset.id,'automatic',T_RUBRIC,passed?1:0,score,JSON.stringify(report),tn()).run();
 await telemetryEvent(env,owner,job,{id:`${id}:checked`,assetId:asset.id,assetVersion:asset.version,name:'asset_rule_checked',stage:'quality',status:passed?'succeeded':'failed',data:{score,rubricVersion:T_RUBRIC,failedChecks:checks.filter(x=>!x.passed).map(x=>x.code)}});
 if(!passed){const stamp=tn();await tq(env,"INSERT OR IGNORE INTO quality_badcases (id,owner_id,job_id,asset_id,kind,stage,code,title,evidence_json,created_at,updated_at) VALUES (?,?,?,?,'rule','quality','RULE_FAILED','图片规则检查未通过',?,?,?)",'bc_'+asset.id,owner,job.id,asset.id,JSON.stringify({reviewId:id,assetId:asset.id,version:asset.version,checks}),stamp,stamp).run();}
 return {id,passed:passed?1:0,score,report_json:JSON.stringify(report)};
}

async function clientTelemetry(request,env,owner,read){
 const e=await read(request,9000),allowed={product_input_started:'upload',product_input_ready:'upload',product_input_failed:'upload',cutout_completed:'cutout',cutout_started:'cutout',composition_completed:'compose',result_viewed:'display',result_load_failed:'display'};
 if(!tid(e.id)||!tid(e.projectId)||!allowed[e.name]||!['started','succeeded','failed','skipped','cancelled'].includes(e.status)||!Number.isSafeInteger(e.inputRevision)||e.inputRevision<1)tf(400,'INVALID_EVENT','事件格式无效。');
 if(e.durationMs!==undefined&&(!Number.isSafeInteger(e.durationMs)||e.durationMs<0||e.durationMs>86400000))tf(400,'INVALID_DURATION','阶段耗时无效。');
 const project=await tq(env,'SELECT owner_id FROM projects WHERE id=?',e.projectId).first();if(project&&project.owner_id!==owner)tf(404,'NOT_FOUND','创作不存在。');
 let job=null,asset=null;
 if(e.jobId){job=await tjob(env,owner,e.jobId);if(job.project_id!==e.projectId||job.source_revision!==e.inputRevision)tf(409,'VERSION_CONFLICT','任务与输入版本不一致。');}
 if(['composition_completed','result_viewed','result_load_failed'].includes(e.name)&&!job)tf(400,'JOB_REQUIRED','该事件需要任务标识。');
 if(e.name.startsWith('result_')){
  if(e.name==='result_viewed'&&e.status!=='succeeded')tf(400,'INVALID_EVENT','展示事件状态无效。');
  asset=await tasset(env,owner,e.assetId);if(asset.job_id!==job.id||asset.version!==e.assetVersion)tf(409,'VERSION_CONFLICT','图片与任务版本不一致。');
 }
 const receivedAt=tn(),occurredAt=typeof e.occurredAt==='string'&&Number.isFinite(Date.parse(e.occurredAt))?new Date(e.occurredAt).toISOString():receivedAt;
 const data={};for(const key of ['inputId','segmentation','errorCode','modelVersion','compositionVersion','imageHash','width','height'])if(typeof e.data?.[key]==='string'||Number.isSafeInteger(e.data?.[key]))data[key]=typeof e.data[key]==='string'?e.data[key].slice(0,100):e.data[key];
 const normalized={id:e.id,projectId:e.projectId,taskId:job?.task_id,jobId:job?.id,assetId:asset?.id,assetVersion:asset?.version,inputRevision:e.inputRevision,traceId:job?.id||data.inputId||e.projectId,name:e.name,stage:allowed[e.name],status:e.status,durationMs:e.durationMs,source:'client',environment:job?.environment||(e.environment==='evaluation'?'evaluation':'production'),occurredAt,data};
 const payload=JSON.stringify(normalized),old=await tq(env,'SELECT owner_id,data_json FROM telemetry_events WHERE id=?',e.id).first();
 if(old){if(old.owner_id!==owner||tj(old.data_json)?.request!==payload)tf(409,'IDEMPOTENCY_CONFLICT','事件标识已用于其他记录。');return {saved:true,jobId:job?.id||null};}
 if(e.name==='result_viewed')data.acceptedToDisplayMs=Math.max(0,Date.parse(receivedAt)-Date.parse(job.created_at));
 await telemetryStatement(env,owner,{...normalized,receivedAt,data:{...data,request:payload}}).run();
 const stored=await tq(env,'SELECT owner_id,data_json FROM telemetry_events WHERE id=?',e.id).first();
 if(stored?.owner_id!==owner||tj(stored?.data_json)?.request!==payload)tf(409,'IDEMPOTENCY_CONFLICT','事件标识已用于其他记录。');
 return {saved:true,jobId:job?.id||null};
}

function humanRubric(value,decision){
 if(!value)return null;
 const gates={};for(const key of ['facts','requirements','delivery']){if(typeof value.gates?.[key]!=='boolean')tf(400,'REVIEW_REQUIRED','请完成商品、需求和交付检查。');gates[key]=value.gates[key];}
 const scores={};for(const key of ['composition','style','light','text']){const n=value.scores?.[key];if(!Number.isInteger(n)||n<0||n>2)tf(400,'INVALID_SCORE','设计项需评分 0—2。');scores[key]=n;}
 if(!['direct','minor','redo'].includes(value.editLevel))tf(400,'INVALID_REVIEW','请选择修改程度。');
 const minutes=value.editLevel==='minor'?value.editMinutes:0;if(!Number.isInteger(minutes)||minutes<0||minutes>600)tf(400,'INVALID_REVIEW','请填写修改耗时。');
 const total=Object.values(scores).reduce((a,b)=>a+b,0),eligible=Object.values(gates).every(Boolean)&&Object.values(scores).every(x=>x>=1)&&total>=6&&value.editLevel!=='redo'&&minutes<=10;
 if(decision==='adopted'&&!eligible)tf(400,'REVIEW_CONFLICT','评分未满足采用门槛，请调整判定或完成修改后重新评审。');
 return {gates,scores,total,editLevel:value.editLevel,editMinutes:minutes,eligible,adoptable:eligible&&decision==='adopted',rubricVersion:T_RUBRIC};
}

async function saveAssetFeedback(request,env,owner,assetId,read){
 const x=await read(request,8000);if(!tid(x.id)||!['adopted','rejected','revoked'].includes(x.feedback))tf(400,'INVALID_FEEDBACK','反馈格式无效。');
 const asset=await tasset(env,owner,assetId),job=await tjob(env,owner,asset.job_id),review=humanRubric(x.review,x.feedback),reason=ttext(x.reasonCode,60),note=ttext(x.note,800);
 const canonical=JSON.stringify({assetId,feedback:x.feedback,reasonCode:reason,note,review});
 const existing=await tq(env,'SELECT * FROM asset_feedback WHERE id=?',x.id).first();
 if(existing){if(existing.owner_id!==owner||existing.request_json!==canonical)tf(409,'IDEMPOTENCY_CONFLICT','反馈标识已用于其他内容。');return {saved:true,id:x.id};}
 await tactive(env,owner,job);if(asset.version!==job.result.compositionVersion)tf(409,'VERSION_CONFLICT','成品已修改，请评价最新版本。');
 if(review?.adoptable&&(await automaticReview(env,owner,job,asset)).passed!==1)tf(400,'RULE_FAILED','请先处理文件与尺寸规则问题，再判定评测通过。');
 const stamp=tn(),statements=[tq(env,'INSERT OR IGNORE INTO asset_feedback (id,owner_id,asset_id,job_id,task_id,feedback,reason_code,note,created_at,request_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM generation_jobs WHERE id=? AND owner_id=? AND result_json=?)',x.id,owner,asset.id,job.id,job.task_id||null,x.feedback,reason,note,stamp,canonical,job.id,owner,job.result_json)];
 if(review)statements.push(tq(env,"INSERT OR IGNORE INTO quality_reviews (id,owner_id,job_id,asset_id,kind,rubric_version,passed,score,report_json,created_at) SELECT ?,?,?,?,'human',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM asset_feedback WHERE id=? AND owner_id=? AND request_json=?)",'human_'+x.id,owner,job.id,asset.id,T_RUBRIC,review.adoptable?1:0,review.total,JSON.stringify(review),stamp,x.id,owner,canonical));
 if(x.feedback==='rejected')statements.push(tq(env,"INSERT OR IGNORE INTO quality_badcases (id,owner_id,job_id,asset_id,kind,stage,code,title,evidence_json,created_at,updated_at) SELECT ?,?,?,?,'feedback','quality',?,?,?,?,? WHERE EXISTS (SELECT 1 FROM asset_feedback WHERE id=? AND owner_id=? AND request_json=?)",'bc_'+x.id,owner,job.id,asset.id,reason||'USER_REJECTED',reason||'图片未获采用',JSON.stringify({feedbackId:x.id,assetId:asset.id,version:asset.version,note,reviewId:review?'human_'+x.id:null}),stamp,stamp,x.id,owner,canonical));
 await env.DB.batch(statements);
 const saved=await tq(env,'SELECT request_json FROM asset_feedback WHERE id=? AND owner_id=?',x.id,owner).first();if(saved?.request_json!==canonical)tf(409,'VERSION_CONFLICT','图片状态已变化，反馈未保存。');
 const current=await ta(tq(env,'SELECT (SELECT f.feedback FROM asset_feedback f WHERE f.owner_id=a.owner_id AND f.asset_id=a.id ORDER BY f.created_at DESC,f.rowid DESC LIMIT 1) AS feedback FROM creative_assets a WHERE a.owner_id=? AND a.job_id=? AND a.version=?',owner,job.id,asset.version));
 const group=current.some(f=>f.feedback==='adopted')?'adopted':current.some(f=>f.feedback==='rejected')?'rejected':null;
 await tq(env,'UPDATE generation_jobs SET feedback=?,feedback_reason=NULL,feedback_at=? WHERE id=? AND owner_id=? AND result_json=?',group,stamp,job.id,owner,job.result_json).run();
 await telemetryEvent(env,owner,job,{id:x.id+':event',assetId:asset.id,assetVersion:asset.version,name:'asset_feedback_saved',stage:'feedback',status:'succeeded',data:{feedback:x.feedback,reasonCode:reason,rubricVersion:review?T_RUBRIC:null}});
 return {saved:true,id:x.id};
}

function caseView(x){return {...x,evidence:tj(x.evidence_json),evidence_json:undefined};}
async function jobQuality(env,owner,id){
 const job=await tjob(env,owner,id);
 const [events,assets,feedback,reviews,cases]=await Promise.all([
  ta(tq(env,"SELECT * FROM telemetry_events WHERE owner_id=? AND (job_id=? OR (job_id IS NULL AND project_id=? AND json_extract(data_json,'$.inputId')=?)) ORDER BY received_at,rowid LIMIT 1000",owner,id,job.project_id,job.input.inputId||null)),
  ta(tq(env,'SELECT * FROM creative_assets WHERE owner_id=? AND job_id=? ORDER BY version DESC,output_index',owner,id)),
  ta(tq(env,'SELECT id,asset_id,feedback,reason_code,note,created_at FROM asset_feedback WHERE owner_id=? AND job_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1000',owner,id)),
  ta(tq(env,'SELECT * FROM quality_reviews WHERE owner_id=? AND job_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1000',owner,id)),
  ta(tq(env,'SELECT * FROM quality_badcases WHERE owner_id=? AND job_id=? ORDER BY created_at DESC',owner,id))
 ]);
 return {job:{id:job.id,projectId:job.project_id,taskId:job.task_id,attemptNo:job.attempt_no,parentJobId:job.parent_job_id,inputFingerprint:job.input_fingerprint,environment:job.environment,model:job.model,workflowVersion:job.workflow_version,status:job.status,createdAt:job.created_at,evaluation:tj(job.evaluation_json),compositionVersion:job.result.compositionVersion||0,expectedCount:job.input.options?.visualVersion===2?job.input.options.conceptCount:2,hasCompositions:Boolean(job.result.compositions?.length)},
  assets:assets.map(a=>({...a,metadata:tj(a.metadata_json),metadata_json:undefined,current:a.version===job.result.compositionVersion,feedback:feedback.find(f=>f.asset_id===a.id)||null,reviews:reviews.filter(r=>r.asset_id===a.id).map(r=>({...r,report:tj(r.report_json),report_json:undefined}))})),
  feedback,events:events.map(e=>{const data=tj(e.data_json)||{};delete data.request;return {...e,data,data_json:undefined};}),
  reviews:reviews.filter(r=>r.kind==='diversity').map(r=>({...r,report:tj(r.report_json),report_json:undefined})),badcases:cases.map(caseView)};
}

export function qualityWeekStart(date=new Date()){
 const shifted=new Date(date.getTime()+8*3600000),weekday=(shifted.getUTCDay()+6)%7;
 return new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()-weekday)-8*3600000).toISOString();
}
async function qualityOverview(env,owner,url){
 const environment=url.searchParams.get('environment')||'production';if(!['production','evaluation','legacy'].includes(environment))tf(400,'INVALID_SCOPE','数据范围无效。');
 const days=Number(url.searchParams.get('days')||7);if(![7,30,90].includes(days))tf(400,'INVALID_RANGE','时间范围无效。');
 const from=new Date(Date.now()-days*86400000).toISOString(),to=tn();
 const cohort=await ta(tq(env,`SELECT j.id,j.task_id,j.parent_job_id,j.attempt_no,j.model,j.status,j.environment,j.created_at,j.evaluation_json,j.input_fingerprint,
  (SELECT COUNT(*) FROM creative_assets a WHERE a.owner_id=j.owner_id AND a.job_id=j.id AND a.version=1) AS first_asset_count,
  json_extract(j.input_json,'$.options.conceptCount') AS requested_count,
  COALESCE(json_extract(j.result_json,'$.compositionVersion'),0) AS version,
  COALESCE(json_array_length(json_extract(j.result_json,'$.compositions')),0) AS asset_count
  FROM generation_jobs j WHERE j.owner_id=? AND j.environment=? AND j.kind='image' AND json_extract(j.input_json,'$.flow')='quick' AND j.created_at>=? AND j.created_at<=? ORDER BY j.created_at DESC`,owner,environment,from,to));
 const firsts=cohort.filter(j=>j.attempt_no===1);
 const reviewed=await ta(tq(env,`SELECT a.job_id,a.version,a.id,r.passed,
  (SELECT f.feedback FROM asset_feedback f WHERE f.owner_id=a.owner_id AND f.asset_id=a.id ORDER BY f.created_at DESC,f.rowid DESC LIMIT 1) AS feedback
  FROM creative_assets a JOIN quality_reviews r ON r.id=(SELECT r2.id FROM quality_reviews r2 WHERE r2.owner_id=a.owner_id AND r2.asset_id=a.id AND r2.kind='human' ORDER BY r2.created_at DESC,r2.rowid DESC LIMIT 1)
  JOIN generation_jobs j ON j.id=a.job_id AND j.owner_id=a.owner_id WHERE a.owner_id=? AND j.environment=? AND j.created_at>=? AND j.created_at<=?`,owner,environment,from,to));
 const firstAdoptable=firsts.filter(j=>reviewed.some(r=>r.job_id===j.id&&r.version===1&&r.passed===1&&r.feedback==='adopted')).length;
 const pendingReview=firsts.filter(j=>{const initial=reviewed.filter(r=>r.job_id===j.id&&r.version===1);if(initial.some(r=>r.passed===1&&r.feedback==='adopted'))return false;return ['queued','running'].includes(j.status)||j.first_asset_count>initial.length||(!j.first_asset_count&&j.version>1)||(!j.first_asset_count&&j.status==='succeeded'&&Date.now()-Date.parse(j.created_at)<600000);}).length;
 const weekStart=qualityWeekStart(),northstar=await tq(env,`SELECT COUNT(*) AS n FROM (SELECT f.task_id,MIN(f.created_at) AS first_adopted FROM asset_feedback f JOIN generation_jobs j ON j.id=f.job_id AND j.owner_id=f.owner_id JOIN creative_assets a ON a.id=f.asset_id AND a.owner_id=f.owner_id WHERE f.owner_id=? AND j.environment='production' AND f.feedback='adopted' AND f.task_id IS NOT NULL GROUP BY f.task_id HAVING first_adopted>=? AND first_adopted<=?) firsts WHERE EXISTS (SELECT 1 FROM asset_feedback live WHERE live.owner_id=? AND live.task_id=firsts.task_id AND live.feedback='adopted' AND live.id=(SELECT latest.id FROM asset_feedback latest WHERE latest.owner_id=live.owner_id AND latest.asset_id=live.asset_id ORDER BY latest.created_at DESC,latest.rowid DESC LIMIT 1))`,owner,weekStart,to,owner).first();
 const displayed=await ta(tq(env,`SELECT e.job_id,MIN(e.received_at) AS first_view,j.created_at FROM telemetry_events e JOIN generation_jobs j ON j.id=e.job_id AND j.owner_id=e.owner_id WHERE e.owner_id=? AND e.name='result_viewed' AND e.status='succeeded' AND j.environment=? AND j.created_at>=? AND j.created_at<=? GROUP BY e.job_id`,owner,environment,from,to));
 const durations=displayed.map(x=>Math.max(0,Date.parse(x.first_view)-Date.parse(x.created_at))).sort((a,b)=>a-b);
 const percentile=p=>durations.length?durations[Math.max(0,Math.ceil(durations.length*p)-1)]:null;
 const caseCount=await tq(env,"SELECT COUNT(*) AS n FROM quality_badcases b JOIN generation_jobs j ON j.id=b.job_id AND j.owner_id=b.owner_id WHERE b.owner_id=? AND j.environment=? AND b.status!='closed'",owner,environment).first();
 return {scope:{environment,from,to,days,timezone:'Asia/Shanghai',weekStart},summary:{jobs:cohort.length,tasks:new Set(cohort.map(j=>j.task_id).filter(Boolean)).size,legacyTasksUnknown:cohort.filter(j=>!j.task_id).length,retries:cohort.filter(j=>j.attempt_no>1).length,
  savedAssets:cohort.reduce((n,j)=>n+j.asset_count,0),fullyDelivered:cohort.filter(j=>j.asset_count===(j.requested_count||2)).length,
  firstAttempt:{numerator:firstAdoptable,denominator:firsts.length,pending:pendingReview,rate:firsts.length&&!pendingReview?firstAdoptable/firsts.length:null},
  weeklyAdoptedTasks:northstar?.n||0,displaySamples:durations.length,firstResultP50Ms:percentile(.5),firstResultP90Ms:percentile(.9),openBadcases:caseCount?.n||0},
  jobs:cohort.slice(0,100).map(j=>({...j,evaluation:tj(j.evaluation_json),evaluation_json:undefined})),listLimited:cohort.length>100};
}

async function saveDiversity(request,env,owner,id,read){
 const x=await read(request,4000),job=await tjob(env,owner,id);await tactive(env,owner,job);
 if(!tid(x.id)||!Number.isSafeInteger(x.version)||x.version<1||x.version!==job.result.compositionVersion||(job.result.compositions?.length||0)<2||typeof x.passed!=='boolean'||!Array.isArray(x.axes)||x.axes.some(a=>!['scene','composition','palette','hierarchy'].includes(a)))tf(400,'INVALID_DIVERSITY','请基于当前版本的至少两张样稿完成差异评审。');
 const axes=[...new Set(x.axes)].sort();if(x.passed&&axes.length<2)tf(400,'INVALID_DIVERSITY','至少两项实质差异才能判定通过。');
 const report={version:x.version,axes,note:ttext(x.note),passed:x.passed},canonical=JSON.stringify(report);
 const old=await tq(env,'SELECT owner_id,job_id,report_json FROM quality_reviews WHERE id=?',x.id).first();if(old){if(old.owner_id!==owner||old.job_id!==id||old.report_json!==canonical)tf(409,'IDEMPOTENCY_CONFLICT','评审标识冲突。');return {saved:true};}
 await tq(env,"INSERT OR IGNORE INTO quality_reviews (id,owner_id,job_id,kind,rubric_version,passed,report_json,created_at) SELECT ?,?,?,'diversity',?,?,?,? WHERE EXISTS (SELECT 1 FROM generation_jobs WHERE id=? AND owner_id=? AND result_json=?)",x.id,owner,id,T_RUBRIC,x.passed?1:0,canonical,tn(),id,owner,job.result_json).run();
 const saved=await tq(env,'SELECT owner_id,job_id,report_json FROM quality_reviews WHERE id=?',x.id).first();
 if(!saved)tf(409,'VERSION_CONFLICT','成品版本已变化，请刷新后重新评审。');
 if(saved.owner_id!==owner||saved.job_id!==id||saved.report_json!==canonical)tf(409,'IDEMPOTENCY_CONFLICT','评审标识冲突。');
 await telemetryEvent(env,owner,job,{id:x.id+':event',name:'group_diversity_reviewed',stage:'quality',status:x.passed?'succeeded':'failed',data:report});return {saved:true};
}

async function badcaseDetail(env,owner,id){
 const row=await tq(env,'SELECT * FROM quality_badcases WHERE id=? AND owner_id=?',id,owner).first();if(!row)tf(404,'NOT_FOUND','案例不存在。');
 const regressions=await ta(tq(env,'SELECT * FROM quality_regressions WHERE badcase_id=? AND owner_id=? ORDER BY created_at DESC,rowid DESC',id,owner));
 return {badcase:caseView(row),regressions:regressions.map(r=>({...r,report:tj(r.report_json),report_json:undefined,request_json:undefined}))};
}
async function regressionProof(env,owner,jobId,assetId,stage){
 const j=await tjob(env,owner,jobId);
 const feedback=assetId?await tq(env,'SELECT id FROM asset_feedback WHERE owner_id=? AND asset_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',owner,assetId).first():null;
 const reviews=assetId?await ta(tq(env,"SELECT r.id,r.kind FROM quality_reviews r WHERE r.owner_id=? AND r.asset_id=? AND r.kind IN ('human','automatic') AND r.id=(SELECT r2.id FROM quality_reviews r2 WHERE r2.owner_id=r.owner_id AND r2.asset_id=r.asset_id AND r2.kind=r.kind ORDER BY r2.created_at DESC,r2.rowid DESC LIMIT 1) ORDER BY r.kind",owner,assetId)):[];
 const event=await tq(env,"SELECT id FROM telemetry_events WHERE owner_id=? AND job_id=? AND stage=? AND source='server' AND status IN ('succeeded','failed') ORDER BY received_at DESC,rowid DESC LIMIT 1",owner,jobId,stage).first();
 return thash(JSON.stringify({result:j.result_json,status:j.status,feedback:feedback?.id||null,reviews,event:event?.id||null}));
}
async function updateBadcase(request,env,owner,id,read){
 const x=await read(request,6000),{badcase:b}=await badcaseDetail(env,owner,id),hypothesis=ttext(x.hypothesis,1500),fix=ttext(x.fix,1500);
 if(x.version!==b.version||!['open','investigating','closed'].includes(x.status))tf(409,'VERSION_CONFLICT','案例状态已变化，请刷新后重试。');
 if(x.status==='closed'){
  const last=await tq(env,'SELECT * FROM quality_regressions WHERE owner_id=? AND badcase_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',owner,id).first();
  if(!hypothesis||!fix||!last||last.outcome!=='passed'||tj(last.report_json)?.caseVersion!==b.version)tf(409,'REGRESSION_REQUIRED','请先保存归因与改进，并完成当前版本的回归验证。');
  if(hypothesis!==b.hypothesis||fix!==b.fix)tf(409,'REGRESSION_REQUIRED','归因或改进变更后需重新回归。');
  if(tj(last.report_json)?.proof!==await regressionProof(env,owner,last.job_id,last.asset_id,b.stage))tf(409,'REGRESSION_STALE','回归结果或评价已变化，请重新验证。');
 }
 const saved=await tq(env,'UPDATE quality_badcases SET hypothesis=?,fix=?,status=?,version=version+1,updated_at=?,closed_at=? WHERE id=? AND owner_id=? AND version=?',hypothesis,fix,x.status,tn(),x.status==='closed'?tn():null,id,owner,b.version).run();
 if(!saved.meta.changes)tf(409,'VERSION_CONFLICT','案例已有新修改。');return badcaseDetail(env,owner,id);
}
async function regression(request,env,owner,id,read){
 const x=await read(request,4000);if(!tid(x.id)||!tid(x.jobId))tf(400,'INVALID_REGRESSION','请选择回归任务。');
 const canonical=JSON.stringify({badcaseId:id,jobId:x.jobId,assetId:x.assetId||null});
 const old=await tq(env,'SELECT * FROM quality_regressions WHERE id=?',x.id).first();if(old){if(old.owner_id!==owner||old.request_json!==canonical)tf(409,'IDEMPOTENCY_CONFLICT','回归标识冲突。');return {saved:true,outcome:old.outcome,report:tj(old.report_json)};}
 const {badcase:b}=await badcaseDetail(env,owner,id),base=await tjob(env,owner,b.job_id),target=await tjob(env,owner,x.jobId);
 if(!b.hypothesis||!b.fix||b.status==='closed')tf(409,'CASE_NOT_READY','请先保存当前案例的归因与改进。');
 let targetAsset=x.assetId?await tasset(env,owner,x.assetId):null;
 if(targetAsset&&targetAsset.job_id!==target.id)tf(409,'ASSET_CONFLICT','回归图片与任务不一致。');
 const originalAsset=b.asset_id?await tasset(env,owner,b.asset_id):null;
 let newEvidence=target.id!==base.id?Date.parse(target.created_at)>=Date.parse(b.created_at):Boolean(targetAsset&&originalAsset&&targetAsset.version>originalAsset.version);
 const sameInput=Boolean(base.input_fingerprint&&base.input_fingerprint===target.input_fingerprint),sameModel=base.model===target.model;
 const checks=[{label:'相同输入与需求',passed:sameInput},{label:'相同生图模型',passed:sameModel},{label:'采用新的回归结果',passed:newEvidence},{label:'回归为真实任务',passed:['production','evaluation'].includes(target.environment)}];
 if(b.kind==='execution'){
  const stage=await tq(env,"SELECT * FROM telemetry_events WHERE owner_id=? AND job_id=? AND stage=? AND source='server' AND status IN ('succeeded','failed') ORDER BY received_at DESC,rowid DESC LIMIT 1",owner,target.id,b.stage).first();
  if(target.id===base.id){newEvidence=Boolean(stage?.status==='succeeded'&&Date.parse(stage.received_at)>=Date.parse(b.created_at)&&tj(stage.data_json)?.recovery);checks.find(c=>c.label==='采用新的回归结果').passed=newEvidence;
   const repeated=await tq(env,"SELECT COUNT(*) AS n FROM telemetry_events WHERE owner_id=? AND job_id=? AND stage='generate' AND status='started' AND received_at>=? AND (? IS NULL OR json_extract(data_json,'$.conceptId')=?)",owner,target.id,b.created_at,b.evidence.conceptId||null,b.evidence.conceptId||null).first();checks.push({label:'恢复未重复调用原方向生图',passed:repeated.n===0});}
  const requested=target.input.options?.visualVersion===2?target.input.options.conceptCount:2;
  checks.push({label:'异常阶段成功完成',passed:stage?.status==='succeeded'},{label:'全部成品已交付',passed:target.result.compositions?.length===requested});
 }else{
  if(!targetAsset)tf(400,'ASSET_REQUIRED','请选择具体的回归图片。');
  if(targetAsset.version!==target.result.compositionVersion)tf(409,'VERSION_CONFLICT','请选择最新成品版本。');
  const auto=await automaticReview(env,owner,target,targetAsset,true);checks.push({label:'当前规则检查通过',passed:auto.passed===1});
  if(b.kind==='feedback'){
   const human=await tq(env,"SELECT passed FROM quality_reviews WHERE owner_id=? AND asset_id=? AND kind='human' ORDER BY created_at DESC,rowid DESC LIMIT 1",owner,targetAsset.id).first();
   const feedback=await tq(env,'SELECT feedback FROM asset_feedback WHERE owner_id=? AND asset_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1',owner,targetAsset.id).first();
   checks.push({label:'人工评测及采用确认',passed:human?.passed===1&&feedback?.feedback==='adopted'});
  }
 }
 const outcome=checks.every(c=>c.passed)?'passed':'failed',report={checks,caseVersion:b.version,inputFingerprint:target.input_fingerprint,environment:target.environment,model:target.model,workflowVersion:target.workflow_version,assetVersion:targetAsset?.version||null,proof:await regressionProof(env,owner,target.id,targetAsset?.id||null,b.stage)};
 const saved=await tq(env,'INSERT OR IGNORE INTO quality_regressions (id,owner_id,badcase_id,job_id,asset_id,outcome,report_json,request_json,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM quality_badcases WHERE id=? AND owner_id=? AND version=?)',x.id,owner,id,target.id,targetAsset?.id||null,outcome,JSON.stringify(report),canonical,tn(),id,owner,b.version).run();
 if(!saved.meta.changes)tf(409,'VERSION_CONFLICT','案例已变化，请重新验证。');return {saved:true,outcome,report};
}

export async function qualityRoute(request,env,owner,read){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==='/api/quality/identity'&&method==='GET')return {identity:await thash(owner)};
 if(path==='/api/telemetry'&&method==='POST')return clientTelemetry(request,env,owner,read);
 if(path==='/api/quality/overview'&&method==='GET')return qualityOverview(env,owner,url);
 const asset=path.match(/^\/api\/quality\/assets\/([\w-]+)\/feedback$/);if(asset&&method==='POST')return saveAssetFeedback(request,env,owner,asset[1],read);
 const job=path.match(/^\/api\/quality\/jobs\/([\w-]+)(?:\/(check|diversity))?$/);
 if(job){
  if(method==='GET'&&!job[2])return jobQuality(env,owner,job[1]);
  if(method==='POST'&&job[2]==='diversity')return saveDiversity(request,env,owner,job[1],read);
  if(method==='POST'&&job[2]==='check'){const row=await tjob(env,owner,job[1]);await tactive(env,owner,row);await persistQualityAssets(env,owner,row);return jobQuality(env,owner,job[1]);}
 }
 if(path==='/api/quality/badcases'&&method==='GET'){
  const environment=url.searchParams.get('environment')||'production';if(!['production','evaluation','legacy'].includes(environment))tf(400,'INVALID_SCOPE','数据范围无效。');
  return {badcases:(await ta(tq(env,'SELECT b.* FROM quality_badcases b JOIN generation_jobs j ON j.id=b.job_id AND j.owner_id=b.owner_id WHERE b.owner_id=? AND j.environment=? ORDER BY b.created_at DESC LIMIT 200',owner,environment))).map(caseView)};
 }
 const candidates=path.match(/^\/api\/quality\/badcases\/([\w-]+)\/candidates$/);
 if(candidates&&method==='GET'){
  const {badcase:b}=await badcaseDetail(env,owner,candidates[1]),base=await tjob(env,owner,b.job_id);
  const jobs=await ta(tq(env,"SELECT id,model,created_at,attempt_no,environment,evaluation_json FROM generation_jobs WHERE owner_id=? AND input_fingerprint=? AND model=? AND environment IN ('production','evaluation') ORDER BY created_at DESC LIMIT 100",owner,base.input_fingerprint,base.model));
  return {jobs:jobs.map(j=>({...j,evaluation:tj(j.evaluation_json),evaluation_json:undefined}))};
 }
 const bc=path.match(/^\/api\/quality\/badcases\/([\w-]+)(?:\/(regressions))?$/);
 if(bc){if(method==='GET'&&!bc[2])return badcaseDetail(env,owner,bc[1]);if(method==='POST')return bc[2]?regression(request,env,owner,bc[1],read):updateBadcase(request,env,owner,bc[1],read);}
 tf(404,'NOT_FOUND','质量记录接口不存在。');
}

export async function attachAssetSummary(env,owner,view){
 if(!view?.result?.compositions?.length)return view;
 const assets=await ta(tq(env,'SELECT id,version,output_index FROM creative_assets WHERE owner_id=? AND job_id=? AND version=?',owner,view.id,view.result.compositionVersion));
 for(const a of assets){const item=view.result.compositions[a.output_index];if(item)item.assetId=a.id;}
 return view;
}
