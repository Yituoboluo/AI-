import {api,refreshMetrics} from './cloud.js';
import {flushTelemetry} from './telemetry.js';

const qe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stageLabels={upload:'读取商品图',cutout:'抠图',queue:'受理任务',plan:'创意策略',generate:'图片生成',generation:'图片生成',copy:'文案生成',checkpoint:'保存中间结果',download:'读取生成结果',persist:'保存背景',compose:'成品合成',save:'成品保存',display:'结果展示',feedback:'采用反馈',quality:'质量检查',analysis:'创意策略',storage:'结果保存'};
const stateLabels={started:'进行中',succeeded:'完成',failed:'失败',cancelled:'取消',skipped:'跳过',queued:'待执行',running:'生成中',interrupted:'结果未确认',open:'待分析',investigating:'分析中',closed:'已关闭'};
const scopes={production:'真实创作',evaluation:'内部评测',legacy:'历史记录'};
const when=s=>s?new Date(s).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const duration=n=>n===null||n===undefined?'—':n<1000?n+' ms':(n/1000).toFixed(1)+' s';
let root,overview,caseList=[],regressionJobs=[],detail=null,caseDetail=null,baseDetail=null,targetDetail=null,scope='production',days=7,loading=0,working=false;
const pendingRequests=new Map();
const message=(text,error=false)=>{const n=root?.querySelector('#quality-notice');if(n){n.textContent=text;n.classList.toggle('error',error);}};
async function post(path,body,key){const signature=JSON.stringify(body),pending=pendingRequests.get(key);const request=pending?.signature===signature?pending:{signature,id:crypto.randomUUID()};pendingRequests.set(key,request);const result=await api(path,{...body,id:request.id});pendingRequests.delete(key);return result;}
const badge=(text,type='')=>`<span class="q-badge ${type}">${qe(text)}</span>`;
const checkList=checks=>`<ul class="q-check-list">${checks.map(x=>`<li>${badge(x.passed?'通过':'未通过',x.passed?'pass':'fail')}<span>${qe(x.label||x.code)}</span></li>`).join('')}</ul>`;
const options=(items,value)=>items.map(([v,label])=>`<option value="${qe(v)}"${String(value)===String(v)?' selected':''}>${qe(label)}</option>`).join('');

