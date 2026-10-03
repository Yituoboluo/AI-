// Worker-native Langfuse projection. The product database remains the source of truth.
// No SDK, Node APIs, raw prompts, image bytes, signed URLs, or keys in exported data.
const LF_VERSION = 'zaowu-langfuse-v1';
const lfJson = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || {}; } catch { return {}; } };
const lfNow = () => new Date().toISOString();
const lfQuery = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const lfRows = async query => (await query.all()).results || [];
const lfHash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const lfAttr = (key, value) => ({key, value:{stringValue:typeof value === 'string' ? value : JSON.stringify(value)}});
const lfNs = value => (BigInt(Date.parse(value)) * 1000000n).toString();
const lfIso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const lfText = value => typeof value === 'string' ? value.slice(0, 300).replace(/(?:sk-|pk-lf-)[A-Za-z0-9._\\-]{8,}/g, '[redacted]').replace(/(?:https?:\/\/|data:)[^\s]+/g, '[redacted]') : value;
const lfPick = (value, keys) => Object.fromEntries(keys.filter(key => ['string','number','boolean'].includes(typeof value?.[key])).map(key => [key, lfText(value[key])]));
const lfStageLabels = {plan:'商品分析与创意策略',generate:'图片生成',download:'图片下载',persist:'背景保存',save:'成品保存',compose:'商品合成',copy:'文案生成',checkpoint:'生成结果检查点'};

function lfConfig(env) {
  if (env.LANGFUSE_ENABLED === 'false' || !env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY || !env.LANGFUSE_BASE_URL) return null;
  try {
    const url = new URL(env.LANGFUSE_BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) return null;
    return {base:url.origin, publicKey:env.LANGFUSE_PUBLIC_KEY, secretKey:env.LANGFUSE_SECRET_KEY};
  } catch { return null; }
}

export function langfuseConnectionStatus(env) {
  const config = lfConfig(env);
  return {configured:Boolean(config), host:config ? new URL(config.base).host : null,...(config&&/^[a-zA-Z0-9_-]+$/.test(env.LANGFUSE_PROJECT_ID||'')?{dashboardUrl:config.base+'/project/'+env.LANGFUSE_PROJECT_ID+'/traces'}:{})};
}

