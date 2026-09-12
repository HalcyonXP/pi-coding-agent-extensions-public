import assert from "node:assert/strict";
import test from "node:test";
import { evaluate } from "../../../openai-compatibility/runtime/evaluator.mjs";

const reply = value => ({isError:false,result:{content:[{type:"text",text:JSON.stringify(value)}]}});
async function cell(code, options = {}) {
  const calls = [], operations = [], output = [];
  const result = await evaluate(code, {
    allowedTools: ["target"],
    invoke: async (name, args) => { calls.push({name,args}); return reply(args); },
    cell: {output: value => output.push(value), yield() {}, pump() {},
      operation: async value => { operations.push(value); return {done:true}; },
      syncOperation: value => { operations.push(value); return {published:true}; }},
    ...options,
  });
  await new Promise(resolve => setImmediate(resolve));
  return {result,calls,operations,output};
}

test("nested JSON-string arguments arrive as exact native objects", async () => {
  const args = {value:"雪\0🌊",nested:{n:3}};
  const r = await cell(`const r=await tools.target(${JSON.stringify(JSON.stringify(args))});text(r.result.content[0].text);`);
  assert.equal(r.result.status,"ok");
  assert.deepEqual(r.calls,[{name:"target",args:{value:"雪\0🌊",nested:{n:3}}}]);
  assert.deepEqual(JSON.parse(r.output[0]),r.calls[0].args);
});
for (const input of ['"{"','"null"','"[]"','"1"','"\\\"text\\\""']) test("invalid string input never delegates: "+input, async () => {
  const r = await cell(`await tools.target(${input});`);
  assert.equal(r.result.status,"error");assert.equal(r.calls.length,0);
});
test("nested string parsing uses captured intrinsics, not guest replacements", async () => {
  const r=await cell('JSON.parse=()=>({forged:true});JSON.stringify=()=>"forged";const r=await tools.target(\'{"literal":true}\');text(r.result.content[0].text);');
  assert.equal(r.result.status,"ok");assert.deepEqual(r.calls,[{name:"target",args:{literal:true}}]);
});
test("native image-reference content blocks can be forwarded without image bytes", async () => {
  const ref="img_11111111-1111-1111-1111-111111111111";
  const r=await cell(`image({type:"image_reference",ref:${JSON.stringify(ref)},mimeType:"image/png",bytes:8});`);
  assert.equal(r.result.status,"ok");assert.deepEqual(r.operations,[{kind:"image",ref}]);
});
for(const value of ['{type:"image",data:"forged",mimeType:"image/png"}','{image_url:"https://example.com/image.png"}','"data:image/png;base64,AAAA"'])test("image forwarding refuses malformed inline data and network URLs: "+value,async()=>{
  const r=await cell(`image(${value});`);assert.equal(r.result.status,"error");assert.equal(r.operations.length,0);
});
test("detached rejection cannot start queued native work after disposal", async () => {
  const r=await cell('tools.target({mustNotRun:true});');
  assert.equal(r.result.code,"DETACHED_TOOL");assert.equal(r.calls.length,0);
});
test("discarded root timers cannot start host operations after disposal", async () => {
  const r=await cell('setTimeout(()=>text("late"),100);text("done");');
  assert.equal(r.result.status,"ok");assert.deepEqual(r.output,["done"]);assert.equal(r.operations.length,0);
});
test("early exit discards queued work and suppresses subsequent output", async () => {
  const r=await cell('tools.target({mustNotRun:true});try{exit()}catch{};text("late");');
  assert.equal(r.result.status,"ok");assert.equal(r.calls.length,0);assert.deepEqual(r.output,[]);
});
test("timer-only evaluator cells do not require a tool bridge to decode replies", async () => {
  const r=await cell('await new Promise(resolve=>setTimeout(resolve,0));text("resumed");',{invoke:undefined,allowedTools:[]});
  assert.equal(r.result.status,"ok");assert.deepEqual(r.output,["resumed"]);
});
for(const expression of ['" ".repeat(65536)+"{}"','JSON.stringify({value:"🌊".repeat(17000)})'])test("string support does not widen source/argument budgets: "+expression,async()=>{
  const r=await cell(`await tools.target(${expression});`);assert.equal(r.result.status,"error");assert.equal(r.calls.length,0);
});
test("portable name-based probe does not gain the cell JSON-string adapter",async()=>{
  let calls=0;const r=await evaluate('await tools.call("target","{}");',{allowedTools:["target"],invoke(){calls++;return reply({});}});
  assert.equal(r.status,"error");assert.equal(calls,0);
});
test("already delegated late results are not inspected after exit",async()=>{
  let finish,calls=0,reads=0;
  const r=await cell('tools.target({});await new Promise(r=>setTimeout(r,0));exit();',{invoke:()=>{calls++;return new Promise(resolve=>{finish=resolve;});}});
  assert.equal(r.result.status,"ok");assert.equal(calls,1);
  finish({get content(){reads++;return [];}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,0);
});
test("image reference accessors refuse before executing guest getters",async()=>{
  const r=await cell('image({get type(){while(true){}}});');assert.equal(r.result.code,"IMAGE_REFERENCE_REQUIRED");assert.equal(r.operations.length,0);
});
test("guest Proxy descriptor traps remain under the unchanged execution watchdog",async()=>{
  const r=await cell('image(new Proxy({}, {getOwnPropertyDescriptor(){while(true){}}}));');assert.equal(r.result.code,"EXECUTION_LIMIT");assert.equal(r.operations.length,0);
});

import {CellEvidence} from '../../../openai-compatibility/runtime/evidence.mjs';
test("image-reference forwarding still requires journaled same-context evidence",async()=>{
  const signal=new AbortController().signal,evidence=new CellEvidence(signal),published=[];
  const scope={id:'synthetic-native-scope',signal,async publishEvidence(value){published.push(value);}};
  const native={content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGioAAAAASUVORK5CYII='}]};
  try{
    await evidence.capture(scope,{scopeId:scope.id,toolName:'imagegen',toolCallId:'synthetic-image-call',result:native,isError:false});
    const block=evidence.project({result:native,isError:false}).result.content[0];
    const r=await cell(`image(${JSON.stringify(block)});`,{cell:{output(){},yield(){},pump(){},operation(){},syncOperation(value){return evidence.resolveImage(value.ref)&&{published:true};}}});
    assert.equal(r.result.status,'ok');assert.equal(published.length,1);
    evidence.close();assert.throws(()=>evidence.resolveImage(block.ref),/PROTECTED_EVIDENCE_UNAVAILABLE/);
    const foreign=new CellEvidence(signal);try{assert.throws(()=>foreign.resolveImage(block.ref),/PROTECTED_EVIDENCE_UNAVAILABLE/);}finally{foreign.close();}
  }finally{evidence.close();}
});

import {WindowsCellRuntime} from '../../../openai-compatibility/runtime/windows-host.mjs';
import {CellStore} from '../../../openai-compatibility/runtime/cell-protocol.mjs';
test('contained Windows cell accepts string arguments without changing native result wrappers',{skip:process.platform!=='win32'||process.arch!=='x64'},async()=>{
  const output=[],calls=[],signal=AbortSignal.timeout(5000),store=new CellStore();
  const runtime=new WindowsCellRuntime({store,output:value=>output.push(value),yield(){}});
  const failures=[];
  try{
    const result=await runtime.run('const r=await tools.target(\'{"n":7}\');text(r.result.content[0].text);',{gateway:{signal,async invoke(name,args){calls.push({name,args});return reply(args);}},allowedTools:['target'],signal});
    assert.equal(result.status,'ok');assert.deepEqual(calls,[{name:'target',args:{n:7}}]);assert.deepEqual(output,['{"n":7}']);
  }catch(error){failures.push(error);}finally{try{await runtime.close();}catch(error){failures.push(error);}store.close();}
  if(failures.length)throw new AggregateError(failures,'Contained coordinator test and/or cleanup failed');
});
