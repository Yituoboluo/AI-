const KEY='zaowuying.badcase-demo.v1';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fresh=()=>({schema:1,tab:0,confirmed:false,result:null,checks:[false,false,false],closed:false,note:'',history:[]});
function restore(){try{const value=JSON.parse(localStorage.getItem(KEY)||'null');if(value?.schema!==1)return fresh();const confirmed=value.confirmed===true,result=confirmed&&['pass','fail'].includes(value.result)?value.result:null,checks=[0,1,2].map(i=>result==='pass'&&value.checks?.[i]===true);return {schema:1,tab:[0,1,2].includes(value.tab)?value.tab:0,confirmed,result,checks,closed:confirmed&&result==='pass'&&checks.every(Boolean)&&value.closed===true,note:typeof value.note==='string'?value.note.slice(0,800):'',history:Array.isArray(value.history)?value.history.filter(v=>typeof v==='string').slice(-20):[]};}catch{return fresh();}}
let state=restore(),root,icon,notice='',storageFailed=false,resetPending=false;
const status=()=>state.closed?'已关闭':state.result==='fail'?'回归未通过':state.result==='pass'?'待确认关闭':state.confirmed?'待回归':'待归因';
function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));storageFailed=false;}catch{storageFailed=true;}}
function record(text){state.history.push(text);state.history=state.history.slice(-20);persist();}
const badge=(text,kind='')=>`<span class="bc-badge ${kind}">${text}</span>`;
const nextButton=(tab,label)=>`<button class="button primary" data-bc-next="${tab}">${label} ${icon('arrow')}</button>`;

function evidence(){return `<div class="bc-section-heading"><h3 id="bc-panel-title-0">先还原用户没拿到图片的那一刻</h3><p>以下反馈、时间线与证据均为模拟，用于演示复盘方法。</p></div>
 <div class="bc-user-voice"><span>${icon('image')}</span><div><strong>“等了一会儿，页面显示生成失败。我又点了一次，还是没有图。”</strong><p>模拟反馈 · 商品场景图 · 首次创作</p></div></div>
 <div class="bc-expectation"><div><h4>预期</h4><p>上传商品后，拿到两张可检查、可下载的排版成品。</p></div><div><h4>实际</h4><p>背景生成结束，素材保存中断；页面只显示“生成失败”。</p></div></div>
 <h4 class="bc-subheading">模拟链路证据</h4><ol class="bc-timeline">
 <li><span class="bc-tick">${icon('check')}</span><div><strong>商品处理完成</strong><p>商品主体与创作参数已保存，可正常进入生成。</p></div>${badge('通过','positive')}</li>
 <li><span class="bc-tick">${icon('check')}</span><div><strong>模型返回有效背景</strong><p>响应成功，返回内容可解码为图片。</p></div>${badge('通过','positive')}</li>
 <li class="bc-fault"><span class="bc-tick">${icon('clock')}</span><div><strong>素材保存中断</strong><p>模拟存储写入超时；尚未形成可读取的成品。</p></div>${badge('异常','danger')}</li>
 <li><span class="bc-tick">${icon('help')}</span><div><strong>界面统一显示“生成失败”</strong><p>用户无法判断失败环节，也不知道能否继续保存。</p></div>${badge('体验问题','warning')}</li></ol>
 <p class="bc-evidence-note">证据边界：可以定位到保存阶段；仅凭这条模拟记录，无法判断具体网络或存储服务故障。</p>
 <div class="bc-panel-footer"><span>下一步：区分问题现象与根因</span>${nextButton(1,'查看归因')}</div>`;}