// Every item is immutable and has a deterministic ID. Later feedback creates a new item.
export async function projectLangfuseSnapshot(snapshot) {
  const {owner, job} = snapshot;
  if (!owner || !job?.id || job.owner_id !== owner) throw new Error('LANGFUSE_SCOPE_MISMATCH');
  const created = lfIso(job.created_at);
  if (!created) throw new Error('LANGFUSE_INVALID_TIME');
  const traceId = (await lfHash(JSON.stringify(['trace', owner, job.id]))).slice(0,32);
  const spanId = async key => (await lfHash(JSON.stringify([traceId,key]))).slice(0,16);
  const rootSpanId = await spanId('root');
  const userId = (await lfHash(JSON.stringify(['user',owner]))).slice(0,32);
  const environment = ['production','evaluation','integration-test','development','mock'].includes(job.environment) ? job.environment : 'legacy';
  const evaluation = lfPick(lfJson(job.evaluation_json), ['batchId','caseId','variant']);
  const input = lfJson(job.input_json);
  const own = rows => (rows || []).filter(row => row.owner_id === owner && row.job_id === job.id);
  const assets = own(snapshot.assets), assetMap = new Map(assets.map(a => [a.id,a]));
  const events = own(snapshot.events);
  const common = [
    lfAttr('langfuse.trace.name',environment==='integration-test'?'造物营 · 接入验证（无模型调用）':'造物营 · 创意生成'),
    lfAttr('langfuse.user.id',userId),
    lfAttr('langfuse.session.id',job.task_id || job.project_id || traceId),
    lfAttr('langfuse.environment',environment),
    lfAttr('langfuse.version',job.workflow_version || 'legacy'),
    lfAttr('langfuse.release',LF_VERSION),
    lfAttr('langfuse.trace.tags',[environment, 'zaowuying', job.kind || 'unknown']),
    ...Object.entries({job_id:job.id,project_id:job.project_id,task_id:job.task_id,attempt_no:job.attempt_no,parent_job_id:job.parent_job_id,...evaluation}).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>lfAttr('langfuse.trace.metadata.'+k,lfText(v)))
  ];
  const items = [];
  const addSpan = async (key, name, start, end, details = {}) => {
    if (!lfIso(start) || !lfIso(end)) return null;
    const id = await spanId(key);
    const failed = details.status === 'failed';
    const attrs = [...common,
      lfAttr('langfuse.observation.type',details.type || 'span'),
      lfAttr('langfuse.observation.level',failed ? 'ERROR' : details.status === 'cancelled' ? 'WARNING' : 'DEFAULT'),
      ...Object.entries(details.meta || {}).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>lfAttr('langfuse.observation.metadata.'+k,lfText(v)))
    ];
    if (details.input !== undefined) attrs.push(lfAttr('langfuse.observation.input',details.input));
    if (details.output !== undefined) attrs.push(lfAttr('langfuse.observation.output',details.output));
    if (details.errorCode) attrs.push(lfAttr('langfuse.observation.status_message',lfText(details.errorCode)));
    if (details.model) attrs.push(lfAttr('langfuse.observation.model.name',lfText(details.model)));
    if (details.usage) attrs.push(lfAttr('langfuse.observation.usage_details',details.usage));
    const payload = {traceId,spanId:id,...(key==='root'?{}:{parentSpanId:rootSpanId}),name,kind:1,
      startTimeUnixNano:lfNs(start),endTimeUnixNano:lfNs(new Date(Math.max(Date.parse(start),Date.parse(end))).toISOString()),
      attributes:attrs,status:{code:failed?2:1,...(failed?{message:lfText(details.errorCode || 'failed')}: {})}};
    items.push({id:'lf_span_'+id,itemType:'span',occurredAt:lfIso(end),payload});
    return id;
  };
  const addScore = async (key, name, value, dataType, timestamp, assetId, metadata={}) => {
    if (!lfIso(timestamp) || value===undefined || value===null || (assetId && !assetMap.has(assetId))) return;
    if (dataType==='NUMERIC' && !Number.isFinite(value)) return;
    if (dataType==='BOOLEAN' && ![true,false,0,1].includes(value)) return;
    const id = await lfHash(JSON.stringify([traceId,key,name]));
    const asset = assetMap.get(assetId);
    const body = {id:'lf_score_'+id,traceId,observationId:asset ? await spanId('asset:'+asset.id) : rootSpanId,name,value:dataType==='BOOLEAN'?Number(value):value,dataType,environment,
      metadata:{job_id:job.id,...(asset?{asset_id:asset.id,asset_version:asset.version}:{}),...metadata}};
    const payload = {id:'lf_event_'+id,timestamp:lfIso(timestamp),type:'score-create',body};
    items.push({id:payload.id,itemType:'score',occurredAt:payload.timestamp,payload});
  };
  await addSpan('root','创意任务已接收',created,created,{type:'event',meta:{timing_scope:'acceptance_event',input_revision:job.source_revision},input:{kind:job.kind,flow:input.flow || 'legacy',options:lfPick(input.options,['ratio','conceptCount','visualVersion','customBackground','customCopy','customLayout'])}});
  for (const event of events) {
    if (event.status==='started' || event.name==='generation_accepted' || event.name==='asset_persisted') continue;
    const end = lfIso(event.occurred_at);
    if (!end) continue;
    const startEvent = event.span_id && events.find(e => e.span_id===event.span_id && e.status==='started');
    const data = {...lfJson(startEvent?.data_json),...lfJson(event.data_json)};
    const start = lfIso(startEvent?.occurred_at) || new Date(Date.parse(end) - Math.max(0,Number(event.duration_ms)||0)).toISOString();
    const isGeneration = ['plan','generate','copy'].includes(event.stage);
    // Older telemetry put the IMAGE job model on plan spans. Do not claim it is the planner's model.
    const model = data.actualModel || (event.stage==='generate' ? data.model || job.model : event.stage==='copy' && job.kind==='copy' ? data.model || job.model : null);
    const usageSource = data.usage || {};
    const usage = Object.fromEntries(Object.entries({input:usageSource.input_tokens ?? usageSource.prompt_tokens,output:usageSource.output_tokens ?? usageSource.completion_tokens,total:usageSource.total_tokens}).filter(([,v])=>Number.isFinite(v)&&v>=0));
    const output = lfPick(data,['errorCode','strategySource','providerRequestId','conceptId','compositionVersion','assetCount','unchanged','recovery','outputIndex','score','feedback','reasonCode','rubricVersion','width','height','segmentation']);
    await addSpan('event:'+(event.span_id || event.id),lfStageLabels[event.stage] || lfText(event.name),start,end,{type:isGeneration?'generation':event.span_id?'span':'event',status:event.status,model:isGeneration?model:null,usage:isGeneration&&Object.keys(usage).length?usage:null,errorCode:data.errorCode,
      meta:{event_id:event.id,stage:event.stage,source:event.source,asset_id:event.asset_id,asset_version:event.asset_version,...lfPick(data,['executionId','conceptId','promptVersion','rulesVersion','recovery','compositionVersion'])},output});
  }
  for (const asset of assets) {
    await addSpan('asset:'+asset.id,`成品 ${asset.output_index+1} · V${asset.version}`,asset.created_at,asset.created_at,{type:'event',meta:{asset_id:asset.id,asset_version:asset.version,output_index:asset.output_index,concept_id:asset.concept_id},output:{assetId:asset.id,version:asset.version,layout:lfText(asset.layout)}});
  }
  for (const review of own(snapshot.reviews)) {
    const report = lfJson(review.report_json);
    const metadata = {review_id:review.id,rubric_version:review.rubric_version,source:review.kind};
    if (review.kind==='automatic') {
      await addScore(review.id,'rule_pass',review.passed,'BOOLEAN',review.created_at,review.asset_id,metadata);
      await addScore(review.id,'rule_score',review.score,'NUMERIC',review.created_at,review.asset_id,{...metadata,scale:'0-100',scope:'file_size_copy_rules_only'});
    } else if (review.kind==='human') {
      await addScore(review.id,'design_total',review.score,'NUMERIC',review.created_at,review.asset_id,{...metadata,scale:'0-8'});
      await addScore(review.id,'human_adoptable',review.passed,'BOOLEAN',review.created_at,review.asset_id,metadata);
      for (const key of ['facts','requirements','delivery']) await addScore(review.id,'gate_'+key,report.gates?.[key],'BOOLEAN',review.created_at,review.asset_id,metadata);
      for (const key of ['composition','style','light','text']) await addScore(review.id,'design_'+key,report.scores?.[key],'NUMERIC',review.created_at,review.asset_id,{...metadata,scale:'0-2'});
    } else if (review.kind==='diversity') await addScore(review.id,'group_diversity_pass',review.passed,'BOOLEAN',review.created_at,null,{...metadata,composition_version:report.version});
  }
  for (const feedback of own(snapshot.feedback)) await addScore(feedback.id,'asset_feedback',feedback.feedback,'CATEGORICAL',feedback.created_at,feedback.asset_id,{feedback_id:feedback.id,reason_code:lfText(feedback.reason_code || ''),interpretation:'immutable_feedback_history'});
  const cases = own(snapshot.badcases);
  for (const badcase of cases) {
    const stamp = badcase.updated_at || badcase.created_at;
    const key = 'badcase:'+badcase.id+':'+badcase.version;
    await addSpan(key,'Badcase · '+lfText(badcase.code),stamp,stamp,{type:'event',status:badcase.status==='closed'?'succeeded':'failed',errorCode:badcase.status==='closed'?null:badcase.code,
      meta:{badcase_id:badcase.id,case_version:badcase.version,asset_id:badcase.asset_id,stage:badcase.stage},output:{kind:badcase.kind,code:lfText(badcase.code),status:badcase.status,hasHypothesis:Boolean(badcase.hypothesis),hasFix:Boolean(badcase.fix)}});
    await addScore(key,'badcase_status',badcase.status,'CATEGORICAL',stamp,badcase.asset_id,{badcase_id:badcase.id,case_version:badcase.version});
  }
  for (const regression of (snapshot.regressions || []).filter(r => r.owner_id===owner && (r.job_id===job.id || cases.some(b => b.id===r.badcase_id)))) {
    await addSpan('regression:'+regression.id,'Badcase 回归验证',regression.created_at,regression.created_at,{type:'event',status:regression.outcome==='passed'?'succeeded':'failed',meta:{badcase_id:regression.badcase_id,regression_id:regression.id,target_job_id:regression.job_id},output:{outcome:regression.outcome}});
    await addScore('regression:'+regression.id,'regression_pass',regression.outcome==='passed','BOOLEAN',regression.created_at,assetMap.has(regression.asset_id)?regression.asset_id:null,{badcase_id:regression.badcase_id,regression_id:regression.id,target_job_id:regression.job_id});
  }
  return {traceId,rootSpanId,items};
}

