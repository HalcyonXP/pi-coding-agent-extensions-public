// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine QuickJS with synthetic shell replies, NOT OS/installed acceptance or a historical cause claim.
import assert from "node:assert/strict";
import test from "node:test";
import {evaluate} from "../../openai-compatibility/runtime/evaluator.mjs";
import {shellReadinessCode} from "../acceptance-diagnostics.mjs";
async function run({readyAt=0,errorAt=-1}){
 let calls=0;
 const result=await evaluate(shellReadinessCode("synthetic command"),{allowedTools:["exec_command","write_stdin"],cell:{output(){},yield(){},pump(){throw Error("Unexpected unresolved fixture reply");}},invoke:async(name,args)=>{
  const index=calls++;
  if(index===0){assert.equal(name,"exec_command");assert.deepEqual(args,{cmd:"synthetic command",yield_time_ms:1});}
  else{assert.equal(name,"write_stdin");assert.deepEqual(args,{session_id:"synthetic-session",yield_time_ms:300});}
  return {isError:index===errorAt,result:{content:[],details:{session_id:"synthetic-session",output:index===readyAt?"READY":""}}};
 }});
 return {result,calls};
}
test("acceptance program handles immediate shell readiness without polling",async()=>{
 const {result,calls}=await run({readyAt:0});assert.equal(result.status,"ok");assert.equal(calls,1);
});
test("acceptance program retains exactly thirty polls and accepts readiness at the final poll",async()=>{
 const {result,calls}=await run({readyAt:30});assert.equal(result.status,"ok");assert.equal(calls,31);
});
for(const [name,options,calls] of [["never ready",{readyAt:31},31],["launch denied",{errorAt:0},1],["poll denied",{readyAt:30,errorAt:1},2]])test("distinct synthetic shell failure is bounded: "+name,async()=>{
 const {result,calls:actual}=await run(options);assert.deepEqual(result,{version:1,status:"error",code:"EXECUTION_FAILED"});assert.equal(actual,calls);
});