function attribution(){return `<div class="bc-section-heading"><h3 id="bc-panel-title-1">把“生成失败”拆成可验证的原因</h3><p>下面是预设的归因示例，确认操作仅推进本次模拟复盘。</p></div>
 <div class="bc-hypotheses"><div class="bc-hypothesis"><div><h4>假设一：模型没有生成图片</h4><p>模拟响应中已经有可解码图片，这条假设与现有证据不符。</p></div>${badge('已排除')}</div>
 <div class="bc-hypothesis supported"><div><h4>假设二：保存中断阻断了成品交付</h4><p>模型结果已返回，存储写入报错，成品记录缺失，三个节点能相互对应。</p></div>${badge('证据支持','warning')}</div>
 <div class="bc-hypothesis"><div><h4>假设三：商品图或抠图存在质量问题</h4><p>尚未进入成品检查，缺少视觉质量反馈，不能据此归因。</p></div>${badge('证据不足')}</div></div>
 <div class="bc-conclusion"><h4>本案例的归因结论</h4><dl><div><dt>直接原因</dt><dd>素材保存中断，生成结果没有交付为可读取的成品。</dd></div><div><dt>体验原因</dt><dd>多个阶段共用“生成失败”提示，用户误以为必须重新生成。</dd></div><div><dt>仍待验证</dt><dd>存储中断的底层原因，以及当时的中间结果是否仍可恢复。</dd></div></dl></div>
 <label class="bc-note-label" for="bc-note">你的复盘补充 <span>可选 · 保存在此浏览器</span></label><textarea id="bc-note" maxlength="800" rows="3" placeholder="例如：需要区分模型成功率与成品保存率，进一步核对存储请求记录。" ${state.confirmed?'readonly':''}>${esc(state.note)}</textarea>
 <div class="bc-panel-footer"><span>${state.confirmed?'归因已确认 · 模拟记录':'确认后查看改进方案与回归样例'}</span>${state.confirmed?`<button class="button secondary" data-bc-action="reopen">重新分析</button>${nextButton(2,'查看改进与回归')}`:'<button class="button primary" data-bc-action="confirm">确认归因（模拟）</button>'}</div>`;}

const regressionRows=()=>[
 ['正常生成','两张成品保存成功，刷新后仍可打开。',true],
 ['保存中断','显示失败环节；有可恢复结果时提供“继续保存”。',true],
 ['继续保存','复用原生成结果，不触发新的模型调用。',true],
 ['状态一致','恢复成功后，任务中心与结果页同步显示成品已保存。',state.result==='pass']
];
function regression(){return `<div class="bc-section-heading"><h3 id="bc-panel-title-2">让修复有明确的验收条件</h3><p>改进方案和回归结果均为模拟；播放样例不会调用模型或修改真实任务。</p></div>
 <ol class="bc-fix-list"><li><strong>拆开任务状态</strong><p>分别表达分析、生成、保存、排版阶段，让报错指向当前失败步骤。</p></li><li><strong>补充恢复路径</strong><p>保留可恢复的中间结果；仅重试保存。结果过期时明确提示下一步及调用影响。</p></li><li><strong>补齐验收记录</strong><p>核对成品可读取、页面状态一致、重复操作去重和模型调用次数。</p></li></ol>
 <div class="bc-regression-controls"><label for="bc-scenario">回归情景<select id="bc-scenario" ${!state.confirmed||state.closed?'disabled':''}><option value="pass">修复后的样例</option><option value="fail" ${state.result==='fail'?'selected':''}>仍有状态缺陷的样例</option></select></label><button class="button ${state.confirmed?'primary':'secondary'}" data-bc-action="replay" ${!state.confirmed||state.closed?'disabled':''}>${icon('layers')} 演示回归结果</button></div>
 ${!state.confirmed?`<p class="bc-guard">先在“归因分析”中确认结论，再进入模拟回归。<button class="text-link" data-bc-next="1">返回归因分析</button></p>`:''}
 ${state.result?`<div class="bc-regression-result" id="bc-regression-result" role="region" aria-label="模拟回归结果" tabindex="-1"><div class="bc-result-heading"><h4>回归结果 ${badge('模拟')}</h4>${badge(state.result==='pass'?'4 项通过':'3 项通过 · 1 项未通过',state.result==='pass'?'positive':'danger')}</div><table><thead><tr><th scope="col">检查项</th><th scope="col">样例中的表现</th><th scope="col">结果</th></tr></thead><tbody>${regressionRows().map(([name,description,passed])=>`<tr><th scope="row">${name}</th><td>${!passed?'成品已可读取，但任务中心仍显示“生成失败”。':description}</td><td>${badge(passed?'通过':'未通过',passed?'positive':'danger')}</td></tr>`).join('')}</tbody></table></div>
 ${state.result==='fail'?'<p class="bc-guard error">这轮不能关闭：仍需修复任务状态同步，再用同一组场景回归。</p>':`<fieldset class="bc-checks" ${state.closed?'disabled':''}><legend>关闭前确认</legend>${['问题现象、证据与归因能够对应','每项改进都有对应的验收结果','已明确这是模拟复盘，不能作为真实效果数据'].map((text,index)=>`<label><input type="checkbox" data-bc-check="${index}" ${state.checks[index]?'checked':''}>${text}</label>`).join('')}</fieldset>`}`:'<div class="bc-regression-empty"><p>先选择情景，再查看这组样例是否满足关闭条件。</p></div>'}
 <div class="bc-panel-footer"><span>${state.closed?'本次模拟复盘已完成。':state.result==='fail'?'当前状态：回归未通过':'通过回归并完成确认后，可以关闭案例。'}</span>${state.closed?'<button class="button secondary" data-bc-action="reopen">重新打开案例</button>':`<button class="button primary" id="bc-close" data-bc-action="close" ${state.result!=='pass'||!state.checks.every(Boolean)?'disabled':''}>关闭案例（模拟）</button>`}</div>`;}

