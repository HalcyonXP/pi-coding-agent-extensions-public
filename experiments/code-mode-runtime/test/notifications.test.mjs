import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluate } from '../../../openai-compatibility/runtime/evaluator.mjs';
import { validOperation, CellStore } from '../../../openai-compatibility/runtime/cell-protocol.mjs';
import { CellRuntime } from '../../../openai-compatibility/runtime/rpc-host.mjs';
import { WindowsCellRuntime } from '../../../openai-compatibility/runtime/windows-host.mjs';

async function semantic(code, acceptance = true) {
  const operations = [], output = [];
  const result = await evaluate(code, { cell: {
    output: text => output.push(text), yield() {}, pump() {}, syncOperation: () => ({}),
    operation: async value => { operations.push(value); return acceptance; },
  } });
  return { result, operations, output };
}

test('notify is a bounded operation without a caller-selected target identity', () => {
  assert.equal(validOperation({kind:'notify',text:'a\0😀'}),true);
  for(const value of [{kind:'notify',text:'a',call_id:'forged'}, {kind:'notify',text:{}}, {kind:'notify',text:'x'.repeat(65537)}, {kind:'notify',text:'😀'.repeat(16385)}])
    assert.equal(validOperation(value),false);
});
test('awaited primitive notifications are separate from guest text output', async () => {
  const r=await semantic('await notify("a\\0😀");await notify(undefined);await notify(null);await notify(false);await notify(42);text("finished");');
  assert.equal(r.result.status,'ok');
  assert.deepEqual(r.operations.map(o=>o.text),['a\0😀','undefined','null','false','42']);
  assert.deepEqual(r.output,['finished']);
});
for(const [receipt,error] of [[false,'NOTIFY_INACTIVE'],[null,'NOTIFY_UNAVAILABLE']])test('native refusal has fixed private feedback: '+error,async()=>{
  const r=await semantic('await notify("private_fixture");text("unreachable")',receipt);
  assert.equal(r.result.code,error);assert.deepEqual(r.output,[]);assert.doesNotMatch(JSON.stringify(r.result),/private_fixture/);
});
for(const code of ['notify()','notify("x","extra")','notify({get x(){while(true){}}})','notify({toString(){while(true){}},toJSON(){while(true){}}})','notify(Symbol("private"))','notify(1n)'])test('notification value refusal avoids guest coercion: '+code,async()=>{
  const r=await semantic(code);assert.equal(r.result.code,'NOTIFY_VALUE_UNSUPPORTED');assert.deepEqual(r.operations,[]);
});
test('caught notification refusal does not poison later cell text',async()=>{
  const r=await semantic('try{await notify("x")}catch{};text("still running")',false);
  assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['still running']);
});
test('notification captures serializer and promise intrinsics and uses a null-prototype payload',async()=>{
  const r=await semantic('JSON.stringify=()=>{throw Error("bad")};Object.prototype.toJSON=()=>{throw Error("bad")};Promise.prototype.then=()=>{throw Error("bad")};await notify("literal");text("done");');
  assert.equal(r.result.status,'ok');assert.deepEqual(r.operations,[{kind:'notify',text:'literal'}]);assert.deepEqual(r.output,['done']);
});
test('detached notification is not silently promoted to background work',async()=>{
  const r=await semantic('notify("detached")');assert.equal(r.result.code,'DETACHED_TOOL');assert.deepEqual(r.operations,[]);
});

for(const [name,Runtime] of [['semantic worker',CellRuntime],['contained worker',WindowsCellRuntime]])test(name+' carries notifications and native refusals without ordinary tool delegation', {skip:name==='contained worker'&&process.platform!=='win32'},async()=>{
  for(const [accepted,expected] of [[true,undefined],[false,'NOTIFY_INACTIVE'],[null,'NOTIFY_UNAVAILABLE']]){
    const store=new CellStore(), output=[], notifications=[], failures=[];
    const runtime=new Runtime({store,output:t=>output.push(t),yield:()=>{}});
    try {
      const result=await runtime.run('await notify("literal\\0😀");text("acknowledged")',{
        gateway:{signal:new AbortController().signal,invoke:async()=>{throw Error('Unexpected ordinary tool');},
          canNotify:()=>accepted!==null,notify:async text=>{notifications.push(text);return accepted;}},
        allowedTools:[],signal:AbortSignal.timeout(5000),
      });
      if(expected){assert.equal(result.code,expected);assert.deepEqual(output,[]);}else{assert.equal(result.status,'ok');assert.deepEqual(output,['acknowledged']);}
      assert.deepEqual(notifications,accepted===null?[]:['literal\0😀']);
    }catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}try{store.close();}catch(e){failures.push(e);}}
    if(failures.length)throw new AggregateError(failures,'Notification worker or cleanup failed; no replay');
  }
});
