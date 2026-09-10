import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../../../openai-compatibility/runtime/evaluator.mjs';
import { CellRuntime } from '../../../openai-compatibility/runtime/rpc-host.mjs';
import { WindowsCellRuntime } from '../../../openai-compatibility/runtime/windows-host.mjs';
import { CellStore } from '../../../openai-compatibility/runtime/cell-protocol.mjs';
const cell = output => ({output: value => output.push(value), syncOperation: () => ({}), operation: async () => ({}), pump() {}, yield() {}});
async function run(code, names = [], invoke = async () => ({result:{content:[]},isError:false})) {
  const output = [], calls = [];
  const result = await evaluate(code, {cell:cell(output),allowedTools:names,toolMetadata:names.map(name=>({name,description:name})),invoke:async(name,args)=>{calls.push({name,args});return invoke(name,args);}});
  return {result,output,calls};
}
for(const [name,code,error] of [
  ['reported metadata-array failure','text(ALL_TOOLS.filter(x=>x.name==="read"))','TEXT_VALUE_UNSUPPORTED'],
  ['plain object','text({private_fixture:"do not disclose"})','TEXT_VALUE_UNSUPPORTED'],
  ['image object','image({private_fixture:"do not disclose"})','IMAGE_REFERENCE_REQUIRED'],
  ['image URL','image("https://invalid.example/private_fixture")','IMAGE_REFERENCE_REQUIRED'],
  ['timer callback','setTimeout("private_fixture",0)','TIMER_CALLBACK_REQUIRED'],
]) test('fixed helper classification: '+name,async()=>{const r=await run(code,['read']);assert.equal(r.result.code,error);assert.equal(r.result.phase,'await');assert.deepEqual(r.calls,[]);assert.deepEqual(r.output,[]);assert.doesNotMatch(JSON.stringify(r.result),/private_fixture|do not disclose/);});
test('primitive output and explicit metadata serialization remain unchanged',async()=>{const r=await run('text("a\\0b");text(null);text(undefined);text(42);text(false);text(JSON.stringify(ALL_TOOLS));',['read']);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['a\0b','null','undefined','42','false','[{"name":"read","description":"read"}]']);});
test('handled helper failure does not poison later success or delegation',async()=>{const r=await run('try{text([])}catch{};await tools.read({path:"fixture"});text("ok")',['read']);assert.equal(r.result.status,'ok');assert.equal(r.calls.length,1);assert.deepEqual(r.output,['ok']);});
test('caught helper failure is not substituted for a later arbitrary error',async()=>{const r=await run('try{text([])}catch{};throw Error("TEXT_VALUE_UNSUPPORTED private_fixture")');assert.equal(r.result.code,'EXECUTION_FAILED');assert.doesNotMatch(JSON.stringify(r.result),/private_fixture/);});
test('helper identity survives hostile mutations without reading error properties',async()=>{const r=await run('let e;try{text([])}catch(x){e=x};Object.defineProperty(e,"message",{get(){while(true){}}});Object.defineProperty(e,"stack",{get(){while(true){}}});throw e');assert.equal(r.result.code,'TEXT_VALUE_UNSUPPORTED');});
test('guest cannot replace captured classification intrinsics',async()=>{const r=await run('WeakMap.prototype.get=()=>"IMAGE_REFERENCE_REQUIRED";WeakMap.prototype.set=()=>{throw Error("private_fixture")};globalThis.Error=function(){throw "private_fixture"};text([])');assert.equal(r.result.code,'TEXT_VALUE_UNSUPPORTED');});
test('forged and proxied failures do not acquire helper classification',async()=>{for(const code of ['throw {code:"TEXT_VALUE_UNSUPPORTED",get message(){while(true){}}}','let e;try{text([])}catch(x){e=x};throw new Proxy(e,{get(){while(true){}}})']){const r=await run(code);assert.equal(r.result.code,'EXECUTION_FAILED');}});
test('exit still ends successfully after a caught helper failure',async()=>{const r=await run('try{text([])}catch{};exit();throw "unreachable"');assert.equal(r.result.status,'ok');});
test('exit from an awaited timer remains successful',async()=>{const r=await run('await new Promise(resolve=>setTimeout(()=>{exit()},0));text("unreachable")');assert.equal(r.result.status,'ok');assert.deepEqual(r.output,[]);});
test('aliases do not enlarge admitted native names or metadata',async()=>{const names=Array.from({length:32},(_,i)=>'native-'+i),r=await run('text(TOOL_NAMES.length);text(ALL_TOOLS.length);text(Object.getOwnPropertyNames(tools).length)',names);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['32','32','64']);assert.deepEqual(r.calls,[]);});
test('omitted and undefined timer delays are zero, not an invalid operation',async()=>{for(const delay of ['',', undefined']){const r=await run(`await new Promise(resolve=>setTimeout(resolve${delay}));text("awake")`);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['awake']);}});
test('timer callback helper failure is classified without exception inspection',async()=>{const r=await run('await new Promise(resolve=>setTimeout(()=>{text([]);resolve()},0))');assert.equal(r.result.code,'TEXT_VALUE_UNSUPPORTED');});
test('unambiguous identifier alias delegates only the original native name',async()=>{const r=await run('await tools.native_read(JSON.stringify({path:"fixture"}));text(TOOL_NAMES.join(","));text(ALL_TOOLS[0].name);text(String(Object.isFrozen(tools)));',['native-read']);assert.equal(r.result.status,'ok');assert.deepEqual(r.calls,[{name:'native-read',args:{path:'fixture'}}]);assert.deepEqual(r.output,['native-read','native-read','true']);});
test('native exact names win over aliases and remain callable',async()=>{const r=await run('await tools.native_read({which:"exact"});await tools["native-read"]({which:"hyphen"})',['native-read','native_read']);assert.equal(r.result.status,'ok');assert.deepEqual(r.calls.map(c=>c.name),['native_read','native-read']);});
test('ambiguous aliases are absent rather than dispatching an arbitrary tool',async()=>{const r=await run('text(typeof tools.a_b_c);await tools["a-b_c"]({});await tools["a_b-c"]({})',['a-b_c','a_b-c']);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['undefined']);assert.deepEqual(r.calls.map(c=>c.name),['a-b_c','a_b-c']);});
test('portable object-only bridge does not acquire cell helper errors or aliases',async()=>{const r=await evaluate('throw Error("TEXT_VALUE_UNSUPPORTED")');assert.equal(r.code,'EXECUTION_FAILED');});
test('arbitrary timer exception remains generic and private',async()=>{const r=await run('await new Promise(resolve=>setTimeout(()=>{throw {get message(){while(true){}},private_fixture:true}},0))');assert.equal(r.result.code,'EXECUTION_FAILED');assert.doesNotMatch(JSON.stringify(r.result),/private_fixture/);});
test('caught callback error allows the timer to finish normally',async()=>{const r=await run('await new Promise(resolve=>setTimeout(()=>{try{text([])}catch{};resolve()},0));text("ok")');assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['ok']);});
for(const [name,Runtime]of [['semantic worker',CellRuntime],['Windows contained worker',WindowsCellRuntime]])test(name+' carries classified helper errors and canonical alias dispatch',{skip:name.startsWith('Windows')&&process.platform!=='win32'},async()=>{
 for(const[code,expected]of [['text(ALL_TOOLS)','TEXT_VALUE_UNSUPPORTED'],['image({})','IMAGE_REFERENCE_REQUIRED'],['setTimeout("not a callback")','TIMER_CALLBACK_REQUIRED'],['await new Promise(resolve=>setTimeout(()=>{text([])},0))','TEXT_VALUE_UNSUPPORTED'],['const r=await tools.native_read("{}");text(r.result.content[0].text)',undefined]]){
  const store=new CellStore(),output=[],calls=[],runtime=new Runtime({store,output:v=>output.push(v),yield:()=>{}}),failures=[];
  try{const result=await runtime.run(code,{gateway:{signal:new AbortController().signal,invoke:async(name,args)=>{calls.push({name,args});return{result:{content:[{type:'text',text:'native wrapper preserved'}]},isError:false};}},allowedTools:['native-read'],toolMetadata:[{name:'native-read',description:'Native fixture read'}],signal:AbortSignal.timeout(5000)});if(expected){assert.equal(result.code,expected);assert.equal(result.diagnostics.guest_phase,'await');assert.equal(result.diagnostics.delegated_calls,0);assert.equal(result.diagnostics.effects,'not_determined');assert.deepEqual(output,[]);}else{assert.equal(result.status,'ok');assert.deepEqual(calls,[{name:'native-read',args:{}}]);assert.deepEqual(output,['native wrapper preserved']);}}
  catch(error){failures.push(error);}finally{try{await runtime.close();}catch(error){failures.push(error);}try{store.close();}catch(error){failures.push(error);}}
  if(failures.length)throw new AggregateError(failures,'Helper worker acceptance and/or owned cleanup failed');
 }
});