export function langfuseOtlpPayload(spans) {
  return {resourceSpans:[{resource:{attributes:[lfAttr('service.name','zaowuying')]},scopeSpans:[{scope:{name:'zaowuying-d1-projector',version:LF_VERSION},spans}]}]};
}

async function lfLoadSnapshot(env,owner,jobId) {
  const job = await lfQuery(env,'SELECT * FROM generation_jobs WHERE id=? AND owner_id=?',jobId,owner).first();
  if (!job) return null;
  const tables = ['telemetry_events','creative_assets','asset_feedback','quality_reviews','quality_badcases'];
  const data = await Promise.all(tables.map(table => lfRows(lfQuery(env,`SELECT * FROM ${table} WHERE owner_id=? AND job_id=? ORDER BY rowid LIMIT 5000`,owner,jobId))));
  const regressions = await lfRows(lfQuery(env,'SELECT * FROM quality_regressions WHERE owner_id=? AND (job_id=? OR badcase_id IN (SELECT id FROM quality_badcases WHERE owner_id=? AND job_id=?)) ORDER BY rowid LIMIT 1000',owner,jobId,owner,jobId));
  return {owner,job,events:data[0],assets:data[1],feedback:data[2],reviews:data[3],badcases:data[4],regressions};
}

async function lfSetState(env,row,state,code=null) {
  const stamp = lfNow();
  const nextRetry = state==='pending' ? new Date(Date.now()+Math.min(3600000,30000 * 2**Math.min(row.attempts || 0,6))).toISOString() : null;
  await lfQuery(env,"UPDATE langfuse_exports SET state=?,last_error=?,next_retry_at=?,updated_at=? WHERE id=? AND state='sending'",state,code,nextRetry,stamp,row.id).run();
}

