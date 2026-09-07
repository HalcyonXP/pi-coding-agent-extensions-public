import assert from "node:assert/strict";
import test from "node:test";
import {CodeCells} from "../../../openai-compatibility/runtime/cells.mjs";
// Manager state-unit fixture only. Native branding/approval/OS ownership is
// separately exercised by the real AgentSession/QuickJS/shell integration.
function fixture({failed=false,returned={version:1,status:"ok",output:["unexpected alternate channel"]}}={}) {
 const owner={},epoch=new AbortController(),scopes=[];
 const invocation={origin:"direct",contextSignal:epoch.signal,signal:epoch.signal,adoptScope(){},openScope(){
  const controller=new AbortController(),resources=new Set();let state="active",closing;
  const scope={id:`unit-${scopes.length}`,signal:controller.signal,get state(){return state;},ownResource(close){resources.add(close);return()=>resources.delete(close);},close(){
   if(closing)return closing;state="draining";controller.abort();
   closing=Promise.resolve().then(async()=>{await Promise.all([...resources].map(close=>close()));if(failed)throw Error("unconfirmed unit closer");state="closed";});return closing;
  }};scopes.push(scope);return scope;
 }};
 const manager=new CodeCells({owner,contextSignal:epoch.signal,runtimeFactory:options=>({async run(){options.output("one guest channel");return returned;},async close(){}})});
 const exec=()=>manager.exec({owner,invocation,code:"text(1)",tools:[],yield_time_ms:0,max_output_tokens:0});
 const wait=id=>manager.wait({owner,invocation,cell_id:id,yield_time_ms:0,max_tokens:0});
 return {manager,scopes,exec,wait,epoch};
}
async function settle(){for(let n=0;n<50;n++)await Promise.resolve();}
test("manager metadata remains status-only even if a trusted runtime factory duplicates output",async()=>{
 const f=fixture();try{const initial=await f.exec();await settle();const result=await f.wait(initial.cell_id);assert.equal(result.status,"completed");assert.deepEqual(result.output,[]);assert.deepEqual(result.result,{version:1,status:"ok"});assert.ok(!JSON.stringify(result).includes("channel"));}finally{await f.manager.close();}
});
test("completed native resources close without wait and completed retention expires monotonically",async t=>{
 let now=0;t.mock.method(performance,"now",()=>now);const f=fixture();try{
  const initial=await f.exec();await settle();assert.equal(f.scopes[0].state,"closed");now=360000;
  await assert.rejects(f.wait(initial.cell_id),/CELL_UNAVAILABLE/);await f.exec();assert.equal(f.scopes.length,2);
 }finally{await f.manager.close();}
});
test("an expired but unconfirmed closer is not pruned into recycled admission",async t=>{
 let now=0;t.mock.method(performance,"now",()=>now);const f=fixture({failed:true});try{
  const initial=await f.exec();await settle();now=720000;assert.equal(f.scopes[0].state,"draining");
  assert.equal((await f.wait(initial.cell_id)).status,"draining");
 }finally{await f.manager.close();}
});

test("manager preserves only fixed failure diagnostics even at zero guest output budget",async()=>{
 const diagnostics={guest_phase:"compile",delegated_calls:0,returned_results:0,tool_errors:0,last_delegation:null,effects:"not_determined"};
 const f=fixture({returned:{version:1,status:"error",code:"EXECUTION_FAILED",diagnostics,message:"private-fixture",output:["private-fixture"]}});
 try{const initial=await f.exec();await settle();const result=await f.wait(initial.cell_id);assert.deepEqual(result.result,{version:1,status:"error",code:"EXECUTION_FAILED",diagnostics});assert.deepEqual(result.output,[]);assert.ok(!JSON.stringify(result).includes("private-fixture"));assert.equal(f.scopes[0].state,"closed");}finally{await f.manager.close();}
});
test("manager never reads diagnostic getters or accepts a raw exception field",async()=>{
 let reads=0;
 for(const extra of [{get diagnostics(){reads++;return {}; }},{diagnostics:{guest_phase:"compile",delegated_calls:0,returned_results:0,tool_errors:0,last_delegation:null,effects:"not_determined",message:"private-fixture"}}]){
  const returned={version:1,status:"error",code:"EXECUTION_FAILED"};Object.defineProperties(returned,Object.getOwnPropertyDescriptors(extra));const f=fixture({returned});
  try{const initial=await f.exec();await settle();const result=await f.wait(initial.cell_id);assert.deepEqual(result.result,{version:1,status:"error",code:"EXECUTION_FAILED"});assert.equal(reads,0);}finally{await f.manager.close();}
 }
});