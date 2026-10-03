import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {createLibsqlDB} from '../server/vercel-db.mjs';

test('libSQL adapter maps named rows and returning changes without serializing array indexes',async()=>{
 const client=createClient({url:'file::memory:',intMode:'number'}),DB=createLibsqlDB(client);
 try{
  await DB.prepare('CREATE TABLE items(id TEXT PRIMARY KEY,n INTEGER)').run();
  assert.equal((await DB.prepare('INSERT INTO items VALUES(?,?)').bind('a',1).run()).meta.changes,1);
  assert.deepEqual(await DB.prepare('SELECT * FROM items WHERE id=?').bind('a').first(),{id:'a',n:1});
  assert.deepEqual((await DB.prepare('UPDATE items SET n=n+1 WHERE id=? RETURNING n').bind('a').all()).results,[{n:2}]);
  assert.equal(await DB.prepare('SELECT * FROM items WHERE id=?').bind('missing').first(),null);
 }finally{client.close();}
});

test('write batches preserve adjacent changes guards, atomic quota and rollback',async()=>{
 const client=createClient({url:'file::memory:',intMode:'number'}),DB=createLibsqlDB(client);
 try{
  await client.executeMultiple('CREATE TABLE quota(id TEXT PRIMARY KEY,used INTEGER);CREATE TABLE jobs(id TEXT PRIMARY KEY);');
  const reserve=id=>DB.batch([
   DB.prepare("INSERT OR IGNORE INTO quota VALUES('owner',0)"),
   DB.prepare("UPDATE quota SET used=used+1 WHERE id='owner' AND used<1 AND NOT EXISTS(SELECT 1 FROM jobs WHERE id=?)").bind(id),
   DB.prepare('INSERT OR IGNORE INTO jobs SELECT ? WHERE changes()=1').bind(id),
  ]);
  const first=await reserve('job-a');
  assert.deepEqual(first.map(x=>x.meta.changes),[1,1,1]);
  assert.equal((await reserve('job-a'))[2].meta.changes,0);
  assert.equal((await reserve('job-b'))[2].meta.changes,0);
  assert.equal((await DB.prepare('SELECT used FROM quota').first()).used,1);
  assert.deepEqual((await DB.prepare('SELECT id FROM jobs').all()).results,[{id:'job-a'}]);
  await assert.rejects(DB.batch([DB.prepare("UPDATE quota SET used=9"),DB.prepare("INSERT INTO jobs VALUES('job-a')")]));
  assert.equal((await DB.prepare('SELECT used FROM quota').first()).used,1);
 }finally{client.close();}
});
