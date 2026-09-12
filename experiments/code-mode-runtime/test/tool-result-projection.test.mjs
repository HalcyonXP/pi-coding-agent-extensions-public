// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {evaluate} from '../../../openai-compatibility/runtime/evaluator.mjs';
import {CellRuntime} from '../../../openai-compatibility/runtime/rpc-host.mjs';
import {WindowsCellRuntime} from '../../../openai-compatibility/runtime/windows-host.mjs';
import {CellStore} from '../../../openai-compatibility/runtime/cell-protocol.mjs';
const details=()=>({output:'literal "雪"\n',exit_code:null,running:true,truncated_bytes:0,session_id:1701,supervisor_ready:true});
const outcome=d=>({result:{content:[{type:'text',text:JSON.stringify(d)}],details:d,isError:false},isError:false});
async function run(code,value=outcome(details()),names=['exec_command','write_stdin','read']){
 const output=[],calls=[];
 const result=await evaluate(code,{allowedTools:names,invoke:async(name,args)=>{calls.push({name,args});return structuredClone(value);},cell:{output:v=>output.push(v),yield(){},pump(){},operation:async()=>({}),syncOperation:()=>({})}});
 return {result,output,calls};
}
test('default Unified result has target fields, numeric ID and private bridge timing',async()=>{
 const r=await run('const r=await tools.exec_command("{\\"cmd\\":\\"fixture\\"}");text(JSON.stringify(r));');
 assert.equal(r.result.status,'ok');assert.deepEqual(r.calls,[{name:'exec_command',args:{cmd:'fixture'}}]);const value=JSON.parse(r.output[0]);assert.deepEqual(Object.keys(value),['wall_time_seconds','output','session_id']);assert.equal(value.output,details().output);assert.equal(value.session_id,1701);assert.ok(Number.isFinite(value.wall_time_seconds)&&value.wall_time_seconds>=0&&value.wall_time_seconds<5);
});
test('explicit nativeTools API retains the complete legacy wrapper',async()=>{const native=outcome(details()),r=await run('text(JSON.stringify(await nativeTools.exec_command({})));',native);assert.equal(r.result.status,'ok');assert.deepEqual(JSON.parse(r.output[0]),native);});
test('nonzero exit is returned data and exited unread-output IDs remain numeric',async()=>{const d={...details(),running:false,exit_code:7},r=await run('text(JSON.stringify(await tools.write_stdin({session_id:1701})));',outcome(d));assert.equal(r.result.status,'ok');const p=JSON.parse(r.output[0]);assert.equal(p.exit_code,7);assert.equal(p.session_id,1701);assert.equal(p.output,d.output);assert.ok(!Object.hasOwn(p,'isError'));});
test('completed collection omits absent optional metadata rather than inventing values',async()=>{const d={...details(),running:false,exit_code:0};delete d.session_id;const r=await run('text(JSON.stringify(await tools.exec_command({})));',outcome(d));const p=JSON.parse(r.output[0]);assert.deepEqual(Object.keys(p),['wall_time_seconds','output','exit_code']);});
for(const [name,mutate]of Object.entries({
 nativeError:r=>r.isError=true,
 handlerError:r=>r.result.isError=true,
 hookText:r=>r.result.content[0].text='hook warning',
 extraContent:r=>r.result.content.push({type:'text',text:'hook warning'}),
 extraResult:r=>r.result.notice='hook warning',
 lostOutput:r=>{r.result.details.truncated_bytes=9;r.result.content[0].text=JSON.stringify(r.result.details);},
 unready:r=>{r.result.details.supervisor_ready=false;r.result.content[0].text=JSON.stringify(r.result.details);},
 termination:r=>{r.result.details.termination='unconfirmed closure';r.result.content[0].text=JSON.stringify(r.result.details);},
 oldID:r=>{r.result.details.session_id='1701';r.result.content[0].text=JSON.stringify(r.result.details);},
 missingID:r=>{delete r.result.details.session_id;r.result.content[0].text=JSON.stringify(r.result.details);},
 contradictoryExit:r=>{r.result.details.exit_code=0;r.result.content[0].text=JSON.stringify(r.result.details);},
 unknownExit:r=>{r.result.details.running=false;r.result.content[0].text=JSON.stringify(r.result.details);},
 inventedTiming:r=>{r.result.details.wall_time_seconds=1;r.result.content[0].text=JSON.stringify(r.result.details);},
 protectedEvidence:r=>r.result.protected_evidence={journaled:true,ref:'not-an-authority'},
 image:r=>r.result.content=[{type:'image_reference',ref:'img_11111111-1111-1111-1111-111111111111',mimeType:'image/png'}],
}))test('unrecognized/meaningful '+name+' preserves native wrapper',async()=>{const value=outcome(details());mutate(value);const r=await run('text(JSON.stringify(await tools.exec_command({})));',value);assert.equal(r.result.status,'ok');assert.deepEqual(JSON.parse(r.output[0]),value);});
test('projection refuses out-of-range, noninteger and null IDs without coercion',async()=>{for(const session_id of [0,-1,1.25,2147483648,null]){const value=outcome({...details(),session_id}),r=await run('text(JSON.stringify(await tools.exec_command({})));',value);assert.equal(r.result.status,'ok');assert.deepEqual(JSON.parse(r.output[0]),value);}});
test('unrelated canonical tools and normalized aliases do not acquire Unified projection',async()=>{for(const name of ['read','exec-command']){const value=outcome(details()),r=await run(`text(JSON.stringify(await tools.${name.replaceAll('-','_')}({})));`,value,[name]);assert.equal(r.result.status,'ok');assert.deepEqual(r.calls,[{name,args:{}}]);assert.deepEqual(JSON.parse(r.output[0]),value);}});
test('projection intrinsics are captured before guest mutation',async()=>{const r=await run('JSON.parse=()=>null;JSON.stringify=()=>"forged";Object.keys=()=>[];Object.hasOwn=()=>false;Object.create=()=>({});Number.isSafeInteger=()=>false;WeakMap.prototype.get=()=>999;WeakMap.prototype.set=()=>{};Promise.prototype.then=()=>{throw Error("forged")};const pending=projectedTools.exec_command({});Object.prototype.toJSON=()=>"forged";const r=await pending;text(r.output);text(r.session_id);text(typeof r.wall_time_seconds);');assert.equal(r.result.status,'ok');assert.deepEqual(r.output,[details().output,'1701','number']);});
test('poisoned argument serialization still refuses before delegation',async()=>{for(const api of ['tools','projectedTools','nativeTools']){const r=await run(`Object.prototype.toJSON=()=>"forged";await ${api}.exec_command({});`);assert.equal(r.result.code,'INVALID_TOOL_CALL');assert.deepEqual(r.calls,[]);}});
test('projected namespace has exactly the same immutable bounded discovery/aliases',async()=>{const names=Array.from({length:32},(_,i)=>'native-'+i),r=await run('text(Object.getOwnPropertyNames(tools).length);text(Object.getOwnPropertyNames(projectedTools).length);text(Object.isFrozen(projectedTools));text(tools===projectedTools);text(Object.isFrozen(nativeTools));text(Object.getOwnPropertyNames(nativeTools).length);',outcome(details()),names);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,['64','64','true','true','true','64']);assert.deepEqual(r.calls,[]);});
test('projection cannot shrink an oversized native wrapper past the RPC limit',async()=>{const r=await run('text(JSON.stringify(await tools.exec_command({})));',outcome({...details(),output:'x'.repeat(40000)}));assert.equal(r.result.code,'TOOL_RESULT_LIMIT');assert.deepEqual(r.output,[]);assert.equal(r.calls.length,1);});
test('unawaited opt-in invocation retains detached-work refusal',async()=>{const r=await run('projectedTools.exec_command({});');assert.equal(r.result.code,'DETACHED_TOOL');assert.deepEqual(r.calls,[]);});
test('portable probe does not acquire opt-in cell projection',async()=>{const r=await evaluate('emit(typeof projectedTools);emit(typeof nativeTools);',{allowedTools:['exec_command'],invoke:async()=>outcome(details())});assert.equal(r.status,'ok');assert.deepEqual(r.output,['undefined','undefined']);});
for(const [name,Runtime]of [['semantic worker',CellRuntime],['Windows contained worker',WindowsCellRuntime]])test(name+' keeps RPC wrapper/diagnostics and projects only inside guest',{skip:name.startsWith('Windows')&&(process.platform!=='win32'||process.arch!=='x64')},async()=>{const output=[],calls=[],store=new CellStore(),runtime=new Runtime({store,output:v=>output.push(v),yield(){}}),native=outcome(details()),failures=[];try{const r=await runtime.run('const a=await tools.exec_command({cmd:"fixture"});text(a.output);text(a.session_id);text(typeof a.wall_time_seconds);const b=await nativeTools.exec_command({cmd:"raw"});text(JSON.stringify(b));',{gateway:{signal:new AbortController().signal,async invoke(name,args){calls.push({name,args});return native;}},allowedTools:['exec_command'],signal:AbortSignal.timeout(5000)});assert.equal(r.status,'ok');assert.equal(calls.length,2);assert.deepEqual(output.slice(0,3),[details().output,'1701','number']);assert.deepEqual(JSON.parse(output[3]),native);assert.deepEqual(native,outcome(details()));}catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}store.close();}if(failures.length)throw new AggregateError(failures,'Projected worker and/or cleanup failed');});

