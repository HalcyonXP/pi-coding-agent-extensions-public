import assert from "node:assert/strict";
import test from "node:test";
import {CodeCells} from "../../../openai-compatibility/runtime/cells.mjs";
// Manager state-unit fixture only. Native branding/approval/OS ownership is
// separately exercised by the real AgentSession/QuickJS/shell integration.
function fixture({failed=false}={}) {
 const owner={},epoch=new AbortController(),scopes=[];
 const invocation={origin:"direct",contextSignal:epoch.signal,signal:epoch.signal,adoptScope(){},openScope(){
  const controller=new AbortController(),resources=new Set();let state="active",closing;
  const scope={id:`unit-${scopes.length}`,signal:controller.signal,get state(){return state;},ownResource(close){resources.add(close);return()=>resources.delete(close);},close(){
   if(closing)return closing;state="draining";controller.abort();
   closing=Promise.resolve().then(async()=>{await Promise.all([...resources].map(close=>close()));if(failed)throw Error("unconfirmed unit closer");state="closed";});return closing;
  }};scopes.push(scope);return scope;
 }};
 const manager=new CodeCells({owner,contextSignal:epoch.signal,runtimeFactory:options=>({async run(){options.output("one guest channel");return {version:1,status:"ok",output:["unexpected alternate channel"]};},async close(){}})});
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
