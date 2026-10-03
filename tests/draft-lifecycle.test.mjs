import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileLifecycle} from '../public/draft-lifecycle.js';
const local={id:'project-1',serverVersion:1,draft:{headline:'旧正文'},pendingTrash:true,deletedAt:'2026-09-23'};
const remote={...local,serverVersion:3,name:'新版',draft:{headline:'远端新版'},thumbnail:'/new.png'};
test('offline edits survive delete and restore acknowledgements until content sync',()=>{
 const edited={...local,pendingCloud:true,draft:{headline:'离线修改'}};
 const deleted=reconcileLifecycle(edited,remote,true);
 assert.equal(deleted.pendingCloud,true);assert.equal(deleted.pendingTrash,false);assert.equal(deleted.draft.headline,'离线修改');
 const restored=reconcileLifecycle(deleted,{...remote,serverVersion:4,deletedAt:null},true);
 assert.equal(restored.deletedAt,null);assert.equal(restored.pendingCloud,true);assert.equal(restored.draft.headline,'离线修改');
});
test('conflict reconciliation advances version without dropping pending deletion',()=>{
 const result=reconcileLifecycle(local,{...remote,deletedAt:null});
 assert.equal(result.serverVersion,3);assert.equal(result.deletedAt,local.deletedAt);assert.equal(result.pendingTrash,true);
});
test('clean cache adopts latest remote content when lifecycle is acknowledged',()=>{
 const result=reconcileLifecycle(local,{...remote,deletedAt:null},true);
 assert.equal(result.draft.headline,'远端新版');assert.equal(result.name,'新版');assert.equal(result.pendingTrash,false);assert.equal(result.deletedAt,null);
});
