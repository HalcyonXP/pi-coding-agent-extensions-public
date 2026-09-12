// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Production exec/wait + original provider dispatch; synthetic models, no service calls.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {responseEvents} from './accept-code-transport.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
export async function exerciseNativeNotifications(session,runtime,nativeStream,cwd,presentation){
 const before=session.model,seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]),restore=([o,k,d])=>d?Object.defineProperty(o,k,d):delete o[k];
 const directory=await mkdtemp(join(cwd,'native notifications ')),rows=[],observations=[],errors=[];
 let current,view;const off=session.agent.subscribe(event=>{
  if(!current)return;
  if(event.type==='tool_execution_end')current.ends.push(structuredClone(event));
  if(event.toolName==='wait'&&['tool_execution_start','tool_execution_end'].includes(event.type))current.journals.push({event:event.type,entries:structuredClone(session.sessionManager.getEntries().filter(e=>e.type==='custom'&&e.customType==='code-mode-protected-evidence'&&e.data.notification?.toolCallId===current.origin))});
 });
 try{
  runtime.checkAuth=async()=>true;runtime.getAuth=async()=>({auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-native-notifications'}})).toString('base64url')}.synthetic`}});
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);
   const id=`call_notify_${provider}`,first=session.messages.length,beforeStats=session.getSessionStats(),wire=[];
   const texts=[`native ${provider} before wait`,`native ${provider} after wait`];
   const source='// @exec: {"yield_time_ms":10000,"max_output_tokens":0}\n'+`await notify(${JSON.stringify(texts[0])});await new Promise(done=>setTimeout(done,15000));await notify(${JSON.stringify(texts[1])});text("SUPPRESSED_NOTIFICATION_GUEST");`;
   assert.equal(typeof presentation,'function');view=presentation(session);
   current={provider,source,wire,ends:[],journals:[],origin:undefined};observations.push(current);let requests=0;
   const completions=()=>session.messages.slice(first).filter(m=>m.role==='toolResult'&&m.notification!==true&&['exec','wait'].includes(m.toolName));
   session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',fetch:async(url,init)=>{
    assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.ok(++requests<=3,'No native model replay');
    wire.push(JSON.parse(typeof init.body==='string'?init.body:Buffer.from(zstdDecompressSync(init.body)).toString('utf8')));
    let item;
    if(requests===1)item={type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'};
    else if(requests===2){const result=completions()[0];assert.ok(result);current.origin=result.toolCallId;const outcome=readCodeOutcome(result);assert.equal(outcome.status,'running');assert.deepEqual(outcome.output,[]);item={type:'function_call',id:`fc_wait_${id}`,call_id:`wait_${id}`,name:'wait',arguments:JSON.stringify({cell_id:outcome.cell_id,yield_time_ms:30000,max_tokens:0}),status:'completed'};}
    else item={type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic notification turn complete',annotations:[]}],status:'completed'};
    return responseEvents(item);
   }});
   await session.prompt('Synthetic production native notifications');assert.equal(requests,3);
   const history=session.messages.slice(first),results=completions(),notes=history.filter(m=>m.role==='toolResult'&&m.notification===true);current.history=structuredClone(history);
   assert.equal(results.length,2);const initial=readCodeOutcome(results[0]),last=readCodeOutcome(results[1]);assert.equal(last.status,'completed');assert.equal(last.result.status,'ok');assert.equal(last.cell_id,initial.cell_id);assert.deepEqual(last.output,[]);
   assert.deepEqual(current.ends.map(e=>e.toolName),['exec','wait']);assert.equal(notes.length,2);
   assert.deepEqual(notes.map(m=>m.content),texts.map(text=>[{type:'text',text}]));for(const note of notes){assert.equal(note.toolCallId,results[0].toolCallId);assert.equal(note.toolName,'exec');assert.equal(note.usage,undefined);assert.equal(note.isError,false);}
   assert.ok(history.indexOf(notes[0])>history.indexOf(results[0]));assert.ok(history.indexOf(notes[1])>history.indexOf(results[1]));
   assert.deepEqual(current.journals.map(r=>r.entries.length),[1,2]);for(const row of current.journals)for(const entry of row.entries)assert.deepEqual(entry.data.notification,{toolName:'exec',toolCallId:results[0].toolCallId});
   const second=wire[1].input.filter(item=>item.type==='custom_tool_call_output'&&item.call_id===id),third=wire[2].input.filter(item=>item.type==='custom_tool_call_output'&&item.call_id===id);
   assert.equal(second.length,2);assert.equal(third.length,3);assert.equal(second[1].output,texts[0]);assert.equal(third[2].output,texts[1]);assert.ok(!JSON.stringify(wire[2].input.filter(item=>['custom_tool_call_output','function_call_output'].includes(item.type))).includes('SUPPRESSED_NOTIFICATION_GUEST'));
   current.presentation=await view.finish(notes,results[0]);view=undefined;
   const stats=session.getSessionStats();assert.equal(stats.toolCalls-beforeStats.toolCalls,2);assert.equal(stats.toolResults-beforeStats.toolResults,4);
   const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);assert.equal(session.autoCompactionEnabled,true);
   rows.push({api:model.api,modelRequests:3,notifications:2,toolCompletions:2,originalExecIdentity:true,adoptedWait:true,zeroGuestBudget:true,nativeCustomOutput:true,nativeNotificationCards:true,replayedNotificationCards:true,activeScopes:0,drainingScopes:0});current=undefined;
  }
 }catch(e){errors.push(e);}finally{
  const clean=async f=>{try{await f();}catch(e){errors.push(e);}};await clean(()=>off());if(view)await clean(()=>view.close());await clean(()=>restore(seams[0]));await clean(()=>restore(seams[1]));await clean(()=>session.setModel(before));await clean(()=>restore(seams[2]));
  await clean(()=>writeFile(join(directory,'observations.json'),JSON.stringify({rows,observations,errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'}));
 }
 if(errors.length)throw new AggregateError(errors,'Native notification scenarios failed; preserve observations, no replay');
 return {nativeNotifications:true,originalExecIdentity:true,adoptedWait:true,zeroGuestBudget:true,nativeCustomOutput:true,nativeNotificationCards:true,replayedNotificationCards:true,syntheticModelRequests:6,scenarios:2,liveServiceCalls:0,rows};
}