async function lfDeliver(env,config,rows,itemType) {
  if (!rows.length) return;
  const payloads = rows.map(row => lfJson(row.payload_json));
  const payload = itemType==='span' ? langfuseOtlpPayload(payloads) : {batch:payloads};
  let response, result;
  try {
    response = await fetch(config.base+(itemType==='span'?'/api/public/otel/v1/traces':'/api/public/ingestion'),{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':'Basic '+btoa(config.publicKey+':'+config.secretKey),'x-langfuse-ingestion-version':'4'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(10000),redirect:'error'
    });
    result = await response.json().catch(()=>null);
  } catch {
    for (const row of rows) await lfSetState(env,row,itemType==='span'?'uncertain':'pending','TRANSPORT_OUTCOME_UNKNOWN');
    return;
  }
  if (!response.ok) {
    // An explicit 429 means rejected before enqueue. 5xx may follow enqueue; do not blindly resend spans.
    const state = response.status===429 ? 'pending' : response.status>=500 ? itemType==='span'?'uncertain':'pending' : 'blocked';
    for (const row of rows) await lfSetState(env,row,state,'HTTP_'+response.status);
    return;
  }
  if (itemType==='span') {
    const partial = result?.partialSuccess || result?.partial_success;
    const rejected = Number(partial?.rejectedSpans ?? partial?.rejected_spans ?? 0);
    const state = response.status!==200 || !result || rejected>0 || !Number.isFinite(rejected) ? 'uncertain' : 'sent';
    for (const row of rows) await lfSetState(env,row,state,state==='sent'?null:'OTLP_ACCEPTANCE_UNCONFIRMED');
    return;
  }
  const success = new Set((result?.successes || []).filter(x=>x.status>=200&&x.status<300).map(x=>x.id));
  const failures = new Map((result?.errors || []).map(x=>[x.id,x.status]));
  for (const row of rows) {
    const status = failures.get(row.id);
    const state = success.has(row.id) ? 'sent' : status && status<500 && status!==429 ? 'blocked' : 'pending';
    await lfSetState(env,row,state,state==='sent'?null:status?'SCORE_HTTP_'+status:'SCORE_ACK_MISSING');
  }
}