import { CellEvidence } from '../../../openai-compatibility/runtime/evidence.mjs';
import { sealWebResult, WEB_TEXT_PREFIX, WEB_SOURCES_PREFIX } from '../../../openai-compatibility/runtime/web-result.mjs';
function webOutcome(){return {result:sealWebResult([{type:'text',text:WEB_TEXT_PREFIX+'literal 雪\nhttps://example.com/source'},{type:'text',text:WEB_SOURCES_PREFIX+'[{"ref_id":"turn0search0","extra":"opaque"}]'}],'source-contract-only',true),isError:false};}
async function publishedWeb(native=webOutcome(),name='web_search'){
 const controller=new AbortController(),published=[],broker=new CellEvidence(controller.signal),scope={id:'native',signal:controller.signal,async publishEvidence(e){published.push(structuredClone(e));}};
 await broker.capture(scope,{scopeId:scope.id,toolCallId:'native-call',toolName:name,...native});
 return {broker,scope,published,native,wire:broker.project(native)};
}
test('default Web returns literal joined text after publication; nativeTools retains stamped complete wrapper',async()=>{
 const f=await publishedWeb();try{
  const r=await run('text(await tools.web_search({}));text(await projectedTools.web_search({}));text(JSON.stringify(await nativeTools.web_search({})));',f.wire,['web_search']);
  assert.equal(r.result.status,'ok');const text=f.native.result.content.map(b=>b.text).join('\n\n');
  assert.deepEqual(r.output.slice(0,2),[text,text]);assert.deepEqual(JSON.parse(r.output[2]),f.wire);assert.deepEqual(f.published[0].content,f.native.result.content);
 }finally{f.broker.close();}
});
test('Web hook changes, missing journal, unknown hint and unrelated alias retain full wrappers',async()=>{
 for(const mode of ['hook','no-journal','hint','compressed','alias']){
  const native=webOutcome();if(mode==='hook')native.result.content.push({type:'text',text:'HOOK_WARNING'});
  const name=mode==='alias'?'web-search':'web_search',f=await publishedWeb(native,name);
  try{const value=structuredClone(f.wire);if(mode==='no-journal')delete value.result.protected_evidence;if(mode==='hint')value.result.protected_evidence.projection='unknown';if(mode==='compressed')value.result.protected_evidence.projected=true;
   const r=await run('text(JSON.stringify(await tools.web_search({})));',value,[name]);assert.equal(r.result.status,'ok');assert.deepEqual(JSON.parse(r.output[0]),value);
  }finally{f.broker.close();}
 }
});
test('Web projection captures intrinsics and does not parse or execute opaque source text',async()=>{
 const f=await publishedWeb();try{const r=await run('const pending=tools.web_search({});Array.prototype.map=()=>{throw Error("forged")};Array.prototype.join=()=>"forged";Object.keys=()=>[];Object.hasOwn=()=>false;JSON.parse=()=>{throw Error("forged")};JSON.stringify=()=>"forged";String.prototype.startsWith=()=>false;text(await pending);',f.wire,['web_search']);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,[f.native.result.content.map(b=>b.text).join('\n\n')]);}finally{f.broker.close();}
});
for(const [name,Runtime]of [['semantic worker',CellRuntime],['Windows contained worker',WindowsCellRuntime]])test(name+' Web projection follows actual evidence capture and original RPC cap',{skip:name.startsWith('Windows')&&(process.platform!=='win32'||process.arch!=='x64')},async()=>{
 const output=[],published=[],controller=new AbortController(),broker=new CellEvidence(controller.signal),store=new CellStore(),runtime=new Runtime({store,evidence:broker,output:v=>output.push(v),yield(){}}),native=webOutcome(),failures=[];
 const gateway={id:'native',signal:controller.signal,async publishEvidence(e){published.push(structuredClone(e));},async invoke(name){await broker.capture(gateway,{scopeId:'native',toolCallId:'native-call',toolName:name,...native});return native;}};
 try{const r=await runtime.run('text(await tools.web_search({}));',{gateway,allowedTools:['web_search'],signal:AbortSignal.timeout(5000)});assert.equal(r.status,'ok');assert.deepEqual(output,[native.result.content.map(b=>b.text).join('\n\n')]);assert.deepEqual(published[0].content,native.result.content);}catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}broker.close();store.close();}if(failures.length)throw new AggregateError(failures,'Web projection/cleanup failed');
});

