import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acceptUnifiedDefaults,validateUnifiedDefaults} from '../accept-unified-defaults.mjs';
const rows=()=>['openai-responses','openai-codex-responses'].map(api=>({api,requests:6,scenarios:3,directBytes:40000,remainderBytes:10001,initialWaitObserved:true,omittedControlsReplayed:true,originalIDCollected:true,nestedEscapedOutputComplete:true,nestedWrappersBounded:true,historyUnchanged:true,activeScopes:0,drainingScopes:0}));
test('default acceptance distinguishes actual initial wait/output and native nested collection',()=>{const r=validateUnifiedDefaults(rows());assert.equal(r.syntheticModelRequests,12);assert.equal(r.scenarios,6);assert.equal(r.omittedOutputBytes,40000);assert.equal(r.liveServiceCalls,0);});
for(const i of [0,1])for(const key of Object.keys(rows()[0]))test(`omitted default acceptance refuses altered ${i}.${key}`,()=>{const r=rows();r[i][key]=typeof r[i][key]==='boolean'?false:typeof r[i][key]==='number'?r[i][key]+1:'unknown';assert.throws(()=>validateUnifiedDefaults(r));delete r[i][key];assert.throws(()=>validateUnifiedDefaults(r));});
for(const shape of ['missing','duplicate','reversed'])test('omitted default acceptance refuses '+shape+' routes',()=>{const r=rows();if(shape==='missing')r.pop();if(shape==='duplicate')r.push(r[0]);if(shape==='reversed')r.reverse();assert.throws(()=>validateUnifiedDefaults(r));});
test('default acceptance restores descriptors/subscription and aggregates primary/model restoration failures',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'unified-default-cleanup-')),model={id:'original'},stream=()=>{},auth=()=>{},check=()=>{};let unsubscribed=0,selections=0;
 const runtime={getAuth:auth,checkAuth:check,getModel(){throw Error('primary failure');}};
 const session={model,agent:{streamFunction:stream,subscribe(){return()=>{unsubscribed++;};}},getActiveToolNames(){return ['exec','wait'];},async setModel(next){assert.equal(next,model);selections++;throw Error('restore failure');}};
 const before=[Object.getOwnPropertyDescriptor(runtime,'getAuth'),Object.getOwnPropertyDescriptor(runtime,'checkAuth'),Object.getOwnPropertyDescriptor(session.agent,'streamFunction')];let passed=false;
 try{await assert.rejects(acceptUnifiedDefaults(session,runtime,stream,cwd),e=>{assert.ok(e instanceof AggregateError);assert.deepEqual(e.errors.map(e=>e.message),['primary failure','restore failure']);return true;});assert.equal(unsubscribed,1);assert.equal(selections,1);assert.deepEqual([Object.getOwnPropertyDescriptor(runtime,'getAuth'),Object.getOwnPropertyDescriptor(runtime,'checkAuth'),Object.getOwnPropertyDescriptor(session.agent,'streamFunction')],before);passed=true;}
 finally{if(passed)await rm(cwd,{recursive:true});}
});