// Bounded, fail-open: call AFTER product writes using ctx.waitUntil(exportJob(...)).
// Retry pending via subsequent job/quality access. Never auto-retry uncertain spans.
export async function exportJob(env,owner,jobId) {
  const config = lfConfig(env);
  if (!config) return {status:'disabled'};
  try {
    const snapshot = await lfLoadSnapshot(env,owner,jobId);
    if (!snapshot) return {status:'not_found'};
    const projection = await projectLangfuseSnapshot(snapshot);
    const stamp = lfNow();
    for (let offset=0;offset<projection.items.length;offset+=50) await env.DB.batch(projection.items.slice(offset,offset+50).map(item => lfQuery(env,
      "INSERT OR IGNORE INTO langfuse_exports (id,owner_id,job_id,item_type,state,payload_json,occurred_at,attempts,created_at,updated_at) VALUES (?,?,?,?,'pending',?,?,0,?,?)",
      item.id,owner,jobId,item.itemType,JSON.stringify(item.payload),item.occurredAt,stamp,stamp)));
    // A killed Worker must not leave sending rows stuck or blindly replay immutable spans.
    await lfQuery(env,"UPDATE langfuse_exports SET state=CASE WHEN item_type='span' THEN 'uncertain' ELSE 'pending' END,last_error='SENDING_LEASE_EXPIRED',updated_at=? WHERE owner_id=? AND job_id=? AND state='sending' AND updated_at<?",stamp,owner,jobId,new Date(Date.now()-120000).toISOString()).run();
    const rows = await lfRows(lfQuery(env,"SELECT * FROM langfuse_exports WHERE owner_id=? AND job_id=? AND state='pending' AND (next_retry_at IS NULL OR next_retry_at<=?) ORDER BY CASE item_type WHEN 'span' THEN 0 ELSE 1 END,occurred_at,id LIMIT 100",owner,jobId,stamp));
    const claimed = [];
    for (const row of rows) {
      const claim = await lfQuery(env,"UPDATE langfuse_exports SET state='sending',attempts=attempts+1,updated_at=? WHERE id=? AND owner_id=? AND state='pending' AND (next_retry_at IS NULL OR next_retry_at<=?)",stamp,row.id,owner,stamp).run();
      if (claim.meta?.changes) claimed.push({...row,attempts:row.attempts+1});
    }
    await lfDeliver(env,config,claimed.filter(x=>x.item_type==='span'),'span');
    // Scores reference immutable asset/root IDs and can be ingested before indexing catches up.
    await lfDeliver(env,config,claimed.filter(x=>x.item_type==='score'),'score');
    const states = await lfRows(lfQuery(env,'SELECT state,COUNT(*) AS count FROM langfuse_exports WHERE owner_id=? AND job_id=? GROUP BY state',owner,jobId));
    return {status:'ok',traceId:projection.traceId,counts:Object.fromEntries(states.map(x=>[x.state,x.count]))};
  } catch {
    // Never log request bodies, upstream error bodies, credentials, or the raw exception.
    return {status:'error',code:'LANGFUSE_EXPORT_FAILED'};
  }
}

export async function langfuseJobStatus(env,owner,jobId) {
  const config = langfuseConnectionStatus(env);
  const job = await lfQuery(env,'SELECT id FROM generation_jobs WHERE id=? AND owner_id=?',jobId,owner).first();
  if (!job) return {configured:config.configured,status:'not_found'};
  const states = await lfRows(lfQuery(env,'SELECT state,COUNT(*) AS count FROM langfuse_exports WHERE owner_id=? AND job_id=? GROUP BY state',owner,jobId));
  const traceId = (await lfHash(JSON.stringify(['trace',owner,jobId]))).slice(0,32);
  return {...config,traceId,counts:Object.fromEntries(states.map(x=>[x.state,x.count]))};
}