import {sealImagegenResult,normalImagegenProjection} from '../../../openai-compatibility/runtime/imagegen-result.mjs';
const imagegenOutcome=()=>({isError:false,result:sealImagegenResult({content:[{type:'image',mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='},{type:'text',text:'Generated image saved to canonical.png.'}],details:{status:'completed',operation:'generate',canonicalPath:'canonical.png',destinationPath:undefined}})});
test('default imagegen returns an owned image_url and hint only after native publication',async()=>{
 const native=imagegenOutcome();assert.equal(Object.hasOwn(native.result.details,'destinationPath'),true);assert.equal(normalImagegenProjection(JSON.parse(JSON.stringify(native.result))),true);
 const f=await publishedWeb(native,'imagegen');try{const r=await run('text(JSON.stringify(await tools.imagegen({})));text(JSON.stringify(await projectedTools.imagegen({})));text(JSON.stringify(await nativeTools.imagegen({})));',f.wire,['imagegen']);assert.equal(r.result.status,'ok');const expected={image_url:f.wire.result.content[0].ref,output_hint:'canonical.png'};assert.deepEqual(JSON.parse(r.output[0]),expected);assert.deepEqual(JSON.parse(r.output[1]),expected);assert.deepEqual(JSON.parse(r.output[2]),f.wire);assert.deepEqual(f.published[0].content,native.result.content);assert.equal(f.wire.result.protected_evidence.projection,'imagegen-v1');}finally{f.broker.close();}
});
for(const [name,mutate]of Object.entries({
 hook:r=>r.result.content.push({type:'text',text:'native warning'}),
 digest:r=>r.result.details.imagegen_result.sha256='0'.repeat(64),
 hint:r=>r.result.details.canonicalPath='changed.png',
 missing:r=>delete r.result.details.imagegen_result,
 copyFailed:r=>{r.result.details.copyStatus='failed';r.result.details.requestedDestinationPath='copy.png';},
 nativeError:r=>r.isError=true,
 handlerError:r=>r.result.isError=true,
 unknown:r=>r.result.details.unreviewed=true,
}))test('imagegen '+name+' preserves full native wrapper and original image',async()=>{
 const native=imagegenOutcome();mutate(native);const f=await publishedWeb(native,'imagegen');try{assert.equal(f.wire.result.protected_evidence.projection,undefined);const r=await run('text(JSON.stringify(await tools.imagegen({})));',f.wire,['imagegen']);assert.equal(r.result.status,'ok');assert.deepEqual(JSON.parse(r.output[0]),f.wire);assert.equal(f.published[0].content[0].data,native.result.content[0].data);}finally{f.broker.close();}
});
test('imagegen aliases, unjournaled data and oversized protected views do not gain projection',async()=>{
 const native=imagegenOutcome(),f=await publishedWeb(native,'other-imagegen');try{assert.equal(f.wire.result.protected_evidence.projection,undefined);const r=await run('text(JSON.stringify(await tools.other_imagegen({})));',f.wire,['other-imagegen']);assert.deepEqual(JSON.parse(r.output[0]),f.wire);}finally{f.broker.close();}
 const missing=await run('text(JSON.stringify(await tools.imagegen({})));',native,['imagegen']);assert.deepEqual(JSON.parse(missing.output[0]),JSON.parse(JSON.stringify(native)));
 const large=imagegenOutcome();large.result.content[1].text='x'.repeat(80000);const big=await publishedWeb(large,'imagegen');try{assert.equal(big.wire.result.protected_evidence.projected,true);assert.equal(big.wire.result.protected_evidence.projection,undefined);const r=await run('text(JSON.stringify(await tools.imagegen({})));',big.wire,['imagegen']);assert.deepEqual(JSON.parse(r.output[0]),big.wire);}finally{big.broker.close();}
});
test('imagegen projection uses captured intrinsics, never guest supplied presentation code',async()=>{
 const f=await publishedWeb(imagegenOutcome(),'imagegen');try{const r=await run('const pending=tools.imagegen({});Object.keys=()=>[];Object.hasOwn=()=>false;Number.isSafeInteger=()=>false;JSON.parse=()=>null;const r=await pending;text(r.image_url);text(r.output_hint);',f.wire,['imagegen']);assert.equal(r.result.status,'ok');assert.deepEqual(r.output,[f.wire.result.content[0].ref,'canonical.png']);}finally{f.broker.close();}
});
for(const [name,Runtime]of [['semantic',CellRuntime],['Windows contained',WindowsCellRuntime]])test(name+' imagegen projection forwards the original through generatedImage with a protected hint',{skip:name==='Windows contained'&&process.platform!=='win32'},async()=>{
 const signal=new AbortController().signal,broker=new CellEvidence(signal),published=[],store=new CellStore(),native=imagegenOutcome(),scope={id:'native',signal,async publishEvidence(e){published.push(e);},async invoke(name){await broker.capture(scope,{scopeId:scope.id,toolName:name,toolCallId:'child',...native});return broker.project(native);}},runtime=new Runtime({store,evidence:broker,output(){throw Error('No guest text');},yield(){}}),failures=[];
 try{const r=await runtime.run('generatedImage(await tools.imagegen({}));',{gateway:scope,allowedTools:['imagegen'],signal:AbortSignal.timeout(5000)});assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(published.length,2);assert.equal(published[1].content[0].data,native.result.content[0].data);assert.equal(published[1].details.output_hint,'canonical.png');assert.match(published[1].content[1].text,/unverified; not a save receipt/);}catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}store.close();broker.close();}if(failures.length)throw new AggregateError(failures,'Imagegen projection or cleanup failed');
});
