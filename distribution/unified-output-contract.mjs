// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Independent installed-output assertions, not a product formatter or authority parser.
import assert from 'node:assert/strict';
const integer=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
function data(value,required,optional=[]){
 assert.ok(value&&typeof value==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
 const keys=Reflect.ownKeys(value);assert.ok(keys.length<=required.length+optional.length);assert.ok(keys.every(k=>typeof k==='string'&&[...required,...optional].includes(k)));
 const result={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);assert.ok(d&&'value'in d,'Acceptance does not invoke result accessors');result[key]=d.value;}for(const key of required)assert.ok(Object.hasOwn(result,key));return result;
}
export function readUnifiedOutcome(message){
 assert.ok(['exec_command','write_stdin'].includes(message.toolName));assert.equal(message.isError,false);
 const d=data(message.details,['output','exit_code','running','truncated_bytes','unified_result'],['session_id','supervisor_ready','termination']);
 const time=data(d.unified_result,['version','wall_time_ms']);assert.equal(time.version,1);assert.ok(integer(time.wall_time_ms));
 assert.equal(typeof d.output,'string');assert.ok(d.output.length<=1024*1024);assert.equal(typeof d.running,'boolean');assert.ok(integer(d.truncated_bytes));assert.ok(d.exit_code===null||Number.isSafeInteger(d.exit_code));
 if(d.session_id!==undefined)assert.ok(typeof d.session_id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(d.session_id));if(d.running){assert.equal(typeof d.session_id,'string');assert.equal(d.exit_code,null);}
 if(d.supervisor_ready!==undefined)assert.equal(typeof d.supervisor_ready,'boolean');if(d.termination!==undefined)assert.ok(typeof d.termination==='string'&&/^[^\u0000-\u001f\u007f]{1,1024}$/.test(d.termination));
 assert.ok(Array.isArray(message.content)&&message.content.length===1);const content=data(message.content[0],['type','text']);assert.equal(content.type,'text');assert.equal(typeof content.text,'string');
 let expected=`Wall time: ${(time.wall_time_ms/1000).toFixed(4)} seconds\n`;
 expected+=d.running?`Process running with session ID ${d.session_id}`:d.exit_code===null?'Process stopped; exit code unavailable':`Process exited with code ${d.exit_code}`;
 if(!d.running&&d.session_id!==undefined)expected+=`\nMore output available with session ID ${d.session_id}`;
 if(d.supervisor_ready!==undefined)expected+=`\nSupervisor preamble: ${d.supervisor_ready?'received':'not confirmed'}`;
 if(d.termination!==undefined)expected+=`\nTermination: ${d.termination}`;
 if(d.truncated_bytes)expected+=`\nOutput omitted: ${d.truncated_bytes} bytes · not recoverable by polling or expansion`;
 expected+='\nOutput:\n'+d.output;
 assert.equal(content.text,expected,'Actual direct Unified text and native details disagree');return message.details;
}
export function validateNativeUnifiedOutput(rows){
 assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);
 for(const row of rows){assert.equal(row.requests,8);for(const key of ['nativeFunctionReplay','sameOwnedSession','literalReturnedOutput','exitedRetainedOutput','nonzeroExitAndLossVisible','readinessVisible','nativeDirectPresentation','measuredCallTimeBoundedByObservation','unchangedHistory'])assert.equal(row[key],true);assert.equal(row.activeScopes,0);assert.equal(row.drainingScopes,0);assert.equal(row.liveServiceCalls,0);}
 return {nativeExec:true,nativeStdin:true,plainModelOutput:true,measuredPerCallWallTime:true,structuredDetailsRetained:true,literalReturnedOutput:true,exitedRetainedOutput:true,nonzeroExitAndLossVisible:true,readinessVisible:true,nativeDirectPresentation:true,nativeResponses:true,nativeCodexResponses:true,nativeFunctionReplay:true,sameOwnedSession:true,measuredPerCallTimeObserved:true,syntheticModelRequests:16,liveServiceCalls:0};
}