function metricsMarkup(){
 const s=overview.summary,f=s.firstAttempt;
 return `<div class="q-metrics">${[
  ['本周采用需求',s.weeklyAdoptedTasks,'北京时间自然周 · 真实创作'],
  ['首次生成可采用',f.rate===null?'—':Math.round(f.rate*100)+'%',`${f.numerator} / ${f.denominator} 个需求 · ${f.pending} 个待完成判定`],
  ['生成尝试',s.jobs,`${s.tasks} 个需求 · ${s.retries} 次重新生成`],
  ['首次可见 P50',duration(s.firstResultP50Ms),`${s.displaySamples} 个展示样本 · P90 ${duration(s.firstResultP90Ms)}`],
  ['待处理问题',s.openBadcases,`${s.savedAssets} 张当前成品 · ${s.fullyDelivered} 次完整交付`]
 ].map(([title,value,note])=>`<div><span>${title}</span><strong>${value}</strong><small>${note}</small></div>`).join('')}</div>`;
}
function tasksMarkup(){return `<section class="q-record-list" aria-labelledby="q-records"><h2 id="q-records">创作记录</h2>${overview.jobs.length?overview.jobs.map(j=>`<a class="q-record ${detail?.job.id===j.id?'selected':''}" href="#quality/${j.id}"><span><strong>${qe(j.evaluation?`${j.evaluation.caseId} · ${j.evaluation.variant} 版`:'商品创作')}</strong><small>${when(j.created_at)}</small></span><span>${badge(stateLabels[j.status]||j.status,j.status==='failed'?'fail':'')}<small>${j.attempt_no?'第 '+j.attempt_no+' 次尝试':'历史任务'} · ${j.asset_count} 张成品</small></span></a>`).join(''):'<p class="q-empty">此范围暂无创作。新任务会自动记录执行过程。</p>'}${overview.listLimited?'<p class="q-caption">列表展示最新 100 次；上方指标覆盖所选时间范围。</p>':''}</section>`;}
function timelineMarkup(d){
 const events=d.events.filter(e=>e.status!=='started'),max=Math.max(1,...events.map(e=>e.duration_ms||0));
 return `<details class="q-trace"><summary>执行过程 · ${events.length} 条记录</summary>${events.length?`<div class="q-table-scroll"><table><thead><tr><th>阶段</th><th>状态</th><th>耗时</th><th>记录时间</th></tr></thead><tbody>${events.map(e=>`<tr><td><strong>${qe(stageLabels[e.stage]||e.stage)}</strong><small>${qe(e.data?.conceptId||'')}${e.data?.recovery?' · 恢复保存':''} · ${e.source==='server'?'服务端':'客户端'}</small></td><td>${badge(stateLabels[e.status]||e.status,e.status==='failed'?'fail':'')}</td><td class="q-duration">${duration(e.duration_ms)}${e.duration_ms!==null?`<i style="width:${Math.max(2,Math.round(e.duration_ms/max*100))}%"></i>`:''}</td><td>${when(e.received_at)}</td></tr>`).join('')}</tbody></table></div>`:'<p>该任务没有阶段记录。历史耗时保持未知。</p>'}<dl class="q-identifiers"><div><dt>需求编号</dt><dd>${qe(d.job.taskId||'历史记录，未关联')}</dd></div><div><dt>任务编号</dt><dd>${qe(d.job.id)}</dd></div><div><dt>上次生成</dt><dd>${d.job.parentJobId?`<a href="#quality/${qe(d.job.parentJobId)}">查看第 ${d.job.attemptNo-1} 次尝试</a>`:'—'}</dd></div><div><dt>模型 / 流程版本</dt><dd>${qe(d.job.model)} / ${qe(d.job.workflowVersion||'历史版本')}</dd></div></dl></details>`;
}
function langfuseMarkup(status){
 if(!status)return '';
 if(!status.configured)return '<p class="q-caption">Langfuse 未启用 · 执行与质量记录已保存在产品中。</p>';
 const c=status.counts||{},pending=(c.pending||0)+(c.sending||0),problem=(c.uncertain||0)+(c.blocked||0);
 return `<details class="q-trace"><summary>Langfuse 追踪 · ${c.sent||0} 项已送达${pending?' · '+pending+' 项待同步':''}${problem?' · '+problem+' 项需核查':''}</summary><p class="q-caption">送达表示平台已接受，索引可能稍有延迟。待同步记录会在后续访问时继续处理。</p><dl class="q-identifiers"><div><dt>追踪编号</dt><dd>${qe(status.traceId)}</dd></div><div><dt>发送结果</dt><dd>已送达 ${c.sent||0} · 待发送 ${c.pending||0} · 发送中 ${c.sending||0} · 结果待核实 ${c.uncertain||0} · 需处理 ${c.blocked||0}</dd></div></dl>${status.dashboardUrl?`<a href="${qe(status.dashboardUrl)}" target="_blank" rel="noopener">打开 Langfuse</a>`:''}</details>`;
}
function feedbackButtons(a){const f=a.feedback?.feedback;return `<div class="q-actions"><button class="button primary" data-q-adopt="${a.id}" ${!a.current||f==='adopted'?'disabled':''}>${f==='adopted'?'已采用':'采用这张'}</button><button class="button secondary" data-q-revoke="${a.id}" ${!a.current||f!=='adopted'?'disabled':''}>撤销采用</button></div>`;}
function reviewForm(a){
 return `<details class="q-human"><summary>人工评测</summary><form data-q-review="${a.id}" class="q-form">
 <div class="q-gates">${[['facts','商品外观、规格与数量'],['requirements','自定义要求'],['delivery','完整交付与可读取']].map(([key,label])=>`<label>${label}<select name="${key}" required>${options([['','请选择'],['true','符合'],['false','不符合']])}</select></label>`).join('')}</div>
 <div class="q-score-grid">${[['composition','层次构图'],['style','风格贴合'],['light','合成光影'],['text','文字可读']].map(([key,label])=>`<label>${label}<select name="${key}" required>${options([['','请选择'],['0','0 · 明显问题'],['1','1 · 基本满足'],['2','2 · 表现良好']])}</select></label>`).join('')}</div>
 <div class="q-gates"><label>修改程度<select name="editLevel" required>${options([['','请选择'],['direct','可直接采用'],['minor','局部修改'],['redo','需要重做']])}</select></label><label>局部修改分钟数<input name="editMinutes" type="number" min="0" max="600" value="0"></label><label>采用判定<select name="decision" required>${options([['','请选择'],['adopted','采用'],['rejected','不采用']])}</select></label></div>
 <label>评审依据<textarea name="note" maxlength="800" rows="2" placeholder="记录具体问题或采用理由"></textarea></label><p class="q-caption">采用门槛：三项检查符合，设计项各 ≥ 1 分，总分 ≥ 6/8；局部修改不超过 10 分钟。</p><button class="button primary" type="submit" ${a.current?'':'disabled'}>保存评测与判定</button></form></details>`;
}
function assetMarkup(a){
 const auto=a.reviews.find(r=>r.kind==='automatic'),human=a.reviews.find(r=>r.kind==='human'),history=detail.feedback.filter(f=>f.asset_id===a.id);
 return `<article class="q-asset" id="q-${a.id}"><div class="q-asset-image"><img src="${qe(a.image_url)}" alt="${qe(a.title||'商品样稿')}" loading="lazy"><a href="${qe(a.image_url)}" target="_blank" rel="noopener">查看原尺寸</a></div><div class="q-asset-body"><div class="q-asset-title"><h3>样稿 ${a.output_index+1} · V${a.version}</h3>${badge(a.current?'当前版本':'历史版本')}</div><p>${qe(a.title||'无标题')}</p>${auto?`<details class="q-rule"><summary>规则检查 ${auto.score}/100 · ${auto.passed?'通过':'需处理'}</summary>${checkList(auto.report.checks)}<p class="q-caption">${qe(auto.report.scope)}</p></details>`:'<p class="q-caption">规则检查待完成</p>'}${human?`<p>最近人工评分 <strong>${human.score}/8</strong> · ${human.passed?'可采用':'未达到采用条件'}</p>`:''}${feedbackButtons(a)}
 ${a.current?`<details><summary>需要改进</summary><form data-q-feedback="${a.id}" class="q-form"><label>主要问题<select name="reasonCode" required>${options([['','请选择'],['商品外观不对','商品外观不对'],['背景不合适','背景不合适'],['文案不准确','文案不准确'],['排版不满意','排版不满意'],['其他','其他']])}</select></label><label>补充说明<textarea name="note" maxlength="800" rows="2"></textarea></label><button class="button secondary" type="submit">保存并建立 Badcase</button></form></details>${reviewForm(a)}`:''}
 <details><summary>反馈历史 · ${history.length} 条</summary>${history.length?`<ol class="q-history">${history.map(f=>`<li><strong>${{adopted:'采用',rejected:'不采用',revoked:'撤销采用'}[f.feedback]}</strong> · ${when(f.created_at)}<p>${qe(f.reason_code)} ${qe(f.note)}</p></li>`).join('')}</ol>`:'<p class="q-caption">暂无反馈</p>'}</details></div></article>`;
}
function jobMarkup(){
 if(!detail)return '<section class="q-empty-panel"><h2>选择一条创作</h2><p>查看阶段耗时、图片版本与评测结果。</p></section>';
 const j=detail.job,current=detail.assets.filter(a=>a.current),archived=detail.assets.filter(a=>!a.current);
 return `<section class="q-detail"><div class="q-detail-heading"><div><h2>${j.evaluation?qe(j.evaluation.caseId+' · '+j.evaluation.variant+' 版'):'创作质量'}</h2><p>${scopes[j.environment]||'历史记录'} · ${j.attemptNo?'第 '+j.attemptNo+' 次尝试':'首次与重试未关联'} · ${when(j.createdAt)}</p></div>${j.hasCompositions?`<button class="button secondary" data-q-check="${j.id}">检查成品</button>`:''}</div>${timelineMarkup(detail)}
 ${langfuseMarkup(detail.langfuse)}${current.length?current.map(assetMarkup).join(''):`<div class="q-empty-panel"><p>${j.hasCompositions?'这条历史任务尚未登记图片版本。点击“检查成品”建立记录。':'尚无已保存成品；失败记录可在执行过程与问题列表中查看。'}</p></div>`}
 ${current.length>=2?`<details class="q-diversity"><summary>整组视觉差异</summary><form data-q-diversity="${j.id}" class="q-form"><fieldset><legend>具有实质变化的维度</legend>${[['scene','背景场景'],['composition','构图'],['palette','配色'],['hierarchy','信息层级']].map(([v,l])=>`<label><input type="checkbox" name="axes" value="${v}"> ${l}</label>`).join('')}</fieldset><label>判定<select name="passed"><option value="true">通过</option><option value="false">未通过</option></select></label><label>评审依据<textarea name="note" maxlength="500"></textarea></label><button class="button secondary">保存差异评审</button></form>${detail.reviews.filter(r=>r.report.version===j.compositionVersion).slice(0,3).map(r=>`<p>${when(r.created_at)} · ${r.passed?'通过':'未通过'}</p>`).join('')}</details>`:''}
 ${archived.length?`<details class="q-archive"><summary>历史图片版本 · ${archived.length} 张</summary>${archived.map(assetMarkup).join('')}</details>`:''}
 ${detail.badcases.length?`<section><h3>关联问题</h3>${detail.badcases.map(caseLink).join('')}</section>`:''}</section>`;
}
function caseLink(b){return `<a class="q-record" href="#quality/case/${b.id}"><span><strong>${qe(b.title)}</strong><small>${qe(stageLabels[b.stage]||b.stage)} · ${when(b.created_at)}</small></span>${badge(stateLabels[b.status],b.status==='closed'?'pass':'')}</a>`;}
function badcaseMarkup(){
 if(!caseDetail)return '';
 const b=caseDetail.badcase,targetAssets=targetDetail?.assets.filter(a=>a.current)||[];
 return `<section class="q-detail"><div class="q-detail-heading"><div><h2>${qe(b.title)}</h2><p>${qe(stageLabels[b.stage]||b.stage)} · ${when(b.created_at)}</p></div>${badge(stateLabels[b.status])}</div><p><a href="#quality/${b.job_id}">查看原任务、图片与 Trace</a></p><details class="q-evidence" open><summary>已记录证据</summary><pre>${qe(JSON.stringify(b.evidence,null,2))}</pre></details>
 <form data-q-case="${b.id}" class="q-form"><label>归因假设与验证依据<textarea name="hypothesis" maxlength="1500" rows="4" ${b.status==='closed'?'readonly':''}>${qe(b.hypothesis)}</textarea></label><label>改进内容与版本<textarea name="fix" maxlength="1500" rows="3" ${b.status==='closed'?'readonly':''}>${qe(b.fix)}</textarea></label>${b.status!=='closed'?'<button class="button primary">保存分析</button>':''}</form>
 ${b.status!=='closed'?`<form data-q-regression="${b.id}" class="q-form q-regression"><h3>关联回归结果</h3><label>回归任务<select id="q-target-job" name="jobId" required><option value="">请选择</option>${regressionJobs.map(j=>`<option value="${j.id}" ${targetDetail?.job.id===j.id?'selected':''}>${when(j.created_at)} · ${j.evaluation?qe(j.evaluation.caseId+' / '+j.evaluation.variant):'第 '+(j.attempt_no||'?')+' 次'} · ${qe(j.model)}</option>`).join('')}</select></label><label>具体图片<select name="assetId"><option value="">执行异常可按整组验证</option>${targetAssets.map(a=>`<option value="${a.id}">样稿 ${a.output_index+1} · V${a.version} · ${qe(a.title)}</option>`).join('')}</select></label><p class="q-caption">读取已有任务与评测结果，不会重新调用生图模型。</p><button class="button secondary">验证回归证据</button></form>`:''}
 <section class="q-regression-history"><h3>回归记录</h3>${caseDetail.regressions.length?caseDetail.regressions.map(r=>`<details ${r===caseDetail.regressions[0]?'open':''}><summary>${when(r.created_at)} · ${r.outcome==='passed'?'通过':'未通过'} · 分析 V${r.report.caseVersion}</summary>${checkList(r.report.checks)}</details>`).join(''):'<p class="q-caption">尚未关联回归结果。</p>'}</section>
 <div class="q-actions"><button class="button ${b.status==='closed'?'secondary':'primary'}" data-q-close="${b.id}">${b.status==='closed'?'重新打开案例':'关闭案例'}</button></div></section>`;
}
function draw(){
 root.innerHTML=`<div class="view-heading"><div><h1 id="quality-title">质量中心</h1><p>跟踪创作过程，评价每张样稿，验证问题改进。</p></div><div class="q-actions"><button class="button secondary" data-q-export>导出当前记录</button><button class="button secondary" data-q-refresh>刷新</button></div></div><div class="q-filters"><label>数据范围<select id="q-scope">${options(Object.entries(scopes),scope)}</select></label><label>时间<select id="q-days">${options([[7,'最近 7 天'],[30,'最近 30 天'],[90,'最近 90 天']],days)}</select></label><a href="#badcases">MOCK 模拟演练</a></div><p id="quality-notice" role="status" class="q-notice"></p>${metricsMarkup()}<div class="q-workspace"><aside>${tasksMarkup()}<section class="q-record-list"><h2>问题复盘</h2>${caseList.length?caseList.map(caseLink).join(''):'<p class="q-empty">此范围暂无问题记录。</p>'}</section></aside>${caseDetail?badcaseMarkup():jobMarkup()}</div>`;
 const selected=location.hash.split('/')[2];if(selected&&selected!=='case')requestAnimationFrame(()=>document.getElementById('q-'+selected)?.scrollIntoView({block:'start',behavior:'instant'}));
}
async function load(){
 const token=++loading,parts=location.hash.split('/');
 try{
  let nextCase=null,nextBase=null,nextDetail=null,nextScope=scope;
  if(parts[1]==='case'&&parts[2]){nextCase=await api('/quality/badcases/'+encodeURIComponent(parts[2]));nextBase=await api('/quality/jobs/'+encodeURIComponent(nextCase.badcase.job_id));nextScope=nextBase.job.environment;}
  else if(parts[1]){nextDetail=await api('/quality/jobs/'+encodeURIComponent(parts[1]));nextScope=nextDetail.job.environment;}
  if(nextDetail)nextDetail.langfuse=await api('/quality/jobs/'+nextDetail.job.id+'/langfuse').catch(()=>null);
  const [o,c,targets]=await Promise.all([api(`/quality/overview?environment=${nextScope}&days=${days}`),api('/quality/badcases?environment='+nextScope),nextCase?api('/quality/badcases/'+nextCase.badcase.id+'/candidates'):Promise.resolve({jobs:[]})]);
  if(token!==loading)return;if(caseDetail?.badcase.id!==nextCase?.badcase.id)targetDetail=null;caseDetail=nextCase;baseDetail=nextBase;detail=nextDetail;scope=nextScope;regressionJobs=targets.jobs;overview=o;caseList=c.badcases;draw();
 }catch(e){if(token!==loading)return;if(!overview)root.innerHTML='<h1 id="quality-title">质量中心</h1><p id="quality-notice" role="status"></p><button class="button secondary" data-q-refresh>重新连接</button>';message(e.message,true);}
}
async function perform(action){if(working)return;working=true;root.setAttribute('aria-busy','true');try{await action();}catch(e){message(e.message+' 输入内容已保留。',true);}finally{working=false;root.removeAttribute('aria-busy');}}
function bind(){
 root.addEventListener('change',e=>{if(e.target.id==='q-scope'||e.target.id==='q-days'){scope=root.querySelector('#q-scope').value;days=Number(root.querySelector('#q-days').value);targetDetail=null;if(location.hash!=='#quality')location.hash='#quality';else void load();}
  if(e.target.id==='q-target-job')void perform(async()=>{targetDetail=e.target.value?await api('/quality/jobs/'+e.target.value):null;const form=e.target.form,select=form.elements.assetId;select.innerHTML='<option value="">执行异常可按整组验证</option>'+((targetDetail?.assets||[]).filter(a=>a.current).map(a=>`<option value="${a.id}">样稿 ${a.output_index+1} · V${a.version}</option>`).join(''));});
 });
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.hasAttribute('data-q-refresh'))void perform(async()=>{await flushTelemetry();await load();});
  if(b.hasAttribute('data-q-export')){const payload={exportedAt:new Date().toISOString(),scope:overview.scope,overview,detail,caseDetail};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='造物营_质量记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  if(b.dataset.qCheck)void perform(async()=>{await api('/quality/jobs/'+b.dataset.qCheck+'/check',{});await load();message('成品记录与规则检查已更新。');});
  if(b.dataset.qAdopt||b.dataset.qRevoke)void perform(async()=>{const id=b.dataset.qAdopt||b.dataset.qRevoke;await post('/quality/assets/'+id+'/feedback',{feedback:b.dataset.qAdopt?'adopted':'revoked'},'feedback-'+id);await load();await refreshMetrics();message('反馈已保存。');});
  if(b.dataset.qClose)void perform(async()=>{const c=caseDetail.badcase,f=root.querySelector('form[data-q-case]');if(c.status!=='closed'&&(f.elements.hypothesis.value.trim()!==c.hypothesis||f.elements.fix.value.trim()!==c.fix))throw new Error('请先保存当前分析，再验证回归证据。');await api('/quality/badcases/'+c.id,{version:c.version,status:c.status==='closed'?'investigating':'closed',hypothesis:c.hypothesis,fix:c.fix});await load();});
 });
 root.addEventListener('submit',e=>{const form=e.target;if(!form.matches('form[data-q-review],form[data-q-feedback],form[data-q-case],form[data-q-regression],form[data-q-diversity]'))return;e.preventDefault();const f=new FormData(form);
  void perform(async()=>{
   if(form.dataset.qReview||form.dataset.qFeedback){const id=form.dataset.qReview||form.dataset.qFeedback,body={feedback:form.dataset.qReview?f.get('decision'):'rejected',reasonCode:f.get('reasonCode')||'',note:f.get('note')||''};
    if(form.dataset.qReview)body.review={gates:Object.fromEntries(['facts','requirements','delivery'].map(k=>[k,f.get(k)==='true'])),scores:Object.fromEntries(['composition','style','light','text'].map(k=>[k,Number(f.get(k))])),editLevel:f.get('editLevel'),editMinutes:Number(f.get('editMinutes'))};
    await post('/quality/assets/'+id+'/feedback',body,'review-'+id);await load();await refreshMetrics();message('评审已保存；不采用结果已关联 Badcase。');
   }else if(form.dataset.qDiversity){await post('/quality/jobs/'+detail.job.id+'/diversity',{version:detail.job.compositionVersion,axes:f.getAll('axes'),passed:f.get('passed')==='true',note:f.get('note')},'diversity-'+detail.job.id);await load();message('差异评审已保存。');}
   else if(form.dataset.qCase){const c=caseDetail.badcase;await api('/quality/badcases/'+c.id,{version:c.version,status:'investigating',hypothesis:f.get('hypothesis'),fix:f.get('fix')});await load();message('归因与改进已保存，待回归验证。');}
   else if(form.dataset.qRegression){const result=await post('/quality/badcases/'+caseDetail.badcase.id+'/regressions',{jobId:f.get('jobId'),assetId:f.get('assetId')||null},'regression-'+caseDetail.badcase.id);await load();message(result.outcome==='passed'?'回归证据通过，可以关闭案例。':'回归未通过，案例保持打开。',result.outcome!=='passed');}
  });
 });
}
export function renderQuality(){const element=document.getElementById('view-quality');if(root!==element){root=element;bind();}if(!overview)root.innerHTML='<h1 id="quality-title">质量中心</h1><p id="quality-notice" role="status">正在读取质量记录…</p>';void load();}
