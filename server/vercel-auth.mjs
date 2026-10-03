import {createHash,randomBytes,randomUUID,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {isIP} from 'node:net';

const derive=promisify(scrypt);
const cookieName='__Host-zaowu_session';
const scryptOptions={N:131072,r:8,p:1,maxmem:256*1024*1024};
const now=()=>Math.floor(Date.now()/1000);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const statement=(env,sql,...args)=>env.DB.prepare(sql).bind(...args);
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff',...headers}});

export class AuthError extends Error{
 constructor(status,code,message){super(message);this.name='AuthError';Object.assign(this,{status,code});}
}
const fail=(status,code,message)=>{throw new AuthError(status,code,message);};
function setting(value,fallback,min,max){const number=Number(value);return value!==undefined&&Number.isSafeInteger(number)?Math.min(max,Math.max(min,number)):fallback;}
function registrationMode(env){const mode=env.AUTH_REGISTRATION_MODE||'invite';return ['invite','open','disabled'].includes(mode)?mode:'disabled';}
function ttl(env){return setting(env.AUTH_SESSION_TTL_SECONDS,604800,300,2592000);}
function cookie(token,seconds){return `${cookieName}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;}
function sessionToken(request){
 const matches=(request.headers.get('cookie')||'').split(';').map(part=>part.trim()).filter(part=>part.startsWith(cookieName+'='));
 if(matches.length!==1)return null;
 const token=matches[0].slice(cookieName.length+1);
 return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}

export async function authenticateSession(request,env){
 const token=sessionToken(request);
 if(!token)return null;
 const row=await statement(env,`SELECT u.id,u.email,u.data_owner_id,s.expires_at
   FROM auth_sessions s JOIN auth_users u ON u.id=s.user_id
   WHERE s.token_hash=? AND s.expires_at>?`,sha256(token),now()).first();
 return row?{user:{id:row.id,email:row.email},ownerId:row.data_owner_id,expiresAt:Number(row.expires_at)}:null;
}

export function requireWorkspace(request,session){
 if(!session)fail(401,'SIGN_IN_REQUIRED','请登录后使用云端工作区。');
 if(request.headers.get('x-zaowu-workspace')!==session.user.id)fail(409,'WORKSPACE_CHANGED','账号已切换，请刷新后继续。');
}

function checkOrigin(request){
 const origin=request.headers.get('origin');
 if(request.headers.get('sec-fetch-site')==='cross-site'||(request.method!=='GET'||origin!==null)&&origin!==new URL(request.url).origin)fail(403,'ORIGIN_REJECTED','请从当前工作区执行操作。');
}

async function readJson(request,allowed){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')fail(415,'JSON_REQUIRED','请求格式需要为 JSON。');
 const max=4096;
 const declared=Number(request.headers.get('content-length'));
 if(Number.isFinite(declared)&&declared>max)fail(413,'AUTH_BODY_TOO_LARGE','登录信息过长。');
 const reader=request.body?.getReader();
 if(!reader)fail(400,'INVALID_AUTH_INPUT','登录信息格式不正确。');
 let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();fail(413,'AUTH_BODY_TOO_LARGE','登录信息过长。');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;
 for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let body;
 try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{fail(400,'INVALID_AUTH_INPUT','登录信息格式不正确。');}
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key)))fail(400,'INVALID_AUTH_INPUT','登录信息格式不正确。');
 return body;
}

function credentials(body){
 if(typeof body.email!=='string'||typeof body.password!=='string')fail(400,'INVALID_AUTH_INPUT','请填写邮箱和密码。');
 const email=body.email.trim().toLowerCase();
 const parts=email.split('@');
 if(email.length>254||parts.length!==2||parts[0].length>64||! /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email)||email.includes('..'))fail(400,'INVALID_AUTH_INPUT','邮箱格式不正确。');
 const length=Array.from(body.password).length;
 if(length<12||length>128)fail(400,'INVALID_AUTH_INPUT','密码需要 12 到 128 个字符。');
 if(body.inviteCode!==undefined&&(typeof body.inviteCode!=='string'||body.inviteCode.length>256))fail(400,'INVALID_AUTH_INPUT','邀请码格式不正确。');
 return {email,password:body.password};
}

async function passwordHash(password){
 const salt=randomBytes(16);
 const key=await derive(password,salt,64,scryptOptions);
 return `scrypt$131072$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}
async function verifyPassword(password,encoded){
 const match=typeof encoded==='string'?encoded.match(/^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/):null;
 // Missing users and damaged hashes still perform the same expensive derivation.
 const salt=match?Buffer.from(match[1],'hex'):Buffer.alloc(16);
 const expected=match?Buffer.from(match[2],'hex'):Buffer.alloc(64);
 const actual=await derive(password,salt,64,scryptOptions);
 return timingSafeEqual(actual,expected)&&Boolean(match);
}

async function limitAttempts(request,env,email){
 // Vercel overwrites x-forwarded-for at its trusted edge. Other hosts must do so too.
 const candidate=(request.headers.get('x-forwarded-for')||'').split(',')[0].trim();
 const ip=isIP(candidate)?candidate.toLowerCase():'unknown';
 const timestamp=now(),window=900;
 await statement(env,'DELETE FROM auth_rate_limits WHERE expires_at<=?',timestamp).run();
 const limits=[['ip',ip,setting(env.AUTH_RATE_IP_LIMIT,30,1,1000)],['email',email,setting(env.AUTH_RATE_EMAIL_LIMIT,10,1,1000)]];
 for(const [kind,value,maximum]of limits){
  const row=await statement(env,`INSERT INTO auth_rate_limits(rate_key,window_started_at,attempts,expires_at)
    VALUES(?,?,1,?) ON CONFLICT(rate_key) DO UPDATE SET
    attempts=CASE WHEN expires_at<=? THEN 1 ELSE attempts+1 END,
    window_started_at=CASE WHEN expires_at<=? THEN excluded.window_started_at ELSE window_started_at END,
    expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END
    RETURNING attempts,expires_at`,kind+':'+sha256(value),timestamp,timestamp+window,timestamp,timestamp,timestamp).first();
  if(!row)throw new Error('Authentication rate limit storage unavailable');
  if(Number(row.attempts)>maximum){const error=new AuthError(429,'AUTH_RATE_LIMITED','尝试次数过多，请稍后再试。');error.retryAfter=Math.max(1,Number(row.expires_at)-timestamp);throw error;}
 }
}

function newSession(env,userId){
 const token=randomBytes(32).toString('base64url'),seconds=ttl(env),createdAt=now();
 const tokenHash=sha256(token),expiresAt=createdAt+seconds;
 return {token,seconds,tokenHash,createdAt,expiresAt,statement:statement(env,'INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)',tokenHash,userId,createdAt,expiresAt)};
}
async function register(request,env){
 const mode=registrationMode(env);
 if(mode==='disabled')fail(403,'REGISTRATION_DISABLED','暂未开放注册。');
 const body=await readJson(request,['email','password','inviteCode']);
 const {email,password}=credentials(body);
 await limitAttempts(request,env,email);
 if(mode==='invite'){
  if(typeof env.AUTH_INVITE_CODE!=='string'||!env.AUTH_INVITE_CODE)fail(503,'AUTH_NOT_CONFIGURED','注册暂不可用，请联系管理员。');
  const supplied=sha256(body.inviteCode||''),expected=sha256(env.AUTH_INVITE_CODE);
  if(!timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex')))fail(403,'INVITATION_REQUIRED','请输入有效的邀请码。');
 }
 const id=randomUUID(),hash=await passwordHash(password),timestamp=now(),session=newSession(env,id);
 try{
  await env.DB.batch([
   statement(env,'INSERT INTO auth_users(id,email,password_hash,data_owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,email,hash,id,timestamp,timestamp),
   session.statement
  ]);
 }catch(error){
  if(await statement(env,'SELECT id FROM auth_users WHERE email=?',email).first())fail(409,'REGISTRATION_FAILED','无法注册此账号，请登录或联系管理员。');
  throw error;
 }
 return json({user:{id,email}},201,{'Set-Cookie':cookie(session.token,session.seconds)});
}
async function login(request,env){
 const {email,password}=credentials(await readJson(request,['email','password']));
 await limitAttempts(request,env,email);
 const row=await statement(env,'SELECT id,email,password_hash FROM auth_users WHERE email=?',email).first();
 if(!await verifyPassword(password,row?.password_hash))fail(401,'INVALID_CREDENTIALS','邮箱或密码不正确。');
 const session=newSession(env,row.id);
 // The password can change while scrypt is running. Only the verified hash may issue a session.
 const inserted=await statement(env,`INSERT INTO auth_sessions(token_hash,user_id,created_at,expires_at)
   SELECT ?,id,?,? FROM auth_users WHERE id=? AND password_hash=? RETURNING token_hash`,session.tokenHash,session.createdAt,session.expiresAt,row.id,row.password_hash).first();
 if(!inserted)fail(401,'INVALID_CREDENTIALS','邮箱或密码不正确。');
 return json({user:{id:row.id,email:row.email}},200,{'Set-Cookie':cookie(session.token,session.seconds)});
}

// Administrator-only helper for the local CLI; there is no public reset route.
export async function resetPassword(env,email,password){
 const normalized=credentials({email,password});
 const user=await statement(env,'SELECT id,email FROM auth_users WHERE email=?',normalized.email).first();
 if(!user)fail(404,'ACCOUNT_NOT_FOUND','账号不存在。');
 const hash=await passwordHash(normalized.password);
 await env.DB.batch([
  statement(env,'UPDATE auth_users SET password_hash=?,updated_at=? WHERE id=?',hash,now(),user.id),
  statement(env,'DELETE FROM auth_sessions WHERE user_id=?',user.id)
 ]);
 return {id:user.id,email:user.email};
}
async function logout(request,env){
 await readJson(request,[]);
 const session=await authenticateSession(request,env);
 if(session){requireWorkspace(request,session);await statement(env,'DELETE FROM auth_sessions WHERE token_hash=?',sha256(sessionToken(request))).run();}
 return json({user:null},200,{'Set-Cookie':cookie('',0)});
}

export async function authRoute(request,env){
 const path=new URL(request.url).pathname;
 if(!path.startsWith('/api/auth/'))return null;
 try{
  checkOrigin(request);
  if(path==='/api/auth/session'&&request.method==='GET')return json({mode:'independent',user:(await authenticateSession(request,env))?.user||null,registration:registrationMode(env),upload:'blob'});
  if(['/api/auth/register','/api/auth/login','/api/auth/logout'].includes(path)){
   if(request.method!=='POST')return json({error:{code:'METHOD_NOT_ALLOWED',message:'请求方法不支持。'}},405,{Allow:'POST'});
   if(path.endsWith('/register'))return await register(request,env);
   if(path.endsWith('/login'))return await login(request,env);
   return await logout(request,env);
  }
  return json({error:{code:'AUTH_ROUTE_NOT_FOUND',message:'登录接口不存在。'}},404);
 }catch(error){
  if(error instanceof AuthError)return json({error:{code:error.code,message:error.message}},error.status,error.retryAfter?{'Retry-After':String(error.retryAfter)}:{});
  return json({error:{code:'AUTH_UNAVAILABLE',message:'登录服务暂不可用，请稍后再试。'}},503);
 }
}
