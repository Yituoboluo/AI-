const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let context={mode:'independent',user:null,registration:'invite',upload:'blob',workspaceName:'zaowu-studio:anonymous',available:false};
let frozen=null,installed=false,channel=null,rechecking=null,saveBeforeChange=null,changing=false,reloading=false,dialogMode='login';
const browser=()=>typeof document!=='undefined'&&typeof window!=='undefined';
const node=id=>browser()?document.getElementById(id):null;

export function contextForSession(session){
 if(session?.mode==='legacy')return {mode:'legacy',user:null,registration:'disabled',upload:'legacy',workspaceName:'zaowu-studio',available:true};
 if(session?.mode!=='independent'||session.user!==null&&(!session.user||typeof session.user.id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(session.user.id)||typeof session.user.email!=='string'))throw new Error('登录服务返回的信息无效。');
 const user=session.user?{id:session.user.id,email:session.user.email}:null;
 return {mode:'independent',user,registration:['invite','open','disabled'].includes(session.registration)?session.registration:'disabled',upload:'blob',workspaceName:'zaowu-studio:'+(user?.id||'anonymous'),available:true};
}
export const headersForContext=value=>value.mode==='independent'?{'X-Zaowu-Workspace':value.user?.id||'anonymous'}:{};
export const workspaceChanged=(before,after)=>before.mode!==after.mode||(before.user?.id||null)!==(after.user?.id||null);
export const accountContext=()=>({...context,user:context.user?{...context.user}:null,frozen:Boolean(frozen)});
export const cloudAccountReady=()=>!frozen&&(context.mode==='legacy'||Boolean(context.user));
export function assertAccountActive(){if(frozen)throw Object.assign(new Error(frozen.message),{status:frozen.status,code:frozen.code});}
export function accountHeaders(){assertAccountActive();return headersForContext(context);}
export function setAccountSaveHook(hook){saveBeforeChange=hook;}

async function sessionContext(){
 const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(response.status===404)return contextForSession({mode:'legacy'});
 if(!response.ok)throw new Error('登录服务暂不可用，仍可使用本机草稿。');
 return contextForSession(await response.json());
}
export async function initializeAccount(){
 frozen=null;reloading=false;
 try{context=await sessionContext();}catch{context={...contextForSession({mode:'independent',user:null,registration:'disabled'}),available:false};}
 install();renderAccount();return accountContext();
}

function freeze(error){
 if(frozen)return;
 frozen={status:error.status||409,code:error.code||'WORKSPACE_CHANGED',message:error.message||'账号已切换，请刷新后继续。'};
 if(!browser())return;
 const stale=context.user||frozen.code==='WORKSPACE_CHANGED';
 if(stale){for(const element of document.querySelectorAll('main, .sidebar nav, [data-shell="new"]'))element.inert=true;}
 for(const dialog of document.querySelectorAll('dialog[open]'))if(dialog.id!=='account-dialog')dialog.close();
 const notice=node('account-notice');if(notice){notice.hidden=false;notice.querySelector('[data-account-message]').textContent=frozen.message;}
 document.dispatchEvent(new CustomEvent('account-frozen',{detail:{...frozen}}));
}
export function handleAccountError(error){
 if(context.mode!=='independent'||error.status!==401&&!(error.status===409&&error.code==='WORKSPACE_CHANGED'))return false;
 freeze({status:error.status,code:error.code||'SIGN_IN_REQUIRED',message:error.status===401?'登录已失效，请重新登录；当前创作保留在本机。':'账号已切换，请刷新后继续。'});
 showAccount();return true;
}
export async function reloadAccount(){
 if(!browser()||reloading)return;reloading=true;
 try{
  await saveBeforeChange?.();
  document.dispatchEvent(new Event('account-reload'));
  window.location.reload();
 }catch{
  freeze({code:'WORKSPACE_CHANGED',message:'本机修改尚未保存，请先导出备份，再刷新工作区。'});
  const notice=node('account-notice');if(notice){notice.hidden=false;notice.querySelector('[data-account-message]').textContent='本机修改尚未保存，请先导出备份，再刷新工作区。';}
  const feedback=node('account-dialog')?.querySelector('[data-account-feedback]');if(feedback)feedback.textContent='本机修改尚未保存，请关闭此窗口并先导出备份，再刷新工作区。';
  reloading=false;
 }
}
async function broadcastAndReload(){
 freeze({code:'WORKSPACE_CHANGED',message:'正在打开新的账号工作区…'});
 channel?.postMessage({type:'account-changed'});
 if(browser())try{localStorage.setItem('zaowu-account-change',crypto.randomUUID());}catch{}
 await reloadAccount();
}
async function recheck(){
 if(!browser()||context.mode==='legacy'||changing||rechecking)return;
 rechecking=(async()=>{try{const next=await sessionContext();if(workspaceChanged(context,next)){freeze({code:'WORKSPACE_CHANGED',message:'账号已在其他页面切换，正在重新载入…'});await reloadAccount();}}catch{/* Keep this account's local cache isolated while the network is unavailable. */}})();
 try{await rechecking;}finally{rechecking=null;}
}

