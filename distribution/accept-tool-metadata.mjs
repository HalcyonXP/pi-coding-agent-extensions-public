// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Independent installed acceptance: original native dispatcher + real QuickJS,
// synthetic per-request auth/SSE and one native read per provider; no hosted service.
import assert from 'node:assert/strict';
import {responseEvents} from './accept-code-transport.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
export function metadataSource(expected,delegate){
 assert.ok(Array.isArray(expected)&&expected.length<=32);
 const source='// @exec: {"yield_time_ms":10000,"max_output_tokens":200}\r\n'+
 `const expected=${JSON.stringify(expected)};if(JSON.stringify(ALL_TOOLS)!==JSON.stringify(expected)||JSON.stringify(TOOL_NAMES)!==JSON.stringify(expected.map(t=>t.name)))throw Error("metadata mismatch");if(!Object.isFrozen(ALL_TOOLS)||!ALL_TOOLS.every(Object.isFrozen))throw Error("metadata mutable");try{ALL_TOOLS[0].description="forged";}catch{}try{ALL_TOOLS.push({name:"extra",description:"forged"});}catch{}try{globalThis.ALL_TOOLS=[];}catch{}if(JSON.stringify(ALL_TOOLS)!==JSON.stringify(expected)||typeof tools.extra!=="undefined")throw Error("metadata mutation");text("NATIVE_METADATA_SNAPSHOT");`+
 (delegate?'const selected=ALL_TOOLS.find(t=>t.name==="read");if(!selected)throw Error("read missing");const r=await tools[selected.name]({path:"input.txt"});if(typeof r.isError!=="boolean"||r.isError||!r.result.content)throw Error("native wrapper changed");text(r.result.content[0].text);':'');
 assert.ok(Buffer.byteLength(source)<=64*1024,'Synthetic metadata source must fit the existing source budget');return source;
}
export function findNativeMetadataResult(messages,source){
 const calls=messages.filter(m=>m.role==='assistant').flatMap(m=>m.content.filter(c=>c.type==='toolCall'));
 assert.equal(calls.length,1);const call=calls[0];assert.equal(call.name,'exec');assert.equal(typeof call.id,'string');assert.ok(call.id.length>0);assert.deepEqual(call.arguments,{code:source});
 // Pi's internal ID may include the native item ID; it is not the raw provider call_id.
 const results=messages.filter(m=>m.role==='toolResult'&&m.toolCallId===call.id);assert.equal(results.length,1);assert.equal(results[0].toolName,'exec');return results[0];
}
export function validateNativeToolMetadata(rows){
 assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);
 for(const r of rows){assert.equal(r.requests,4);for(const k of ['nativeRegistryMetadata','immutableQuickJSSnapshot','nativeWrapperPreserved','customInputReplay','historyUnchanged'])assert.equal(r[k],true);assert.equal(r.inspectionDelegations,0);assert.equal(r.lookupDelegations,1);assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);assert.equal(r.liveServiceCalls,0);}
 return{nativeRegistryMetadata:true,immutableQuickJSSnapshot:true,metadataIsNotAuthority:true,inspectionDelegations:0,nativeLookupDelegations:2,nativeWrapperPreserved:true,customInputReplay:true,historyUnchanged:true,syntheticModelRequests:8,scenarios:4,liveServiceCalls:0};
}
export async function acceptNativeToolMetadata(session,runtime,nativeStream){
 assert.equal(typeof nativeStream,'function');const originalModel=session.model,originalStream=session.agent.streamFunction,originalAuth=runtime.getAuth,descriptor=Object.getOwnPropertyDescriptor(runtime,'checkAuth'),failures=[],rows=[],activeBefore=[...session.getActiveToolNames()].sort();let observed=[];
 const off=session.agent.subscribe(event=>{if(event.type==='tool_execution_start'&&event.scopeId)observed.push(event);});
 try{
  runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);runtime.getAuth=async selected=>{assert.equal(typeof selected==='string'?selected:selected.provider,provider);return{auth:{apiKey:provider==='openai'?'synthetic-tool-metadata-key':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-tool-metadata'}})).toString('base64url')}.synthetic`}};};
   await session.setModel(model);assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore);
   // Reconstruct from original native definitions, not the product's adapter.
   const names=[...new Set(session.getActiveToolNames().filter(n=>/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(n)&&!['exec','wait'].includes(n)))],definitions=session.getAllTools();assert.ok(names.length>0&&names.length<=32);
   const expected=names.map(name=>{const matching=definitions.filter(t=>t.name===name);assert.equal(matching.length,1);assert.equal(typeof matching[0].description,'string');return{name,description:matching[0].description};});
   let total=0;
   for(const delegate of [false,true]){
    observed=[];let requests=0;const payloads=[],first=session.messages.length,id=`call_metadata_${provider}_${delegate}`,source=metadataSource(expected,delegate);
    session.agent.streamFunction=(selected,context,options)=>{assert.equal(selected.api,model.api);assert.equal(selected.provider,provider);return nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'Unexpected metadata model request; do not retry');total++;const item=requests===1?{type:'custom_tool_call',id:`ctc_metadata_${provider}_${delegate}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_metadata_${provider}_${delegate}`,role:'assistant',content:[{type:'output_text',text:'Synthetic native metadata turn complete',annotations:[]}],status:'completed'};return responseEvents(item);}});};
    await session.prompt('Synthetic native Code tool metadata acceptance');assert.equal(requests,2);assert.equal(payloads.length,2);
    const result=findNativeMetadataResult(session.messages.slice(first),source);const saved=JSON.stringify(result),value=readCodeOutcome(result);assert.equal(value.status,'completed');assert.equal(value.result.status,'ok');assert.deepEqual(value.output,delegate?['NATIVE_METADATA_SNAPSHOT','artifact native read']:['NATIVE_METADATA_SNAPSHOT']);
    assert.deepEqual(observed.map(e=>e.toolName),delegate?['read']:[]);const declaration=payloads[0].tools.find(t=>t.name==='exec');assert.equal(declaration.type,'custom');assert.equal(Object.hasOwn(declaration,'output_schema'),false);
    const replay=payloads[1].input.find(t=>t.type==='custom_tool_call'&&t.call_id===id),output=payloads[1].input.find(t=>t.type==='custom_tool_call_output'&&t.call_id===id);assert.equal(replay.input,source);assert.equal(output.output,result.content[0].text);assert.equal(JSON.stringify(result),saved);
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);
   }
   rows.push({api:model.api,requests:total,nativeRegistryMetadata:true,immutableQuickJSSnapshot:true,nativeWrapperPreserved:true,customInputReplay:true,historyUnchanged:true,inspectionDelegations:0,lookupDelegations:1,activeScopes:0,drainingScopes:0,liveServiceCalls:0});
  }
 }catch(e){failures.push(e);}finally{
  const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};await cleanup(()=>off());await cleanup(()=>{session.agent.streamFunction=originalStream;});await cleanup(()=>{runtime.getAuth=originalAuth;});await cleanup(()=>session.setModel(originalModel));await cleanup(()=>{if(descriptor)Object.defineProperty(runtime,'checkAuth',descriptor);else delete runtime.checkAuth;});await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore));
 }
 if(failures.length)throw new AggregateError(failures,'Native tool metadata acceptance and/or owned cleanup failed; preserve every failure.');return validateNativeToolMetadata(rows);
}
