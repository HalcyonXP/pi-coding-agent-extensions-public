import assert from "node:assert/strict";
import { test } from "node:test";
import { CellRuntime } from "../../../openai-compatibility/runtime/rpc-host.mjs";
import { WindowsCellRuntime } from "../../../openai-compatibility/runtime/windows-host.mjs";
import { CellStore, CELL_LIMITS } from "../../../openai-compatibility/runtime/cell-protocol.mjs";
import { SyncChannel } from "../../../openai-compatibility/runtime/sync-channel.mjs";

async function run(code, {store = new CellStore(), invoke = async (_name, args) => ({isError:false,result:{content:[{type:"text",text:JSON.stringify(args)}]}}), tools = ["target"], Constructor = CellRuntime, timeout = 4000} = {}) {
  const output=[]; let yields=0;
  const runtime=new Constructor({store,output: value=>output.push(value),yield:()=>yields++});
  try { return {result: await runtime.run(code,{gateway:{signal:new AbortController().signal,invoke},allowedTools:tools,signal:AbortSignal.timeout(timeout)}),output,yields}; }
  finally { await runtime.close(); }
}
test("synchronous cell helpers share only serialized bounded session memory",async()=>{
  const store=new CellStore();
  const a=await run('const v={value:"α\\0🐈"};store("__proto__",v);v.value="changed";text(load("__proto__").value);',{store,tools:[]});
  assert.equal(a.result.status,"ok");assert.deepEqual(a.output,["α\0🐈"]);
  assert.deepEqual((await run('text(load("__proto__").value);text(load("absent"));',{store,tools:[]})).output,["α\0🐈","undefined"]);
  assert.deepEqual((await run('text(load("__proto__"));',{tools:[]})).output,["undefined"]);
});
test("store bounds are atomic and closed stores cannot be reused",()=>{
 const store=new CellStore();for(let n=0;n<CELL_LIMITS.keys;n++)store.apply({kind:"store",key:String(n),value:n});
 assert.throws(()=>store.apply({kind:"store",key:"overflow",value:1}));
 assert.throws(()=>store.apply({kind:"store",key:"0",value:"x".repeat(CELL_LIMITS.valueBytes+1)}));
 assert.deepEqual(store.apply({kind:"load",key:"0"}),{found:true,value:0});store.close();assert.throws(()=>store.apply({kind:"load",key:"0"}));
});
test("store getters/toJSON never execute in the native host store",()=>{
 const store=new CellStore();let calls=0;
 assert.throws(()=>store.apply({kind:"store",key:"x",value:{get secret(){calls++;return 1;}}}));assert.equal(calls,0);
});
test("named tools, synchronous operations, microtasks and timer callbacks share the same evaluator",async()=>{
 const result=await run('const p=tools.target({value:3});store("x",4);text(load("x"));text((await p).result.content[0].text);await new Promise(r=>setTimeout(r,10));text("done");');
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,["4",'{"value":3}',"done"]);
});
test("explicit yield publishes without restarting the script",async()=>{
 const result=await run('text("first");yield_control();await new Promise(r=>setTimeout(r,10));text("second");');
 assert.equal(result.result.status,"ok");assert.equal(result.yields,1);assert.deepEqual(result.output,["first","second"]);
});
test("exit after a resumed promise succeeds and prevents subsequent side effects",async()=>{
 let calls=0;const result=await run('await new Promise(r=>setTimeout(r,1));try{exit()}catch{};tools.target({});text("forbidden");while(true){}',{invoke:async()=>{calls++;return {result:{content:[]},isError:false}}});
 assert.equal(result.result.status,"ok");assert.equal(calls,0);assert.deepEqual(result.output,[]);
});
test("timers are discarded at completed root, never left as an invisible worker",async()=>{
 const before=performance.now();const result=await run('setTimeout(()=>text("late"),60000);text("now");');
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,["now"]);assert.ok(performance.now()-before<3000);
});
test("cleared timers do not run callbacks",async()=>{
 const result=await run('clearTimeout(setTimeout(()=>text("bad"),1));await new Promise(r=>setTimeout(r,20));text("good");');
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,["good"]);
});
for(const [name,code]of [
 ['operation admission','for(let n=0;n<65;n++)store("x",n);'],
 ['output count','for(let n=0;n<65;n++)text("x");'],
 ['timer duration','setTimeout(()=>{},60001);await new Promise(()=>{});'],
 ['heap','let s="x";while(true)s+=s;'],
 ['active CPU','while(true){}'],
 ['imports','await import("node:fs");'],
 ['recursive exec','await tools.exec({code:"text(1)"});'],
 ['detached tools','tools.target({});'],
])test(`cell rejects ${name}`,async()=>{assert.equal((await run(code)).result.status,"error");});
test("a cell is not constrained by the historical five-second probe watchdog",async()=>{
 const result=await run('text("before");await new Promise(r=>setTimeout(r,5200));text("after");',{timeout:9000});
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,["before","after"]);
});
test("the Windows-contained cell uses the same engine and synchronous channel",{skip:process.platform!=="win32"||process.arch!=="x64"},async()=>{
 const result=await run('store("x","α\\0🐈");yield_control();await new Promise(r=>setTimeout(r,20));text(load("x"));',{Constructor:WindowsCellRuntime});
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,["α\0🐈"]);assert.equal(result.yields,1);
});
test("synchronous framing handles partial reads/writes and rejects EOF",()=>{
 const input=Buffer.from('{"value":"α\\u0000🐈"}\n');let offset=0;const chunks=[];
 const channel=new SyncChannel({read:(_fd,b,start)=>{if(offset===input.length)return 0;b[start]=input[offset++];return 1;},write:(_fd,b,start,length)=>{const n=Math.min(2,length);chunks.push(Buffer.from(b.subarray(start,start+n)));return n;}});
 const value=channel.receive();assert.deepEqual(value,{value:"α\0🐈"});channel.send(value);assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()),value);assert.throws(()=>channel.receive());
});
import { execInput, budgetOutput } from "../../../openai-compatibility/runtime/cell-input.mjs";
test("exec pragma validates exact fields and rejects ambiguous duplicate controls",()=>{
 assert.deepEqual(execInput('// @exec: {"yield_time_ms":0,"max_output_tokens":1}\ntext(1);'),{code:'text(1);',yieldMs:0,tokens:1});
 for(const code of ['// @exec: {}','// @exec: {"unknown":1}\ntext(1)','// @exec: {"yield_time_ms":null}\ntext(1)','// @exec: {"yield_time_ms":30001}\ntext(1)'])assert.throws(()=>execInput(code));
 assert.throws(()=>execInput('// @exec: {"yield_time_ms":1}\ntext(1)',{yield_time_ms:1}));
 assert.throws(()=>execInput('text(1)',{max_output_tokens:null}));
});
test("CRLF pragmas preserve zero and maximum limits instead of silently using defaults",()=>{
 for(const newline of ["\n","\r\n"])for(const [yieldMs,tokens]of [[0,0],[30000,16384]]){
  const source=`// @exec: ${JSON.stringify({yield_time_ms:yieldMs,max_output_tokens:tokens})}${newline}text("雪");${newline}`;
  assert.deepEqual(execInput(source),{code:`text("雪");${newline}`,yieldMs,tokens});
 }
 for(const pragma of ['{"unknown":1}','{"yield_time_ms":-1}','{"max_output_tokens":null}','{'])assert.throws(()=>execInput(`// @exec: ${pragma}\r\ntext("must not run");`));
 assert.throws(()=>execInput('// @exec: {"yield_time_ms":1}\r\ntext(1)',{yield_time_ms:1}));
});
test("estimated output budgets preserve Unicode and disclose omitted guest bytes",()=>{
 assert.deepEqual(budgetOutput(['🐈🐈','next'],1),{output:['🐈'],omitted_output_bytes:8});
 assert.deepEqual(budgetOutput(['α\0🐈'],0),{output:[],omitted_output_bytes:7});
 assert.deepEqual(budgetOutput(['α\0🐈'],2),{output:['α\0🐈']});
});
test("contained cell configuration never falls back to a portable/legacy profile",()=>{
 assert.throws(()=>new WindowsCellRuntime());
 assert.throws(()=>new WindowsCellRuntime({store:{},output:()=>{},yield:()=>{}}));
});
test("confirmed clearTimeout drains timer admission before another tool call",async()=>{
 const result=await run('const ids=[];for(let n=0;n<4;n++)ids.push(setTimeout(()=>text("bad"),60000));for(const id of ids)clearTimeout(id);text((await tools.target({value:1})).result.content[0].text);');
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,['{"value":1}']);
});
test("clearTimeout confirms already-admitted host timers before reclaiming work slots",async()=>{
 const result=await run('const ids=[];for(let n=0;n<3;n++)ids.push(setTimeout(()=>text("bad"),60000));await new Promise(r=>setTimeout(r,10));for(const id of ids)clearTimeout(id);text((await tools.target({value:2})).result.content[0].text);');
 assert.equal(result.result.status,"ok");assert.deepEqual(result.output,['{"value":2}']);
});
