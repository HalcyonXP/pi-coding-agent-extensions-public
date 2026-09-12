// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine production cells: idle refusal and reload revocation, no native authority mocks.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {responseEvents} from './accept-code-transport.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
export async function exerciseNotificationLifecycle(session,runtime,nativeStream,cwd){
 const before=session.model,seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]),restore=([o,k,d])=>d?Object.defineProperty(o,k,d):delete o[k];
 const folder=await mkdtemp(join(cwd,'notification lifecycle ')),rows=[],observations=[],errors=[];
 try{
  runtime.checkAuth=async()=>true;runtime.getAuth=async()=>({auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-notification-lifecycle'}})).toString('base64url')}.synthetic`}});
  for(const provider of ['openai','openai-codex'])for(const scenario of ['idle','reload']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);
   const first=session.messages.length,id=`call_lifecycle_${provider}_${scenario}`,source='// @exec: {"yield_time_ms":0,"max_output_tokens":0}\n'+`await new Promise(done=>setTimeout(done,${scenario==='idle'?1000:60000}));await notify("FORBIDDEN_LIFECYCLE_NOTICE");`;
   const observation={provider,scenario,source};observations.push(observation);let requests=0,collect=false,cell;
   session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',fetch:async(url)=>{
    assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.ok(++requests<=(collect?4:2),'Notification must not manufacture an idle turn or replay source');
    let item;if(requests===1)item={type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'};
    else if(requests===3)item={type:'function_call',id:`fc_${id}`,call_id:`wait_${id}`,name:'wait',arguments:JSON.stringify({cell_id:cell,yield_time_ms:30000,max_tokens:0}),status:'completed'};
    else item={type:'message',id:`msg_${id}_${requests}`,role:'assistant',content:[{type:'output_text',text:'Synthetic lifecycle boundary',annotations:[]}],status:'completed'};
    return responseEvents(item);
   }});
   await session.prompt('Synthetic asynchronous notification lifecycle');assert.equal(requests,2);
   const initial=session.messages.slice(first).find(m=>m.role==='toolResult'&&m.toolName==='exec'&&m.notification!==true),started=readCodeOutcome(initial);assert.equal(started.status,'running');cell=started.cell_id;
   if(scenario==='reload'){assert.equal(session.agent.getToolGatewayInfo().activeScopes,1);await session.reload();}
   const deadline=performance.now()+15000;while(session.agent.getToolGatewayInfo().activeScopes||session.agent.getToolGatewayInfo().drainingScopes){assert.ok(performance.now()<deadline,'Lifecycle cleanup unconfirmed');await new Promise(done=>setTimeout(done,10));}
   assert.equal(requests,2);assert.equal(session.messages.slice(first).filter(m=>m.role==='toolResult'&&m.notification===true).length,0);
   collect=true;await session.prompt('Explicitly collect the original cell without re-executing source');assert.equal(requests,4);
   const history=session.messages.slice(first);observation.history=structuredClone(history);observation.requests=requests;
   const calls=history.filter(m=>m.role==='assistant').flatMap(m=>m.content.filter(b=>b.type==='toolCall'));assert.deepEqual(calls.map(c=>c.name),['exec','wait']);assert.equal(history.filter(m=>m.role==='toolResult'&&m.notification===true).length,0);
   const result=history.find(m=>m.role==='toolResult'&&m.toolName==='wait');assert.ok(result);
   if(scenario==='idle'){const outcome=readCodeOutcome(result);assert.equal(outcome.status,'completed');assert.equal(outcome.result.status,'error');assert.equal(outcome.result.code,'NOTIFY_INACTIVE');assert.equal(outcome.cell_id,cell);}
   else{assert.equal(result.isError,true);assert.match(result.content.map(b=>b.type==='text'?b.text:'').join('\n'),/Code mode cell is unavailable in this native context/);}
   const notes=session.sessionManager.getEntries().filter(e=>e.type==='custom'&&e.customType==='code-mode-protected-evidence'&&e.data.notification?.toolCallId===initial.toolCallId);assert.equal(notes.length,0);
   const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);assert.equal(session.autoCompactionEnabled,true);
   rows.push({api:model.api,scenario,modelRequests:4,notifications:0,noIdleTurn:true,noSourceReplay:true,confirmedCleanup:true,staleLookupRefused:scenario==='reload',activeScopes:0,drainingScopes:0});
  }
 }catch(e){errors.push(e);}finally{
  const clean=async f=>{try{await f();}catch(e){errors.push(e);}};await clean(()=>restore(seams[0]));await clean(()=>restore(seams[1]));await clean(()=>session.setModel(before));await clean(()=>restore(seams[2]));await clean(()=>writeFile(join(folder,'observations.json'),JSON.stringify({rows,observations,errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'}));
 }
 if(errors.length)throw new AggregateError(errors,'Native notification lifecycle failed; preserve observations, no replay');return {idleRefusal:true,reloadRevocation:true,syntheticModelRequests:16,scenarios:4,liveServiceCalls:0,rows};
}
