import {api,updateJob as publishJob,publishTaskState,refreshMetrics} from './cloud.js';
import {quickDefaults,quickMarkup} from './quick-layout.js';
import {prepareProduct,composeCreative} from './quick-images.js';
import {queueTelemetry,observeResultTelemetry,flushTelemetry} from './telemetry.js';
import {categoryNames} from './visual-layout.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
let hooks,project=null,service=null,jobs=[],busy=false,cutting=false,comparing=false,freshRequested=false,uploadEpoch=0,abortCutout=null,saveTimer,poll,refreshing=null,runPending=false;
const composing=new Set(),observedJobs=new Set(),resumeAttempts=new Set();
const feedbackDrafts=new Map(),feedbackSaving=new Set(),downloading=new Set(),editDrafts=new Map();
const feedbackReasons=['商品外观不对','背景不合适','文案不准确','排版不满意','其他'];
const options=()=>({...quickDefaults(),...project?.draft.quick.settings,visualVersion:2});
const photo=()=>project?.draft.imageData;
function say(text,error=false){$('quick-status').textContent=text;$('quick-status').classList.toggle('error',error);}
function cutoutStatus(text,error=false){$('quick-cutout-status').textContent=text;$('quick-cutout-status').classList.toggle('error',error);}
function newDraft(file,original,settings,projectId=crypto.randomUUID()){const stamp=new Date().toISOString();return {id:projectId,name:'商品快捷创作',createdAt:stamp,updatedAt:stamp,thumbnail:original,draft:{productName:'',sellingPoint:'',campaign:'商品快捷创作',headline:'',price:'',originalPrice:'',startDate:'',endDate:'',imageName:file.name.slice(0,200),background:'white',template:'airy',size:settings.ratio,revision:1,approvedRevision:null,generated:false,isExample:false,history:[],imageData:original,backgroundData:null,creationMode:'quick',quick:{originalImageData:original,segmentation:'original',settings}}};}
async function localSave(synced=false){if(!project)return;const latest=hooks.list().find(p=>p.id===project.id);project.serverVersion=Math.max(project.serverVersion||0,latest?.serverVersion||0);project.cloud=Boolean(project.cloud||latest?.cloud);project.pendingCloud=Boolean(project.cloud&&!synced);project.updatedAt=new Date().toISOString();await hooks.put(structuredClone(project));}
function activeQuickJobs(){const ids=new Set(hooks.list().map(p=>p.id));return jobs.filter(j=>j.flow==='quick'&&ids.has(j.projectId));}
const hasRunning=()=>activeQuickJobs().some(j=>j.status==='running');
function renderPhoto(){
 const upload=$('quick-upload');
 if(!project){upload.classList.remove('has-image');$('quick-photo-actions').hidden=true;return;}
 const original=project.draft.quick.originalImageData,ready=Boolean(photo()),transparent=ready&&project.draft.quick.segmentation!=='original';
 upload.classList.add('has-image');upload.innerHTML=`<img src="${esc(comparing||!ready?original:photo())}" alt="${comparing||!ready?'商品原图':'商品主体预览'}"><span>更换图片</span>`;
 $('quick-photo-actions').hidden=false;$('quick-compare').hidden=!transparent;$('quick-compare').textContent=comparing?'查看抠图':'查看原图';
 $('quick-original').hidden=ready&&!transparent;$('quick-cutout-download').hidden=!transparent;$('quick-cutout-retry').hidden=transparent||cutting;
}
function renderControls(){
 const config=service?.providers?.image,count=Number($('quick-count').value)||3,remaining=config?.unlimited?Infinity:Math.max(0,(config?.dailyLimit||0)-(config?.usedToday||0)),locked=busy||hasRunning(),queued=activeQuickJobs().some(j=>j.status==='queued'&&j.projectId===project?.id);
 $('quick-generate').disabled=locked||cutting||queued||!photo()||!config?.enabled||remaining<count;
 $('quick-generate').innerHTML=hooks.icon('sparkles')+(locked?'正在创作…':cutting?'正在处理商品…':queued?'请继续右侧创作':count===3?'生成三套样稿':'生成一套样稿');
 $('quick-quota').textContent=queued&&!locked?'已有待执行的创作，点击右侧“继续生成”。':config?.enabled?`本次 ${count} 次生图 · ${config.unlimited?'每日不限次数':`今日剩余 ${remaining} 次`}`:'生成服务暂未连接，可先上传商品';
 for(const node of document.querySelectorAll('.quick-controls input,.quick-controls textarea,.quick-controls select,.quick-sizes button'))node.disabled=locked||cutting;
 for(const id of ['quick-upload','quick-original','quick-cutout-download','quick-cutout-retry'])$(id).disabled=locked||cutting;
 document.querySelector('.quick-controls').setAttribute('aria-busy',String(locked||cutting));
}
function restoreControls(){
 if(project?.cloud)hooks.status(project.pendingCloud?'已存本机 · 云端待同步':'已保存到云端');
 const o=options();
 for(const kind of ['background','copy','layout']){const key='custom'+kind[0].toUpperCase()+kind.slice(1),toggle=$('quick-custom-'+kind);toggle.checked=o[key];toggle.setAttribute('aria-expanded',String(o[key]));$('quick-'+kind+'-fields').hidden=!o[key];}
 $('quick-background-prompt').value=o.backgroundPrompt;$('quick-copy-title').value=o.title;$('quick-copy-subtitle').value=o.subtitle;$('quick-layout').value=o.layout;
 $('quick-category').value=o.category;$('quick-count').value=String(o.conceptCount);$('quick-direction').value=o.direction;$('quick-direction-fields').hidden=o.conceptCount!==1;
 document.querySelectorAll('[data-quick-size]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.quickSize===o.ratio)));renderPhoto();renderControls();
}
function readOptions(){return {visualVersion:2,category:$('quick-category').value,conceptCount:Number($('quick-count').value),direction:$('quick-direction').value,ratio:document.querySelector('[data-quick-size][aria-pressed=true]')?.dataset.quickSize||'square',customBackground:$('quick-custom-background').checked,backgroundPrompt:$('quick-background-prompt').value.trim(),customCopy:$('quick-custom-copy').checked,title:$('quick-copy-title').value.trim(),subtitle:$('quick-copy-subtitle').value.trim(),customLayout:$('quick-custom-layout').checked,layout:$('quick-layout').value};}
function changed(){
 for(const kind of ['background','copy','layout']){const toggle=$('quick-custom-'+kind);$('quick-'+kind+'-fields').hidden=!toggle.checked;toggle.setAttribute('aria-expanded',String(toggle.checked));}
 $('quick-direction-fields').hidden=$('quick-count').value!=='1';renderControls();
 if(project){project.draft.quick.settings=readOptions();project.draft.size=project.draft.quick.settings.ratio;project.draft.revision++;clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;void localSave().catch(e=>say(e.message,true));},350);}
}
async function upload(file,reuseId=null){
 if(!file||busy||hasRunning()||(cutting&&!reuseId))return;
 const settings=readOptions(),epoch=++uploadEpoch,inputId=crypto.randomUUID(),inputProjectId=reuseId||crypto.randomUUID(),uploadStart=performance.now();let created=false,cutoutStart=null,inputRevision=1;
 const observe=(name,status,durationMs,data={})=>queueTelemetry({name,status,projectId:inputProjectId,inputRevision,...(durationMs===null?{}:{durationMs:Math.max(0,Math.round(durationMs))}),data:{inputId,...data}});
 void observe('product_input_started','started',null);
 clearTimeout(saveTimer);saveTimer=null;abortCutout?.abort();abortCutout=new AbortController();cutting=true;comparing=false;renderControls();renderPhoto();cutoutStatus('正在读取商品图…');say('');
 try{
  const result=await prepareProduct(file,(phase,original,metadata)=>{
   if(epoch!==uploadEpoch)return;
   if(phase==='original'){
    created=true;
    if(reuseId&&project?.id===reuseId){project.draft.imageData=null;project.draft.quick.originalImageData=original;project.draft.quick.segmentation='original';project.draft.revision++;}
    else project=newDraft(file,original,settings,inputProjectId);
    project.draft.quick.inputId=inputId;inputRevision=project.draft.revision;cutoutStart=performance.now();
    void observe('product_input_ready','succeeded',performance.now()-uploadStart,metadata);void observe('cutout_started','started',null,{modelVersion:'u2netp'});
    restoreControls();void localSave().catch(e=>say(e.message,true));
   }else cutoutStatus(phase==='loading'?'正在载入抠图组件，首次约需下载 16 MB…':'正在识别商品轮廓…');
  },abortCutout.signal);
  if(epoch!==uploadEpoch){void observe('cutout_completed','cancelled',performance.now()-(cutoutStart||uploadStart));return;}
  project.draft.imageData=result.cutout;project.draft.quick.originalImageData=result.original;project.draft.quick.segmentation=result.segmentation;project.draft.revision++;project.thumbnail=result.cutout;
  void observe('cutout_completed',result.segmentation==='transparent'?'skipped':'succeeded',performance.now()-(cutoutStart||uploadStart),{segmentation:result.segmentation,modelVersion:result.segmentation==='transparent'?'alpha-check':'u2netp'});
  cutoutStatus(result.segmentation==='transparent'?'这张图片已有透明背景，可以直接创作。':'已自动抠图。你可以查看原图对比边缘。');await localSave();
 }catch(e){
  void observe(created?'cutout_completed':'product_input_failed',epoch!==uploadEpoch?'cancelled':'failed',performance.now()-(cutoutStart||uploadStart),{errorCode:created?'CUTOUT_FAILED':'INPUT_FAILED'});
  if(epoch!==uploadEpoch)return;cutoutStatus(e.message,true);
  if(created&&project){project.draft.imageData=null;say('原图已保留。可重新抠图，或改用原图继续。');await localSave();}
 }finally{if(epoch===uploadEpoch){cutting=false;renderPhoto();renderControls();schedulePoll();}}
}
async function retryCutout(){
 if(!project||busy||cutting||hasRunning())return;
 const id=project.id,original=project.draft.quick.originalImageData;
 cutting=true;renderControls();renderPhoto();cutoutStatus('正在读取保留的原图…');
 try{
  const response=await fetch(original,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('原图读取失败，请重新上传。');
  const blob=await response.blob();if(project?.id!==id)return;
  await upload(new File([blob],project.draft.imageName||'商品原图.png',{type:blob.type||'image/png'}),id);
 }catch(e){cutoutStatus(e.message,true);}
 finally{cutting=false;renderPhoto();renderControls();schedulePoll();}
}
function feedbackMarkup(job){const draft=feedbackDrafts.get(job.id),saving=feedbackSaving.has(job.id),adopted=job.feedback==='adopted',rejected=job.feedback==='rejected';return `<div class="quick-feedback" aria-label="创作效果反馈"><div class="quick-feedback-line"><span>${adopted?'已标记采用这组图':rejected?'已记录需要改进':'这组图符合你的需要吗？'}</span><div class="quick-feedback-actions"><button class="button secondary" data-quick-adopt="${job.id}" aria-pressed="${adopted}" ${saving?'disabled':''}>${adopted?'已采用':'采用这组'}</button><button class="button secondary" data-quick-feedback="${job.id}" aria-expanded="${Boolean(draft)}" aria-controls="quick-feedback-${job.id}" ${saving?'disabled':''}>${rejected?'修改反馈':'需要改进'}</button></div></div>${job.feedbackReason&&!draft?`<p class="quick-feedback-note">${esc(job.feedbackReason)}</p>`:''}${draft?`<form class="quick-feedback-form" id="quick-feedback-${job.id}" data-feedback-form="${job.id}" aria-busy="${saving}"><label>主要问题<select id="quick-reason-${job.id}" data-feedback-reason="${job.id}" ${saving?'disabled':''}>${feedbackReasons.map(reason=>`<option${draft.reason===reason?' selected':''}>${reason}</option>`).join('')}</select></label><label>补充说明（可选）<textarea id="quick-note-${job.id}" data-feedback-note="${job.id}" maxlength="400" placeholder="例如：商品边缘有白边，背景太杂乱" ${saving?'disabled':''}>${esc(draft.note)}</textarea></label><p class="quick-feedback-error" role="status">${esc(draft.error||'')}</p><div class="quick-feedback-actions"><button type="submit" class="button primary" ${saving?'disabled':''}>${saving?'正在保存…':'保存反馈'}</button><button type="button" class="button quiet" data-quick-feedback-cancel="${job.id}" ${saving?'disabled':''}>取消</button></div></form>`:''}</div>`;}
function resultMarkup(job){
 const p=job.result?.quick,visual=p?.visualVersion===2,images=job.result?.compositions||[],backgrounds=job.result?.backgrounds||[],name=visual?'商品视觉样稿':images[0]?.title||'商品创意',ratio=p?.ratio==='portrait'?'3:4':'1:1',stamp=new Date(job.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
 const terminal=['succeeded','failed','interrupted'].includes(job.status),ready=images.length>0,integrated=p?.renderRoute==='reference_scene_edit',assetLabel=integrated?'画面':'背景',layouts={center:'居中聚焦',right:'左文右图',left:'左图右文'};
 let content='';
 if(visual)content+=`<div class="quick-concepts" aria-label="样稿方向">${p.concepts.map((c,i)=>{const done=backgrounds.some(b=>b.conceptId===c.id),error=job.result.conceptErrors?.some(e=>e.conceptId===c.id),active=job.status==='running'&&i===job.nextStep;return `<span class="quick-concept-state ${done?'is-ready':active?'is-active':''}">${esc(c.name)} · ${done?assetLabel+'已保存':error?'未完成':active?'生成中':'待生成'}</span>`;}).join('')}</div>`;
 if(ready){
  content+=`<div class="quick-output-grid">${images.map((image,index)=>`<figure class="quick-output"><img data-view-job="${job.id}" data-view-asset="${image.assetId||''}" src="${esc(image.imageUrl)}" alt="${esc(image.name||layouts[image.layout])} · ${esc(image.title)}" loading="lazy"><figcaption><div><strong>${esc(image.name||layouts[image.layout])}</strong><small>${esc(image.title||'无标题')}</small></div><div class="quick-output-actions"><button class="button secondary" data-quick-edit="${job.id}" data-output-index="${index}">调整文案</button><button class="button dark" data-quick-download="${job.id}" data-output-index="${index}">${hooks.icon('download')} 下载</button><a class="button secondary" href="#quality/${job.id}/${image.assetId||''}">评价这张</a></div></figcaption></figure>`).join('')}</div><div class="quick-edit" id="quick-edit-${job.id}" hidden><label>主标题<input maxlength="18" id="quick-title-${job.id}"></label><label>副标题<input maxlength="40" id="quick-subtitle-${job.id}"></label><button class="button primary" data-quick-recompose="${job.id}">应用到${visual?'这张样稿':'两种排版'} · 不重新生图</button></div>`;
 }
 if(['running','queued'].includes(job.status)||composing.has(job.id)){
  const label=composing.has(job.id)?'正在排版并保存成品…':job.status==='queued'?(backgrounds.length?'已保存部分'+assetLabel+'，可以继续下一套':'创作已准备，等待开始'):job.stage==='saving'?assetLabel+'已生成，正在保存…':job.stage==='analyzing'?'正在识别商品与设计方向…':visual?`正在${integrated?'融合商品与场景':'生成背景'} · 第 ${job.nextStep+1} / ${p.concepts.length} 套…`:'正在生成背景…';
  content+=`<div class="quick-progress">${hooks.icon('clock')}<div><strong>${label}</strong><p>已完成的${assetLabel}会保留。关闭页面后，请回到这里继续。</p>${job.status==='queued'?`<button class="button secondary" data-quick-run="${job.id}">继续生成</button>`:''}</div></div>`;
 }
 if(terminal&&needsCompose(job))content+=`<div class="quick-failure"><strong>${visual?backgrounds.length+' 套'+assetLabel+'已保存':'背景已生成'}，成品待排版</strong><p>继续排版不会重新调用模型。</p><button class="button secondary" data-quick-compose="${job.id}">继续排版并保存</button></div>`;
 if(terminal&&job.error&&!visual)content+=`<div class="quick-failure"><strong>这次创作未完成</strong><p>${esc(job.error.message)}</p></div>`;
 if(visual&&job.result.conceptErrors?.length)content+=`<div class="quick-direction-errors" role="status">${job.result.conceptErrors.map(e=>`<p><strong>${esc(e.name)}</strong>：${esc(e.message)}</p>`).join('')}<p>已完成的样稿会保留。新建一组会产生新的生成调用。</p></div>`;
 else if(terminal&&job.error&&visual)content+=`<div class="quick-failure"><strong>这次创作未完成</strong><p>${esc(job.error.message)}</p></div>`;
 if(job.canRecover)content+=`<div class="quick-failure"><button class="button secondary" data-quick-recover="${job.id}">重新保存原图片</button><p>只恢复已生成图片，不再调用模型。其余方向可在恢复后继续。</p></div>`;
 if(integrated&&ready)content+=`<details class="quick-reference"><summary>对照商品原图 · 核对包装与标识</summary><img src="${esc(p.subjectImageUrl)}" alt="本组商品参考图" loading="lazy"><p>AI 融合可能改动包装小字、图案或结构。请对照确认后再采用。</p></details>`;
 return `<article class="quick-batch" id="quick-batch-${job.id}" tabindex="-1"><div class="quick-batch-heading">${p?.subjectImageUrl?`<img src="${esc(p.subjectImageUrl)}" alt="商品主体">`:''}<div><h3>${esc(name)}</h3><p>${stamp} · ${ratio}${visual?' · '+esc(categoryNames[p.category]):''}${integrated?' · 商品与场景融合':''} · ${(p?.strategySource||job.strategySource)==='preset'?'基础设计规则 · ':''}${ready?images.length+' 套已保存 · 下载前请检查商品外观与文案':'智能创作'}</p></div></div>${content}${terminal&&ready&&!needsCompose(job)?`<div class="quick-feedback"><a class="button secondary" href="#quality/${job.id}">逐图反馈与质量评测</a><span>采用、问题原因与评分按图片版本保存</span></div>`:''}</article>`;
}
function needsCompose(job){const r=job.result;if(!['succeeded','failed','interrupted'].includes(job.status)||!r?.quick)return false;return r.quick.visualVersion===2?r.backgrounds.length>0&&r.compositions.length!==r.backgrounds.length:job.status==='succeeded'&&!r.compositions?.length;}
function renderResults(){const list=activeQuickJobs(),focused=document.activeElement,focusId=$('quick-results-list').contains(focused)?focused.id:null,selection=focusId&&'selectionStart' in focused?[focused.selectionStart,focused.selectionEnd]:null;$('quick-results-list').innerHTML=list.length?list.map(resultMarkup).join(''):`<div class="quick-empty">${hooks.icon('layers')}<h3>好创意，从一张商品图开始。</h3><p>上传左侧的商品图，让 AI 为它搭配一个新场景。</p></div>`;for(const [id,draft]of editDrafts){const panel=$('quick-edit-'+id);if(panel){panel.hidden=false;$('quick-title-'+id).value=draft.title;$('quick-subtitle-'+id).value=draft.subtitle;}}for(const b of document.querySelectorAll('[data-quick-edit],[data-quick-recompose],[data-quick-compose],[data-quick-run],[data-quick-recover]'))b.disabled=busy||cutting||hasRunning()||(Boolean(b.dataset.quickEdit)&&!['succeeded','failed','interrupted'].includes(jobs.find(j=>j.id===b.dataset.quickEdit)?.status));for(const b of document.querySelectorAll('[data-quick-download]')){b.disabled=downloading.has(b.dataset.quickDownload);if(b.disabled)b.textContent='正在下载…';}if(focusId&&$(focusId)){$(focusId).focus({preventScroll:true});if(selection&&typeof $(focusId).setSelectionRange==='function')$(focusId).setSelectionRange(...selection);}observeResultTelemetry($('quick-results-list'),list);}
function update(job){jobs=[job,...jobs.filter(j=>j.id!==job.id)].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));publishJob(job);renderResults();}
function schedulePoll(){
 clearTimeout(poll);poll=null;
 const unfinished=activeQuickJobs().some(j=>needsCompose(j)&&!resumeAttempts.has(j.id)&&(j.projectId===project?.id||observedJobs.has(j.id)));
 if(runPending||hasRunning()||unfinished)poll=setTimeout(()=>{poll=null;void refresh();},3500);
}
async function refresh(){
 if(refreshing)return refreshing;
 refreshing=(async()=>{
  try{
   const [status,history]=await Promise.all([api('/status'),api('/jobs')]);service=status;jobs=history.jobs;publishTaskState(jobs,status);
   for(const j of activeQuickJobs())if(j.status==='running')observedJobs.add(j.id);
   renderControls();renderResults();
   // Refresh observes existing jobs. It never starts or retries a paid model call.
   const ready=activeQuickJobs().find(j=>needsCompose(j)&&!resumeAttempts.has(j.id)&&(j.projectId===project?.id||observedJobs.has(j.id)));
   if(ready&&!busy&&!cutting){
    resumeAttempts.add(ready.id);busy=true;renderControls();
    try{await finish(ready);}finally{busy=false;renderControls();renderResults();}
   }
  }catch(e){say('暂时无法更新进度：'+e.message+' 原任务会保留，请勿重复生成。',true);}
  finally{schedulePoll();}
 })();
 try{return await refreshing;}finally{refreshing=null;}
}
async function cloudSave(){if(!project)throw new Error('请先上传商品图片。');clearTimeout(saveTimer);await localSave();const captured=project;const saved=await hooks.sync(captured);if(!saved)throw new Error("当前创作已删除，请新建后再试。");if(project?.id===captured.id){project={...saved,draft:{...saved.draft,imageData:captured.draft.imageData,quick:{...saved.draft.quick,originalImageData:captured.draft.quick.originalImageData}}};await localSave(true);}return saved;}
async function finish(job,edits){
 if(composing.has(job.id))return;composing.add(job.id);renderResults();let savedOutputs=false,composed=false;
 const composeStart=performance.now();
 try{
  const images=await composeCreative(job,edits);composed=true;
  void queueTelemetry({name:'composition_completed',status:'succeeded',projectId:job.projectId,jobId:job.id,inputRevision:job.sourceRevision,durationMs:Math.round(performance.now()-composeStart),data:{compositionVersion:(job.result.compositionVersion||0)+1}});
  const result=await api('/jobs/'+job.id+'/compose',{images,expectedVersion:edits?.expectedVersion??job.result.compositionVersion??0});
  savedOutputs=true;editDrafts.delete(job.id);feedbackDrafts.delete(job.id);update(result.job);void refreshMetrics();
  if(project?.id===job.projectId){project.thumbnail=result.job.result.compositions[0].imageUrl;project.draft.backgroundData=job.result.imageUrl;project.draft.headline=images[0].title;project.draft.productName=images[0].title||'商品创意';project.draft.generated=true;project.draft.revision++;await cloudSave();}
  say(edits?'文案已更新，没有重新调用模型。':result.job.result.compositions.length+' 套样稿已保存，可以下载或调整文案。');return result.job;
 }catch(e){if(!composed)void queueTelemetry({name:'composition_completed',status:'failed',projectId:job.projectId,jobId:job.id,inputRevision:job.sourceRevision,durationMs:Math.round(performance.now()-composeStart),data:{errorCode:e.code||'COMPOSITION_FAILED'}});say(savedOutputs?'成品已保存，可以下载。创作信息暂未同步：'+e.message:'成品尚未保存：'+e.message+' 可继续排版，无需重新生成。',true);}
 finally{composing.delete(job.id);renderResults();}
}
async function runJob(job,action='run'){
 if(!job)return;busy=true;runPending=true;observedJobs.add(job.id);renderControls();renderResults();schedulePoll();
 try{
  let current=job;
  // Each paid request has its own step token. A lost response never repeats that call.
  for(let attempt=0;attempt<3;attempt++){
   const before=current.nextStep||0,payload=action==='run'&&current.visualVersion===2?{step:before}:{};
   const response=await api('/jobs/'+current.id+'/'+action,payload);current=response.job;update(current);
   // Recovery is strictly a free save; continuation requires the visible button.
   if(action==='recover'||current.visualVersion!==2||current.status!=='queued'||current.nextStep<=before)break;
  }
  if(needsCompose(current)){resumeAttempts.add(current.id);await finish(current);}
  else if(current.status==='queued')say('原图片已保存。点击“继续生成”完成其余方向。');
  else if(current.error)say(current.error.message,true);
  else if(current.status!=='succeeded')say('正在查看创作进度，请勿重复生成。');
 }catch(e){say('本次请求暂未确认：'+e.message+' 原任务已保留，请刷新记录，避免重复生成。',true);}
 finally{runPending=false;busy=false;await refresh();renderControls();renderResults();}
}
async function generate(){if(busy||cutting||!photo())return;busy=true;renderControls();say('正在保存商品，准备创作…');try{project.draft.quick.settings=readOptions();const saved=await cloudSave();const {job}=await api('/jobs',{id:crypto.randomUUID(),projectId:saved.id,kind:'image',flow:'quick',sourceVersion:saved.serverVersion,...($('quick-evaluation').checked?{evaluation:{batchId:$('quick-eval-batch').value.trim(),caseId:$('quick-eval-case').value.trim().toUpperCase(),variant:$('quick-eval-variant').value}}:{})});update(job);await runJob(job);}catch(e){say(e.message,true);}finally{busy=false;renderControls();}}
async function downloadImage(src,name){const response=await fetch(src,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('图片下载失败，请重试下载，成品已保留。');const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);}
async function downloadResult(job,index){
 if(!job||downloading.has(job.id))return;downloading.add(job.id);renderResults();
 try{await downloadImage(job.result.compositions[index].imageUrl,'造物营_商品创意_'+(index+1)+'.png');
  try{await api('/jobs/'+job.id+'/export',{id:crypto.randomUUID(),compositionVersion:job.result.compositionVersion,outputIndex:index});say('下载已发起。');await refreshMetrics();}catch{say('下载已发起，下载记录暂未同步。');}
 }catch{say('下载未完成，成品已保留。请重试下载，无需重新生成。',true);}finally{downloading.delete(job.id);renderResults();}
}
async function saveFeedback(job,feedback){
 if(!job||feedbackSaving.has(job.id))return;const draft=feedbackDrafts.get(job.id);feedbackSaving.add(job.id);if(draft)draft.error='';renderResults();
 try{const response=await api('/jobs/'+job.id+'/feedback',{feedback,reason:feedback==='adopted'?'':draft.reason+(draft.note.trim()?'：'+draft.note.trim():''),compositionVersion:draft?.version??job.result.compositionVersion});feedbackDrafts.delete(job.id);update(response.job);say(feedback==='adopted'?'已标记采用这组图。':'改进反馈已保存。');await refreshMetrics();}
 catch(error){if(draft)draft.error=error.message+' 输入内容已保留。';else say(error.message,true);}
 finally{feedbackSaving.delete(job.id);renderResults();}
}
export function initQuickCreate(adapter){hooks=adapter;$('view-image-create').innerHTML=quickMarkup(hooks.icon);
 $('quick-upload').addEventListener('click',()=>$('quick-file').click());$('quick-file').addEventListener('change',e=>{void upload(e.target.files?.[0]);e.target.value='';});
 const drop=$('quick-upload');drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('dragover');void upload(e.dataTransfer.files?.[0]);});
 $('quick-generate').addEventListener('click',generate);$('quick-evaluation').addEventListener('change',()=>{$('quick-eval-fields').hidden=!$('quick-evaluation').checked;});void flushTelemetry();$('quick-refresh').addEventListener('click',refresh);
 for(const kind of ['background','copy','layout'])$('quick-custom-'+kind).addEventListener('change',changed);for(const id of ['quick-background-prompt','quick-copy-title','quick-copy-subtitle','quick-layout','quick-category','quick-count','quick-direction'])$(id).addEventListener('input',changed);
 $('view-image-create').addEventListener('input',e=>{const node=e.target,id=node.dataset.feedbackReason||node.dataset.feedbackNote;if(id&&feedbackDrafts.has(id)){const draft=feedbackDrafts.get(id);draft[node.dataset.feedbackReason?'reason':'note']=node.value;}const edit=node.closest('.quick-edit');if(edit){const jobId=edit.id.slice('quick-edit-'.length);editDrafts.set(jobId,{...editDrafts.get(jobId),title:$('quick-title-'+jobId).value,subtitle:$('quick-subtitle-'+jobId).value});}});
 $('view-image-create').addEventListener('submit',e=>{const id=e.target.dataset.feedbackForm;if(!id)return;e.preventDefault();void saveFeedback(jobs.find(j=>j.id===id),'rejected');});
 document.querySelectorAll('[data-quick-size]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-quick-size]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));changed();}));
 $('view-image-create').addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;try{
  if(b.id==='quick-compare'){comparing=!comparing;renderPhoto();}if(b.id==='quick-original'&&project&&!busy&&!cutting){project.draft.imageData=project.draft.quick.originalImageData;project.draft.quick.segmentation='original';project.draft.revision++;comparing=false;cutoutStatus('已改用原图，将以图中的商品为参考创作。');await localSave();renderPhoto();renderControls();}
  if(b.id==='quick-cutout-retry')await retryCutout();if(b.id==='quick-cutout-download'&&photo())await downloadImage(photo(),'造物营_商品透明图.png');
  if(b.dataset.quickDownload)await downloadResult(jobs.find(j=>j.id===b.dataset.quickDownload),Number(b.dataset.outputIndex));
  if(b.dataset.quickAdopt)await saveFeedback(jobs.find(j=>j.id===b.dataset.quickAdopt),'adopted');
  if(b.dataset.quickFeedback){const job=jobs.find(j=>j.id===b.dataset.quickFeedback);if(feedbackDrafts.has(job.id))feedbackDrafts.delete(job.id);else feedbackDrafts.set(job.id,{reason:feedbackReasons.find(r=>job.feedbackReason?.startsWith(r))||feedbackReasons[0],note:job.feedbackReason?.includes('：')?job.feedbackReason.split('：').slice(1).join('：'):'',version:job.result.compositionVersion,error:''});renderResults();$('quick-reason-'+job.id)?.focus();}
  if(b.dataset.quickFeedbackCancel){feedbackDrafts.delete(b.dataset.quickFeedbackCancel);renderResults();document.querySelector(`[data-quick-feedback="${b.dataset.quickFeedbackCancel}"]`)?.focus();}
  if(b.dataset.quickEdit){const job=jobs.find(j=>j.id===b.dataset.quickEdit),index=Number(b.dataset.outputIndex)||0,image=job.result.compositions[index];if(editDrafts.get(job.id)?.index===index)editDrafts.delete(job.id);else editDrafts.set(job.id,{index,conceptId:image.conceptId,title:image.title,subtitle:image.subtitle,version:job.result.compositionVersion});renderResults();$('quick-title-'+job.id)?.focus();}
  if(b.dataset.quickRecompose&&!busy){busy=true;renderControls();const id=b.dataset.quickRecompose;await finish(jobs.find(j=>j.id===id),{title:$('quick-title-'+id).value.trim(),subtitle:$('quick-subtitle-'+id).value.trim(),expectedVersion:editDrafts.get(id)?.version,conceptId:editDrafts.get(id)?.conceptId});busy=false;renderControls();renderResults();}
  if(b.dataset.quickCompose&&!busy){busy=true;renderControls();await finish(jobs.find(j=>j.id===b.dataset.quickCompose));busy=false;renderControls();renderResults();}
  if(b.dataset.quickRecover&&!busy)await runJob(jobs.find(j=>j.id===b.dataset.quickRecover),'recover');if(b.dataset.quickRun&&!busy)await runJob(jobs.find(j=>j.id===b.dataset.quickRun));
 }catch(error){busy=false;renderControls();renderResults();say(error.message,true);}});
}
function restoredPhotoStatus(){cutoutStatus(!photo()?'抠图未完成，原图已保留。可重新抠图或改用原图。':project.draft.quick.segmentation==='original'?'当前使用原图。':'已载入商品主体，可继续创作。',!photo());}
export async function openQuickCreate(value,jobId){
 if(value){if(cutting){abortCutout?.abort();uploadEpoch++;cutting=false;}project=structuredClone(value);comparing=false;freshRequested=false;restoreControls();restoredPhotoStatus();}
 else if(!project&&!freshRequested){project=structuredClone(hooks.list().find(p=>p.draft.creationMode==='quick')||null);if(project){restoreControls();restoredPhotoStatus();}}
 else if(project&&!busy&&!cutting){const latest=hooks.list().find(p=>p.id===project.id);if(latest&&(latest.serverVersion||0)>(project.serverVersion||0)&&latest.draft.revision>=project.draft.revision){project=structuredClone(latest);restoreControls();restoredPhotoStatus();}}
 await refresh();
 if(jobId){const target=$('quick-batch-'+jobId);target?.focus({preventScroll:true});target?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
}
export function newQuickCreation(){if(busy||cutting||hasRunning()){say('请等待当前图片处理完成。');return;}if(saveTimer){clearTimeout(saveTimer);saveTimer=null;void localSave().catch(e=>say(e.message,true));}project=null;freshRequested=true;comparing=false;restoreControls();$('quick-upload').innerHTML=`${hooks.icon('image')}<strong>点击或拖入商品图</strong><small>PNG、JPG、WebP · 最大 8 MB</small>`;$('quick-photo-actions').hidden=true;cutoutStatus('上传后自动抠图，保留商品原貌。');say('');}
