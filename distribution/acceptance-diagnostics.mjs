// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only acceptance diagnostics. Never print guest output, paths or payloads.
import {ERROR_CODES} from "../openai-compatibility/runtime/protocol.mjs";
import {RPC_ERRORS} from "../openai-compatibility/runtime/rpc-protocol.mjs";
const knownCodes=new Set([...ERROR_CODES,...RPC_ERRORS]);
// Same bounded acceptance program, factored for deterministic failure-path tests.
// No runtime/poll/teardown budget is widened and no service call is introduced.
export function shellReadinessCode(command){
 if(typeof command!=="string")throw new TypeError("Shell acceptance command must be a string");
 return `// @exec: {"yield_time_ms":30000}\nlet r=await tools.exec_command({cmd:${JSON.stringify(command)},yield_time_ms:1});if(r.isError)throw Error("launch denied");let o=r.result.details.output;const deadline=Date.now()+9000;for(let i=0;i<30&&!o.includes("READY")&&Date.now()+5000<=deadline;i++){r=await tools.write_stdin({session_id:r.result.details.session_id,yield_time_ms:300});if(r.isError)throw Error("poll denied");o+=r.result.details.output;}if(!o.includes("READY"))throw Error("not ready");`;
}
const terminationKinds=new Map([
 ["Native supervisor admission failed.","supervisor-admission"],
 ["Native shell could not start.","launch"],
 ["Native owning scope ended.","scope-ended"],
 ["Native shell cleanup could not be confirmed.","cleanup"],
 ["OS process termination was not confirmed; further launches are blocked after reset.","unconfirmed-stop"],
 ["Tool call cancelled.","cancelled"],
 ["Process lifetime or idle limit reached.","lifetime"],
]);
const observerSnapshots=new WeakMap();
// Observe genuine native events, never guest-emitted diagnostics. Only fixed-field
// summaries are retained; no args, command, IDs, output, exception text or paths.
export function createShellObserver(){
 let starts=0,ends=0,last={operation:"none",toolError:null,running:null,supervisorReady:null,exitCode:null,termination:"none",hadOutput:false};
 const observer={
  observe(event){
   if(!["exec_command","write_stdin"].includes(event?.toolName))return;
   if(event.type==="tool_execution_start"){starts=Math.min(starts+1,65);return;}
   if(event.type!=="tool_execution_end")return;
   ends=Math.min(ends+1,65);const d=event.result?.details;
   last={operation:event.toolName==="exec_command"?"launch":"poll",toolError:typeof event.isError==="boolean"?event.isError:null,running:typeof d?.running==="boolean"?d.running:null,supervisorReady:typeof d?.supervisor_ready==="boolean"?d.supervisor_ready:null,exitCode:Number.isInteger(d?.exit_code)&&d.exit_code>=-2147483648&&d.exit_code<=2147483647?d.exit_code:null,termination:d?.termination===undefined?"none":terminationKinds.get(d.termination)??"other",hadOutput:typeof d?.output==="string"&&d.output.length>0};
  },
  snapshot(){return {starts,ends,...last};},
 };
 observerSnapshots.set(observer,()=>({starts,ends,...last}));return Object.freeze(observer);
}
export function shellAcceptanceDiagnostic(outcome,markerRecorded,native){
 return JSON.stringify({phase:"synthetic-shell-readiness",cellStatus:["completed","running","draining","terminated"].includes(outcome?.status)?outcome.status:"unknown",resultStatus:["ok","error"].includes(outcome?.result?.status)?outcome.result.status:"unknown",code:knownCodes.has(outcome?.result?.code)?outcome.result.code:"UNCLASSIFIED",markerRecorded:markerRecorded===true,...(native?{native:observerSnapshots.get(native)?.()??{status:"unavailable"}}:{})});
}
