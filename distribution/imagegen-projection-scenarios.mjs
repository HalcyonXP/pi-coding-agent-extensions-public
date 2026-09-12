// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {responseEvents,codeHookOwner} from './accept-code-transport.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
export async function exerciseImagegenProjection(session,runtime,nativeStream,cwd,resources,fixture){
 const before=session.model,active=[...session.getActiveToolNames()].sort(),rows=[],observations=[],failures=[],handlers=codeHookOwner(resources.getExtensions().extensions,[]).handlers.get('tool_result'),prior=[...handlers];
 const seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]),restore=([o,k,d])=>{if(d)Object.defineProperty(o,k,d);else delete o[k];};
 const hook=e=>fixture.state.scenario==='hook'&&e.toolName==='imagegen'?{content:[...e.content,{type:'text',text:'IMAGEGEN_NATIVE_HOOK_WARNING'}]}:undefined;
 let events=[];const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end'&&e.scopeId&&e.toolName==='imagegen')events.push(structuredClone(e));});const folder=await mkdtemp(join(cwd,'imagegen projection '));
 try{
  handlers.push(hook);runtime.checkAuth=async()=>true;runtime.getAuth=async()=>({auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-media-input'}})).toString('base64url')}.synthetic`}});
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);let total=0;
   for(const scenario of ['normal','raw','hook','copy']){
    fixture.state.scenario=scenario;fixture.state.copyDestination=join(cwd,`imagegen-copy-${provider}.png`);events=[];
    const args={prompt:'synthetic imagegen projection '+scenario,...(scenario==='copy'?{destination_path:`imagegen-copy-${provider}.png`}:scenario==='normal'?{destination_path:`imagegen-normal-${provider}.png`}:{})};
    const code=`const r=await ${scenario==='raw'?'nativeTools':'tools'}.imagegen(${JSON.stringify(args)});`+(scenario==='normal'?'if(Object.keys(r).sort().join(",")!=="image_url,output_hint")throw Error("default imagegen projection missing");generatedImage(r);':scenario==='raw'?'if(r.result.protected_evidence.projection!=="imagegen-v1")throw Error("raw original unavailable");generatedImage({image_url:r.result.content[0].ref,output_hint:r.result.details.canonicalPath});':scenario==='hook'?'if(r.result.protected_evidence.projection!==undefined||r.result.content.at(-1).text!=="IMAGEGEN_NATIVE_HOOK_WARNING")throw Error("hook warning lost");generatedImage({image_url:r.result.content[0].ref});':'if(r.result.protected_evidence.projection!==undefined||r.result.details.copyStatus!=="failed")throw Error("copy warning lost");generatedImage({image_url:r.result.content[0].ref});')+'text("SUPPRESSED_PROJECTION_OUTPUT");';
    const source='// @exec: {"yield_time_ms":30000,"max_output_tokens":0}\n'+code,first=session.messages.length,id=`call_imagegen_${provider}_${scenario}`,payloads=[],serviceStart=fixture.state.requests.length;let requests=0;
    const observation={provider,scenario,source,payloads,events};observations.push(observation);
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'No imagegen model request replay');total++;
     return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic imagegen projection complete',annotations:[]}],status:'completed'});
    }});
    await session.prompt('Synthetic native imagegen projection development');observation.history=structuredClone(session.messages.slice(first));observation.requests=requests;
    assert.equal(requests,2);assert.equal(fixture.state.requests.length-serviceStart,1);assert.equal(events.length,1);assert.equal(events[0].isError,false);
    const message=findNativeMetadataResult(session.messages.slice(first),source),r=readCodeOutcome(message);assert.equal(r.status,'completed');assert.equal(r.result.status,'ok',JSON.stringify(r));assert.deepEqual(r.output,[]);
    const evidence=observation.history.filter(m=>m.role==='custom'&&m.customType==='code-mode-evidence');assert.equal(evidence.length,2);assert.deepEqual(evidence[0].content,events[0].result.content);assert.deepEqual(evidence[0].details.finalized,JSON.parse(JSON.stringify(events[0].result.details)));assert.deepEqual(evidence[1].content[0],events[0].result.content[0]);assert.equal(evidence[1].details.helper,'generatedImage');
    const details=events[0].result.details,local=relative(join(cwd,'.pi','Agent','Work','generated_images'),resolve(details.canonicalPath));assert.ok(local&&!local.startsWith('..')&&!isAbsolute(local));assert.deepEqual(await readFile(details.canonicalPath),Buffer.from(fixture.state.images[0].data,'base64'));observation.canonical=details.canonicalPath;
    if(scenario==='normal'){assert.deepEqual(await readFile(details.destinationPath),await readFile(details.canonicalPath));assert.equal(evidence[1].details.output_hint,details.destinationPath);}
    if(scenario==='raw')assert.equal(evidence[1].details.output_hint,details.canonicalPath);
    if(scenario==='hook')assert.equal(evidence[0].content.at(-1).text,'IMAGEGEN_NATIVE_HOOK_WARNING');
    if(scenario==='copy'){assert.equal(details.copyStatus,'failed');assert.equal(await readFile(fixture.state.copyDestination,'utf8'),'synthetic competing writer');assert.ok(evidence[0].content.some(b=>b.type==='text'&&b.text.includes('Workspace copy failed')));}
    assert.ok(!JSON.stringify(payloads[1].input.find(item=>item.type==='custom_tool_call_output'&&item.call_id===id)).includes('SUPPRESSED_PROJECTION_OUTPUT'));
    const images=p=>p.input.flatMap(row=>Array.isArray(row.content)?row.content.filter(c=>c.type==='input_image'):[]);assert.equal(images(payloads[1]).length-images(payloads[0]).length,2);
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);assert.equal(session.autoCompactionEnabled,true);
   }
   rows.push({api:model.api,requests:total,serviceRequests:4,scenarios:4,defaultProjection:true,rawWrapperPreserved:true,hookAndCopyWarningsPreserved:true,canonicalOriginalsRetained:true,generatedHelper:true,zeroGuestBudgetPreservesEvidence:true,activeScopes:0,drainingScopes:0});
  }
  assert.equal(fixture.state.externalAttempts,0);
 }catch(e){failures.push(e);}finally{
  fixture.state.scenario=undefined;const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};
  await cleanup(()=>off());await cleanup(()=>{const index=handlers.indexOf(hook);assert.ok(index>=0);handlers.splice(index,1);assert.deepEqual(handlers,prior);});await cleanup(()=>restore(seams[0]));await cleanup(()=>restore(seams[1]));await cleanup(()=>session.setModel(before));await cleanup(()=>restore(seams[2]));await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),active));
  await writeFile(join(folder,'observations.json'),JSON.stringify({rows,observations,service:fixture.state,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});
 }
 if(failures.length)throw new AggregateError(failures,'Imagegen projection failed; preserve observations, no replay');
 return {defaultImagegenProjection:true,rawWrapperPreserved:true,generatedHelper:true,nativeWarningsAndOriginalsPreserved:true,syntheticModelRequests:16,syntheticServiceRequests:8,scenarios:8,liveServiceCalls:0,rows};
}
