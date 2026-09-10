// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Real installed registry/dispatcher/QuickJS/rendering; synthetic model transport only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {responseEvents} from './accept-code-transport.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
import {pollingPresentation} from './polling-presentation.mjs';
import {inspectCodeResult} from './code-result-presentation.mjs';
export function helperFixtureExtension(cwd) {
 return pi=>pi.registerTool({name:'helper-probe-read',label:'Helper fixture read',description:'Acceptance-only read of the owned input fixture.',parameters:{[Symbol.for('TypeBox.Kind')]:'Object',type:'object',properties:{},additionalProperties:false},async execute(){return{content:[{type:'text',text:await readFile(join(cwd,'input.txt'),'utf8')}]};}});
}
export const helperScenarios=Object.freeze([
 {name:'text',code:'text(ALL_TOOLS.filter(t=>t.name==="read"));',error:'TEXT_VALUE_UNSUPPORTED',hint:'text() requires a primitive.'},
 {name:'image',code:'image("https://invalid.example/PRIVATE_HELPER_VALUE");',error:'IMAGE_REFERENCE_REQUIRED',hint:'image() requires a native image reference'},
 {name:'timer',code:'setTimeout("PRIVATE_HELPER_VALUE",0);',error:'TIMER_CALLBACK_REQUIRED',hint:'setTimeout() requires a function callback'},
 {name:'callback',code:'await new Promise(resolve=>setTimeout(()=>{text({PRIVATE_HELPER_VALUE:true})},0));',error:'TEXT_VALUE_UNSUPPORTED',hint:'text() requires a primitive.'},
 {name:'opaque',code:'let saved;try{text([])}catch(error){saved=error}Object.defineProperty(saved,"message",{get(){while(true){}}});Object.defineProperty(saved,"stack",{get(){while(true){}}});throw saved;',error:'TEXT_VALUE_UNSUPPORTED',hint:'text() requires a primitive.'},
 {name:'alias',code:'if(!TOOL_NAMES.includes("helper-probe-read")||TOOL_NAMES.includes("helper_probe_read")||!ALL_TOOLS.some(t=>t.name==="helper-probe-read"))throw Error("metadata changed");const r=await tools.helper_probe_read(JSON.stringify({}));if(r.isError||!r.result.content)throw Error("wrapper changed");text(r.result.content[0].text);'},
]);
export function validateHelperFeedback(rows){
 assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);
 for(const r of rows){assert.equal(r.requests,12);assert.equal(r.failures,5);assert.equal(r.aliasDelegations,1);for(const key of ['fixedHints','collapsedAndExpanded','canonicalMetadata','nativeWrapper','customReplay','historyUnchanged'])assert.equal(r[key],true);assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);}
 return{fixedHelperFailures:true,timerCallbackFailuresVisible:true,collapsedAndExpandedHints:true,opaqueErrorsNotInspected:true,canonicalAliasDispatch:true,nativeMetadataUnchanged:true,nativeWrapperPreserved:true,customInputReplay:true,historyUnchanged:true,syntheticModelRequests:24,scenarios:12,nativeAliasReads:2,liveServiceCalls:0};
}
export async function acceptHelperFeedback(session,runtime,nativeStream,native){
 const modelBefore=session.model,streamBefore=session.agent.streamFunction,authBefore=runtime.getAuth,authDescriptor=Object.getOwnPropertyDescriptor(runtime,'checkAuth'),activeBefore=[...session.getActiveToolNames()].sort(),rows=[],failures=[];let events=[];
 assert.ok(activeBefore.includes('helper-probe-read'));const ui=pollingPresentation(session,native),off=session.agent.subscribe(e=>{if(e.type==='tool_execution_start'&&e.scopeId)events.push(e.toolName);});
 try{
  runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);runtime.getAuth=async selected=>{assert.equal(typeof selected==='string'?selected:selected.provider,provider);return{auth:{apiKey:provider==='openai'?'synthetic-helper-key':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-helper'}})).toString('base64url')}.synthetic`}};};await session.setModel(model);assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore);let total=0;
   for(const scenario of helperScenarios){
    events=[];let requests=0;const payloads=[],first=session.messages.length,id=`call_helper_${provider}_${scenario.name}`,source='// @exec: {"yield_time_ms":10000,"max_output_tokens":200}\n'+scenario.code;
    session.agent.streamFunction=(selected,context,options)=>{assert.equal(selected.api,model.api);assert.equal(selected.provider,provider);return nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'No helper acceptance model retry');total++;return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_helper_${provider}_${scenario.name}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_helper_${provider}_${scenario.name}`,role:'assistant',content:[{type:'output_text',text:'Synthetic helper turn complete',annotations:[]}],status:'completed'});}});};
    await session.prompt('Synthetic native helper feedback acceptance');assert.equal(requests,2);assert.equal(payloads.length,2);const result=findNativeMetadataResult(session.messages.slice(first),source),saved=JSON.stringify(result),value=readCodeOutcome(result);assert.equal(value.status,'completed');assert.doesNotMatch(JSON.stringify(value),/PRIVATE_HELPER_VALUE/);
    if(scenario.error){assert.equal(value.result.status,'error');assert.equal(value.result.code,scenario.error);assert.equal(value.result.diagnostics.guest_phase,'await');assert.equal(value.result.diagnostics.delegated_calls,0);assert.equal(value.result.diagnostics.effects,'not_determined');assert.deepEqual(value.output,[]);assert.deepEqual(events,[]);assert.ok(result.content[0].text.includes(scenario.hint));}
    else{assert.equal(value.result.status,'ok');assert.deepEqual(value.output,['artifact native read']);assert.deepEqual(events,['helper-probe-read']);}
    await ui.settle();inspectCodeResult(ui,result,scenario.error?'failed':'completed',scenario.hint??'artifact native read');assert.equal(JSON.stringify(result),saved);
    const declaration=payloads[0].tools.find(t=>t.name==='exec');assert.equal(declaration.type,'custom');const replay=payloads[1].input.find(t=>t.type==='custom_tool_call'&&t.call_id===id),output=payloads[1].input.find(t=>t.type==='custom_tool_call_output'&&t.call_id===id);assert.equal(replay.input,source);assert.equal(output.output,result.content[0].text);const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);
   }
   rows.push({api:model.api,requests:total,failures:5,aliasDelegations:1,fixedHints:true,collapsedAndExpanded:true,canonicalMetadata:true,nativeWrapper:true,customReplay:true,historyUnchanged:true,activeScopes:0,drainingScopes:0});
  }
 }catch(e){failures.push(e);}finally{const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};await cleanup(()=>off());await cleanup(()=>ui.close());await cleanup(()=>{session.agent.streamFunction=streamBefore;runtime.getAuth=authBefore;});await cleanup(()=>session.setModel(modelBefore));await cleanup(()=>{if(authDescriptor)Object.defineProperty(runtime,'checkAuth',authDescriptor);else delete runtime.checkAuth;});await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore));}
 if(failures.length)throw new AggregateError(failures,'Native helper feedback acceptance and/or owned cleanup failed; preserve every failure.');return validateHelperFeedback(rows);
}
