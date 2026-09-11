// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Original installed dispatcher and real owned Windows shell/stdin/output, synthetic SSE/auth only.
import assert from 'node:assert/strict';
import {responseEvents} from './accept-code-transport.mjs';
import {readUnifiedOutcome,validateNativeUnifiedOutput} from './unified-output-contract.mjs';
import {pollingPresentation} from './polling-presentation.mjs';
export const UNIFIED_BEFORE='UNIFIED_BEFORE "quotes" \\ 雪 🌊\r\n{"literal":"keep this text"}\r\n';
export const UNIFIED_AFTER='UNIFIED_AFTER "quotes" \\ 雪 🌊\r\n{"literal":"keep this too"}\r\n';
const quote=s=>`'${s.replaceAll("'","''")}'`;
export function unifiedOutputCommands(nodePath){
 // Encode only synthetic output data. Literal double quotes in node -e are not preserved by every Windows shell argument path.
 const before=Buffer.from(UNIFIED_BEFORE).toString('base64'),after=Buffer.from(UNIFIED_AFTER).toString('base64');
 const script=`process.stdout.write(Buffer.from('${before}','base64'));process.stdin.resume();const expiry=setTimeout(()=>process.exit(19),30000);process.stdin.once('data',b=>{if(b.toString()!=='finish\\n'){process.exit(23);return;}clearTimeout(expiry);process.stdout.write(Buffer.from('${after}','base64'),()=>{process.exitCode=7;process.stdin.destroy();});});`;
 // Console.Write bypasses PowerShell's native-command line conversion: exactly 2 MiB, no appended newline.
 return [`& ${quote(nodePath)} -e ${quote(script)}; exit $LASTEXITCODE`, "[Console]::Out.Write('x' * (2 * 1024 * 1024)); exit 0"];
}
export async function acceptNativeUnifiedOutput(session,runtime,nativeStream,native){
 assert.equal(process.platform,'win32');assert.equal(typeof nativeStream,'function');
 const originalModel=session.model,originalStream=session.agent.streamFunction,originalAuth=runtime.getAuth,descriptor=Object.getOwnPropertyDescriptor(runtime,'checkAuth'),failures=[],rows=[];
 const [command,lossCommand]=unifiedOutputCommands(process.execPath),ui=pollingPresentation(session,native);
 try{
  runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);
   runtime.getAuth=async selected=>{assert.equal(typeof selected==='string'?selected:selected.provider,provider);return{auth:{apiKey:provider==='openai'?'synthetic-native-unified-key':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-native-unified'}})).toString('base64url')}.synthetic`}};};
   await session.setModel(model);let total=0,cell,head='';
   for(const stage of ['start','finish','drain','loss']){
    const name=['start','loss'].includes(stage)?'exec_command':'write_stdin',args=stage==='start'?{cmd:command,yield_time_ms:10000,max_output_tokens:100}:stage==='finish'?{session_id:cell,chars:'finish\n',yield_time_ms:10000,max_output_tokens:4}:stage==='drain'?{session_id:cell,yield_time_ms:10000,max_output_tokens:100}:{cmd:lossCommand,yield_time_ms:10000,max_output_tokens:4};
    const id=`call_unified_${provider}_${stage}`,first=session.messages.length,payloads=[];let requests=0;
    session.agent.streamFunction=(selected,context,options)=>{assert.equal(selected.api,model.api);assert.equal(selected.provider,provider);return nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'Unexpected native Unified output model request; do not retry');total++;const item=requests===1?{type:'function_call',id:`fc_unified_${provider}_${stage}`,call_id:id,name,arguments:JSON.stringify(args),status:'completed'}:{type:'message',id:`msg_unified_${provider}_${stage}`,role:'assistant',content:[{type:'output_text',text:'Synthetic native Unified output turn complete',annotations:[]}],status:'completed'};return responseEvents(item);}});};
    const before=performance.now();await session.prompt('Synthetic native Unified output acceptance');const observed=performance.now()-before;assert.equal(requests,2);assert.equal(payloads.length,2);
    const message=session.messages.slice(first).find(m=>m.role==='toolResult'&&m.toolName===name);assert.ok(message);const saved=JSON.stringify(message),value=readUnifiedOutcome(message);
    assert.ok(value.unified_result.wall_time_ms<=Math.ceil(observed)+1,'Measured call must fit the independently observed prompt interval');
    assert.equal(payloads[0].tools.find(t=>t.name===name).type,'function');
    const call=payloads[1].input.find(t=>t.type==='function_call'&&t.call_id===id),output=payloads[1].input.find(t=>t.type==='function_call_output'&&t.call_id===id);assert.ok(call&&output);assert.deepEqual(JSON.parse(call.arguments),args);assert.equal(output.output,message.content[0].text);for(const key of ['details','unified_result','wall_time_ms'])assert.equal(Object.hasOwn(output,key),false);
    assert.equal(value.supervisor_ready,true);
    if(stage==='start'){assert.equal(value.running,true);assert.equal(value.exit_code,null);assert.equal(value.output,UNIFIED_BEFORE);assert.equal(value.truncated_bytes,0);assert.equal(typeof value.session_id,"number");cell=value.session_id;}
    else if(stage==='finish'){assert.equal(value.running,false);assert.equal(value.exit_code,7);assert.equal(value.session_id,cell);assert.equal(value.truncated_bytes,0);assert.equal(value.output,UNIFIED_AFTER.slice(0,16));head=value.output;assert.match(message.content[0].text,/More output available with session ID/);assert.doesNotMatch(message.content[0].text,/Process running/);}
    else if(stage==='drain'){assert.equal(value.running,false);assert.equal(value.exit_code,7);assert.equal(value.session_id,undefined);assert.equal(value.truncated_bytes,0);assert.equal(head+value.output,UNIFIED_AFTER);}
    else {assert.equal(value.running,false);assert.equal(value.exit_code,0);assert.equal(value.output,'x'.repeat(16));assert.equal(value.truncated_bytes,1024*1024);assert.equal(typeof value.session_id,"number");assert.match(message.content[0].text,/Output omitted: 1048576 bytes/);await session.prompt(`/openai-tools jobs cancel ${value.session_id}`);}
    await ui.settle();const frame=ui.toolFrame(message.toolCallId,120);assert.ok(frame.includes('Wall time:'));assert.ok(frame.includes(value.running?'Process running with session ID':`Process exited with code ${value.exit_code}`));
    if(stage==='loss')assert.ok(frame.includes('Output omitted: 1048576 bytes'));if(stage==='finish')assert.ok(frame.includes('More output available with session ID'));
    const history=JSON.stringify(session.messages);ui.expand(true);const expanded=ui.toolFrame(message.toolCallId,120);ui.expand(false);for(const line of value.output.split(/\r?\n/).filter(Boolean))assert.ok(expanded.includes(line),'Returned text missing from expanded native view');assert.equal(ui.toolFrame(message.toolCallId,120),frame);assert.equal(JSON.stringify(session.messages),history);assert.equal(ui.groups().length,0,'Direct calls must not enter a nested group');
    assert.equal(JSON.stringify(message),saved,'Formatting/replay/owned result disposal must not rewrite history');
   }
   const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);rows.push({api:model.api,requests:total,nativeFunctionReplay:true,numericSessionIDs:true,sameOwnedSession:true,literalReturnedOutput:true,exitedRetainedOutput:true,nonzeroExitAndLossVisible:true,readinessVisible:true,nativeDirectPresentation:true,measuredCallTimeBoundedByObservation:true,unchangedHistory:true,activeScopes:0,drainingScopes:0,liveServiceCalls:0});
  }
 }catch(error){failures.push(error);}finally{
  const cleanup=async f=>{try{await f();}catch(error){failures.push(error);}};
  await cleanup(()=>ui.close());session.agent.streamFunction=originalStream;runtime.getAuth=originalAuth;await cleanup(()=>session.setModel(originalModel));await cleanup(()=>{if(descriptor)Object.defineProperty(runtime,'checkAuth',descriptor);else delete runtime.checkAuth;});
 }
 if(failures.length)throw new AggregateError(failures,'Native Unified output acceptance and/or owned cleanup failed; preserve every failure.');return validateNativeUnifiedOutput(rows);
}
