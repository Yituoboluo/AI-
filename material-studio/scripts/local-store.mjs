import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';

export async function localStore(root,filename=':memory:',assetDir=null){
  const sqlite=new DatabaseSync(filename);
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  for(const name of (await readdir(path.join(root,'drizzle'))).filter(x=>x.endsWith('.sql')).sort()){
    if(!sqlite.prepare('SELECT name FROM _local_migrations WHERE name=?').get(name)){
      sqlite.exec('BEGIN');
      try{sqlite.exec(await readFile(path.join(root,'drizzle',name),'utf8'));sqlite.prepare('INSERT INTO _local_migrations VALUES (?)').run(name);sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}
    }
  }
  const prepare=sql=>({sql,args:[],bind(...args){this.args=args;return this;},async first(){return sqlite.prepare(sql).get(...this.args)||null;},async all(){return {results:sqlite.prepare(sql).all(...this.args),success:true};},async run(){const info=sqlite.prepare(sql).run(...this.args);return {success:true,meta:{changes:Number(info.changes)}};}});
  let batchTail=Promise.resolve();
  const DB={prepare,batch(statements){const next=batchTail.then(async()=>{sqlite.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());sqlite.exec('COMMIT');return values;}catch(e){sqlite.exec('ROLLBACK');throw e;}});batchTail=next.catch(()=>{});return next;}};
  const memory=new Map();
  const assetPath=key=>{if(!/^[a-f0-9]{64}\/assets\/[a-f0-9]{64}\.(png|jpeg|webp)$/.test(key))throw new Error('Invalid asset key');return path.join(assetDir,key);};
  const BUCKET={async put(key,bytes,options={}){const value={bytes:new Uint8Array(bytes),type:options.httpMetadata?.contentType||'image/png'};if(assetDir){const file=assetPath(key);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value.bytes);}else memory.set(key,value);},async get(key){let item;if(assetDir){try{item={bytes:await readFile(assetPath(key)),type:'image/'+key.split('.').at(-1)};}catch(e){if(e.code==='ENOENT')return null;throw e;}}else item=memory.get(key);return item?{body:item.bytes,httpMetadata:{contentType:item.type}}:null;},async head(key){return (await this.get(key))?{}:null;}};
  return {DB,BUCKET,sqlite};
}
