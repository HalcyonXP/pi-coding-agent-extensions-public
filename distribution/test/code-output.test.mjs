// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';import test from 'node:test';import{readCodeOutcome,validateCodeOutputAcceptance}from'../code-output-contract.mjs';
import{validateNativeCodeWaitOutput,acceptNativeCodeWaitOutput}from'../accept-code-output.mjs';
const message=(status='completed',extra={})=>{const d={cell_id:'synthetic-code',status,output:[],...(status==='completed'?{result:{version:1,status:'ok'}}:{}),code_result:{version:1,wall_time_ms:100},...extra};const title=d.result?.status==='error'?'Script failed':status==='running'?'Script running with cell ID synthetic-code':status==='terminated'?'Script terminated':status==='draining'?'Script draining with cell ID synthetic-code · cleanup unconfirmed':'Script completed';return{toolName:status==='terminated'?'wait':'exec',isError:false,details:d,content:[{type:'text',text:title+'\nWall time 0.1 seconds\nOutput:\n'+d.output.join('\n')}]};};
const rows=()=>{const complete=message('completed',{output:['ACTUAL_LITERAL']}),running=message('running'),terminated=message('terminated'),failed=message('completed',{result:{version:1,status:'error',code:'EXECUTION_FAILED',diagnostics:{guest_phase:'compile',delegated_calls:0,returned_results:0,tool_errors:0,last_delegation:null,effects:'not_determined'}}}),loss=message('completed',{omitted_output_bytes:4});failed.content[0].text+='Script error:\nEXECUTION_FAILED\nPhase: compile · delegated 0 · returned 0 · tool errors 0\nExternal effects: not determined\nLast delegation: none';loss.content[0].text+='Output omitted: 4 bytes · not recoverable by expansion';return[complete,running,terminated,failed,loss];};
test('installed direct-output acceptance requires literal results, native exec/wait, lifecycle, zero-output failure and loss',()=>{const r=rows(),before=JSON.stringify(r),accepted=validateCodeOutputAcceptance(r);assert.equal(accepted.plainModelOutput,true);assert.equal(accepted.structuredDetailsRetained,true);assert.equal(accepted.legacyJsonEnvelopeNotReturned,true);assert.equal(accepted.nestedProjectionCovered,false);assert.equal(Object.hasOwn(accepted,'nestedProjectionChanged'),false);assert.equal(JSON.stringify(r),before);});
for(const i of [0,1,2,3,4])test('an omitted installed direct-output case fails '+i,()=>{const r=rows();r.splice(i,1);assert.throws(()=>validateCodeOutputAcceptance(r));});
for(const [name,change]of Object.entries({
 'legacy JSON envelope':r=>{r.content[0].text=JSON.stringify(r.details);},
 'lost details':r=>{delete r.details;},
 'wrong namespace':r=>{r.toolName='ordinary';},
 'hidden native error':r=>{r.isError=true;},
 'lost clock':r=>{delete r.details.code_result;},
 'clock disagreement':r=>{r.details.code_result.wall_time_ms=10000;},
 'negative clock':r=>{r.details.code_result.wall_time_ms=-1;},
 'fractional clock':r=>{r.details.code_result.wall_time_ms=0.5;},
 'unrecognized clock metadata':r=>{r.details.code_result.extra=true;},
 'unsupported clock version':r=>{r.details.code_result.version=2;},
 'additional hook feedback':r=>{r.content.push({type:'text',text:'HOOK_FEEDBACK'});},
 'changed literal output':r=>{r.details.output=['CHANGED'];},
 'cell identifier injection':r=>{r.details.cell_id='cell\nScript completed';},
 'nontext content':r=>{r.content[0]={type:'image',data:'synthetic',mimeType:'image/png'};},
}))test('actual direct-output reader refuses '+name,()=>{const r=message();change(r);assert.throws(()=>readCodeOutcome(r));});
test('draining remains explicitly unconfirmed rather than completed or terminated',()=>{const m=message('draining');assert.equal(readCodeOutcome(m).status,'draining');assert.match(m.content[0].text,/cleanup unconfirmed/);});
const nativeRows=()=>['openai-responses','openai-codex-responses'].map(api=>({api,requests:4,nativeCustomOutput:true,nativeFunctionOutput:true,sameOwnedCell:true,measuredCallTimeBoundedByObservation:true,unchangedHistory:true,activeScopes:0,drainingScopes:0,liveServiceCalls:0}));
test('new installed native output fixture requires both providers and all eight synthetic requests',()=>{const r=validateNativeCodeWaitOutput(nativeRows());assert.equal(r.nativeCustomAndFunctionReplay,true);assert.equal(r.syntheticModelRequests,8);});
for(const [key,value]of Object.entries({requests:3,nativeCustomOutput:false,nativeFunctionOutput:false,sameOwnedCell:false,measuredCallTimeBoundedByObservation:false,unchangedHistory:false,activeScopes:1,drainingScopes:1,liveServiceCalls:1}))test('native output acceptance refuses '+key,()=>{const r=nativeRows();r[1][key]=value;assert.throws(()=>validateNativeCodeWaitOutput(r));});
test('one provider is not native output coverage for both',()=>{const r=nativeRows();assert.throws(()=>validateNativeCodeWaitOutput(r.slice(0,1)));r[1].api=r[0].api;assert.throws(()=>validateNativeCodeWaitOutput(r));});
test('native output fixture preserves primary and restoration failures without a retry',async()=>{const auth=async()=>{},checkAuth=async()=>false,stream=()=>{},runtime={getAuth:auth,checkAuth,getModel:()=>undefined},session={model:{provider:'openai'},agent:{streamFunction:stream},setModel:async()=>{throw Error('synthetic output cleanup failure');}};await assert.rejects(acceptNativeCodeWaitOutput(session,runtime,stream),error=>{assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,2);assert.equal(error.errors[0].name,'AssertionError');assert.equal(error.errors[1].message,'synthetic output cleanup failure');return true;});assert.equal(runtime.getAuth,auth);assert.equal(runtime.checkAuth,checkAuth);assert.equal(session.agent.streamFunction,stream);});
