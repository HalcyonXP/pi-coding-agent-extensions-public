// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Original native dispatcher/shell/cells with omitted controls; synthetic model/auth only.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {responseEvents} from './accept-code-transport.mjs';
import {readUnifiedOutcome} from './unified-output-contract.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
export function validateUnifiedDefaults(rows){
 assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);
 for(const r of rows){assert.equal(r.requests,6);assert.equal(r.scenarios,3);assert.equal(r.directBytes,40000);assert.equal(r.remainderBytes,10001);for(const k of ['initialWaitObserved','omittedControlsReplayed','originalIDCollected','nestedEscapedOutputComplete','nestedWrappersBounded','historyUnchanged'])assert.equal(r[k],true);assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);}
 return{omittedInitialWaitObserved:true,omittedOutputBytes:40000,originalIDCollection:true,nestedEscapedOutputComplete:true,nativeWrappersBounded:true,omittedControlsReplayed:true,historyUnchanged:true,syntheticModelRequests:12,scenarios:6,liveServiceCalls:0};
}
export async function acceptUnifiedDefaults(session,runtime,nativeStream,cwd){
 const folder=await mkdtemp(join(cwd,'unified defaults ')),modelBefore=session.model,activeBefore=[...session.getActiveToolNames()].sort(),streamBefore=session.agent.streamFunction,authBefore=runtime.getAuth;
 const descriptors={stream:Object.getOwnPropertyDescriptor(session.agent,'streamFunction'),auth:Object.getOwnPropertyDescriptor(runtime,'getAuth'),check:Object.getOwnPropertyDescriptor(runtime,'checkAuth')},rows=[],failures=[];let events=[];
 const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end'&&e.scopeId&&['exec_command','write_stdin'].includes(e.toolName))events.push(structuredClone(e));});
 const restore=(object,key,descriptor)=>{if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];};
 try{
  runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);
   runtime.getAuth=async selected=>{assert.equal(typeof selected==='string'?selected:selected.provider,provider);return{auth:{apiKey:provider==='openai'?'synthetic-unified-defaults':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-defaults'}})).toString('base64url')}.synthetic`}};};
   await session.setModel(model);assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore);let total=0,originalID,head='';
   for(const stage of ['direct','remainder','nested']){
    events=[];const expected=stage==='nested'?'\"\t\\'.repeat(12000)+'\n':'d'.repeat(50000)+'\n',file=join(folder,`${provider}-${stage}.cjs`);
    await writeFile(file,`setTimeout(()=>process.stdout.write(Buffer.from(${JSON.stringify(Buffer.from(expected).toString('base64'))},'base64')),1500);`,{flag:'wx'});
    const q=s=>`'${s.replaceAll("'","''")}'`,command=process.platform==='win32'?`& ${q(process.execPath)} ${q(file)}; exit $LASTEXITCODE`:`${q(process.execPath)} ${q(file)}`;
    const source='// @exec: {"yield_time_ms":10000,"max_output_tokens":200}\n'+`let r=await tools.exec_command({cmd:${JSON.stringify(command)}}),calls=0,id;while(true){if(++calls>12||r.isError||r.result.isError)throw Error("native result");const v=r.result.details;if(r.result.content[0].text!==JSON.stringify(v)||v.truncated_bytes!==0)throw Error("wrapper or loss");if(!v.session_id){if(v.running||v.exit_code!==0)throw Error("completion");break;}if(id&&v.session_id!==id)throw Error("foreign ID");id=v.session_id;r=await tools.write_stdin({session_id:id});}text("DEFAULT_NESTED_OK");text(calls);`;
    const name=stage==='nested'?'exec':stage==='direct'?'exec_command':'write_stdin',args=stage==='direct'?{cmd:command}:{session_id:originalID},id=`call_defaults_${provider}_${stage}`,first=session.messages.length,payloads=[];let requests=0;
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'Do not retry native default commands');total++;return responseEvents(requests===1?(stage==='nested'?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name,input:source,status:'completed'}:{type:'function_call',id:`fc_${id}`,call_id:id,name,arguments:JSON.stringify(args),status:'completed'}):{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic omitted defaults complete',annotations:[]}],status:'completed'});}});
    await session.prompt('Synthetic omitted Unified defaults acceptance');assert.equal(requests,2);assert.equal(payloads.length,2);
    const result=stage==='nested'?findNativeMetadataResult(session.messages.slice(first),source):session.messages.slice(first).find(m=>m.role==='toolResult'&&m.toolName===name);assert.ok(result);const saved=JSON.stringify(result);
    if(stage==='nested'){
     const value=readCodeOutcome(result);assert.equal(value.status,'completed');assert.equal(value.result.status,'ok',JSON.stringify(value));assert.equal(value.output[0],'DEFAULT_NESTED_OK');assert.equal(events.length,Number(value.output[1]));assert.ok(events.length>=2&&events.length<=12);
     let collected='',owned;for(const [i,e]of events.entries()){assert.equal(e.toolName,i?'write_stdin':'exec_command');assert.equal(e.isError,false);assert.ok(Buffer.byteLength(JSON.stringify({result:e.result,isError:e.isError}))<=65536);const v=e.result.details;assert.equal(e.result.content[0].text,JSON.stringify(v));assert.equal(v.truncated_bytes,0);assert.equal(v.running,false);assert.equal(v.exit_code,0);collected+=v.output;if(v.session_id){owned??=v.session_id;assert.equal(v.session_id,owned);}else assert.equal(i,events.length-1);}assert.ok(owned);assert.equal(collected.replace(/\r\n/g,'\n'),expected);
    }else{
     const value=readUnifiedOutcome(result);assert.equal(value.running,false,'Omitted initial wait must observe the 1500ms child exit');assert.equal(value.exit_code,0);assert.equal(value.truncated_bytes,0);
     if(stage==='direct'){assert.equal(value.output,'d'.repeat(40000));assert.equal(typeof value.session_id,'string');originalID=value.session_id;head=value.output;}
     else{assert.equal(value.session_id,undefined);assert.equal(Buffer.byteLength(value.output.replace(/\r\n/g,'\n')),10001);assert.equal(head+value.output.replace(/\r\n/g,'\n'),expected);}
    }
    const custom=stage==='nested',call=payloads[1].input.find(t=>t.type===(custom?'custom_tool_call':'function_call')&&t.call_id===id),output=payloads[1].input.find(t=>t.type===(custom?'custom_tool_call_output':'function_call_output')&&t.call_id===id);assert.ok(call&&output);if(custom)assert.equal(call.input,source);else assert.deepEqual(JSON.parse(call.arguments),args);assert.equal(output.output,result.content[0].text);assert.equal(JSON.stringify(result),saved);assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,0);
   }
   rows.push({api:model.api,requests:total,scenarios:3,directBytes:40000,remainderBytes:10001,initialWaitObserved:true,omittedControlsReplayed:true,originalIDCollected:true,nestedEscapedOutputComplete:true,nestedWrappersBounded:true,historyUnchanged:true,activeScopes:0,drainingScopes:0});
  }
 }catch(e){failures.push(e);}finally{
  const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};
  await cleanup(()=>off());await cleanup(()=>{session.agent.streamFunction=streamBefore;restore(session.agent,'streamFunction',descriptors.stream);});await cleanup(()=>{runtime.getAuth=authBefore;restore(runtime,'getAuth',descriptors.auth);});await cleanup(()=>session.setModel(modelBefore));await cleanup(()=>restore(runtime,'checkAuth',descriptors.check));await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),activeBefore));
 }
 if(failures.length)throw new AggregateError(failures,'Native omitted defaults acceptance/restoration failed; preserve evidence.');return validateUnifiedDefaults(rows);
}
