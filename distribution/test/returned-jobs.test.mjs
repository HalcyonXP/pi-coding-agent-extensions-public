// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {acceptReturnedJobs} from "../accept-returned-jobs.mjs";
function fixture({thirdAllowed=false,readyAt=0,echo=false,foreign=false}={}){
 let started=0,active=0,reads=0;const polls=[0,0],calls=[];
 const session={agent:{getToolGatewayInfo:()=>({activeScopes:active,drainingScopes:0})}};
 const invoke=async(name,args)=>{
  calls.push({name,args});
  if(name==="exec_command"){
   if(++started===3)return {isError:!thirdAllowed,content:[{type:"text",text:"Durable scope admission unavailable or prior cleanup incomplete"}]};
   active++;return {isError:false,value:{session_id:String(started),running:true,supervisor_ready:readyAt===0,output:echo?"process.stdout.write(DIRECT_READY);\nReferenceError: DIRECT_READY is not defined\n":readyAt===0?"DIRECT_READY\n":""}};
  }
  if(name==="read"){reads++;assert.equal(active,2);return {isError:false};}
  const i=Number(args.session_id)-1;if(foreign)return {isError:true};
  if(args.chars){active--;return {isError:false,value:{running:false,supervisor_ready:true,exit_code:0,output:"DIRECT_DONE\n"}};}
  polls[i]++;return {isError:false,value:{session_id:args.session_id,running:true,supervisor_ready:polls[i]>=readyAt,output:!echo&&polls[i]>=readyAt?"DIRECT_READY\r\n":""}};
 };
 const outcome=r=>{assert.equal(r.isError,false,"Native result must succeed");return r.value;};
 return {run:()=>acceptReturnedJobs(session,invoke,outcome),polls,calls,reads:()=>reads};
}
test("direct-job acceptance retains both jobs across denied admission and ordinary work",async()=>{
 const f=fixture();assert.deepEqual(await f.run(),{twoDirectJobs:true,thirdAdmissionDenied:true,ordinaryWorkBetweenPolls:true,completedByPolling:true,automaticCompletionTurns:false});assert.equal(f.reads(),1);assert.deepEqual(f.polls,[0,0]);assert.equal(f.calls.filter(c=>c.name==="exec_command").length,3);
});
test("direct-job readiness accepts only an exact line and retains the thirtieth poll",async()=>{
 const f=fixture({readyAt:30});await f.run();assert.deepEqual(f.polls,[30,30]);assert.ok(f.calls.filter(c=>c.name==="write_stdin"&&!c.args.chars).every(c=>c.args.yield_time_ms===300));
});
test("an error echo cannot masquerade as direct-job readiness or trigger relaunch",async()=>{
 const f=fixture({echo:true,readyAt:1});await assert.rejects(f.run(),/exact readiness line/);assert.deepEqual(f.polls,[30,0]);assert.equal(f.calls.filter(c=>c.name==="exec_command").length,3);
});
test("unexpected third-scope admission fails installed acceptance",async()=>{await assert.rejects(fixture({thirdAllowed:true}).run());});
test("loss of either original native context fails instead of adopting or relaunching jobs",async()=>{
 const f=fixture({foreign:true,readyAt:1});await assert.rejects(f.run(),/Native result must succeed/);assert.equal(f.calls.filter(c=>c.name==="exec_command").length,3);
});
