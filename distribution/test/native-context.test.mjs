// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {assertNativeContextReceipt,expectedNativeContextResult} from '../native-context-contract.mjs';
import {readCodeOutcome} from '../code-output-contract.mjs';
const source='a'.repeat(40);
test('native additional output is not parsed as a Code completion',()=>assert.throws(()=>readCodeOutcome({role:'toolResult',toolName:'exec',toolCallId:'original',notification:true,isError:false,content:[{type:'text',text:'notice'}]}),/not a Code completion/));
for(const name of ['web','notifications'])test(`${name}: preserve primary, model-restore and receipt-write failures`,async()=>{
 const {mkdtemp,mkdir,readdir,rm}=await import('node:fs/promises'),{join}=await import('node:path'),{tmpdir}=await import('node:os');const cwd=await mkdtemp(join(tmpdir(),'native-context-cleanup-control-'));
 const primary=Error('synthetic primary'),restoration=Error('synthetic model restore');let calls=0,off=0,passed=false;
 const auth=async()=>{},check=async()=>true,stream=()=>{},runtime={getAuth:auth,checkAuth:check,getModel:()=>({})};
 const session={model:{},agent:{streamFunction:stream,subscribe:()=>()=>{off++;}},setModel:async()=>{for(const entry of await readdir(cwd))await mkdir(join(cwd,entry,'observations.json'),{recursive:true});throw ++calls===1?primary:restoration;}};
 try{
  const run=name==='web'?(await import('../web-context-scenarios.mjs')).exerciseWebContext:(await import('../notification-scenarios.mjs')).exerciseNativeNotifications;
  await assert.rejects(run(session,runtime,stream,cwd,{state:{}}),error=>{assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,3);assert.equal(error.errors[0],primary);assert.equal(error.errors[1],restoration);assert.equal(typeof error.errors[2].code,'string');return true;});
  assert.equal(off,1);assert.equal(runtime.getAuth,auth);assert.equal(runtime.checkAuth,check);assert.equal(session.agent.streamFunction,stream);passed=true;
 }finally{if(passed)await rm(cwd,{recursive:true,force:true});}
});
function receipt(cohort){return {kind:'actual-bundle-native-context',cohort,bundleSource:source,profile:'synthetic-profile',externalAttempts:0,result:expectedNativeContextResult(cohort)};}
function leaves(value,path=[]){return value&&typeof value==='object'?Object.entries(value).flatMap(([key,v])=>leaves(v,[...path,key])):[path];}
for(const cohort of ['context','notifications']){
 test(`${cohort}: exact complete receipt`,()=>assert.doesNotThrow(()=>assertNativeContextReceipt(receipt(cohort),{source,cohort})));
 for(const path of leaves(receipt(cohort).result))test(`${cohort}: rejects changed ${path.join('.')}`,()=>{
  const r=receipt(cohort);let parent=r.result;for(const key of path.slice(0,-1))parent=parent[key];const key=path.at(-1),v=parent[key];parent[key]=typeof v==='boolean'?!v:typeof v==='number'?v+1:v+' changed';
  assert.throws(()=>assertNativeContextReceipt(r,{source,cohort}));
 });
 for(const key of Object.keys(receipt(cohort)))test(`${cohort}: missing ${key}`,()=>{const r=receipt(cohort);delete r[key];assert.throws(()=>assertNativeContextReceipt(r,{source,cohort}));});
 for(const change of [r=>r.bundleSource='b'.repeat(40),r=>r.externalAttempts=1,r=>r.profile='',r=>r.kind='source-only',r=>r.extra=true,r=>r.result.rows.pop(),r=>r.result.rows.reverse(),r=>r.result.rows.push(r.result.rows[0]),r=>r.result.extra=true])test(`${cohort}: rejects source/scope/coverage mutation ${String(change)}`,()=>{const r=receipt(cohort);change(r);assert.throws(()=>assertNativeContextReceipt(r,{source,cohort}));});
}
test('redaction-only development is not complete actual-bundle context acceptance',()=>{const r=receipt('context');r.result.forwardedHistory=false;r.result.coverage=['serialized-redaction'];r.result.syntheticModelRequests=6;r.result.syntheticServiceRequests=0;r.result.scenarios=2;r.result.rows=r.result.rows.filter(row=>row.scenario==='serialized-redaction');assert.throws(()=>assertNativeContextReceipt(r,{source,cohort:'context'}));});

test('artifact workflow requires both native cohorts without removing Web/media or widening job budget', async()=>{
 const {readFile}=await import('node:fs/promises');const text=(await readFile(new URL('../../.github/workflows/private-windows-artifacts.yml',import.meta.url),'utf8')).replace(/\r\n/g,'\n');
 assert.match(text,/timeout-minutes: 20/);
 for(const cohort of ['context','notifications'])assert.ok(text.includes(`timeout-minutes: 5\n        run: node distribution/accept-native-context.mjs '.pi/extracted artifact' ${cohort}`));
 for(const cohort of ['web','media','imagegen','web-profile'])assert.ok(text.includes(`timeout-minutes: 5\n        run: node distribution/accept-web-media.mjs '.pi/extracted artifact' ${cohort}`));
 assert.ok(text.includes('No deployment, publishing, credentials or executable artifact upload.'));
});
