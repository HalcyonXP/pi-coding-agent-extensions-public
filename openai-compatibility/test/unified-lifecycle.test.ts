// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CapabilityEpoch } from "../capability-policy.ts";
import { UnifiedExecManager, createUnifiedExecTools, type NativeJobBinding, type NativeCompletion } from "../unified-exec.ts";
import { Utf8OutputBuffer } from "../utf8-output.ts";
import { completionEvidence } from "../unified-completion.ts";

const fixture = "process.stdin.once('end',()=>process.stdout.write('LIFECYCLE_DONE\\n'));process.stdin.resume();setTimeout(()=>process.exit(19),30000).unref()";
const manager = () => new UnifiedExecManager(code => ({ executable: process.execPath, args: ["-e", code] }));
type RecordState = { child: ChildProcessWithoutNullStreams; done: Promise<void>; settled?: Promise<void>; closed: boolean; completionFailed?: boolean };
function record(jobs: UnifiedExecManager, id: string): RecordState { return (Reflect.get(jobs, "processes") as Map<string, RecordState>).get(id)!; }
async function closeChild(r: RecordState) {
 r.child.stdin.end();let timer: NodeJS.Timeout | undefined;
 try { await Promise.race([r.done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Owned fixture did not close")),3000);})]); }
 finally { clearTimeout(timer); }
 assert.equal(r.closed,true);
}
function binding(publish: (value: NativeCompletion) => Promise<void> = async () => {}) {
 const context=new AbortController(),scope=new AbortController(),resources=new Set<()=>Promise<void>>(),reports:NativeCompletion[]=[];
 let finished=0;
 const value:NativeJobBinding={context:context.signal,resource:{id:"synthetic-owned-scope",signal:scope.signal,ownResource(close){resources.add(close);return()=>{resources.delete(close);};}},
  async publishCompletion(report){reports.push(structuredClone(report));await publish(report);},
  async finish(){finished++;scope.abort();await Promise.all([...resources].map(close=>close()));},
 };
 return {value,context,scope,reports,resources,get finished(){return finished;}};
}

for(const [closedAt,elapsed] of [[16000,65000],[75000,75001],[16000,600000]])test(`uncollected output at ${elapsed} ms survives close at ${closedAt} ms since last poll`,async t=>{
 let clock=1700000000000;t.mock.method(Date,"now",()=>clock);const jobs=manager();
 try {
  const first=await jobs.start("owner",fixture,process.cwd(),0,100);assert.equal(first.running,true);const r=record(jobs,first.session_id!);
  clock+=closedAt;await Reflect.get(jobs,"expire").call(jobs);assert.equal(r.closed,false);await closeChild(r);await r.settled;
  clock=1700000000000+elapsed;await Reflect.get(jobs,"expire").call(jobs);
  const terminal=await jobs.write("owner",first.session_id!,"",0,100);
  assert.equal(terminal.running,false);assert.equal(terminal.exit_code,0);assert.match(terminal.output,/LIFECYCLE_DONE/);assert.equal(terminal.session_id,undefined);
  await assert.rejects(jobs.write("owner",first.session_id!,"",0,100),/Unknown, expired, or foreign/);
 } finally { await jobs.close(); }
});

test("completed retention still obeys the eight-record capacity bound",async()=>{
 const jobs=manager();const ids:string[]=[];
 try{
  for(let i=0;i<9;i++){const first=await jobs.start("owner",fixture,process.cwd(),0,100);ids.push(first.session_id!);const r=record(jobs,first.session_id!);await closeChild(r);await r.settled;}
  assert.equal(jobs.inspect("owner").length,8);
  await assert.rejects(jobs.write("owner",ids[0],"",0,100),/Unknown, expired, or foreign/);
  assert.match((await jobs.write("owner",ids[1],"",0,100)).output,/LIFECYCLE_DONE/);
 }finally{await jobs.close();}
});

test("returned direct completion publishes once without a poll and does not consume output",async()=>{
 const jobs=manager(),native=binding();
 try{
  const first=await jobs.start("owner",fixture,process.cwd(),0,100,undefined,native.value);assert.equal(first.running,true);
  const r=record(jobs,first.session_id!);await closeChild(r);await r.settled;
  assert.equal(native.reports.length,1);assert.equal(native.reports[0].session_id,first.session_id);assert.equal(native.reports[0].running,false);assert.equal(native.reports[0].exit_code,0);assert.match(native.reports[0].output,/LIFECYCLE_DONE/);
  assert.equal(native.resources.size,0);assert.equal(native.finished,1);
  const terminal=await jobs.write("owner",first.session_id!,"",0,100,undefined,{context:native.context.signal});assert.equal(terminal.output,native.reports[0].output);assert.equal(native.reports.length,1);
 }finally{await jobs.close();}
});

test("initial synchronous completion is not duplicated as an asynchronous report",async()=>{
 const jobs=manager(),native=binding();
 try{const first=await jobs.start("owner","process.stdout.write('SYNC_DONE')",process.cwd(),3000,100,undefined,native.value);assert.equal(first.running,false);assert.equal(first.output,"SYNC_DONE");assert.deepEqual(native.reports,[]);assert.equal(native.finished,1);assert.deepEqual(jobs.inspect("owner"),[]);}
 finally{await jobs.close();}
});

test("pending publication remains visible and terminal collection waits for settlement",async()=>{
 let publish!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>{started=r;}),pending=new Promise<void>(r=>{publish=r;});const jobs=manager(),native=binding(async()=>{started();await pending;});
 try{
  const first=await jobs.start("owner",fixture,process.cwd(),0,100,undefined,native.value),r=record(jobs,first.session_id!);await closeChild(r);await ready;
  assert.equal(jobs.inspect("owner")[0].cleanup_pending,true);assert.equal(native.finished,0);
  let collected=false;const terminal=jobs.write("owner",first.session_id!,"",0,100,undefined,{context:native.context.signal}).then(r=>{collected=true;return r;});
  await new Promise(r=>setImmediate(r));assert.equal(collected,false);publish();assert.equal((await terminal).exit_code,0);assert.equal(native.finished,1);
 }finally{publish();await jobs.close();}
});

test("report failure stays owned/visible across collection, cancellation and reset; no automatic retry",async()=>{
 const jobs=manager(),native=binding(async()=>{throw Error("synthetic publisher rejected");});
 const first=await jobs.start("owner",fixture,process.cwd(),0,100,undefined,native.value),r=record(jobs,first.session_id!);await closeChild(r);await r.settled;
 assert.equal(native.reports.length,1);assert.equal(jobs.inspect("owner")[0].cleanup_pending,true);
 await assert.rejects(jobs.write("owner",first.session_id!,"",0,100,undefined,{context:native.context.signal}),/reporting or native cleanup is unconfirmed/);
 await assert.rejects(jobs.cancel("owner",first.session_id!),/reporting or native cleanup is unconfirmed/);
 await assert.rejects(jobs.start("owner",fixture,process.cwd(),0,100),/cleanup or completion reporting is incomplete/);
 await assert.rejects(jobs.close(),/reporting cleanup/);assert.equal(jobs.inspect("owner").length,1);assert.equal(native.reports.length,1);assert.equal(r.closed,true);
});

test("context revocation suppresses completion and never makes an old ID adoptable",async()=>{
 const jobs=manager(),native=binding();
 try{const first=await jobs.start("owner",fixture,process.cwd(),0,100,undefined,native.value);native.context.abort();const r=record(jobs,first.session_id!);await closeChild(r);await r.settled;assert.deepEqual(native.reports,[]);await assert.rejects(jobs.write("owner",first.session_id!,"",0,100,undefined,{context:new AbortController().signal}),/foreign/);await jobs.reset();assert.deepEqual(jobs.inspect("owner"),[]);}
 finally{await jobs.close();}
});

test("reset while a process runs suppresses its asynchronous result",async()=>{
 const jobs=manager(),native=binding();try{await jobs.start("owner",fixture,process.cwd(),0,100,undefined,native.value);await jobs.reset();assert.deepEqual(native.reports,[]);assert.deepEqual(jobs.inspect("owner"),[]);assert.equal(native.resources.size,0);}finally{await jobs.close();}
});

test("non-consuming terminal snapshots retain UTF-8 boundaries, omission counters and unread bytes",()=>{
 const output=new Utf8OutputBuffer(12);output.append("stdout",Buffer.from("abcdef🙂🙂"));output.end("stdout");const before=output.byteLength,a=output.peek(7),b=output.peek(7);assert.deepEqual(a,b);assert.equal(output.byteLength,before);assert.ok(a.truncatedBytes>0);assert.ok(a.remainingBytes>0);assert.ok(!a.output.includes("�"));assert.deepEqual(output.read(7),{output:a.output,truncatedBytes:a.truncatedBytes});assert.equal(output.byteLength,a.remainingBytes);
});

test("completion evidence correlates the original invocation without leaking extra metadata or duplicating output",()=>{
 const report=completionEvidence("native-call",{session_id:"job",output:"untrusted output",exit_code:0,running:false,truncated_bytes:0,output_remaining_bytes:0,extra:"MUST_NOT_LEAK"} as NativeCompletion);
 assert.equal(report.details.kind,"unified_exec_completion");assert.equal(report.details.toolCallId,"native-call");assert.equal(report.details.session_id,"job");assert.ok(!Object.hasOwn(report.details,"output"));assert.doesNotMatch(JSON.stringify(report),/MUST_NOT_LEAK/);assert.match(report.content[0].text,/not a new command/);assert.throws(()=>completionEvidence("",{} as NativeCompletion),/correlation/);
});

test("capacity eviction prefers an older uncollected result over recently collected partial output",async t=>{
 let clock=1700000000000;t.mock.method(Date,"now",()=>clock);const jobs=manager(),ids:string[]=[];
 try{
  for(let n=0;n<8;n++){clock++;const first=await jobs.start("owner",fixture,process.cwd(),0,4);ids.push(first.session_id!);const r=record(jobs,first.session_id!);await closeChild(r);await r.settled;}
  clock++;const partial=await jobs.write("owner",ids[0],"",0,4);assert.equal(partial.running,false);assert.equal(partial.session_id,ids[0]);
  clock++;const next=await jobs.start("owner",fixture,process.cwd(),0,100);const r=record(jobs,next.session_id!);await closeChild(r);await r.settled;
  await assert.rejects(jobs.write("owner",ids[1],"",0,100),/Unknown/);assert.equal(partial.output+(await jobs.write("owner",ids[0],"",0,100)).output,"LIFECYCLE_DONE\n");
 }finally{await jobs.close();}
});

test("synchronous partial output remains collectable without a second completion report",async()=>{
 const jobs=manager(),native=binding();
 try{const first=await jobs.start("owner","process.stdout.write('1234🙂5678')",process.cwd(),3000,4,undefined,native.value);assert.equal(first.running,false);assert.equal(first.output,"1234");assert.ok(first.session_id);assert.deepEqual(native.reports,[]);
  const second=await jobs.write("owner",first.session_id!,"",0,4,undefined,{context:native.context.signal});assert.equal(second.output,"🙂");assert.equal(second.session_id,first.session_id);
  const last=await jobs.write("owner",first.session_id!,"",0,4,undefined,{context:native.context.signal});assert.equal(last.output,"5678");assert.equal(last.session_id,undefined);assert.deepEqual(native.reports,[]);
 }finally{await jobs.close();}
});

test("native completion uses at most 64 KiB and honestly reports uncollected and dropped bytes",async()=>{
 const jobs=manager(),native=binding();
 try{const first=await jobs.start("owner",fixture.replace("'LIFECYCLE_DONE\\n'","'x'.repeat(1024*1024+128)"),process.cwd(),0,100,undefined,native.value),r=record(jobs,first.session_id!);await closeChild(r);await r.settled;assert.equal(native.reports.length,1);const report=native.reports[0];assert.equal(report.output.length,64*1024);assert.equal(report.output_remaining_bytes,1024*1024-64*1024);assert.equal(report.truncated_bytes,128);
  const collected=await jobs.write("owner",first.session_id!,"",0,64*1024,undefined,{context:native.context.signal});assert.equal(collected.output,report.output);assert.equal(collected.truncated_bytes,report.truncated_bytes);
 }finally{await jobs.close();}
});

for(const absent of ["protectedResults","publishEvidence"])test(`native binding refuses missing ${absent} before OS launch`,async()=>{
 let launches=0,closes=0;const context=new AbortController(),scope=new AbortController(),jobs=new UnifiedExecManager(code=>{launches++;return{executable:process.execPath,args:["-e",code]};}),epoch=new CapabilityEpoch();
 const nativeScope={id:"native-fixture",signal:scope.signal,ownResource(){return()=>{};},async close(){closes++;scope.abort();},...(absent==="publishEvidence"?{}:{async publishEvidence(){}})};
 const ctx={cwd:process.cwd(),sessionManager:{getSessionId:()=>"session"},toolGatewayInfo:{version:1,protectedResults:absent!=="protectedResults"},tools:{origin:"direct",contextSignal:context.signal,parentToolCallId:"call",openScope:()=>nativeScope}} as unknown as ExtensionContext;
 try{const [start]=createUnifiedExecTools(jobs,(_n,_c,signal)=>epoch.lease(()=>{},signal));await assert.rejects(start.execute("call",{cmd:fixture,yield_time_ms:0},undefined,undefined,ctx),/protected completion/);assert.equal(launches,0);assert.equal(closes,absent==="publishEvidence"?1:0);assert.deepEqual(jobs.inspect("session:"+process.cwd()),[]);}finally{await jobs.close();}
});

test("the native completion lease is revocable after the initiating handler returns",async()=>{
 const jobs=manager(),epoch=new CapabilityEpoch(),context=new AbortController(),scope=new AbortController();let publications=0,closes=0;
 const ctx={cwd:process.cwd(),sessionManager:{getSessionId:()=>"session"},toolGatewayInfo:{version:1,protectedResults:true},tools:{origin:"direct",contextSignal:context.signal,parentToolCallId:"call",openScope:()=>({id:"native-fixture",signal:scope.signal,ownResource(){return()=>{};},async close(){closes++;scope.abort();},async publishEvidence(){publications++;}})}} as unknown as ExtensionContext;
 const [start]=createUnifiedExecTools(jobs,(_n,_c,signal)=>epoch.lease(()=>{},signal)),first=(await start.execute("call",{cmd:fixture,yield_time_ms:0},undefined,undefined,ctx)).details;
 epoch.revoke();const r=record(jobs,first.session_id!);await closeChild(r);await r.settled;assert.equal(publications,0);assert.equal(closes,1);assert.equal(r.completionFailed,true);await assert.rejects(jobs.close(),/reporting cleanup/);
});

test("explicit cancellation reports terminal state once and only confirmed settlement removes the record",async()=>{
 const jobs=manager(),native=binding();try{const first=await jobs.start("owner",fixture,process.cwd(),0,100,undefined,native.value);await jobs.cancel("owner",first.session_id!);assert.equal(native.reports.length,1);assert.equal(native.reports[0].running,false);assert.equal(native.reports[0].termination,"Cancelled by user.");assert.equal(native.finished,1);assert.deepEqual(jobs.inspect("owner"),[]);}finally{await jobs.close();}
});

test("nested jobs do not publish a direct completion or close the owning cell",async()=>{
 const jobs=manager(),native=binding();const access={context:native.context.signal,scope:native.value.resource};try{const first=await jobs.start("owner",fixture,process.cwd(),0,100,undefined,{...native.value,...access,finish:undefined}),r=record(jobs,first.session_id!);await closeChild(r);await r.settled;assert.deepEqual(native.reports,[]);assert.equal(native.finished,0);assert.equal(native.scope.signal.aborted,false);assert.equal((await jobs.write("owner",first.session_id!,"",0,100,undefined,access)).exit_code,0);}finally{await jobs.close();}
});
