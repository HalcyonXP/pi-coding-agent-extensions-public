// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Real native dispatcher/extension scenarios with synthetic transport only.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {responseEvents} from './accept-code-transport.mjs';
const endpoint='https://chatgpt.com/backend-api/codex/alpha/search';
export function webContextTransport(){
 const state={scenario:undefined,expected:undefined,requests:[],attempts:[],failures:[],externalAttempts:0};
 return {state,async fetch(url,init){
  state.attempts.push({scenario:state.scenario,url:String(url),method:init?.method,body:typeof init?.body==='string'?init.body:undefined});
  try{
  if(String(url)!==endpoint){state.externalAttempts++;throw Error('Unexpected external context fixture transport');}
  assert.equal(state.scenario,'visible');assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
  const headers=new Headers(init.headers);assert.ok(headers.get('authorization')?.startsWith('Bearer synthetic.'));assert.equal(headers.get('chatgpt-account-id'),'synthetic-web-context');
  const body=JSON.parse(String(init.body));assert.deepEqual(Object.keys(body).sort(),['commands','id','input','max_output_tokens','model','settings']);assert.deepEqual(body.input,state.expected);
  assert.deepEqual(body.commands,{search_query:[{q:'synthetic native context'}],response_length:'short'});assert.ok(Buffer.byteLength(String(init.body))<=16384);
  state.requests.push({scenario:state.scenario,body});return Response.json({output:'Synthetic context-aware Web result',results:[],encrypted_output:'do-not-replay-context'});
  }catch(error){state.failures.push({name:error.name,message:error.message,stack:error.stack});throw error;}
 }};
}
export async function exerciseWebContext(session,runtime,nativeStream,cwd,fixture,mode='full'){
 assert.ok(['full','redaction-auth-only'].includes(mode));const scenarios=mode==='full'?['visible','serialized-redaction']:['serialized-redaction'];
 const before=session.model,seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]),restore=([o,k,d])=>d?Object.defineProperty(o,k,d):delete o[k];
 const directory=await mkdtemp(join(cwd,'native Web context ')),rows=[],observations=[],failures=[];
 let webActive=false,webAuthCalls=0;const off=session.agent.subscribe(event=>{if(event.toolName!=='web_search')return;if(event.type==='tool_execution_start')webActive=true;if(event.type==='tool_execution_end')webActive=false;});
 try{
  runtime.checkAuth=async()=>true;runtime.getAuth=async()=>{if(webActive)webAuthCalls++;return {auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-web-context'}})).toString('base64url')}.synthetic`}};};
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);
   for(const scenario of scenarios){
    const first=`first visible user ${provider} ${scenario}`,middle='intervening visible assistant',latest=`latest visible user ${provider} ${scenario}`;
    fixture.state.scenario=scenario;fixture.state.expected=[{type:'message',role:'user',content:[{type:'input_text',text:first}]},{type:'message',role:'assistant',content:[{type:'output_text',text:middle}]},{type:'message',role:'user',content:[{type:'input_text',text:latest}]}];
    const start=session.messages.length,serviceStart=fixture.state.requests.length,authStart=webAuthCalls,wire=[];let requests=0,serializations=0;
    const observation={provider,scenario,wire};observations.push(observation);
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){
     const replacement=await options?.onPayload?.(body,m),value=replacement===undefined?body:replacement;
     if(scenario!=='serialized-redaction'||requests!==1)return value;
     return {...value,get input(){serializations++;return value.input.map(item=>item.role==='user'?{...item,content:item.content.map(block=>block.text===latest?{...block,text:'redacted at native serialization'}:block)}:item);}};
    },fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.ok(++requests<=3,'No native model replay');
     const body=typeof init.body==='string'?init.body:Buffer.from(zstdDecompressSync(init.body)).toString('utf8');wire.push(JSON.parse(body));
     return responseEvents(requests===2?{type:'function_call',id:`fc_${provider}_${scenario}`,call_id:`call_${provider}_${scenario}`,name:'web_search',arguments:JSON.stringify({search_query:[{q:'synthetic native context'}],response_length:'short'}),status:'completed'}:{type:'message',id:`msg_${provider}_${scenario}_${requests}`,role:'assistant',content:[{type:'output_text',text:requests===1?middle:'Synthetic native context turn complete',annotations:[]}],status:'completed'});
    }});
    await session.prompt(first);assert.equal(requests,1);await session.prompt(latest);assert.equal(requests,3);
    const history=session.messages.slice(start);observation.history=structuredClone(history);observation.serializations=serializations;observation.webAuthCalls=webAuthCalls-authStart;
    const result=history.find(m=>m.role==='toolResult'&&m.toolName==='web_search');assert.ok(result);
    assert.equal(result.isError,scenario!=='visible');assert.equal(fixture.state.requests.length-serviceStart,scenario==='visible'?1:0);
    assert.equal(serializations,scenario==='serialized-redaction'?1:0);
    if(scenario==='serialized-redaction')assert.equal(webAuthCalls-authStart,0,'Unavailable context must refuse before subscription auth');else assert.ok(webAuthCalls>authStart);
    if(scenario==='serialized-redaction'){assert.ok(JSON.stringify(result.content).includes('WEB_CONTEXT_UNAVAILABLE'));assert.ok(JSON.stringify(wire[1].input).includes('redacted at native serialization'));assert.ok(!JSON.stringify(wire[1].input).includes(latest));}
    assert.ok(!JSON.stringify(wire).includes('do-not-replay-context'));assert.equal(session.autoCompactionEnabled,true);
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);
    rows.push({api:model.api,scenario,modelRequests:requests,serviceRequests:fixture.state.requests.length-serviceStart,webAuthCalls:webAuthCalls-authStart,serializedBoundary:true,activeScopes:0,drainingScopes:0});
   }
  }
  assert.equal(fixture.state.externalAttempts,0);
 }catch(e){failures.push(e);}finally{
  const clean=async f=>{try{await f();}catch(e){failures.push(e);}};fixture.state.scenario=undefined;
  await clean(()=>off());await clean(()=>restore(seams[0]));await clean(()=>restore(seams[1]));await clean(()=>session.setModel(before));await clean(()=>restore(seams[2]));
  await clean(()=>writeFile(join(directory,'observations.json'),JSON.stringify({rows,observations,service:fixture.state,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'}));
 }
 if(failures.length)throw new AggregateError(failures,'Native Web context failed; preserve observations, no replay');
 return {nativeSerializedContext:true,forwardedHistory:mode==='full',preAuthRedactionRefusal:true,syntheticModelRequests:scenarios.length*6,syntheticServiceRequests:mode==='full'?2:0,scenarios:scenarios.length*2,coverage:scenarios,liveServiceCalls:0,rows};
}
