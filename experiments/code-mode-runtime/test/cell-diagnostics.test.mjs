import assert from "node:assert/strict";
import test from "node:test";
import { CellRuntime } from "../../../openai-compatibility/runtime/rpc-host.mjs";
import { CellStore } from "../../../openai-compatibility/runtime/cell-protocol.mjs";
import { copyCellDiagnostics, validCellDone, cellDiagnostics } from "../../../openai-compatibility/runtime/cell-diagnostics.mjs";
const result = details => ({isError:false,result:{content:[],details}});
async function run(code, invoke = async () => result({})) {
 const runtime = new CellRuntime({store:new CellStore(),output:()=>{},yield:()=>{}});
 try { return await runtime.run(code,{gateway:{signal:new AbortController().signal,invoke},allowedTools:["exec_command","write_stdin","target"],signal:AbortSignal.timeout(4000)}); }
 finally { await runtime.close(); }
}
test("cell compilation failure reports a fixed phase and no delegation, never exception text",async()=>{
 const r=await run('const = "private-fixture"');assert.equal(r.code,"EXECUTION_FAILED");assert.equal(r.diagnostics.guest_phase,"compile");assert.equal(r.diagnostics.delegated_calls,0);assert.equal(r.diagnostics.last_delegation,null);assert.doesNotMatch(JSON.stringify(r),/private-fixture/);
});
test("missing Node globals and hostile thrown getters are guest failures without property inspection",async()=>{
 for(const code of ['require("node:fs")','throw {get message(){while(true){}},get stack(){while(true){}},toString(){while(true){}}}']){
  const r=await run(code);assert.equal(r.code,"EXECUTION_FAILED");assert.equal(r.diagnostics.guest_phase,"await");assert.equal(r.diagnostics.delegated_calls,0);
 }
});
test("failure after a returned shell command distinguishes supervisor/result observations from OS effects",async()=>{
 const r=await run('await tools.exec_command({cmd:"private-fixture"});throw Error("private-fixture")',async()=>result({supervisor_ready:true,running:false,exit_code:0,output:"private-fixture",session_id:"private-fixture",termination:"private-fixture"}));
 assert.equal(r.code,"EXECUTION_FAILED");assert.deepEqual(r.diagnostics,{guest_phase:"await",delegated_calls:1,returned_results:1,tool_errors:0,last_delegation:{operation:"exec_command",result:"returned",shell:{supervisor_ready:true,running:false,exit_code:0,output_observed:true,termination:"reported"}},effects:"not_determined"});assert.doesNotMatch(JSON.stringify(r),/private-fixture/);
});
test("a returned tool error is distinct from a gateway rejection with no returned result",async()=>{
 const r=await run('const r=await tools.exec_command({});if(r.isError)throw Error("failed")',async()=>({isError:true,result:{content:[{type:"text",text:"private-fixture"}]}}));
 assert.equal(r.diagnostics.tool_errors,1);assert.equal(r.diagnostics.last_delegation.result,"tool_error");assert.equal(r.diagnostics.last_delegation.shell.supervisor_ready,null);assert.doesNotMatch(JSON.stringify(r),/private-fixture/);
 const rejected=await run('await tools.exec_command({})',async()=>{throw Error("private-fixture")});assert.equal(rejected.code,"GATEWAY_FAILED");assert.equal(rejected.diagnostics.guest_phase,"unknown");assert.equal(rejected.diagnostics.delegated_calls,1);assert.equal(rejected.diagnostics.returned_results,0);assert.equal(rejected.diagnostics.last_delegation.result,"pending");
});
test("running returned shell and poll exit status do not assert successful desktop automation",async()=>{
 let n=0;const r=await run('await tools.exec_command({});await tools.write_stdin({session_id:"private-fixture"});throw Error("stop")',async()=>result(++n===1?{running:true,supervisor_ready:true,exit_code:null}:{running:false,supervisor_ready:true,exit_code:1}));
 assert.equal(r.diagnostics.delegated_calls,2);assert.equal(r.diagnostics.returned_results,2);assert.equal(r.diagnostics.last_delegation.operation,"write_stdin");assert.equal(r.diagnostics.last_delegation.shell.exit_code,1);assert.equal(r.diagnostics.effects,"not_determined");
});
test("concurrent completions cannot attach one tool's result to a different last-started delegation",()=>{
 const d=cellDiagnostics(),a=d.begin("exec_command"),b=d.begin("custom-private-fixture");b(result({}));a(result({running:true}));a(result({running:false}));const value=d.snapshot("await");assert.equal(value.delegated_calls,2);assert.equal(value.returned_results,2);assert.deepEqual(value.last_delegation,{operation:"other",result:"returned",shell:null});assert.doesNotMatch(JSON.stringify(value),/private-fixture/);
});
test("diagnostic schema rejects raw extras, getters, unknown phases and inconsistent counts",()=>{
 const d=cellDiagnostics().snapshot("compile");assert.deepEqual(copyCellDiagnostics(d),d);for(const value of [{...d,secret:"private-fixture"},{...d,guest_phase:"private-fixture"},{...d,returned_results:1},{...d,delegated_calls:65}])assert.equal(copyCellDiagnostics(value),undefined);
 let reads=0;assert.equal(copyCellDiagnostics({...d,get effects(){reads++;return "not_determined";}}),undefined);assert.equal(reads,0);
 assert.equal(validCellDone({version:1,status:"error",code:"EXECUTION_FAILED",phase:"compile"}),true);assert.equal(validCellDone({version:1,status:"error",code:"EXECUTION_FAILED",phase:"compile",message:"private-fixture"}),false);
});