function renderAccount(){
 const button=node('account-button');if(button){button.hidden=context.mode==='legacy';button.textContent=context.user?'我的账号':'登录 / 注册';button.title=context.user?.email||'登录云端工作区';}
 const profile=node('account-profile');if(profile&&context.mode==='independent'){profile.textContent=context.user?.email||'本机创作空间';}
 const subtitle=node('account-profile-note');if(subtitle&&context.mode==='independent')subtitle.textContent=context.user?'当前账号 · 云端与本机':'登录后使用 AI 与云端保存';
}
export function authSettings(){
 if(context.mode==='legacy')return '';
 if(context.user)return `<section class="settings-card account-card"><h2>我的账号</h2><p class="account-email">${esc(context.user.email)}</p><p>当前创作保存在此账号的独立工作区。切换账号后，只会打开对应账号的创作。</p><div class="settings-actions"><button class="button secondary" data-account="logout">退出登录</button></div><p class="body-small muted">退出前会保存本机修改。其他账号和未登录时的草稿可通过备份主动导入。</p></section>`;
 return `<section class="settings-card account-card"><h2>登录云端工作区</h2><p>${context.available?'登录后可使用 AI 生成、云端保存与跨设备读取。':'登录服务暂不可用，可刷新重试；本机草稿仍可编辑。'}</p><div class="settings-actions"><button class="button dark" data-account="open">登录${context.registration==='disabled'?'':' / 注册'}</button></div><p class="body-small muted">本机草稿与账号草稿分别保存。登录后不会自动同步未登录时的内容，可先导出备份，再主动导入。</p></section>`;
}
function dialogMarkup(){
 if(context.user&&!frozen)return `<div class="dialog-header"><h2 id="account-title">我的账号</h2><button class="icon-button" data-account="close" aria-label="关闭账号窗口">×</button></div><div class="dialog-body"><p class="account-email">${esc(context.user.email)}</p><p>当前账号的创作与其他工作区分别保存。</p><p class="account-feedback" data-account-feedback role="status"></p></div><div class="dialog-actions"><button class="button secondary" data-account="logout">退出登录</button><button class="button dark" data-account="close">继续创作</button></div>`;
 const signup=dialogMode==='register',canSignup=context.registration!=='disabled';
 return `<div class="dialog-header"><div><h2 id="account-title">${signup?'创建账号':'登录造物营'}</h2><p class="body-small muted">打开属于你的云端工作区</p></div><button type="button" class="icon-button" data-account="close" aria-label="关闭登录窗口">×</button></div><form data-account-form><div class="dialog-body">${canSignup?`<div class="account-tabs" role="group" aria-label="登录方式"><button type="button" data-account="login" aria-pressed="${!signup}">登录</button><button type="button" data-account="register" aria-pressed="${signup}">注册</button></div>`:''}<label class="field">邮箱<input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label><label class="field">密码<input name="password" type="password" autocomplete="${signup?'new-password':'current-password'}" minlength="12" maxlength="128" required placeholder="至少 12 个字符"></label>${signup&&context.registration==='invite'?'<label class="field">邀请码<input name="inviteCode" autocomplete="off" maxlength="256" required placeholder="填写管理员提供的邀请码"></label>':''}<p class="account-feedback" data-account-feedback role="status">${esc(frozen?.message||'')}</p>${signup?'<p class="body-small muted">未登录时的本机草稿可在登录前导出备份，登录后主动导入。</p>':'<p class="body-small muted">忘记密码时，请联系管理员重置。</p>'}</div><div class="dialog-actions"><button type="button" class="button secondary" data-account="close">稍后再说</button><button class="button dark" type="submit">${signup?'注册并登录':'登录'}</button></div></form>`;
}
function showAccount(mode='login'){
 const dialog=node('account-dialog');if(!dialog||context.mode==='legacy')return;
 dialogMode=mode==='register'&&context.registration!=='disabled'?'register':'login';
 dialog.innerHTML=dialogMarkup();if(!dialog.open)dialog.showModal();dialog.querySelector('input')?.focus();
}
async function mutate(action,body){
 if(changing)return;changing=true;
 const dialog=node('account-dialog'),buttons=dialog?.querySelectorAll('button')||[];
 for(const button of buttons)button.disabled=true;
 try{
  if(!frozen)await saveBeforeChange?.();
  const response=await fetch('/api/auth/'+action,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(action==='logout'?headersForContext(context):{})},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(15000)});
  const value=await response.json();
  if(!response.ok)throw Object.assign(new Error(value.error?.message||'登录请求未完成，请重试。'),{status:response.status,code:value.error?.code});
  await broadcastAndReload();
 }catch(error){
  const feedback=dialog?.querySelector('[data-account-feedback]');if(feedback)feedback.textContent=error.message;
  if(action==='logout')handleAccountError(error);
 }finally{changing=false;for(const button of buttons)button.disabled=false;}
}
function install(){
 if(!browser()||installed)return;installed=true;
 if(typeof BroadcastChannel!=='undefined'){channel=new BroadcastChannel('zaowu-account');channel.onmessage=event=>{if(event.data?.type==='account-changed'){freeze({code:'WORKSPACE_CHANGED',message:'账号已在其他页面切换，正在重新载入…'});void reloadAccount();}};}
 window.addEventListener('storage',event=>{if(event.key==='zaowu-account-change'){freeze({code:'WORKSPACE_CHANGED',message:'账号已在其他页面切换，正在重新载入…'});void reloadAccount();}});
 window.addEventListener('pageshow',()=>void recheck());
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void recheck();});
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-account]');if(!button)return;
  const action=button.dataset.account;
  if(action==='close')node('account-dialog')?.close();
  else if(action==='reload')void reloadAccount();
  else if(action==='logout'){if(!node('account-dialog')?.open)showAccount();void mutate('logout',{});}
  else showAccount(action);
 });
 document.addEventListener('submit',event=>{
  if(!event.target.matches('[data-account-form]'))return;event.preventDefault();
  const form=new FormData(event.target),body={email:form.get('email'),password:form.get('password')};
  if(dialogMode==='register'&&context.registration==='invite')body.inviteCode=form.get('inviteCode');
  void mutate(dialogMode,body);
 });
}
