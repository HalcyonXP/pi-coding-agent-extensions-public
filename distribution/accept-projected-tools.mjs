// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Native dispatcher, contained cells and owned shell fixtures; synthetic auth/SSE only.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyBundle} from './lib.mjs';
import {responseEvents,codeHookOwner} from './accept-code-transport.mjs';
import {findNativeMetadataResult} from './accept-tool-metadata.mjs';
import {readCodeOutcome} from './code-output-contract.mjs';
export function validateProjectedTools(rows){
 assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);
 for(const r of rows){assert.equal(r.requests,8);assert.equal(r.scenarios,4);for(const key of ['targetFields','numericRetainedID','completeOutput','nativeWrappersUnchanged','hookFallbackVisible','bridgeTimeBounded','nativeCustomReplay','historyUnchanged'])assert.equal(r[key],true);assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);assert.equal(r.liveServiceCalls,0);}
 return {optInUnifiedProjection:true,defaultWrappersUnchanged:true,numericRetainedID:true,hookFallbackVisible:true,bridgeTimeObserved:true,nativeScopesReleased:true,syntheticModelRequests:16,scenarios:8,liveServiceCalls:0};
}
export async function acceptProjectedTools(session,runtime,nativeStream,cwd,resources){
 const handlers=codeHookOwner(resources.getExtensions().extensions,[]).handlers.get('tool_result');assert.ok(Array.isArray(handlers));const beforeHandlers=[...handlers];
 const folder=await mkdtemp(join(cwd,'projected tools ')),before=session.model,active=[...session.getActiveToolNames()].sort(),rows=[],invocations=[],failures=[];
 const descriptors={stream:Object.getOwnPropertyDescriptor(session.agent,'streamFunction'),auth:Object.getOwnPropertyDescriptor(runtime,'getAuth'),check:Object.getOwnPropertyDescriptor(runtime,'checkAuth')};
 const restore=(o,key,d)=>{if(d)Object.defineProperty(o,key,d);else delete o[key];};let events=[],hook=false;
 const afterResult=e=>{if(hook&&e.toolName==='exec_command')return{content:[...e.content,{type:'text',text:'NATIVE_PROJECTION_HOOK_WARNING'}]};};
 const off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end'&&e.scopeId&&['exec_command','write_stdin'].includes(e.toolName))events.push(structuredClone(e));});
 try{
  handlers.push(afterResult);runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
  for(const provider of ['openai','openai-codex']){
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);runtime.getAuth=async id=>{assert.equal(typeof id==='string'?id:id.provider,provider);return{auth:{apiKey:provider==='openai'?'synthetic-projection':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-projection'}})).toString('base64url')}.synthetic`}};};await session.setModel(model);let total=0;
   for(const scenario of ['complete','retained','hook','raw']){
    events=[];hook=scenario==='hook';const expected=scenario==='retained'?'\\"雪\t'.repeat(12):'NATIVE_PROJECTION\n',file=join(folder,`${provider}-${scenario}.cjs`);await writeFile(file,`process.stdout.write(Buffer.from(${JSON.stringify(Buffer.from(expected).toString('base64'))},'base64'));process.exitCode=7;`,{flag:'wx'});
    const quote=s=>`'${s.replaceAll("'","''")}'`,command=process.platform==='win32'?`& ${quote(process.execPath)} ${quote(file)}; exit $LASTEXITCODE`:`${quote(process.execPath)} ${quote(file)}`;
    const source='// @exec: {"yield_time_ms":30000,"max_output_tokens":3000}\n'+`let r=await ${scenario==='raw'?'tools':'projectedTools'}.exec_command({cmd:${JSON.stringify(command)},max_output_tokens:${scenario==='retained'?4:100}});`+(hook||scenario==='raw'?'text(JSON.stringify(r));':`for(let n=0;;n++){if(n>=32||typeof r.output!=="string")throw Error("projection unavailable");text(JSON.stringify(r));if(!r.session_id)break;r=await projectedTools.write_stdin({session_id:r.session_id,max_output_tokens:4});}`);
    let requests=0;const payloads=[],first=session.messages.length,id=`call_projection_${provider}_${scenario}`,observation={provider,scenario,events,payloads};invocations.push(observation);
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));return next;},fetch:async(url,init)=>{assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'No projection fixture request replay');total++;return responseEvents(requests===1?{type:'custom_tool_call',id:`ctc_${id}`,call_id:id,name:'exec',input:source,status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic projection turn complete',annotations:[]}],status:'completed'});}});
    const start=performance.now();await session.prompt('Synthetic native projection acceptance');const observed=performance.now()-start;observation.requests=requests;observation.ms=observed;observation.history=structuredClone(session.messages.slice(first));
    assert.equal(requests,2);assert.equal(payloads.length,2);const result=findNativeMetadataResult(session.messages.slice(first),source),saved=JSON.stringify(result),value=readCodeOutcome(result);assert.equal(value.status,'completed');assert.equal(value.result.status,'ok',JSON.stringify(value));assert.equal(value.output.length,events.length);assert.ok(events.length>0);
    let output='',idSeen;
    for(let i=0;i<events.length;i++){
     const e=events[i],p=JSON.parse(value.output[i]),d=e.result.details;assert.equal(e.isError,false);assert.equal(typeof e.scopeId,'string');assert.equal(e.toolName,i?'write_stdin':'exec_command');assert.ok(Buffer.byteLength(JSON.stringify({result:e.result,isError:e.isError}))<=65536);
     if(hook||scenario==='raw'){assert.deepEqual(p,JSON.parse(JSON.stringify({result:e.result,isError:e.isError})));if(hook)assert.equal(p.result.content.at(-1).text,'NATIVE_PROJECTION_HOOK_WARNING');else{assert.equal(p.result.details.output,expected);assert.equal(p.result.details.exit_code,7);assert.equal(p.isError,false);}continue;}
     assert.equal(e.result.content[0].text,JSON.stringify(d));assert.equal(p.output,d.output);assert.equal(d.truncated_bytes,0);assert.ok(Number.isFinite(p.wall_time_seconds)&&p.wall_time_seconds>=0&&p.wall_time_seconds*1000<=Math.ceil(observed)+1);const expectedKeys=['output','wall_time_seconds'];if(d.exit_code!==null){expectedKeys.push('exit_code');assert.equal(p.exit_code,d.exit_code);}if(d.session_id!==undefined){expectedKeys.push('session_id');assert.equal(typeof p.session_id,'number');assert.equal(p.session_id,d.session_id);idSeen??=p.session_id;assert.equal(p.session_id,idSeen);}assert.deepEqual(Object.keys(p).sort(),expectedKeys.sort());output+=p.output;
    }
    if(!hook&&scenario!=='raw'){assert.equal(output,expected);assert.equal(events.at(-1).result.details.exit_code,7);assert.equal(events.at(-1).result.details.session_id,undefined);if(scenario==='retained'){assert.ok(events.length>=2);assert.ok(idSeen);}}
    assert.equal(payloads[0].tools.find(t=>t.name==='exec').type,'custom');assert.equal(payloads[1].input.find(t=>t.type==='custom_tool_call'&&t.call_id===id).input,source);assert.equal(payloads[1].input.find(t=>t.type==='custom_tool_call_output'&&t.call_id===id).output,result.content[0].text);assert.equal(JSON.stringify(result),saved);const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);
   }
   rows.push({api:model.api,requests:total,scenarios:4,targetFields:true,numericRetainedID:true,completeOutput:true,nativeWrappersUnchanged:true,hookFallbackVisible:true,bridgeTimeBounded:true,nativeCustomReplay:true,historyUnchanged:true,activeScopes:0,drainingScopes:0,liveServiceCalls:0});
  }
 }catch(e){failures.push(e);}finally{const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};await cleanup(()=>off());await cleanup(()=>{const i=handlers.indexOf(afterResult);assert.ok(i>=0);handlers.splice(i,1);assert.deepEqual(handlers,beforeHandlers);});await cleanup(()=>restore(session.agent,'streamFunction',descriptors.stream));await cleanup(()=>restore(runtime,'getAuth',descriptors.auth));await cleanup(()=>session.setModel(before));await cleanup(()=>restore(runtime,'checkAuth',descriptors.check));await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),active));await writeFile(join(folder,'observations.json'),JSON.stringify({rows,invocations,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});}
 if(failures.length)throw new AggregateError(failures,'Native projection acceptance/restoration failed; preserve evidence');return {...validateProjectedTools(rows),rows};
}

