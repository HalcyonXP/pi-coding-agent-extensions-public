import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acceptNestedOutput,validateNestedOutput} from '../accept-nested-output.mjs';
const rows=()=>['openai-responses','openai-codex-responses'].map(api=>({api,requests:8,scenarios:4,retainedCollections:3,hookRefusals:1,completeOutput:true,boundedWrappers:true,originalIDs:true,historyUnchanged:true,customReplay:true,activeScopes:0,drainingScopes:0}));
test('native nested acceptance requires both routes, original-ID collection and unchanged hook refusal',()=>{const value=validateNestedOutput(rows());assert.equal(value.syntheticModelRequests,16);assert.equal(value.scenarios,8);assert.equal(value.oversizedHookRefused,true);assert.equal(value.liveServiceCalls,0);});
for(const index of [0,1])for(const key of Object.keys(rows()[0]))test(`native nested acceptance refuses altered ${index}.${key}`,()=>{const r=rows();r[index][key]=typeof r[index][key]==='number'?r[index][key]+1:typeof r[index][key]==='boolean'?false:'unknown';assert.throws(()=>validateNestedOutput(r));});
for(const which of ['missing','duplicate','reversed'])test('native nested acceptance refuses '+which+' routes',()=>{const r=rows();if(which==='missing')r.pop();if(which==='duplicate')r.push(r[0]);if(which==='reversed')r.reverse();assert.throws(()=>validateNestedOutput(r));});
test('acceptance restores owned hooks/model/auth/stream after primary and restoration failures',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'nested-output-cleanup-')),handlers=[],model={id:'original'},originalStream=()=>{},auth=()=>{},check=()=>{},active=['exec','wait'];let unsubscribed=0,selections=0;
 const runtime={getAuth:auth,checkAuth:check,getModel(){throw Error('primary fixture failure');}};
 const session={model,agent:{streamFunction:originalStream,subscribe(){return()=>{unsubscribed++;};}},getActiveToolNames(){return active;},async setModel(next){assert.equal(next,model);selections++;throw Error('restoration fixture failure');}};
 const resources={getExtensions(){return{extensions:[{tools:new Map([['exec',{}],['wait',{}]]),handlers:new Map([['tool_result',handlers]])}]};}};
 let passed=false;
 try{await assert.rejects(acceptNestedOutput(session,runtime,originalStream,cwd,resources),e=>{assert.ok(e instanceof AggregateError);assert.deepEqual(e.errors.map(e=>e.message),['primary fixture failure','restoration fixture failure']);return true;});assert.equal(unsubscribed,1);assert.equal(selections,1);assert.equal(runtime.getAuth,auth);assert.equal(runtime.checkAuth,check);assert.equal(session.agent.streamFunction,originalStream);assert.deepEqual(handlers,[]);passed=true;}
 finally{if(passed)await rm(cwd,{recursive:true});}
});
