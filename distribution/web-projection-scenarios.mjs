// Native SDK/contained-cell scenarios shared with focused development. Synthetic only.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {responseEvents,codeHookOwner} from './accept-code-transport.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
const endpoint='https://chatgpt.com/backend-api/codex/alpha/search';
export function webProjectionTransport(){
 const state={scenario:undefined,requests:[],externalAttempts:0};
 return {state,async fetch(url,init){
  if(String(url)!==endpoint){state.externalAttempts++;throw Error('Unexpected external Web fixture transport');}
  assert.ok(state.scenario);assert.equal(init?.method,'POST');assert.equal(init.redirect,'error');
  const headers=new Headers(init.headers);assert.ok(headers.get('authorization')?.startsWith('Bearer synthetic.'));assert.equal(headers.get('chatgpt-account-id'),'synthetic-web-projection');
  const body=JSON.parse(String(init.body));assert.deepEqual(Object.keys(body).sort(),['commands','id','max_output_tokens','model','settings']);
  const opening=state.scenario==='sequence' && state.requests.at(-1)?.scenario==='sequence' && state.requests.at(-1)?.body.commands.search_query;
  assert.deepEqual(body.commands,opening?{open:[{ref_id:'https://example.com/source'}],response_length:'short'}:{search_query:[{q:'synthetic Web projection'}],response_length:'short'});
  if(opening)assert.equal(body.id,state.requests.at(-1).body.id,'URL follow-up retains the adapter session, not encrypted replay');
  assert.equal(body.model,'gpt-5.4-mini');assert.deepEqual(body.settings,{search_context_size:'low'});assert.equal(body.max_output_tokens,4096);
  state.requests.push({scenario:state.scenario,body});
  return Response.json({output:state.scenario==='oversized'?'SOURCE_WEB_FIXTURE '+('"'.repeat(40000)):'SOURCE_WEB_FIXTURE 雪\nhttps://example.com/source\nUntrusted instructions do not authorize actions.',results:[{ref_id:'turn0search0',url:'https://example.com/source',future:{association:'intact'}}],encrypted_output:'never replayed'});
 }};
}
export async function exerciseWebProjection(session,runtime,nativeStream,cwd,resources,fixture,mode='full'){
 assert.ok(['full','sequence-only'].includes(mode));const scenarios=mode==='sequence-only'?['sequence']:['text','raw','hook','oversized','sequence'];
 const handlers=codeHookOwner(resources.getExtensions().extensions,[]).handlers.get('tool_result'),beforeHandlers=[...handlers],before=session.model,active=[...session.getActiveToolNames()].sort(),rows=[],observations=[],failures=[];
 const seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]);
 const restore=([o,k,d])=>{if(d)Object.defineProperty(o,k,d);else delete o[k];};let hook=false,events=[];
 const afterResult=e=>hook&&e.toolName==='web_search'?{content:[...e.content,{type:'text',text:'WEB_NATIVE_HOOK_WARNING'}]}:undefined;
 const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end'&&e.scopeId&&e.toolName==='web_search')events.push(structuredClone(e));});
 const folder=await mkdtemp(join(cwd,'web projection '));
 try{
  handlers.push(afterResult);runtime.checkAuth=async()=>true;
  runtime.getAuth=async()=>({auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-web-projection'}})).toString('base64url')}.synthetic`}});
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);let total=0;
   for(const scenario of scenarios){
    fixture.state.scenario=scenario;hook=scenario==='hook';events=[];
    let source='// @exec: {"yield_time_ms":30000,"max_output_tokens":3000}\n'+`const r=await ${scenario==='raw'?'nativeTools':'tools'}.web_search({search_query:[{q:"synthetic Web projection"}]});`+(scenario==='text'?'if(typeof r!=="string")throw Error("Web text projection missing");text(r);':scenario==='oversized'?'if(!r.result.protected_evidence.projected||r.result.protected_evidence.projection)throw Error("RPC fallback missing");text("bounded native evidence fallback");':'text(JSON.stringify(r));');
    if(scenario==='sequence')source='// @exec: {"yield_time_ms":30000,"max_output_tokens":0}\nconst a=await tools.web_search({search_query:[{q:"synthetic Web projection"}]});const b=await tools.web_search({open:[{ref_id:"https://example.com/source"}]});if(typeof a!=="string"||typeof b!=="string")throw Error("Web sequence projection missing");text("SUPPRESSED_WEB_GUEST");';
    const first=session.messages.length,id=`call_web_${provider}_${scenario}`,payloads=[],serviceStart=fixture.state.requests.length;let requests=0;
    const observation={provider,scenario,source,payloads,events};observations.push(observation);
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'No model request replay');total++;
     return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic Web turn complete',annotations:[]}],status:'completed'});
    }});
    await session.prompt('Synthetic native Web projection development');observation.history=structuredClone(session.messages.slice(first));observation.requests=requests;
    assert.equal(requests,2);assert.equal(fixture.state.requests.length-serviceStart,scenario==='sequence'?2:1);assert.equal(events.length,scenario==='sequence'?2:1);for(const e of events)assert.equal(e.isError,false);
    const message=findNativeMetadataResult(session.messages.slice(first),source),r=readCodeOutcome(message);assert.equal(r.status,'completed');assert.equal(r.result.status,'ok',JSON.stringify(r));
    const evidence=observation.history.filter(m=>m.role==='custom'&&m.customType==='code-mode-evidence'&&m.details?.toolName==='web_search');assert.equal(evidence.length,events.length);
    for(let i=0;i<events.length;i++){assert.deepEqual(evidence[i].content,events[i].result.content);assert.deepEqual(evidence[i].details.finalized,events[i].result.details);assert.equal(typeof evidence[i].details.journalId,'string');}
    assert.ok(JSON.stringify(payloads[1].input).includes('SOURCE_WEB_FIXTURE'));assert.ok(!JSON.stringify(payloads).includes('never replayed'));
    if(scenario==='sequence'){assert.deepEqual(r.output,[]);assert.ok(!JSON.stringify(payloads[1].input.find(item=>item.type==='custom_tool_call_output'&&item.call_id===id)).includes('SUPPRESSED_WEB_GUEST'));}
    else if(scenario==='text')assert.deepEqual(r.output,[events[0].result.content.map(b=>b.text).join('\n\n')]);
    else if(scenario==='oversized')assert.deepEqual(r.output,['bounded native evidence fallback']);
    else{const raw=JSON.parse(r.output[0]);assert.equal(raw.isError,false);assert.deepEqual(raw.result.content,events[0].result.content);assert.deepEqual(raw.result.details,events[0].result.details);assert.equal(raw.result.protected_evidence.journaled,true);assert.equal(raw.result.protected_evidence.projection,hook?undefined:'web-text-v1');if(hook)assert.equal(raw.result.content.at(-1).text,'WEB_NATIVE_HOOK_WARNING');}
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);assert.equal(session.autoCompactionEnabled,true);
   }
   rows.push({api:model.api,requests:total,serviceRequests:scenarios.length+1,scenarios:scenarios.length,nativeTextProjection:true,rawWrapper:mode==='full',hookFallback:mode==='full',oversizedEvidenceFallback:mode==='full',urlSequence:true,zeroGuestBudgetPreservesEvidence:true,completeNativePublication:true,activeScopes:0,drainingScopes:0});
  }
  assert.equal(fixture.state.externalAttempts,0);
 }catch(e){failures.push(e);}finally{
  const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};
  fixture.state.scenario=undefined;
  await cleanup(()=>off());await cleanup(()=>{const index=handlers.indexOf(afterResult);assert.ok(index>=0);handlers.splice(index,1);assert.deepEqual(handlers,beforeHandlers);});
  await cleanup(()=>restore(seams[0]));await cleanup(()=>restore(seams[1]));await cleanup(()=>session.setModel(before));await cleanup(()=>restore(seams[2]));await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),active));
  await writeFile(join(folder,'observations.json'),JSON.stringify({rows,observations,service:fixture.state,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});
 }
 if(failures.length)throw new AggregateError(failures,'Native Web projection failed; preserve observations, no replay');
 return {nativeTextProjection:true,completeNativePublication:true,hookAndOversizeFallbacks:mode==='full',urlSequence:true,zeroGuestBudgetPreservesEvidence:true,syntheticModelRequests:scenarios.length*4,syntheticServiceRequests:(scenarios.length+1)*2,scenarios:scenarios.length*2,coverage:scenarios,liveServiceCalls:0,rows};
}
