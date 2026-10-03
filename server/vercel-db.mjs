import {createClient} from '@libsql/client/web';

const rows=result=>result.rows.map(row=>Object.fromEntries(result.columns.map((name,index)=>[name,row[index]])));
const mapped=result=>({success:true,results:rows(result),meta:{changes:Number(result.rowsAffected)}});

// A single libSQL write batch keeps the quota UPDATE and its changes() guard
// adjacent on the same transaction. Never fan these statements out with fetch.
export function createLibsqlDB(client){
 const prepare=sql=>({
  sql,args:[],
  bind(...args){this.args=args;return this;},
  async first(column){const result=rows(await client.execute({sql:this.sql,args:this.args}))[0]||null;return column&&result?result[column]:result;},
  async all(){return mapped(await client.execute({sql:this.sql,args:this.args}));},
  async run(){return mapped(await client.execute({sql:this.sql,args:this.args}));},
 });
 return {prepare,async batch(statements){return (await client.batch(statements.map(({sql,args})=>({sql,args})),'write')).map(mapped);}};
}

export function createRemoteDB(env){
 if(!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN)throw new Error('Database configuration missing');
 const client=createClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,intMode:'number'});
 return {DB:createLibsqlDB(client),client};
}