/** Keep projection fixture history out of the scripted parent conversation. No compaction override. */
export async function acceptProjectedToolsProfile(bundle){
 const profile=await mkdtemp(join(tmpdir(),'projected-tools-profile-'));
 for(const n of ['tmp','roaming','local','workspace'])await mkdir(join(profile,n));
 for(const n of ['gitconfig','npm-user','npm-global'])await writeFile(join(profile,n),'',{flag:'wx'});
 const env={HOME:profile,USERPROFILE:profile,APPDATA:join(profile,'roaming'),LOCALAPPDATA:join(profile,'local'),TEMP:join(profile,'tmp'),TMP:join(profile,'tmp'),PI_CODING_AGENT_DIR:profile,PI_OFFLINE:'1',PI_TELEMETRY:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(profile,'gitconfig'),npm_config_userconfig:join(profile,'npm-user'),npm_config_globalconfig:join(profile,'npm-global')};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','ComSpec','PATHEXT'])if(process.env[key]!==undefined)env[key]=process.env[key];
 await writeFile(join(profile,'started.json'),JSON.stringify({at:new Date().toISOString(),bundle:resolve(bundle),environmentKeys:Object.keys(env).sort(),credentialsInherited:false,compactionOverride:false})+'\n',{flag:'wx'});
 const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--installed-profile',resolve(bundle)],{env,encoding:null,timeout:180000,maxBuffer:8*1024*1024});
 for(const[name,bytes]of [['stdout',p.stdout],['stderr',p.stderr]])await writeFile(join(profile,name+'.log'),bytes??Buffer.alloc(0),{flag:'wx'});
 await writeFile(join(profile,'completed.json'),JSON.stringify({at:new Date().toISOString(),status:p.status,signal:p.signal,error:p.error?.message})+'\n',{flag:'wx'});
 assert.equal(p.error,undefined,'Preserve isolated native-projection fixture; no command replay');assert.equal(p.status,0,'Isolated native-projection fixture failed; inspect retained raw logs');
 const r=JSON.parse(p.stdout);assert.equal(r.state,'passed');assert.equal(r.networkAttempts,0);assert.equal(r.compactionEnabled,true);const {rows,...receipt}=r.nativeProjectedTools;assert.deepEqual(validateProjectedTools(rows),receipt);return receipt;
}

