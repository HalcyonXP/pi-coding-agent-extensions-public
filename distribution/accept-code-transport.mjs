// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine installed provider/parser/agent/extension/gateway/QuickJS boundaries.
// Only synthetic per-request transports, a newly owned session and native read.
import assert from "node:assert/strict";
import {readCodeOutcome} from "./code-output-contract.mjs";

const cases=["raw", "bad-pragma", "legacy-options", "hook-arguments", "hook-block", "hook-result"];
export function validateNativeCodeTransport(rows) {
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(row=>row.api),["openai-responses","openai-codex-responses"]);
 for(const row of rows){
  assert.equal(row.nativeCatalogGrammar,true);assert.equal(row.requests,12);assert.equal(row.customDeclaration,true);
  assert.equal(row.internalOutputSchemaSerialized,false);assert.equal(row.ordinaryToolsRetained,true);
  assert.equal(row.rawSourcePreserved,true);assert.equal(row.customReplay,true);assert.equal(row.wrapperPreserved,true);
  assert.equal(row.nativeDelegations,2);assert.equal(row.rejectedDelegations,0);assert.equal(row.hookFeedbackVisible,true);
  assert.deepEqual(row.cases,cases);assert.equal(row.activeScopes,0);assert.equal(row.drainingScopes,0);assert.equal(row.liveServiceCalls,0);
 }
 return {nativeResponses:true,nativeCodexResponses:true,rawJavaScriptInput:true,customHistoryReplay:true,legacyOptionsRefused:true,pragmaAndHookRefusals:true,finalizedHookFeedbackVisible:true,ordinaryToolsRetained:true,nestedWrapperPreserved:true,syntheticModelRequests:24,scenarios:12,liveServiceCalls:0};
}
export function responseEvents(item) {
 const events=[{type:"response.output_item.added",output_index:0,item:{...item,status:"in_progress",...(item.type==="message"?{content:[]}:item.type==="custom_tool_call"?{input:""}:{arguments:""})}}];
 if(item.type==="message"){
  const part=item.content[0];events.push({type:"response.content_part.added",output_index:0,content_index:0,part:{...part,text:""}}, {type:"response.output_text.delta",output_index:0,content_index:0,delta:part.text},{type:"response.output_text.done",output_index:0,content_index:0,text:part.text});
 }else{
  const custom=item.type==="custom_tool_call",key=custom?"input":"arguments",kind=custom?"custom_tool_call_input":"function_call_arguments",value=item[key];
  for(const delta of [value.slice(0,7),value.slice(7)])events.push({type:`response.${kind}.delta`,output_index:0,delta});
  events.push({type:`response.${kind}.done`,output_index:0,[key]:value});
 }
 events.push({type:"response.output_item.done",output_index:0,item},{type:"response.completed",response:{id:"resp_synthetic_native_code",status:"completed",output:[item]}});
 const bytes=new TextEncoder().encode(events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join(""));let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset===bytes.length){controller.close();return;}const next=Math.min(offset+29,bytes.length);controller.enqueue(bytes.slice(offset,next));offset=next;}}),{headers:{"content-type":"text/event-stream"}});
}
export async function acceptNativeCodeTransport(session,runtime,resources,nativeStream) {
 assert.equal(typeof nativeStream,"function","Pass the original installed SDK dispatcher, not a replacement provider");
 const originalModel=session.model,originalStream=session.agent.streamFunction,originalAuth=runtime.getAuth;
 const checkAuthDescriptor=Object.getOwnPropertyDescriptor(runtime,"checkAuth"),failures=[];
 const owned=resources.getExtensions().extensions;assert.equal(owned.length,1);
 const handlers=owned[0].handlers,callHandlers=handlers.get("tool_call"),resultHandlers=handlers.get("tool_result");
 assert.ok(Array.isArray(callHandlers)&&Array.isArray(resultHandlers));
 const originalCalls=[...callHandlers],originalResults=[...resultHandlers];
 const activeBefore=[...session.getActiveToolNames()].sort(),rows=[];
 let scenario,observed=[],payloads=[],request=0,rawSource,model;
 const off=session.agent.subscribe(event=>{if(event.type==="tool_execution_start"&&event.scopeId)observed.push(event);});
 const beforeCall=event=>{
  if(event.toolName!=="exec")return;
  if(scenario==="hook-arguments")event.input.code='// @exec: {"unknown":true}\r\n'+event.input.code;
  if(scenario==="hook-block")return {block:true,reason:"SYNTHETIC_NATIVE_CODE_BLOCK"};
 };
 const afterResult=event=>{if(event.toolName==="exec"&&scenario==="hook-result")return {content:[{type:"text",text:"SYNTHETIC_NATIVE_CODE_HOOK_FEEDBACK"}],details:{syntheticNativeHook:true},isError:true};};
 callHandlers.push(beforeCall);resultHandlers.push(afterResult);
 try{
  // Native model selection has a separate auth check. Only this newly owned
  // validator runtime receives a synthetic seam; no installed auth is read.
  runtime.checkAuth=async provider=>["openai","openai-codex"].includes(provider);
  for(const provider of ["openai","openai-codex"]){
   model=runtime.getModel(provider,"gpt-6-astra");assert.ok(model);assert.equal(model.compat?.supportsOpenAIGrammarTools,true);
   runtime.getAuth=async selected=>{const id=typeof selected==="string"?selected:selected.provider;assert.equal(id,provider);return {auth:{apiKey:provider==="openai"?"synthetic-native-key":`synthetic.${Buffer.from(JSON.stringify({"https://api.openai.com/auth":{chatgpt_account_id:"synthetic-native-code"}})).toString("base64url")}.synthetic`}};};
   await session.setModel(model);
   assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore);
   let requests=0,delegations=0;
   session.agent.streamFunction=(selected,context,options)=>{
    assert.equal(selected.provider,provider);assert.equal(selected.api,model.api);
    return nativeStream(selected,context,{...options,transport:"sse",maxRetries:0,cacheRetention:"none",async onPayload(body,selected){const next=await options?.onPayload?.(body,selected);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{
     requests++;assert.ok(++request<=2,"Unexpected model request; do not retry");assert.equal(init?.method,"POST");assert.equal(String(url),provider==="openai"?"https://api.openai.com/v1/responses":"https://chatgpt.com/backend-api/codex/responses");
     const item=request===1?(scenario==="legacy-options"?{type:"function_call",id:`fc_${provider}_${scenario}`,call_id:`call_${provider}_${scenario}`,name:"exec",arguments:JSON.stringify({code:rawSource,yield_time_ms:0}),status:"completed"}:{type:"custom_tool_call",id:`ctc_${provider}_${scenario}`,call_id:`call_${provider}_${scenario}`,name:"exec",input:rawSource,status:"completed"}):{type:"message",id:`msg_${provider}_${scenario}`,role:"assistant",content:[{type:"output_text",text:"Synthetic native Code turn complete",annotations:[]}],status:"completed"};
     return responseEvents(item);
    }});
   };
   for(scenario of cases){
    observed=[];payloads=[];request=0;
    // Exercise the string-object adapter on both actual Responses routes without
    // adding service requests; other installed cases retain native object calls.
    const readArgs=scenario==="raw"?'JSON.stringify({path:"input.txt"})':'{path:"input.txt"}';
    rawSource=(scenario==="bad-pragma"?'// @exec: {"unsupported":true}\r\n':'// @exec: {"yield_time_ms":10000,"max_output_tokens":10000}\r\n')+`const r=await tools.read(${readArgs});if(r.isError||!r.result.content)throw Error("native wrapper changed");text("NATIVE_RAW 雪 🌊");text(r.result.content[0].text);`;
    const first=session.messages.length;
    await session.prompt("Synthetic native Code transport acceptance");
    const errors=session.messages.slice(first).filter(message=>message.role==="assistant"&&message.stopReason==="error").map(message=>({stopReason:message.stopReason,errorMessage:message.errorMessage}));
    assert.equal(request,2,JSON.stringify({provider,scenario,request,errors}));assert.equal(payloads.length,2);
    const declaration=payloads[0].tools.find(tool=>tool.name==="exec");assert.equal(declaration.type,"custom");assert.equal(declaration.format.syntax,"lark");assert.equal(Object.hasOwn(declaration,"parameters"),false);assert.equal(Object.hasOwn(declaration,"output_schema"),false);
    assert.equal(payloads[0].tools.find(tool=>tool.name==="wait").type,"function");assert.equal(payloads[0].tools.find(tool=>tool.name==="read").type,"function");
    const messages=session.messages.slice(first),assistant=messages.find(message=>message.role==="assistant"&&message.content.some(part=>part.type==="toolCall")),call=assistant?.content.find(part=>part.type==="toolCall");assert.ok(call);assert.equal(call.arguments.code,rawSource);
    const result=messages.find(message=>message.role==="toolResult"&&message.toolCallId===call.id);assert.ok(result);
    const replay=payloads[1].input.find(item=>item.type==="custom_tool_call"&&item.call_id===`call_${provider}_${scenario}`),output=payloads[1].input.find(item=>item.type==="custom_tool_call_output"&&item.call_id===`call_${provider}_${scenario}`);assert.ok(replay);assert.ok(output);assert.equal(replay.input,rawSource);
    if(scenario==="raw"||scenario==="hook-result"){
     assert.equal(observed.length,1);assert.equal(observed[0].toolName,"read");delegations++;
     if(scenario==="raw"){
      assert.equal(result.isError,false);const value=readCodeOutcome(result);assert.equal(value.status,"completed");assert.equal(value.result.status,"ok");assert.deepEqual(value.output,["NATIVE_RAW 雪 🌊","artifact native read"]);assert.equal(output.output,result.content[0].text);
     }else{assert.equal(result.isError,true);assert.equal(output.output,"SYNTHETIC_NATIVE_CODE_HOOK_FEEDBACK");}
    }else{
     assert.equal(result.isError,true);assert.equal(observed.length,0,"Refused input/hook must not delegate");
     if(scenario==="legacy-options")assert.equal(call.arguments.yield_time_ms,0,"Rejected original input remains in native history, not migrated");
    }
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);
   }
   rows.push({api:model.api,nativeCatalogGrammar:true,requests,customDeclaration:true,internalOutputSchemaSerialized:false,ordinaryToolsRetained:true,rawSourcePreserved:true,customReplay:true,wrapperPreserved:true,nativeDelegations:delegations,rejectedDelegations:0,hookFeedbackVisible:true,cases:[...cases],activeScopes:0,drainingScopes:0,liveServiceCalls:0});
  }
 }catch(error){failures.push(error);}finally{
  const cleanup=async operation=>{try{await operation();}catch(error){failures.push(error);}};
  await cleanup(()=>off());
  await cleanup(()=>{const index=callHandlers.indexOf(beforeCall);assert.ok(index>=0);callHandlers.splice(index,1);assert.deepEqual(callHandlers,originalCalls);});
  await cleanup(()=>{const index=resultHandlers.indexOf(afterResult);assert.ok(index>=0);resultHandlers.splice(index,1);assert.deepEqual(resultHandlers,originalResults);});
  session.agent.streamFunction=originalStream;runtime.getAuth=originalAuth;
  await cleanup(()=>session.setModel(originalModel));
  if(checkAuthDescriptor)Object.defineProperty(runtime,"checkAuth",checkAuthDescriptor);else delete runtime.checkAuth;
 }
 if(failures.length)throw new AggregateError(failures,"Native Code acceptance and/or owned cleanup failed; preserve every failure.");
 assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore);
 return validateNativeCodeTransport(rows);
}
