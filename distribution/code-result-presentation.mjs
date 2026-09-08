// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only installed native TUI acceptance, with no authority creation or replay.
import assert from 'node:assert/strict';
import {pollingPresentation,validatePollingFrames} from './polling-presentation.mjs';
export const CODE_RESULT_FRAMES=Object.freeze(['code-result-running','code-result-completed','code-result-expanded','code-result-failed','code-result-draining','code-result-terminated','code-result-output-loss','code-result-unknown-visible']);
export function validateCodeResultFrames(frames){
 assert.deepEqual(frames.map(f=>f.name),CODE_RESULT_FRAMES);
 for(const f of frames)assert.ok(typeof f.text==='string'&&f.text.trim());
 assert.match(frames[0].text,/Cell running · collect with wait/);assert.doesNotMatch(frames[0].text,/Cell completed/);
 for(const text of ['Cell completed','Coordinator output:','Task one: SAMPLE_ALPHA · exit 0','Task two: SAMPLE_BETA · exit 0','Empty-running polls: 4'])assert.ok(frames[1].text.includes(text));assert.doesNotMatch(frames[1].text,/cell_id|"output"|"version"/);
 assert.match(frames[2].text,/Cell details:/);assert.match(frames[2].text,/synthetic-readable-cell/);assert.match(frames[2].text,/"version": 1/);
 assert.match(frames[3].text,/Cell failed · EXECUTION_FAILED/);assert.match(frames[3].text,/Phase: compile/);assert.match(frames[3].text,/External effects: not determined/);assert.doesNotMatch(frames[3].text,/Cell completed/);
 assert.match(frames[4].text,/Cell draining · cleanup unconfirmed/);assert.doesNotMatch(frames[4].text,/Cell completed/);
 assert.match(frames[5].text,/Cell terminated/);assert.doesNotMatch(frames[5].text,/Cell completed/);
 assert.match(frames[6].text,/Output omitted: 47 bytes/);assert.match(frames[6].text,/not recoverable by expansion/);
 assert.match(frames[7].text,/SYNTHETIC_UNKNOWN_METADATA/);assert.doesNotMatch(frames[7].text,/Cell completed/);return true;
}
export function validateReadableFrames(frames){assert.equal(frames.length,27);validatePollingFrames(frames.slice(0,19));validateCodeResultFrames(frames.slice(19));return true;}
export function inspectCodeResult(ui,message,status,text){
 const before=JSON.stringify(message),history=ui.historySnapshot(),title=status==='failed'?'Cell failed':status==='running'?'Cell running':status==='terminated'?'Cell terminated':'Cell completed';
 const compact=ui.toolFrame(message.toolCallId);assert.ok(compact.includes(title),'Native Code result title missing');if(text)assert.ok(compact.includes(text),'Native Code result text missing');assert.doesNotMatch(compact,/"cell_id"|"output"|"version"/,'Raw wrapper displayed');
 ui.expand(true);const expanded=ui.toolFrame(message.toolCallId);ui.expand(false);assert.ok(expanded.includes('Cell details:'),'Expanded native details missing');assert.ok(expanded.includes(JSON.parse(message.content[0].text).cell_id),'Cell correlation missing');assert.equal(JSON.stringify(message),before,'UI mutated wire result');assert.equal(ui.historySnapshot(),history,'UI mutated native history');assert.equal(ui.toolFrame(message.toolCallId),compact,'Expansion did not restore compact view');return true;
}
export async function readableCodeFrames(session,native){
 const ui=pollingPresentation(session,native),frames=[];
 const terminal={cell_id:'synthetic-readable-cell',status:'completed',output:['Task one: SAMPLE_ALPHA · exit 0','Task two: SAMPLE_BETA · exit 0','Empty-running polls: 4'],result:{version:1,status:'ok'}};
 const render=async(name,tool,details)=>{ui.history([]);const call='synthetic-'+name;await ui.fixtureEvent({type:'tool_execution_start',toolCallId:call,toolName:tool,args:tool==='exec'?{code:'text("synthetic display only")'}:{cell_id:details.cell_id}});const result={content:[{type:'text',text:JSON.stringify(details)}],details},before=JSON.stringify(result);await ui.fixtureEvent({type:'tool_execution_end',toolCallId:call,toolName:tool,result,isError:false});assert.equal(JSON.stringify(result),before);frames.push({name,text:ui.frame()});return result;};
 try{
  await render(CODE_RESULT_FRAMES[0],'exec',{cell_id:terminal.cell_id,status:'running',output:[]});
  const r=await render(CODE_RESULT_FRAMES[1],'wait',terminal),before=JSON.stringify(r);ui.expand(true);frames.push({name:CODE_RESULT_FRAMES[2],text:ui.frame()});ui.expand(false);assert.equal(JSON.stringify(r),before);
  await render(CODE_RESULT_FRAMES[3],'exec',{cell_id:terminal.cell_id,status:'completed',output:[],result:{version:1,status:'error',code:'EXECUTION_FAILED',diagnostics:{guest_phase:'compile',delegated_calls:0,returned_results:0,tool_errors:0,last_delegation:null,effects:'not_determined'}}});
  for(const[name,status]of[[CODE_RESULT_FRAMES[4],'draining'],[CODE_RESULT_FRAMES[5],'terminated']])await render(name,'wait',{cell_id:terminal.cell_id,status,output:[]});
  await render(CODE_RESULT_FRAMES[6],'exec',{...terminal,output:[],omitted_output_bytes:47});
  await render(CODE_RESULT_FRAMES[7],'wait',{...terminal,output:[],extra:'SYNTHETIC_UNKNOWN_METADATA'});
  assert.equal(ui.pending(),0);validateCodeResultFrames(frames);return frames;
 }finally{ui.close();}
}
