// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Real installed native completion/history behavior; synthetic model delay and owned fixture only.
import assert from "node:assert/strict";
import {writeFile} from "node:fs/promises";
import {join} from "node:path";
import {setTimeout as pause} from "node:timers/promises";
const matches=(details,id)=>details?.kind==="unified_exec_completion"&&details.session_id===id;
const modelReports=(context,id)=>context.messages.flatMap(m=>{const text=typeof m.content==="string"?m.content:Array.isArray(m.content)?m.content.filter(c=>c.type==="text").map(c=>c.text).join("\n"):"";if(!text.includes("Unified exec completed."))return [];try{const value=JSON.parse(text.slice(text.indexOf('{')));return matches(value,id)?[value]:[];}catch{return [];}});
export async function acceptAsyncCompletion(session,invoke,outcome,faux,ai,cwd,timing={now:()=>performance.now(),pause}) {
 const quote=s=>`'${s.replaceAll("'","''")}'`,control="async-completion-release.txt";
 const program=`process.stdout.write('ASYNC_READY\\n');setTimeout(()=>process.exit(19),30000);setInterval(()=>{if(require('node:fs').existsSync('${control}')){process.stdout.write('ASYNC_DONE\\n');process.exit(7)}},25)`;
 const first=outcome(await invoke("exec_command",{cmd:`& ${quote(process.execPath)} -e ${quote(program)}; exit $LASTEXITCODE`,yield_time_ms:1}));assert.equal(first.running,true);assert.equal(typeof first.session_id,"string");
 const id=first.session_id;let r=first,output=first.output;
 for(let n=0;n<30&&!output.split(/\r?\n/).includes("ASYNC_READY");n++){r=outcome(await invoke("write_stdin",{session_id:id,yield_time_ms:300}));output+=r.output;}
 assert.ok(output.split(/\r?\n/).includes("ASYNC_READY"));assert.equal(r.running,true);assert.equal(r.supervisor_ready,true);
 const lastPoll=timing.now(),reports=()=>session.messages.filter(m=>m.role==="custom"&&matches(m.details,id)),events=[];
 const unsubscribe=session.subscribe(event=>{if(event.type==="message_end"&&event.message.role==="custom"&&matches(event.message.details,id))events.push(event.message);});
 let modelRequests=0,safeContextObserved=false,journalObservedWhileStreaming=false;
 try {
  faux.setResponses([
   async context=>{
    modelRequests++;assert.equal(reports().length,0);assert.equal(session.isStreaming,true);
    // Release the newly owned synthetic child while a genuine model request is in
    // flight. Never use another write_stdin to obtain or manufacture completion.
    await writeFile(join(cwd,control),"synthetic release",{flag:"wx"});
    for(let n=0;n<30;n++){
     const journal=session.sessionManager.getEntries().filter(e=>e.type==="custom"&&e.customType==="code-mode-protected-evidence"&&matches(e.data?.details,id));
     if(journal.length){assert.equal(journal.length,1);journalObservedWhileStreaming=true;break;}
     await timing.pause(300);
    }
    assert.equal(journalObservedWhileStreaming,true,"Native completion must persist without a shell poll");
    assert.equal(events.length,0,"Do not inject between an assistant request and its tool result");assert.equal(reports().length,0);
    assert.equal(modelReports(context,id).length,0);
    // Reproduce a real >60-second other-work gap, not just rapid polling or a
    // mocked production clock. Execution/readiness/cleanup budgets are unchanged.
    await timing.pause(Math.max(0,65_000-(timing.now()-lastPoll)));
    return ai.fauxAssistantMessage([ai.fauxToolCall("read",{path:"input.txt"})],{stopReason:"toolUse"});
   },
   context=>{
    modelRequests++;const messages=modelReports(context,id);assert.equal(messages.length,1);assert.ok(messages[0].output.includes("ASYNC_DONE"));assert.equal(messages[0].exit_code,7);safeContextObserved=true;
    return ai.fauxAssistantMessage("Synthetic ordinary work and asynchronous completion observed");
   },
  ]);
  await session.prompt("Synthetic long other-work completion acceptance");
  assert.equal(modelRequests,2);assert.equal(safeContextObserved,true);assert.ok(timing.now()-lastPoll>=65_000);
  assert.equal(events.length,1);assert.equal(reports().length,1);assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,0);
  const terminal=outcome(await invoke("write_stdin",{session_id:id,yield_time_ms:1}));assert.equal(terminal.running,false);assert.equal(terminal.exit_code,7);assert.ok(terminal.output.split(/\r?\n/).includes("ASYNC_DONE"));assert.equal(events.length,1);assert.equal(reports().length,1);
  return {nativeCompletionWithoutPolling:true,protectedJournalWhileStreaming:true,nextSafeModelRequest:true,exactlyOneCompletionReport:true,lateOutputCollected:true,otherWorkGapAtLeast65000Ms:true,automaticIdleTurns:false,incrementalOutputStreaming:false};
 } finally {unsubscribe();}
}