async function installedProfile(bundle){
 assert.equal(process.env.PI_OFFLINE,'1');const profile=process.env.PI_CODING_AGENT_DIR;assert.equal(profile,process.env.HOME);assert.equal(profile,process.env.USERPROFILE);assert.ok(profile);
 await verifyBundle(bundle);const cwd=join(profile,'workspace');let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw Error('External transport forbidden');};
 const root=join(bundle,'node_modules/@earendil-works/pi-coding-agent'),pkg=JSON.parse(await readFile(join(root,'package.json')));assert.equal(pkg.name,'@earendil-works/pi-coding-agent');assert.equal(pkg.version,'0.85.1');assert.ok(pkg.exports['.'].import.startsWith('./dist/'));
 const sdk=await import(pathToFileURL(join(root,pkg.exports['.'].import)).href),failures=[];let session,nativeProjectedTools;
 try{
  const settings=sdk.SettingsManager.inMemory(),resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[join(bundle,'extensions/openai-compatibility/index.ts')],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
  const runtime=await sdk.ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});runtime.hasConfiguredAuth=()=>true;runtime.isUsingOAuth=id=>id==='openai-codex';runtime.getAuth=async()=>({auth:{apiKey:'synthetic-default-profile'}});runtime.checkAuth=async()=>true;
  ({session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model:runtime.getModel('openai','gpt-6-astra'),settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,'sessions')),resourceLoader:resources}));await session.bindExtensions({uiContext:{...session.extensionRunner.createContext().ui,notify(){}}});
  assert.equal(session.autoCompactionEnabled,true);await session.prompt('/openai-tools unified_exec on');await session.prompt('/openai-tools code_mode on');nativeProjectedTools=await acceptProjectedTools(session,runtime,session.agent.streamFunction,cwd,resources);assert.equal(networkAttempts,0);assert.equal(session.autoCompactionEnabled,true);
 }catch(e){failures.push(e);}finally{const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};if(session){await cleanup(()=>session.agent.abort());await cleanup(()=>session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}));await cleanup(()=>session.dispose());}}
 if(failures.length)throw new AggregateError(failures,'Isolated native-projection fixture failed; retain profile and logs');console.log(JSON.stringify({state:'passed',nativeProjectedTools,networkAttempts,compactionEnabled:true}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--installed-profile');assert.equal(process.platform,'win32');await installedProfile(resolve(process.argv[3]));
}
