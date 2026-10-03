import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRemoteDB} from '../server/vercel-db.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
export async function migrateVercel(env=process.env){
 const {DB,client}=createRemoteDB(env);
 try{
  await DB.prepare('CREATE TABLE IF NOT EXISTS _vercel_schema_migrations(name TEXT PRIMARY KEY,sha256 TEXT NOT NULL)').run();
  const files=[];
  for(const dir of ['drizzle','server/vercel'])for(const name of (await readdir(path.join(root,dir))).filter(x=>x.endsWith('.sql')).sort())files.push(`${dir}/${name}`);
  for(const name of files){
   const sql=await readFile(path.join(root,name),'utf8'),hash=createHash('sha256').update(sql).digest('hex');
   const applied=await DB.prepare('SELECT sha256 FROM _vercel_schema_migrations WHERE name=?').bind(name).first();
   if(applied){if(applied.sha256!==hash)throw new Error('Applied migration changed: '+name);continue;}
   // These versioned files contain DDL only, with no semicolons inside literals.
   const statements=sql.replace(/--> statement-breakpoint/g,'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>DB.prepare(x));
   statements.push(DB.prepare('INSERT INTO _vercel_schema_migrations(name,sha256) VALUES(?,?)').bind(name,hash));
   await DB.batch(statements);console.log('Applied '+name);
  }
  console.log('Vercel database schema ready.');
 }finally{client.close();}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await migrateVercel();
