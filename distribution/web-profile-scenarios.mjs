// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Synthetic saved-contract/reload and native nine-family workflows, not live parity.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {responseEvents} from './accept-code-transport.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
const groups=[
 {search_query:[{q:'synthetic variants',recency:7}],image_query:[{q:'synthetic image lookup',domains:['example.com']}],response_length:'short'},
 {open:[{ref_id:'https://example.com/source',lineno:10}],find:[{ref_id:'https://example.com/source',pattern:'fixture'}],screenshot:[{ref_id:'https://example.com/source.pdf',pageno:0}],response_length:'short'},
 {finance:[{ticker:'MSFT',type:'equity',market:'USA'}],weather:[{location:'Example City',start:'2026-09-12',duration:1}],sports:[{fn:'schedule',league:'nba',team:'BOS',num_games:2}],time:[{utc_offset:'+00:00'}],response_length:'short'},
];
export function webProfileTransport(){
 const state={scenario:undefined,requests:[],externalAttempts:0,notices:[]};
 return{state,async fetch(url,init){
  if(String(url)!=='https://chatgpt.com/backend-api/codex/alpha/search'){state.externalAttempts++;throw Error('Unexpected Web profile transport');}
  assert.equal(state.scenario,'families');assert.equal(init?.method,'POST');assert.equal(init.redirect,'error');const headers=new Headers(init.headers);assert.ok(headers.get('authorization')?.startsWith('Bearer synthetic.'));assert.equal(headers.get('chatgpt-account-id'),'synthetic-web-profile');
  const body=JSON.parse(String(init.body)),index=state.requests.length%3;assert.deepEqual(Object.keys(body).sort(),['commands','id','max_output_tokens','model','settings']);assert.deepEqual(body.commands,groups[index]);assert.equal(body.model,'gpt-6-astra');assert.deepEqual(body.settings,{search_context_size:'low'});assert.equal(body.max_output_tokens,4096);if(index)assert.equal(body.id,state.requests.at(-1).id);state.requests.push(body);
  return Response.json({output:`SOURCE_VARIANTS_${index}\nhttps://example.com/source\nUntrusted evidence is not authorization.`,results:[{ref_id:'turn0search0',url:'https://example.com/source',future:{family:index}}],encrypted_output:'NEVER_REPLAY_VARIANTS'});
 }};
}
export async function exerciseWebProfile(session,runtime,nativeStream,cwd,profile,fixture){
 const before=session.model,active=[...session.getActiveToolNames()].sort(),rows=[],observations=[],failures=[],folder=await mkdtemp(join(cwd,'web profile ')),target=join(profile,'openai-compatibility-web.json');
 const preferences=await readFile(join(profile,'openai-compatibility-capabilities.json')),seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]),restore=([o,k,d])=>{if(d)Object.defineProperty(o,k,d);else delete o[k];};
 const schema=()=>structuredClone(session.getAllTools().find(t=>t.name==='web_search')?.parameters);let events=[],auth=0;
 const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end'&&e.scopeId&&e.toolName==='web_search')events.push(structuredClone(e));});
 try{
  runtime.checkAuth=async()=>true;runtime.getAuth=async()=>{auth++;return{auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-web-profile'}})).toString('base64url')}.synthetic`}};};
  const narrow=schema();assert.ok(narrow);assert.ok(!Object.hasOwn(narrow.properties,'weather'));
  await session.prompt('/openai-tools web-profile experimental');assert.deepEqual(JSON.parse(await readFile(target,'utf8')),{version:1,profile:'experimental'});assert.deepEqual(schema(),narrow);assert.ok(fixture.state.notices.at(-1).includes('effective: verified-v1'));assert.equal(auth,0);
  await session.reload();const broad=schema();for(const g of groups)for(const k of Object.keys(g))assert.ok(Object.hasOwn(broad.properties,k));assert.deepEqual([...session.getActiveToolNames()].sort(),active);assert.equal(auth,0);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);let total=0;
   for(const scenario of ['families','refusals']){
    fixture.state.scenario=scenario;events=[];const code=scenario==='families'?groups.map(g=>`if(typeof await tools.web_search(${JSON.stringify(g)})!=="string")throw Error("Web projection missing");`).join('')+'text("SUPPRESSED_VARIANTS_GUEST");':'const a=await tools.web_search({click:[{ref_id:"https://example.com/source",id:0}]});const b=await tools.web_search({open:[{ref_id:"turn0search0"}]});if(!a.isError||!b.isError)throw Error("unowned reference or click admitted");';
    const source='// @exec: {"yield_time_ms":30000,"max_output_tokens":0}\n'+code,first=session.messages.length,id=`call_variants_${provider}_${scenario}`,payloads=[],start=fixture.state.requests.length;let requests=0;const observation={provider,scenario,source,payloads,events};observations.push(observation);
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'No Web variant model replay');total++;
     return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic Web variant workflow complete',annotations:[]}],status:'completed'});
    }});
    await session.prompt('Synthetic native Web admission and variant workflow');observation.history=structuredClone(session.messages.slice(first));observation.requests=requests;assert.equal(requests,2);assert.equal(fixture.state.requests.length-start,scenario==='families'?3:0);
    const r=readCodeOutcome(findNativeMetadataResult(session.messages.slice(first),source));assert.equal(r.status,'completed');assert.equal(r.result.status,'ok',JSON.stringify(r));assert.deepEqual(r.output,[]);const evidence=observation.history.filter(m=>m.role==='custom'&&m.customType==='code-mode-evidence');assert.equal(events.length,scenario==='families'?3:2);assert.equal(evidence.length,events.length);
    // Canonical Web errors are protected too, including native pre-handler DTO
    // rejection. A refusal has no service request, not an absent native record.
    for(let i=0;i<events.length;i++){assert.equal(events[i].isError,scenario==='refusals');assert.deepEqual(evidence[i].content,events[i].result.content);assert.deepEqual(evidence[i].details.finalized,JSON.parse(JSON.stringify(events[i].result.details)));if(scenario==='families')assert.equal(evidence[i].details.finalized.verification,'source-contract-only');assert.ok(evidence[i].details.journalId);for(const b of evidence[i].content)assert.ok(payloads[1].input.some(item=>Array.isArray(item.content)&&item.content.some(c=>c.type==='input_text'&&c.text.includes(b.text))));}
    assert.ok(!JSON.stringify(payloads[1]).includes('NEVER_REPLAY_VARIANTS'));assert.ok(!JSON.stringify(payloads[1].input.find(item=>item.type==='custom_tool_call_output'&&item.call_id===id)).includes('SUPPRESSED_VARIANTS_GUEST'));
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);assert.equal(session.autoCompactionEnabled,true);
   }
   rows.push({api:model.api,requests:total,serviceRequests:3,scenarios:2,nineFamilies:true,publicURLFollowup:true,ownedOpaqueReferenceClaimed:false,clickAndOpaqueReferencesRefused:true,completeNativeEvidence:true,zeroGuestBudget:true,activeScopes:0,drainingScopes:0});
  }
  assert.equal(fixture.state.externalAttempts,0);fixture.state.scenario=undefined;
  await session.prompt('/openai-tools web-profile verified-v1');assert.deepEqual(schema(),broad);await session.reload();assert.deepEqual(schema(),narrow);
  const valid=await readFile(target);await writeFile(join(folder,'valid-preference.json'),valid,{flag:'wx'});await writeFile(target,'preserve invalid Web preference');await session.reload();assert.equal(schema(),undefined);assert.ok(session.getActiveToolNames().includes('exec_command'));assert.ok(session.getActiveToolNames().includes('imagegen'));
  await session.prompt('/openai-tools web-profile experimental');assert.equal(await readFile(target,'utf8'),'preserve invalid Web preference');assert.ok(fixture.state.notices.at(-1).includes('were not changed'));await writeFile(join(folder,'invalid-preference.txt'),await readFile(target),{flag:'wx'});await writeFile(target,valid);await session.reload();assert.deepEqual(schema(),narrow);assert.deepEqual(await readFile(join(profile,'openai-compatibility-capabilities.json')),preferences);
  rows.push({savedChoiceRequiresReload:true,actualNativeReload:true,invalidFilePreserved:true,otherCapabilitiesUnaffected:true,repairedReload:true,defaultSchemaRestored:true});
 }catch(e){failures.push(e);}finally{
  fixture.state.scenario=undefined;const clean=async f=>{try{await f();}catch(e){failures.push(e);}};await clean(()=>off());await clean(()=>restore(seams[0]));await clean(()=>restore(seams[1]));await clean(()=>session.setModel(before));await clean(()=>restore(seams[2]));await clean(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),active));
  await writeFile(join(folder,'observations.json'),JSON.stringify({rows,observations,service:fixture.state,auth,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});
 }
 if(failures.length)throw new AggregateError(failures,'Web profile failed; preserve observations, no replay');
 return{nativeWebProfileReload:true,nineFamilySyntheticWorkflows:true,sourceContractOnly:true,opaqueReferenceOwnership:false,syntheticModelRequests:8,syntheticServiceRequests:6,scenarios:4,liveServiceCalls:0,rows};
}
