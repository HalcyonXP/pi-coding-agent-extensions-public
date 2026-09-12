// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine bundled exec and native journal/queue; inject only the acknowledgement
// AFTER the real publisher accepted it. This does not mock invocation authority.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {responseEvents} from './accept-code-transport.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
const barrier=()=>{let release;const promise=new Promise(done=>{release=done;});return{promise,release};};
async function within(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}}
export async function exerciseNotificationAcknowledgement(session,nativeStream,cwd,mode){
 assert.ok(['confirm','throw','invalid'].includes(mode));
 const directory=await mkdtemp(join(cwd,'notification acknowledgement ')),seams=['streamFunction','notifyToolOutput'].map(key=>[key,Object.getOwnPropertyDescriptor(session.agent,key)]),original=session.agent.notifyToolOutput;
 assert.equal(typeof original,'function');const accepted=barrier(),ack=barrier(),settled=barrier(),errors=[],observation={mode,api:session.model.api,requests:0,effects:0,events:[]};let prompt,stage='original',nativeScope,origin;
 const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end')observation.events.push(structuredClone(e));});
 const journals=()=>session.sessionManager.getEntries().filter(e=>e.type==='custom'&&e.customType==='code-mode-protected-evidence'&&e.data.notification?.toolCallId===origin?.toolCallId);
 try{
  session.agent.notifyToolOutput=async(...args)=>{
   observation.effects++;assert.equal(observation.effects,1,'Do not replay notification publication');
   const value=await original.apply(session.agent,args);assert.equal(value,true);origin=structuredClone(args[1]);nativeScope=args[2];assert.equal(origin.toolName,'exec');assert.equal(journals().length,1);
   accepted.release();try{await ack.promise;if(mode==='throw')throw Error('Synthetic lost acknowledgement after native publication');if(mode==='invalid')return undefined;return value;}finally{settled.release();}
  };
  const source='// @exec: {"yield_time_ms":30000,"max_output_tokens":0}\nawait notify("NATIVE_ACK_JOURNAL_ONCE");text("FORBIDDEN_AFTER_CANCEL");';
  const invoke=(next,code)=>{stage=next;let requests=0;session.agent.streamFunction=(model,context,options)=>nativeStream(model,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',fetch:async(url)=>{
   assert.equal(String(url),model.api==='openai-responses'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');observation.requests++;assert.ok(++requests<=2,'No implicit model turn or source replay');const id=`ack_${mode}_${next}`;
   return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:code,status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic acknowledgement boundary',annotations:[]}],status:'completed'});
  }});const pending=session.prompt('Synthetic native acknowledgement '+next);void pending.catch(()=>{});return pending;};
  prompt=invoke('original',source);await within(accepted.promise,10000,'Native notification was not journaled');assert.equal(observation.requests,1);assert.equal(session.agent.getToolGatewayInfo().activeScopes,1);
  let finalized=false;void prompt.then(()=>{finalized=true;},()=>{finalized=true;});session.agent.abort();
  const drainingDeadline=performance.now()+2000;while(session.agent.getToolGatewayInfo().drainingScopes!==1){assert.ok(performance.now()<drainingDeadline,'Cancellation did not quarantine the pending acknowledgement');await new Promise(done=>setTimeout(done,10));}
  assert.equal(nativeScope.signal.aborted,true);assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(journals().length,1);
  // Code collection and whole native-turn finalization are different boundaries.
  // Native finalization must not overtake an outstanding scope acknowledgement.
  assert.equal(finalized,false);assert.equal(observation.events.length,0);
  await assert.rejects(session.prompt('Do not replace a pending native turn'),/already processing/i);
  assert.equal(observation.requests,1);assert.equal(observation.effects,1);assert.equal(finalized,false);
  ack.release();await within(settled.promise,2000,'Injected acknowledgement did not settle');await within(prompt,10000,'Native finalization did not settle after acknowledgement outcome');prompt=undefined;
  const initial=observation.events.filter(e=>e.toolName==='exec')[0];assert.ok(initial);assert.equal(initial.toolCallId,origin.toolCallId);assert.equal(initial.isError,true);
  if(mode==='confirm')assert.match(initial.result.content[0].text,/result withheld: capability or session authorization changed/i);
  else{assert.equal(initial.result.details.scopeCleanup,'unconfirmed');assert.deepEqual(initial.result.details.scopes,[{id:nativeScope.id,state:'draining'}]);}
  if(mode==='confirm'){
   const deadline=performance.now()+5000;while(session.agent.getToolGatewayInfo().drainingScopes){assert.ok(performance.now()<deadline,'Confirmed notification failed to drain');await new Promise(done=>setTimeout(done,10));}
   prompt=invoke('resumed','text("ADMITTED_AFTER_CONFIRMED_DRAIN");');await within(prompt,10000,'Confirmed drain did not allow a fresh cell');prompt=undefined;
   const resumed=observation.events.filter(e=>e.toolName==='exec').at(-1),result=readCodeOutcome({...resumed.result,toolName:'exec',isError:resumed.isError});assert.equal(result.status,'completed');assert.equal(result.result.status,'ok');assert.deepEqual(result.output,['ADMITTED_AFTER_CONFIRMED_DRAIN']);
  }else{
   prompt=invoke('still-blocked','text("FORBIDDEN_UNCERTAIN_CELL");');await within(prompt,10000,'Unconfirmed admission did not return');prompt=undefined;
   const refused=observation.events.filter(e=>e.toolName==='exec').at(-1);assert.equal(refused.isError,true);assert.match(refused.result.content.map(b=>b.type==='text'?b.text:'').join('\n'),/scope admission unavailable|cleanup incomplete/i);
  }
  assert.equal(observation.requests,3);assert.equal(observation.effects,1);assert.equal(journals().length,1);assert.equal(session.autoCompactionEnabled,true);
  const output=JSON.stringify(observation.events.map(e=>e.result));for(const marker of ['FORBIDDEN_AFTER_CANCEL','FORBIDDEN_REPLACEMENT_CELL','FORBIDDEN_UNCERTAIN_CELL'])assert.ok(!output.includes(marker));
  observation.journals=structuredClone(journals());observation.history=structuredClone(session.messages);const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,mode==='confirm'?0:1);
  observation.result={api:session.model.api,mode,modelRequests:3,nativePublications:1,journalRecords:1,nativeFinalizationHeld:true,replacementTurnRefusedWhilePending:true,originalExecIdentity:true,noPublicationReplay:true,confirmedDrainResumes:mode==='confirm',uncertaintyQuarantined:mode!=='confirm',activeScopes:0,drainingScopes:mode==='confirm'?0:1};
 }catch(e){errors.push(e);}finally{
  const clean=async f=>{try{await f();}catch(e){errors.push(e);}};ack.release();if(prompt){await clean(()=>session.agent.abort());await clean(()=>within(prompt,10000,'Failed scenario prompt remained active'));}
  await clean(()=>off());for(const [key,d]of seams)await clean(()=>d?Object.defineProperty(session.agent,key,d):delete session.agent[key]);
  await clean(()=>writeFile(join(directory,'observations.json'),JSON.stringify({...observation,stage,errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'}));
 }
 if(errors.length)throw new AggregateError(errors,'Native acknowledgement scenario failed; preserve observations, no replay');return observation.result;
}