function contextRail(){return `<aside class="bc-context" aria-label="案例信息"><h3>案例信息</h3><dl><div><dt>案例编号</dt><dd>BC-DEMO-001</dd></div><div><dt>所属场景</dt><dd>商品图片创作</dd></div><div><dt>影响</dt><dd>无法拿到成品，可能重复发起生成</dd></div><div><dt>处理优先级</dt><dd>高 · 阻断交付（示例）</dd></div><div><dt>复盘目标</dt><dd>定位失败环节，建立恢复与验证路径</dd></div></dl><h3>观察哪些指标</h3><p>成品保存率、重复调用次数，以及最终的有效创作次数。</p><p class="bc-muted">本案例不计入真实任务、采用率和北极星指标。</p><h3>演示进度</h3><ol class="bc-history"><li>模拟案例已载入</li>${state.history.map(item=>`<li>${esc(item)}</li>`).join('')}</ol><p class="bc-local">${storageFailed?'浏览器暂时无法保存。可导出复盘留存。':'演示进度仅保存在此浏览器。'}</p></aside>`;}

function report(){return `# Badcase 复盘与归因｜模拟案例\n\n> BC-DEMO-001。本文件的反馈、链路证据、归因与回归结果均为模拟，不代表真实商家反馈、线上故障诊断或业务效果。\n\n## 问题\n背景已生成，但保存中断，用户只看到“生成失败”。预期是拿到两张可下载成品；实际没有成品，并可能重复发起生成。\n\n## 模拟证据\n1. 商品处理完成，参数可读取。\n2. 模型返回内容可解码为背景图片。\n3. 存储写入超时，成品记录缺失。\n4. 页面统一显示“生成失败”，未解释失败阶段与恢复方式。\n\n## 归因\n- 直接原因：保存中断阻断成品交付。\n- 体验原因：多阶段状态合并，用户误以为必须重新生成。\n- 已排除：模型未返回图片，与模拟证据不符。\n- 待验证：存储中断的底层原因及中间结果可恢复性。\n- 归因状态：${state.confirmed?'已确认（模拟）':'待确认'}。\n\n## 复盘补充\n${state.note||'暂无。'}\n\n## 改进方案\n1. 拆分分析、生成、保存、排版状态。\n2. 保留可恢复中间结果；恢复时仅重试保存，过期或不可恢复时明确提示。\n3. 验证成品可读、任务状态一致、重复操作去重和模型调用次数。\n\n## 回归记录\n${state.result?regressionRows().map(([name,text,passed])=>`- ${name}：${passed?'通过':'未通过'}（模拟）。${passed?text:'成品已可读取，但任务中心仍显示生成失败。'}`).join('\n'):'尚未载入回归样例。'}\n\n## 结论\n当前状态：${status()}（模拟）。${state.closed?'通过所选回归样例与人工确认后关闭；不等于线上修复已验证。':'仍需按复盘流程完成确认和验证。'}\n`;}
function downloadReport(){const url=URL.createObjectURL(new Blob([report()],{type:'text/markdown;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='造物营_Badcase复盘_模拟案例.md';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function draw(focus){root.innerHTML=`<div class="bc-heading"><div><h1 id="badcases-title">Badcase 复盘</h1><p>从问题现场出发，让每个结论都有证据。</p></div><button class="button secondary" data-bc-action="export">${icon('download')} 导出复盘</button></div>
 <div class="bc-demo-note">${badge('MOCK · 模拟案例')}<p>预设反馈与样例证据，用于演示复盘和归因方法。</p><button class="button quiet" data-bc-action="reset">重置演示</button></div>
 ${resetPending?'<div class="bc-reset" role="group" aria-label="重置演示确认"><span>重置将清除这条模拟案例的复盘补充和演示进度。</span><button class="button secondary" data-bc-action="cancel-reset">取消</button><button class="button primary" data-bc-action="confirm-reset">确认重置</button></div>':''}
 <div class="bc-case-heading"><div><h2>背景已生成，成品却没有保存</h2><p>一次交付中断，如何定位到正确的环节？</p></div>${badge(status(),state.closed?'positive':state.result==='fail'?'danger':'warning')}</div>
 <div class="bc-layout"><section class="bc-sheet" aria-label="模拟复盘工作区"><div class="bc-tabs" role="tablist" aria-label="复盘步骤">${['问题现场','归因分析','改进与回归'].map((label,index)=>`<button role="tab" id="bc-tab-${index}" data-bc-tab="${index}" aria-controls="bc-panel" aria-selected="${state.tab===index}" tabindex="${state.tab===index?0:-1}"><span>${index+1}</span>${label}</button>`).join('')}</div><div class="bc-content" role="tabpanel" id="bc-panel" aria-labelledby="bc-tab-${state.tab}" tabindex="0">${[evidence,attribution,regression][state.tab]()}</div><p id="bc-notice" class="bc-notice ${storageFailed?'error':''}" role="status">${esc(storageFailed?'演示进度未能保存，可导出复盘留存。':notice)}</p></section>${contextRail()}</div>`;
 if(focus)root.querySelector('#'+focus)?.focus({preventScroll:true});}
function tab(index,focus=false){state.tab=index;notice='';persist();draw(focus?'bc-tab-'+index:undefined);}
export function renderBadcase(iconFn){icon=iconFn;const element=document.getElementById('view-badcases');if(root!==element){root=element;
 root.addEventListener('input',event=>{if(event.target.id==='bc-note'&&!state.confirmed){state.note=event.target.value;persist();const message=root.querySelector('#bc-notice');message.textContent=storageFailed?'未能保存复盘补充，可导出留存。':'复盘补充已保存在此浏览器。';}});
 root.addEventListener('change',event=>{if(event.target.dataset.bcCheck!==undefined&&!state.closed){state.checks[Number(event.target.dataset.bcCheck)]=event.target.checked;persist();root.querySelector('#bc-close').disabled=state.result!=='pass'||!state.checks.every(Boolean);}if(event.target.id==='bc-scenario'){const selected=event.target.value;if(state.result&&selected!==state.result){state.result=null;state.checks=[false,false,false];notice='已切换情景，请重新载入回归样例。';persist();draw('bc-scenario');root.querySelector('#bc-scenario').value=selected;}}});
 root.addEventListener('keydown',event=>{const current=event.target.dataset.bcTab;if(current===undefined)return;let index=Number(current);if(event.key==='ArrowRight')index=(index+1)%3;else if(event.key==='ArrowLeft')index=(index+2)%3;else if(event.key==='Home')index=0;else if(event.key==='End')index=2;else return;event.preventDefault();tab(index,true);});
 root.addEventListener('click',event=>{const button=event.target.closest('button');if(!button||button.disabled)return;if(button.dataset.bcTab!==undefined){tab(Number(button.dataset.bcTab),true);return;}if(button.dataset.bcNext!==undefined){tab(Number(button.dataset.bcNext),true);return;}
 const action=button.dataset.bcAction;if(!action)return;
 if(action==='export'){downloadReport();notice='已导出模拟复盘，文件包含当前结论与演示状态。';draw();return;}
 if(action==='reset'){resetPending=true;draw();root.querySelector('[data-bc-action="cancel-reset"]')?.focus();return;}
 if(action==='cancel-reset'){resetPending=false;draw();root.querySelector('[data-bc-action="reset"]')?.focus();return;}
 if(action==='confirm-reset'){state=fresh();resetPending=false;notice='模拟案例已重置。';persist();draw('bc-tab-0');return;}
 if(action==='confirm'&&!state.confirmed){state.confirmed=true;state.tab=2;record('已确认归因（模拟）');notice='已确认归因。可以查看改进方案并演示回归结果。';draw('bc-tab-2');return;}
 if(action==='replay'&&state.confirmed&&!state.closed){state.result=root.querySelector('#bc-scenario').value;state.checks=[false,false,false];record(state.result==='pass'?'回归样例：4 项通过（模拟）':'回归样例：状态同步未通过（模拟）');notice=state.result==='pass'?'样例已通过，完成关闭前确认后可关闭案例。':'样例仍有缺陷，当前不能关闭案例。';draw('bc-regression-result');root.querySelector('.bc-regression-result')?.scrollIntoView({block:'nearest',behavior:'instant'});return;}
 if(action==='close'&&state.confirmed&&state.result==='pass'&&state.checks.every(Boolean)){state.closed=true;record('已完成确认并关闭案例（模拟）');notice='这条模拟案例已闭环，可导出复盘。';draw('bc-tab-2');return;}
 if(action==='reopen'){state.confirmed=false;state.result=null;state.checks=[false,false,false];state.closed=false;state.tab=1;record('重新分析：原回归结论待重新验证');notice='已重新打开，更新归因后需要再次回归。';draw('bc-note');}
 });}
 draw();}
