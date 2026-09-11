// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// New owned timers and synthetic model responses, through the real installed SDK.
import assert from "node:assert/strict";
import {setTimeout as pause} from "node:timers/promises";
import {pollingPresentation} from "./polling-presentation.mjs";
import {validateCompactLocalJobs} from "./accept-local-jobs.mjs";
const auditCount=messages=>messages.flatMap(m=>typeof m.content==="string"?[{type:"text",text:m.content}]:m.content??[]).filter(b=>b.type==="text"&&/^Code mode: (exec_command|write_stdin) (returned|failed)\.$/.test(b.text)).length;

export function validateQuietPolling(rows) {
 assert.equal(rows.length,2);
 for(const r of rows){
  assert.equal(r.modelRequestsDuringWork,2);assert.equal(r.shellStarts,3);assert.ok(r.quietPolls>=1);
  assert.equal(r.quietCards,0);assert.equal(r.quietAudits,0);assert.equal(r.inFlightInputChanged,false);
  assert.equal(r.visibleMeaningfulResults,r.meaningfulResults);assert.equal(r.pendingPresentation,0);
  assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);
 }
 const [normal,aborted]=rows;
 assert.equal(normal.aborted,false);assert.equal(normal.terminalResults,3);assert.equal(normal.collectedCell,true);
 assert.equal(normal.followupAudits,normal.expectedAudits);assert.ok(normal.expectedAudits>=6);
 assert.equal(aborted.aborted,true);assert.equal(aborted.startsAfterAbort,0);assert.ok(aborted.errorResults>=1);
 return {threeNestedJobs:true,quietPollsHidden:true,noQuietPollAudits:true,meaningfulResultsVisible:true,nativeToolPresentation:true,modelRequestsDuringWork:2,unchangedInFlightInput:true,intentionalAbortDrained:true,automaticIdleTurns:false,liveTokenOrQuotaMeasurement:false};
}

