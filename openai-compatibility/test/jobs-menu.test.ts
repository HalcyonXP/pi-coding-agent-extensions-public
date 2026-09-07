// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { SettingsList, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { OpenAIJobsPanel, OpenAISettingsPanel, type JobsController, type JobRow } from "../settings-menu.ts";
import { harness } from "./capability-fixture.ts";
const tick=()=>new Promise<void>(r=>setImmediate(r));
const quoteFixture=(s:string,platform:NodeJS.Platform=process.platform)=>`'${s.replaceAll("'",platform==="win32"?"''":"'\\''")}'`;
const hasReady=(output:string)=>output.split(/\r?\n/).includes("JOB_READY");
test("jobs fixture preserves shell literals and requires a dedicated readiness line, not an error echo",()=>{
 assert.equal(quoteFixture("a'b","win32"),"'a''b'");assert.equal(quoteFixture("a'b","linux"),"'a'\\''b'");
 assert.equal(hasReady("process.stdout.write(JOB_READY);\nReferenceError: JOB_READY is not defined\n"),false);assert.equal(hasReady("JOB_READY\n"),true);assert.equal(hasReady("JOB_READY\r\n"),true);
});
const theme={fg:(_tone:string,text:string)=>text} as ExtensionContext["ui"]["theme"];
const job=():JobRow=>({session_id:"owned-fixture",cleanup_pending:false,ownership:"cell",running:true,buffered_bytes:0,age_seconds:1});
function fixture(cancel?:JobsController["cancel"]){
 let rows=[job()],calls=0,closes=0,renders=0;const abort=new AbortController();
 const controller:JobsController={read:()=>rows,async cancel(id,signal){calls++;if(cancel)await cancel(id,signal);else rows=rows.filter(row=>row.session_id!==id);}};
 const panel=new OpenAIJobsPanel(controller,()=>!abort.signal.aborted,theme,()=>{renders++;},()=>{closes++;},abort.signal);
 return {panel,controller,abort,view:(width=80)=>panel.render(width).join("\n"),calls:()=>calls,closes:()=>closes,renders:()=>renders,setRows:(v:JobRow[])=>{rows=v;}};
}
function confirm(panel:OpenAIJobsPanel){panel.handleInput("\r");panel.handleInput("\x1b[B");panel.handleInput("\r");}
test("jobs use the native list and require explicit cancellation confirmation",async()=>{
 const f=fixture();try{assert.ok(f.panel.children.some(x=>x instanceof SettingsList));assert.match(f.view(),/Job 1\s+running/);f.panel.handleInput("\r");assert.match(f.view(),/Keep job/);f.panel.handleInput("\r");assert.equal(f.calls(),0);confirm(f.panel);await tick();assert.equal(f.calls(),1);assert.doesNotMatch(f.view(),/Job 1/);assert.match(f.view(),/Job cancelled/);}finally{f.panel.dispose();}
});
test("pending job cancellation is serialized and never reported successful before confirmation",async()=>{
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});const f=fixture(async()=>{await wait;});try{confirm(f.panel);assert.match(f.view(),/Cancelling owned job/);confirm(f.panel);assert.equal(f.calls(),1);release();await tick();assert.match(f.view(),/Job cancelled/);}finally{release();f.panel.dispose();}
});
test("failed cleanup remains visible and is never automatically retried",async()=>{
 const f=fixture(async()=>{throw Error("OS termination was not confirmed");});try{f.setRows([{...job(),cleanup_pending:true}]);confirm(f.panel);await tick();assert.equal(f.calls(),1);assert.match(f.view(),/cleanup pending/);assert.match(f.view(),/Cancellation failed: OS termination was not confirmed/);await tick();assert.equal(f.calls(),1);f.panel.handleInput("\r");assert.match(f.view(),/Retry owned cleanup/);f.panel.handleInput("\x1b");assert.equal(f.calls(),1);}finally{f.panel.dispose();}
});
test("context revocation aborts pending UI work and blocks late rendering or cancellation",async()=>{
 let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let applied=false;const f=fixture(async(_id,signal)=>{await wait;signal.throwIfAborted();applied=true;});confirm(f.panel);f.abort.abort();const renders=f.renders();release();await tick();assert.equal(applied,false);assert.equal(f.renders(),renders);confirm(f.panel);assert.equal(f.calls(),1);
});
test("jobs refresh is passive and failed refresh freezes cancellation",()=>{
 const f=fixture();try{f.setRows([]);f.panel.handleInput("\x1b[B");f.panel.handleInput("\r");assert.doesNotMatch(f.view(),/Job 1/);assert.equal(f.calls(),0);f.controller.read=()=>{throw Error("private-fixture");};f.panel.handleInput("\r");assert.match(f.view(),/Unable to refresh jobs/);assert.doesNotMatch(f.view(),/private-fixture/);f.panel.handleInput("\r");assert.equal(f.calls(),0);}finally{f.panel.dispose();}
});
test("hidden narrow job controls cannot cancel; job text cannot inject terminal controls",()=>{
 const f=fixture();try{f.setRows([{...job(),session_id:"\x1b[31m\u202econtrol",ownership:"\ncell"}]);f.panel.handleInput("\x1b[B");f.panel.handleInput("\r");assert.doesNotMatch(f.view().replace(/\x1b\[(?:7|27)m/g,""),/[\x1b\u202e]/);f.panel.handleInput("\r");f.view(16);f.panel.handleInput("\x1b[B");f.panel.handleInput("\r");assert.equal(f.calls(),0);for(const w of [1,16,32,80])for(const line of f.panel.render(w))assert.ok(visibleWidth(line)<=w);}finally{f.panel.dispose();}
});
test("jobs stay inside the common settings menu and return without losing its filter",async()=>{
 const parent=new AbortController();let done=0;const rows=[{id:"jobs",label:"Jobs",value:"0 running",values:["refresh"],description:"Owned job snapshot"},{id:"fast",label:"Fast",value:"off",values:["off","on"],description:"Saved"}];
 const panel=new OpenAISettingsPanel(rows,{read:async()=>rows,change:async()=>"Refreshed",isCurrent:()=>!parent.signal.aborted,onBoundary:fn=>{parent.signal.addEventListener("abort",fn);return()=>parent.signal.removeEventListener("abort",fn);},jobs:{read:()=>[],cancel:async()=>assert.fail("No job to cancel")}},theme,()=>{},()=>{done++;},"jobs");
 try{for(const c of "Jobs")panel.handleInput(c);panel.handleInput("\r");assert.match(panel.render(80).join("\n"),/Unified exec jobs/);panel.handleInput("\x1b");await tick();assert.equal(done,0);assert.match(panel.render(80).join("\n"),/→ Jobs/);assert.doesNotMatch(panel.render(80).join("\n"),/Fast\s+off/);panel.handleInput("\x1b");assert.equal(done,1);}finally{panel.dispose();}
});
test("consolidated jobs control cancels a real owned shell and rejects stale or foreign control",async()=>{
 const h=harness(tmpdir());try{
  await h.emit("session_start");assert.deepEqual([...h.commands.keys()],["openai-tools"]);await h.commands.get("openai-tools").handler("unified_exec on",h.ctx);
  const cmd=`${process.platform==="win32"?"& ":""}${quoteFixture(process.execPath)} -e ${quoteFixture("process.stdout.write('JOB_READY\\n');setTimeout(()=>{},30000)")}`;
  let launched:any=await h.tools.get("exec_command")!.execute("owned-jobs-fixture",{cmd,yield_time_ms:1},undefined,undefined,h.ctx),output=launched.details.output;
  for(let n=0;n<30&&!hasReady(output);n++){launched=await h.tools.get("write_stdin")!.execute(`owned-jobs-poll-${n}`,{session_id:launched.details.session_id,yield_time_ms:300},undefined,undefined,h.ctx);output+=launched.details.output;}
  assert.equal(hasReady(output),true,"Dedicated JOB_READY line required");assert.equal(launched.details.running,true);
  const control=h.settings.jobs(h.ctx),rows=control.read();assert.equal(rows.length,1);assert.equal(rows[0].running,true);
  await assert.rejects(h.settings.jobs({...h.ctx,cwd:h.ctx.cwd+"-foreign"}).cancel(rows[0].session_id,new AbortController().signal),/context changed/);
  await h.commands.get("openai-tools").handler(`jobs cancel ${rows[0].session_id}`,h.ctx);assert.equal(control.read().length,0);assert.match(h.notices.at(-1)!,/job cancelled/);assert.equal(h.authCalls(),0);
  await h.emit("model_select");assert.throws(()=>control.read(),/context changed/);
 }finally{await h.emit("session_shutdown");}
});
