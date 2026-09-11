// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Synthetic media through the real native SDK/contained cells; no live-service qualification.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,relative,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {responseEvents} from './accept-code-transport.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
const inlineLabel='Code image helper: guest-provided inline image, not a native tool result or proof of generation/save.';
export function mediaInputTransport(mode='edit'){
 assert.ok(['edit','projection'].includes(mode));
 const state={images:[],scenario:undefined,requests:[],externalAttempts:0};
 return {state,async prepare(bundle){
  // Caller verifies this workspace-local SDK and isolates the profile before any import.
  const {PhotonImage}=await import(pathToFileURL(join(bundle,'node_modules/@silvia-odwyer/photon-node/photon_rs.js')).href);
  const image=new PhotonImage(new Uint8Array([200,60,50,255]),1,1);
  try{state.images=[['image/png',image.get_bytes()],['image/jpeg',image.get_bytes_jpeg(80)],['image/webp',image.get_bytes_webp()],['image/gif',Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7','base64')]].map(([mimeType,bytes])=>({mimeType,data:Buffer.from(bytes).toString('base64')}));}finally{image.free();}
  for(const fixture of state.images){const decoded=PhotonImage.new_from_base64(fixture.data);try{assert.equal(decoded.get_width(),1);assert.equal(decoded.get_height(),1);}finally{decoded.free();}}
 },async fetch(url,init){
  if(String(url)!==(mode==='edit'?'https://chatgpt.com/backend-api/codex/images/edits':'https://chatgpt.com/backend-api/codex/images/generations')){state.externalAttempts++;throw Error('Unexpected external media fixture transport');}
  if(mode==='edit')assert.equal(state.scenario,'edit');else assert.ok(['normal','raw','hook','copy'].includes(state.scenario));assert.equal(init?.method,'POST');assert.equal(init.redirect,'error');
  const headers=new Headers(init.headers);assert.ok(headers.get('authorization')?.startsWith('Bearer synthetic.'));assert.equal(headers.get('chatgpt-account-id'),'synthetic-media-input');
  const gif=state.images.find(i=>i.mimeType==='image/gif'),body=JSON.parse(String(init.body));
  assert.deepEqual(body,mode==='edit'?{prompt:'synthetic inline reference edit',background:'auto',model:'gpt-image-2',quality:'auto',size:'auto',images:[{image_url:`data:${gif.mimeType};base64,${gif.data}`}]}:{prompt:'synthetic imagegen projection '+state.scenario,background:'auto',model:'gpt-image-2',quality:'auto',size:'auto'});state.requests.push(body);
  if(mode==='projection'&&state.scenario==='copy'){assert.equal(typeof state.copyDestination,'string');await writeFile(state.copyDestination,'synthetic competing writer',{flag:'wx'});}
  return Response.json({data:[{b64_json:state.images[0].data}]});
 }};
}
function imageURLs(payload){const urls=[];for(const row of payload.input??[])if(Array.isArray(row.content))for(const item of row.content)if(item.type==='input_image')urls.push(item.image_url);return urls;}
export async function exerciseMediaInput(session,runtime,nativeStream,cwd,fixture,mode='full'){
 assert.ok(['full','canvas-only','generated-only'].includes(mode));const scenarios=mode==='full'?['formats','edit','url','mime','foreign','canvas','generated','generated-read','generated-invalid']:mode==='canvas-only'?['canvas']:['generated','generated-read','generated-invalid'];
 const generatedCovered=mode!=='canvas-only';
 if(generatedCovered)await writeFile(join(cwd,'generated-helper-input.png'),Buffer.from(fixture.state.images[0].data,'base64'),{flag:'wx'});
 const before=session.model,active=[...session.getActiveToolNames()].sort(),rows=[],observations=[],failures=[];
 const seams=[[session.agent,'streamFunction'],[runtime,'getAuth'],[runtime,'checkAuth']].map(([o,k])=>[o,k,Object.getOwnPropertyDescriptor(o,k)]);
 const restore=([o,k,d])=>{if(d)Object.defineProperty(o,k,d);else delete o[k];};let events=[],previousRef='img_00000000-0000-0000-0000-000000000000';
 const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end'&&e.scopeId)events.push(structuredClone(e));});
 const folder=await mkdtemp(join(cwd,'media input '));
 try{
  runtime.checkAuth=async()=>true;runtime.getAuth=async()=>({auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-media-input'}})).toString('base64url')}.synthetic`}});
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);await session.setModel(model);let total=0,firstRef;const foreign=previousRef;
   for(const scenario of scenarios){
    fixture.state.scenario=scenario;events=[];
    const png=fixture.state.images[0],gif=fixture.state.images.find(i=>i.mimeType==='image/gif');
    let code;
    if(scenario==='formats')code=`const values=${JSON.stringify(fixture.state.images)};const refs=[];for(let i=0;i<values.length;i++){const v=values[i],url="data:"+v.mimeType+";base64,"+v.data;const r=image(i===0?url:i===1?{image_url:url}:{type:"image",...v});if(!r.published)throw Error("missing native receipt");refs.push(r.ref);image({type:"image_reference",ref:r.ref,mimeType:v.mimeType});}text(JSON.stringify(refs));`;
    else if(scenario==='edit')code=`const r=image(${JSON.stringify({image_url:`data:${gif.mimeType};base64,${gif.data}`})});const edited=await nativeTools.imagegen({prompt:"synthetic inline reference edit",referenced_image_refs:[r.ref]});if(edited.isError)throw Error("native edit failed");image(edited.result.content[0]);store("canonical",edited.result.details.canonicalPath);text("SUPPRESSED_MEDIA_OUTPUT");`;
    else if(scenario==='url')code='image("https://invalid.example/PRIVATE_MEDIA_VALUE.png");';
    else if(scenario==='mime')code=`image({type:"image",data:${JSON.stringify(png.data)},mimeType:"image/jpeg"});`;
    else if(scenario==='generated')code=`const r=generatedImage({image_url:${JSON.stringify(`data:image/png;base64,${png.data}`)},output_hint:"first unverified hint.png"});generatedImage({image_url:r.ref,output_hint:"repeated unverified hint.png"});text("SUPPRESSED_MEDIA_OUTPUT");`;
    else if(scenario==='generated-read')code='const r=await nativeTools.read({path:"generated-helper-input.png"});if(r.isError)throw Error("native read failed");const b=r.result.content.find(b=>b.type==="image_reference");generatedImage({image_url:b.ref,output_hint:"not-a-save-receipt.png"});text("SUPPRESSED_MEDIA_OUTPUT");';
    else if(scenario==='generated-invalid')code='generatedImage({image_url:"https://invalid.example/PRIVATE_MEDIA_VALUE.png"});';
    else if(scenario==='canvas'){const bytes=Buffer.from(png.data,'base64');bytes.writeUInt32BE(5000,16);code=`image(${JSON.stringify({type:'image',mimeType:'image/png',data:bytes.toString('base64')})});`;}
    else code=`image(${JSON.stringify(foreign)});`;
    const source=`// @exec: {"yield_time_ms":30000,"max_output_tokens":${['edit','generated','generated-read'].includes(scenario)?0:1000}}\n`+code;
    const first=session.messages.length,id=`call_media_${provider}_${scenario}`,payloads=[],serviceStart=fixture.state.requests.length;let requests=0;
    const observation={provider,scenario,source,payloads,events};observations.push(observation);
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'No media model request replay');total++;
     return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic media turn complete',annotations:[]}],status:'completed'});
    }});
    await session.prompt('Synthetic native media input development');observation.history=structuredClone(session.messages.slice(first));observation.requests=requests;
    assert.equal(requests,2);assert.equal(fixture.state.requests.length-serviceStart,scenario==='edit'?1:0);assert.equal(events.length,['edit','generated-read'].includes(scenario)?1:0);
    const message=findNativeMetadataResult(session.messages.slice(first),source),r=readCodeOutcome(message);assert.equal(r.status,'completed');
    const evidence=observation.history.filter(m=>m.role==='custom'&&m.customType==='code-mode-evidence');
    const beforeImages=imageURLs(payloads[0]),afterImages=imageURLs(payloads[1]);
    if(scenario==='formats'){
     assert.equal(r.result.status,'ok',JSON.stringify(r));const refs=JSON.parse(r.output[0]);assert.equal(refs.length,4);firstRef=refs[0];assert.equal(evidence.length,8);
     for(let i=0;i<4;i++){const v=fixture.state.images[i],content=[{type:'image',...v},{type:'text',text:inlineLabel}];assert.deepEqual(evidence[i*2].content,content);assert.deepEqual(evidence[i*2+1].content,content);assert.equal(evidence[i*2].details.origin,'guest-inline');assert.equal(evidence[i*2].details.image_refs[0],refs[i]);const url=`data:${v.mimeType};base64,${v.data}`;assert.equal(afterImages.filter(x=>x===url).length-beforeImages.filter(x=>x===url).length,2);}
    }else if(scenario==='edit'){
     assert.equal(r.result.status,'ok',JSON.stringify(r));assert.deepEqual(r.output,[]);assert.equal(evidence.length,3);assert.equal(events[0].toolName,'imagegen');assert.equal(events[0].isError,false);
     assert.deepEqual(evidence[1].content,events[0].result.content);assert.deepEqual(evidence[1].details.finalized,JSON.parse(JSON.stringify(events[0].result.details)));assert.equal(events[0].result.details.operation,'edit');assert.equal(evidence[0].content[0].mimeType,'image/gif');assert.equal(evidence[0].content[1].text,inlineLabel);assert.deepEqual(evidence[2].content,[events[0].result.content[0]]);
     const canonical=events[0].result.details.canonicalPath,local=relative(join(cwd,'.pi','Agent','Work','generated_images'),resolve(canonical));assert.ok(local&&!local.startsWith('..')&&!isAbsolute(local));assert.deepEqual(await readFile(canonical),Buffer.from(png.data,'base64'));observation.canonical=canonical;
     assert.equal(afterImages.length-beforeImages.length,3);assert.ok(!JSON.stringify(payloads[1].input.find(item=>item.type==='custom_tool_call_output'&&item.call_id===id)).includes('SUPPRESSED_MEDIA_OUTPUT'));
    }else if(scenario==='generated'||scenario==='generated-read'){
     assert.equal(r.result.status,'ok',JSON.stringify(r));assert.deepEqual(r.output,[]);assert.equal(evidence.length,2);assert.equal(afterImages.length-beforeImages.length,2);
     if(scenario==='generated'){for(const e of evidence){assert.equal(e.details.helper,'generatedImage');assert.equal(e.details.origin,'guest-inline');assert.equal(e.content[0].data,png.data);assert.equal(e.content[1].text,inlineLabel);assert.match(e.content[2].text,/unverified; not a save receipt/);}}
     else{assert.equal(events[0].toolName,'read');assert.equal(events[0].isError,false);assert.deepEqual(evidence[0].content,events[0].result.content);assert.equal(evidence[1].details.helper,'generatedImage');assert.deepEqual(evidence[1].content[0],events[0].result.content.find(b=>b.type==='image'));assert.ok(evidence[1].content[1].text.endsWith('not-a-save-receipt.png'));assert.deepEqual(await readFile(join(cwd,'generated-helper-input.png')),Buffer.from(png.data,'base64'));}
     assert.ok(!JSON.stringify(payloads[1].input.find(item=>item.type==='custom_tool_call_output'&&item.call_id===id)).includes('SUPPRESSED_MEDIA_OUTPUT'));
    }else{assert.equal(r.result.status,'error');assert.equal(r.result.code,scenario==='foreign'?'TOOL_LIMIT':scenario==='generated-invalid'?'GENERATED_IMAGE_INPUT_REQUIRED':'IMAGE_REFERENCE_REQUIRED');assert.equal(evidence.length,0);assert.deepEqual(r.output,[]);assert.ok(!JSON.stringify(r).includes('PRIVATE_MEDIA_VALUE'));assert.equal(afterImages.length,beforeImages.length);}
    const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);assert.equal(session.autoCompactionEnabled,true);
   }
   previousRef=firstRef;rows.push({api:model.api,requests:total,serviceRequests:mode==='full'?1:0,scenarios:scenarios.length,formats:mode==='full'?fixture.state.images.map(i=>i.mimeType):[],inlineAndReferencePublication:mode==='full',editOriginalPreserved:mode==='full',zeroGuestBudgetPreservesEvidence:mode==='full',invalidInputsRefused:true,canvasLimitRefused:mode!=='generated-only',generatedImageCovered:generatedCovered,foreignReferenceRefused:mode==='full',revokedReferenceCovered:mode==='full'&&provider==='openai-codex',activeScopes:0,drainingScopes:0});
  }
  assert.equal(fixture.state.externalAttempts,0);
 }catch(e){failures.push(e);}finally{
  fixture.state.scenario=undefined;const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};
  await cleanup(()=>off());await cleanup(()=>restore(seams[0]));await cleanup(()=>restore(seams[1]));await cleanup(()=>session.setModel(before));await cleanup(()=>restore(seams[2]));await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),active));
  await writeFile(join(folder,'observations.json'),JSON.stringify({rows,observations,service:fixture.state,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});
 }
 if(failures.length)throw new AggregateError(failures,'Native media input failed; preserve observations, no replay');
 return {nativeInlineAndReferenceImages:mode==='full',formats:mode==='full'?fixture.state.images.map(i=>i.mimeType):[],immutableEditOriginals:mode==='full',zeroGuestBudgetPreservesEvidence:mode==='full',invalidAndRevokedReferencesRefused:mode==='full',canvasLimitRefused:mode!=='generated-only',generatedImageCovered:generatedCovered,coverage:scenarios,syntheticModelRequests:scenarios.length*4,syntheticServiceRequests:mode==='full'?2:0,scenarios:scenarios.length*2,liveServiceCalls:0,rows};
}
