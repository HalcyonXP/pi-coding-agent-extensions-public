import assert from "node:assert/strict";
import test from "node:test";
import {UnifiedExecManager,type NativeJobBinding} from "../unified-exec.ts";
const command='process.stdout.write("ready");setInterval(()=>{},1000);setTimeout(()=>process.exit(),30000);';
function owner(){
 const controller=new AbortController(),context=new AbortController();let closer:(()=>Promise<void>)|undefined,released=0;
 const scope={id:"native-fixture",signal:controller.signal,ownResource(close:()=>Promise<void>){closer=close;return()=>{released++;};}};
 const binding:NativeJobBinding={resource:scope,scope,context:context.signal};
 return {binding,context,get released(){return released;},async close(){controller.abort();await closer?.();}};
}
const manager=()=>new UnifiedExecManager(code=>({executable:process.execPath,args:["-e",code]}));
test("returned process access requires the same native scope and context, not only its public ID",async()=>{
 const jobs=manager(),a=owner(),b=owner();
 try{
  const result=await jobs.start("conversation",command,process.cwd(),1,64,undefined,a.binding);assert.ok(result.running);assert.ok(result.session_id);
  await assert.rejects(jobs.write("conversation",result.session_id!,"",0,64,undefined,b.binding),/foreign/);
  await assert.rejects(jobs.write("conversation",result.session_id!,"",0,64),/foreign/);
  assert.equal((await jobs.write("conversation",result.session_id!,"",0,64,undefined,a.binding)).running,true);
  a.context.abort();await assert.rejects(jobs.write("conversation",result.session_id!,"",0,64,undefined,a.binding),/foreign/);
  await a.close();assert.equal(a.released,1);
 }finally{await jobs.close();}
});
test("native admission failure precedes process creation",async()=>{
 const jobs=manager(),a=owner();a.binding.resource={...a.binding.resource,ownResource:()=>{throw Error("native admission full");}};
 try{await assert.rejects(jobs.start("owner",command,process.cwd(),1,64,undefined,a.binding),/admission/);assert.deepEqual(jobs.inspect("owner"),[]);}
 finally{await jobs.close();}
});
test("unconfirmed cleanup rejects and retains admission until a real independent process close",async()=>{
 const jobs=manager(),a=owner();
 // Failure injection at the trusted OS cleanup seam, not a claim that the test
 // manufactured an unkillable process. The process itself is real.
 const internal=jobs as unknown as {stop:(...args:unknown[])=>Promise<void>};const stop=internal.stop;
 try{
  const result=await jobs.start("owner",command,process.cwd(),1,64,undefined,a.binding);assert.ok(result.running);
  internal.stop=async()=>{};
  await assert.rejects(a.close(),/could not be confirmed/);assert.equal(a.released,0);
  await assert.rejects(jobs.start("owner",command,process.cwd(),1,64),/cleanup/);
 }finally{internal.stop=stop;await jobs.close();}
 assert.equal(a.released,1);
});

test("user input and EOF cannot acknowledge a pending native supervisor gate",async()=>{
 const jobs=new UnifiedExecManager(code=>({executable:process.execPath,args:["-e",code],supervised:true}));
 try{
  const r=await jobs.start("owner","process.stdin.resume();setInterval(()=>{},1000)",process.cwd(),0,64);
  await assert.rejects(jobs.write("owner",r.session_id!,"\u0001",0,64),/starting/);
  await assert.rejects(jobs.write("owner",r.session_id!,"\u0004",0,64),/starting/);
  assert.equal((await jobs.write("owner",r.session_id!,"\u0003",1000,64)).running,false);
 }finally{await jobs.close();}
});

for(const recovery of ["explicit user retry","independent process close"])test(`a throwing OS cleanup stays owned until ${recovery}`,async t=>{
 type Record={child:import("node:child_process").ChildProcess;closed:boolean};
 const jobs=manager(),a=owner();let restore:(()=>void)|undefined,record:Record|undefined;
 const independentClose=async()=>{if(record&&!record.closed){const done=new Promise<void>(r=>record!.child.once("close",()=>r()));record.child.kill("SIGKILL");await done;}};
 try{
  const r=await jobs.start("owner",command,process.cwd(),1,64,undefined,a.binding);
  record=(Reflect.get(jobs,"processes") as Map<string,Record>).get(r.session_id!)!;
  const kill=record.child.kill;restore=()=>{record!.child.kill=kill;};record.child.kill=()=>{throw Error("injected OS cleanup failure");};
  if(process.platform!=="win32"){
   const groupKill=process.kill;
   t.mock.method(process,"kill",(pid:number,signal?:number|NodeJS.Signals)=>{if(pid===-record!.child.pid!&&signal==="SIGKILL")throw Error("injected group cleanup failure");return groupKill.call(process,pid,signal);});
  }
  await assert.rejects(a.close(),/injected OS cleanup/);assert.equal(a.released,0);
  assert.equal(jobs.inspect("owner")[0].cleanup_pending,true);
  await assert.rejects(jobs.start("owner",command,process.cwd(),1,64),/cleanup/);
  await assert.rejects(jobs.cancel("foreign",r.session_id!),/foreign/);
  restore();if(recovery==="explicit user retry")await jobs.cancel("owner",r.session_id!);else await independentClose();
  assert.equal(a.released,1);await jobs.close();
 }finally{restore?.();await independentClose();await jobs.close();}
});
