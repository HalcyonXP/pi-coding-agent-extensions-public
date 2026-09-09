// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Additional installed native exec -> wait round trips. Original SDK dispatcher;
// synthetic per-request SSE/auth only, real owned restricted cells, no shell/service.
import assert from 'node:assert/strict';import{responseEvents}from'./accept-code-transport.mjs';import{readCodeOutcome}from'./code-output-contract.mjs';
export function validateNativeCodeWaitOutput(rows){assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);for(const r of rows){assert.equal(r.requests,4);assert.equal(r.nativeCustomOutput,true);assert.equal(r.nativeFunctionOutput,true);assert.equal(r.sameOwnedCell,true);assert.equal(r.measuredCallTimeBoundedByObservation,true);assert.equal(r.unchangedHistory,true);assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);assert.equal(r.liveServiceCalls,0);}return{nativeResponsesWait:true,nativeCodexResponsesWait:true,nativeCustomAndFunctionReplay:true,sameOwnedCell:true,measuredPerCallTimeObserved:true,syntheticModelRequests:8,liveServiceCalls:0};}
export async function acceptNativeCodeWaitOutput(session,runtime,nativeStream){
 assert.equal(typeof nativeStream,'function');const originalModel=session.model,originalStream=session.agent.streamFunction,originalAuth=runtime.getAuth,descriptor=Object.getOwnPropertyDescriptor(runtime,'checkAuth'),failures=[],rows=[];
 const source='// @exec: {"yield_time_ms":10000,"max_output_tokens":100}\r\ntext("NATIVE_WAIT_BEFORE");yield_control();await new Promise(r=>setTimeout(r,10000));text("NATIVE_WAIT_AFTER");';
 try{
  runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);runtime.getAuth=async selected=>{assert.equal(typeof selected==='string'?selected:selected.provider,provider);return{auth:{apiKey:provider==='openai'?'synthetic-native-output-key':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-native-output'}})).toString('base64url')}.synthetic`}};};
   await session.setModel(model);let total=0,cell;
   for(const name of ['exec','wait']){
    let requests=0;const payloads=[],first=session.messages.length,id=`call_output_${provider}_${name}`,args=name==='exec'?{code:source}:{cell_id:cell,yield_time_ms:30000,max_tokens:100};
    session.agent.streamFunction=(selected,context,options)=>{assert.equal(selected.api,model.api);assert.equal(selected.provider,provider);return nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'Unexpected native output model request; do not retry');total++;const item=requests===1?(name==='exec'?{type:'custom_tool_call',id:`ctc_output_${provider}`,call_id:id,name,input:source,status:'completed'}:{type:'function_call',id:`fc_output_${provider}`,call_id:id,name,arguments:JSON.stringify(args),status:'completed'}):{type:'message',id:`msg_output_${provider}_${name}`,role:'assistant',content:[{type:'output_text',text:'Synthetic native output turn complete',annotations:[]}],status:'completed'};return responseEvents(item);}});};
    const before=performance.now();await session.prompt('Synthetic native Code output acceptance');const observed=performance.now()-before;assert.equal(requests,2);assert.equal(payloads.length,2);
    const result=session.messages.slice(first).find(m=>m.role==='toolResult'&&m.toolName===name);assert.ok(result);const saved=JSON.stringify(result),value=readCodeOutcome(result);assert.ok(value.code_result.wall_time_ms<=Math.ceil(observed)+1,'Per-call measurement must fit the independently observed request interval');
    const declaration=payloads[0].tools.find(t=>t.name===name);assert.equal(declaration.type,name==='exec'?'custom':'function');
    const output=payloads[1].input.find(t=>t.type===(name==='exec'?'custom_tool_call_output':'function_call_output')&&t.call_id===id);assert.ok(output);assert.equal(output.output,result.content[0].text);assert.ok(!output.output.includes('"code_result"'));
    if(name==='exec'){assert.equal(value.status,'running');assert.deepEqual(value.output,['NATIVE_WAIT_BEFORE']);cell=value.cell_id;const call=payloads[1].input.find(t=>t.type==='custom_tool_call'&&t.call_id===id);assert.equal(call.input,source);}else{assert.equal(value.cell_id,cell);assert.equal(value.status,'completed');assert.equal(value.result.status,'ok');assert.deepEqual(value.output,['NATIVE_WAIT_AFTER']);const call=payloads[1].input.find(t=>t.type==='function_call'&&t.call_id===id);assert.deepEqual(JSON.parse(call.arguments),args);}
    assert.equal(JSON.stringify(result),saved,'Provider replay must not mutate native history');
   }
   const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);rows.push({api:model.api,requests:total,nativeCustomOutput:true,nativeFunctionOutput:true,sameOwnedCell:true,measuredCallTimeBoundedByObservation:true,unchangedHistory:true,activeScopes:0,drainingScopes:0,liveServiceCalls:0});
  }
 }catch(error){failures.push(error);}finally{
  const cleanup=async f=>{try{await f();}catch(error){failures.push(error);}};session.agent.streamFunction=originalStream;runtime.getAuth=originalAuth;await cleanup(()=>session.setModel(originalModel));await cleanup(()=>{if(descriptor)Object.defineProperty(runtime,'checkAuth',descriptor);else delete runtime.checkAuth;});
 }
 if(failures.length)throw new AggregateError(failures,'Native Code output acceptance and/or owned cleanup failed; preserve every failure.');return validateNativeCodeWaitOutput(rows);
}