export async function acceptQuietPolling(session,invoke,outcome,faux,ai,native) {
 const rows=[];
 for(const cancel of [false,true]){
  const ui=pollingPresentation(session,native),raw=[],inputs=[],journalStart=session.sessionManager.getEntries().length,messageStart=session.messages.length;
  const priorAudits=auditCount(session.messages),stream=session.agent.streamFunction;let requests=0,aborted=false,inFlight,inFlightJSON;
  const off=session.agent.subscribe(event=>{if(["tool_execution_start","tool_execution_end"].includes(event.type)&&["exec_command","write_stdin"].includes(event.toolName)){assert.ok(event.scopeId);raw.push({...event,afterAbort:aborted});}});
  session.agent.streamFunction=(model,context,options)=>{requests++;inputs.push(auditCount(context.messages)-priorAudits);if(requests===2){inFlight=context.messages;inFlightJSON=JSON.stringify(inFlight);}return stream(model,context,options);};
  try{
   // Concurrent owned starts accommodate the Windows 10s initial floor. Timers
   // outlive the first 5s poll; no production wait/cleanup budget is bypassed.
   const durations=cancel?[30000,32000,34000]:[20000,22000,24000];
   const code=`const jobs=await Promise.all(${JSON.stringify(durations)}.map(async(ms,n)=>{const r=await tools.exec_command({cmd:'Start-Sleep -Milliseconds '+ms+'; Write-Output QUIET_TIMER_'+n,yield_time_ms:1});if(r.isError||!r.result.details.running)throw Error('synthetic start refused');return {id:r.result.details.session_id,n};}));yield_control();for(const job of jobs){let r,output='';do{r=await tools.write_stdin({session_id:job.id,yield_time_ms:250});if(r.isError)throw Error('synthetic poll refused');output+=r.result.details.output;}while(r.result.details.running);if(r.result.details.exit_code!==0||!output.includes('QUIET_TIMER_'+job.n))throw Error('synthetic output missing');text('QUIET_DONE_'+job.n);}`;
   faux.setResponses([ai.fauxAssistantMessage([ai.fauxToolCall("exec",{code:'// @exec: {"yield_time_ms":1000}\n'+code})],{stopReason:"toolUse"}),async()=>{
    const began=performance.now();while(performance.now()-began<35000){
     assert.equal(requests,2);assert.equal(JSON.stringify(inFlight),inFlightJSON);
     if(cancel&&raw.filter(e=>e.type==="tool_execution_start"&&e.toolName==="write_stdin").length>=2){aborted=true;session.agent.abort();break;}
     const info=session.agent.getToolGatewayInfo();if(!cancel&&info.activeScopes===0&&info.drainingScopes===0)break;await pause(25);
    }
    return ai.fauxAssistantMessage("Synthetic ordinary work during local polling");
   }]);
   await session.prompt("Synthetic owned quiet-poll acceptance");assert.equal(requests,2);
   const first=session.messages.slice(messageStart).find(m=>m.role==="toolResult"&&m.toolName==="exec"),cell=outcome(first);assert.equal(cell.status,"running");
   for(let n=0;n<100;n++){const i=session.agent.getToolGatewayInfo();if(i.activeScopes===0&&i.drainingScopes===0)break;await pause(50);}await ui.settle();
   const info=session.agent.getToolGatewayInfo(),ends=raw.filter(e=>e.type==="tool_execution_end"),quiet=ends.filter(e=>e.localPoll==="quiet"),ids=new Set(quiet.map(e=>e.toolCallId));
   const journal=session.sessionManager.getEntries().slice(journalStart).filter(e=>e.type==="custom"&&e.customType==="code-mode-protected-evidence"&&e.data?.details?.auditOnly);
   const meaningful=ends.filter(e=>e.localPoll!=="quiet"),visible=new Set(ui.forwarded.filter(e=>e.type==="tool_execution_end").map(e=>e.toolCallId));
   const row={aborted,shellStarts:raw.filter(e=>e.type==="tool_execution_start"&&e.toolName==="exec_command").length,modelRequestsDuringWork:requests,quietPolls:quiet.length,quietCards:ui.forwarded.filter(e=>ids.has(e.toolCallId)).length,quietAudits:journal.filter(e=>ids.has(e.data.details.toolCallId)).length,inFlightInputChanged:JSON.stringify(inFlight)!==inFlightJSON,meaningfulResults:meaningful.length,visibleMeaningfulResults:meaningful.filter(e=>visible.has(e.toolCallId)).length,terminalResults:ends.filter(e=>e.toolName==="write_stdin"&&!e.isError&&e.result.details?.running===false&&e.result.details?.exit_code===0).length,errorResults:ends.filter(e=>e.isError).length,startsAfterAbort:raw.filter(e=>e.type==="tool_execution_start"&&e.afterAbort).length,pendingPresentation:ui.pending(),activeScopes:info.activeScopes,drainingScopes:info.drainingScopes};
   if(!cancel){
    for(let n=0;n<3;n++)assert.ok(ui.frame().includes('QUIET_TIMER_'+n),"Actual terminal output missing from native tool presentation");
    const collected=outcome(await invoke("wait",{cell_id:cell.cell_id,yield_time_ms:1000}));assert.equal(collected.status,"completed");assert.equal(collected.result.status,"ok");for(let n=0;n<3;n++)assert.ok(collected.output.includes('QUIET_DONE_'+n));
    row.collectedCell=true;row.expectedAudits=journal.length;row.followupAudits=inputs[2];
   }else assert.ok(session.messages.some(m=>m.role==="assistant"&&m.stopReason==="aborted"));
   const before=JSON.stringify(session.messages),compact=ui.groupFrame(),groups=ui.groups();
   row.groupCount=groups.length;row.compactLines=compact.split("\n").length;row.compactOutputs=[0,1,2].filter(n=>compact.includes('QUIET_TIMER_'+n)).length;
   row.groupAudits=groups.reduce((n,g)=>n+g.audits.size,0);row.prominentAbort=compact.includes('error');
   ui.expand(true);const expanded=ui.groupFrame();row.expandedNativeDetails=expanded.includes('Scope:')&&expanded.includes('Call:')&&expanded.includes('session_id');ui.expand(false);
   row.presentationMutatedHistory=JSON.stringify(session.messages)!==before;
   rows.push(row);
  }finally{off();session.agent.streamFunction=stream;ui.close();}
 }
 return {quietLocalPolling:validateQuietPolling(rows),compactLocalJobs:validateCompactLocalJobs(rows)};
}
