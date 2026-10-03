import {emitKeypressEvents} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createRemoteDB} from '../server/vercel-db.mjs';
import {resetPassword,AuthError} from '../server/vercel-auth.mjs';

async function hiddenPassword(label){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw new Error('Run this command in an interactive terminal.');
 process.stdout.write(label);
 emitKeypressEvents(process.stdin);
 const wasRaw=process.stdin.isRaw;
 process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  const finish=(error)=>{process.stdin.removeListener('keypress',keypress);process.stdin.setRawMode(Boolean(wasRaw));process.stdin.pause();process.stdout.write('\n');if(error)reject(error);else resolve(value);};
  const keypress=(text,key={})=>{
   if(key.ctrl&&key.name==='c'){finish(new Error('Cancelled.'));return;}
   if(key.name==='return'){finish();return;}
   if(key.name==='backspace'){value=Array.from(value).slice(0,-1).join('');return;}
   if(text&&!key.ctrl&&!key.meta&&! /[\x00-\x1f\x7f]/.test(text)&&Array.from(value+text).length<=128)value+=text;
  };
  process.stdin.on('keypress',keypress);
 });
}

async function main(){
 if(process.argv.length!==3)throw new Error('Usage: node --env-file=.env.local scripts/reset-password.mjs account@example.com');
 const password=await hiddenPassword('New password (12–128 characters, hidden): ');
 const confirmation=await hiddenPassword('Confirm password (hidden): ');
 if(password!==confirmation)throw new Error('Passwords do not match.');
 const {DB,client}=createRemoteDB(process.env);
 try{await resetPassword({DB},process.argv[2],password);process.stdout.write('Password reset. All existing sessions were revoked.\n');}finally{client.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write((error instanceof AuthError?error.message:typeof error.message==='string'&&['Run this command in an interactive terminal.','Passwords do not match.','Cancelled.'].includes(error.message)?error.message:process.argv.length!==3?'Usage: node --env-file=.env.local scripts/reset-password.mjs account@example.com':'Password reset failed.')+'\n');process.exitCode=1;});
