// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Synthetic events on actual native components; no invocation/ownership or user-state discovery.
import assert from 'node:assert/strict';
import {pollingPresentation} from './polling-presentation.mjs';
import {validateReadableFrames} from './code-result-presentation.mjs';
import {readLegacyUnifiedOutcome} from './unified-output-contract.mjs';
export const UNIFIED_OUTPUT_FRAMES=Object.freeze(['unified-output-running','unified-output-retained','unified-output-expanded','unified-output-loss','unified-output-hook-visible']);
export function validateUnifiedOutputFrames(frames){
 assert.deepEqual(frames.map(f=>f.name),UNIFIED_OUTPUT_FRAMES);for(const f of frames)assert.ok(typeof f.text==='string'&&f.text.trim());
 assert.match(frames[0].text,/Process running with session ID synthetic-unified/);assert.match(frames[0].text,/Supervisor preamble: not confirmed/);assert.doesNotMatch(frames[0].text,/Process exited/);
 assert.match(frames[1].text,/Process exited with code 7/);assert.match(frames[1].text,/More output available with session ID synthetic-unified/);assert.match(frames[1].text,/more lines/);assert.doesNotMatch(frames[1].text,/Process running/);
 assert.match(frames[2].text,/UNIFIED_LITERAL_12/);assert.match(frames[2].text,/"literal JSON"/);assert.doesNotMatch(frames[2].text,/more lines/);
 assert.match(frames[3].text,/Output omitted: 47 bytes/);assert.match(frames[3].text,/Termination: Cancelled by user\./);
 assert.match(frames[4].text,/SYNTHETIC_UNIFIED_HOOK_FEEDBACK/);
 for(const f of frames)assert.doesNotMatch(f.text,/Local job group|"unified_result"|"wall_time_ms"/);return true;
}
export function validateAllOutputFrames(frames){assert.equal(frames.length,36);validateReadableFrames(frames.slice(0,31));validateUnifiedOutputFrames(frames.slice(31));return true;}
export async function unifiedOutputFrames(session,native){
 const ui=pollingPresentation(session,native),frames=[];
 const render=async(name,details,text,hook=false)=>{
  ui.history([]);const id='synthetic-'+name,toolName='exec_command';const result={content:[{type:'text',text}],details};
  if(!hook)readLegacyUnifiedOutcome({...result,toolName,isError:false});const saved=JSON.stringify(result);
  await ui.fixtureEvent({type:'tool_execution_start',toolCallId:id,toolName,args:{cmd:'synthetic display only'}});
  await ui.fixtureEvent({type:'tool_execution_end',toolCallId:id,toolName,result,isError:false});
  assert.equal(JSON.stringify(result),saved);assert.equal(ui.groups().length,0);frames.push({name,text:ui.frame()});return result;
 };
 try{
  const running={session_id:'synthetic-unified',output:'',exit_code:null,running:true,supervisor_ready:false,truncated_bytes:0,unified_result:{version:1,wall_time_ms:214}};
  await render(UNIFIED_OUTPUT_FRAMES[0],running,'Wall time: 0.2140 seconds\nProcess running with session ID synthetic-unified\nSupervisor preamble: not confirmed\nOutput:\n');
  const output=Array.from({length:13},(_,n)=>'UNIFIED_LITERAL_'+n).join('\n')+'\n{"literal JSON":"not a summary"}',terminal={...running,output,exit_code:7,running:false,supervisor_ready:true};
  const text='Wall time: 0.2140 seconds\nProcess exited with code 7\nMore output available with session ID synthetic-unified\nSupervisor preamble: received\nOutput:\n'+output;
  const r=await render(UNIFIED_OUTPUT_FRAMES[1],terminal,text),saved=JSON.stringify(r);ui.expand(true);frames.push({name:UNIFIED_OUTPUT_FRAMES[2],text:ui.frame()});ui.expand(false);assert.equal(JSON.stringify(r),saved);
  await render(UNIFIED_OUTPUT_FRAMES[3],{...terminal,output:'',termination:'Cancelled by user.',truncated_bytes:47},'Wall time: 0.2140 seconds\nProcess exited with code 7\nMore output available with session ID synthetic-unified\nSupervisor preamble: received\nTermination: Cancelled by user.\nOutput omitted: 47 bytes · not recoverable by polling or expansion\nOutput:\n');
  await render(UNIFIED_OUTPUT_FRAMES[4],{...terminal,output:'',hookExtra:true},'SYNTHETIC_UNIFIED_HOOK_FEEDBACK',true);
  assert.equal(ui.pending(),0);validateUnifiedOutputFrames(frames);return frames;
 }finally{ui.close();}
}
