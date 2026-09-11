// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Real native shell/dispatcher; synthetic model and auth, never live requests.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyBundle} from './lib.mjs';
import {responseEvents} from './accept-code-transport.mjs';
import {readUnifiedOutcome} from './unified-output-contract.mjs';

export function validateUnifiedWait(rows) {
 assert.deepEqual(rows.map(r=>r.api),['openai-responses','openai-codex-responses']);
 for(const r of rows) {
  assert.equal(r.requests,11);assert.equal(r.configuredCeilingMs,60000);
  for(const key of ['explicitInitialFloor','nonemptyFloor','backgroundCollectedOnce','originalID','cancelledLongWait','historyUnchanged','invalidCeilingPreserved','preferenceChangePreservedJob'])assert.equal(r[key],true);
  assert.ok(Number.isFinite(r.backgroundMs)&&r.backgroundMs>30000&&r.backgroundMs<60000);
  assert.ok(Number.isFinite(r.cancelMs)&&r.cancelMs>=0&&r.cancelMs<5000);
  assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);
 }
 return {explicitWaitClamping:true,backgroundWaitBeyond30Seconds:true,configuredBackgroundCeiling:true,originalIDCollected:true,longWaitCancelled:true,nativeScopesReleased:true,syntheticModelRequests:22,scenarios:6,liveServiceCalls:0};
}

export async function acceptUnifiedWait(session,runtime,nativeStream,cwd,profile) {
 assert.ok(profile);const preferenceFile=join(profile,'openai-compatibility-unified.json');
 const configure=async ceiling=>{
  const before=session.agent.getToolGatewayInfo();
  await session.prompt(`/openai-tools background-wait ${ceiling}`);
  assert.deepEqual(JSON.parse(await readFile(preferenceFile,'utf8')),{version:1,maxBackgroundWaitMs:ceiling});
  const after=session.agent.getToolGatewayInfo();assert.equal(after.activeScopes,before.activeScopes);assert.equal(after.drainingScopes,before.drainingScopes);
 };
 const folder=await mkdtemp(join(cwd,'unified wait ')),before=session.model,active=[...session.getActiveToolNames()].sort(),rows=[],invocations=[],failures=[];
 const descriptors={stream:Object.getOwnPropertyDescriptor(session.agent,'streamFunction'),auth:Object.getOwnPropertyDescriptor(runtime,'getAuth'),check:Object.getOwnPropertyDescriptor(runtime,'checkAuth')};
 let cancelTimer,cancelStarted,armCancel=false,ends=[];
 const off=session.agent.subscribe(e=>{
  if(e.type==='tool_execution_end'&&e.toolName==='write_stdin')ends.push(structuredClone(e));
  if(armCancel&&e.type==='tool_execution_start'&&e.toolName==='write_stdin') {armCancel=false;cancelStarted=performance.now();cancelTimer=setTimeout(()=>session.agent.abort(),100);}
 });
 const restore=(object,key,value)=>value?Object.defineProperty(object,key,value):delete object[key];
 try {
  runtime.checkAuth=async provider=>['openai','openai-codex'].includes(provider);
  for(const provider of ['openai','openai-codex']) {
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);
   runtime.getAuth=async selected=>{assert.equal(typeof selected==='string'?selected:selected.provider,provider);return {auth:{apiKey:provider==='openai'?'synthetic-wait':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-wait'}})).toString('base64url')}.synthetic`}};};
   await session.setModel(model);assert.deepEqual([...session.getActiveToolNames()].sort(),active);
   let total=0,sequence=0;
   const invoke=async(name,args,cancel=false)=>{
    const id=`call_wait_${provider}_${sequence++}`,first=session.messages.length,payloads=[],payloadAborts=[];let requests=0;
    session.agent.streamFunction=(selected,context,options)=>nativeStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',async onPayload(body,m){const next=await options?.onPayload?.(body,m);payloads.push(structuredClone(next??body));payloadAborts.push(options?.signal?.aborted===true);return next;},fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init?.method,'POST');assert.ok(++requests<=2,'Do not retry fixture commands');total++;
     return responseEvents(requests===1?{type:'function_call',id:`fc_${id}`,call_id:id,name,arguments:JSON.stringify(args),status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic wait complete',annotations:[]}],status:'completed'});
    }});
    armCancel=cancel;ends=[];const started=performance.now();await session.prompt('Synthetic Unified wait acceptance');const ms=performance.now()-started;
    invocations.push({provider,name,cancel,requests,payloadAborts,ms});
    assert.equal(requests,cancel?1:2);
    // Native preparation can run for an already-aborted follow-up. It must not fetch.
    if(cancel){assert.ok(payloads.length===1||payloads.length===2);if(payloads.length===2)assert.equal(payloadAborts[1],true);assert.equal(armCancel,false);assert.ok(session.messages.slice(first).some(m=>m.role==='assistant'&&m.stopReason==='aborted'));assert.ok(ends.some(e=>e.isError));return {ms:performance.now()-cancelStarted};}
    assert.equal(payloads.length,2);
    const result=session.messages.slice(first).find(m=>m.role==='toolResult'&&m.toolName===name);assert.ok(result);const saved=JSON.stringify(result),value=readUnifiedOutcome(result);
    const call=payloads[1].input.find(t=>t.type==='function_call'&&t.call_id===id),output=payloads[1].input.find(t=>t.type==='function_call_output'&&t.call_id===id);
    assert.ok(call&&output);assert.deepEqual(JSON.parse(call.arguments),args);assert.equal(output.output,result.content[0].text);assert.equal(JSON.stringify(result),saved);
    return {value,ms};
   };
   const command=async(label,program)=>{const file=join(folder,`${provider}-${label}.cjs`);await writeFile(file,program,{flag:'wx'});const q=s=>`'${s.replaceAll("'","''")}'`;return process.platform==='win32'?`& ${q(process.execPath)} ${q(file)}; exit $LASTEXITCODE`:`${q(process.execPath)} ${q(file)}`;};
   const early=await invoke('exec_command',{cmd:await command('early',"setTimeout(()=>process.stdout.write('WAIT_EARLY\\n'),1500)"),yield_time_ms:0});
   assert.equal(early.value.running,false);assert.equal(early.value.exit_code,0);assert.match(early.value.output,/WAIT_EARLY/);
   const start=await invoke('exec_command',{cmd:await command('background',"process.stdin.resume();const expiry=setTimeout(()=>process.exit(19),90000);process.stdin.once('data',()=>setTimeout(()=>{clearTimeout(expiry);process.stdout.write('WAIT_BACKGROUND\\n');process.stdin.destroy()},35000))"),yield_time_ms:0});
   assert.equal(start.value.running,true);assert.equal(typeof start.value.session_id,"number");const id=start.value.session_id;
   const input=await invoke('write_stdin',{session_id:id,chars:'arm\n',yield_time_ms:0});assert.equal(input.value.running,true);assert.equal(input.value.session_id,id);assert.ok(input.ms>=200&&input.ms<5000);
   assert.equal(session.agent.getToolGatewayInfo().activeScopes,1);
   await configure(60000);const savedPreference=await readFile(preferenceFile);
   await session.prompt('/openai-tools background-wait 300001');assert.deepEqual(await readFile(preferenceFile),savedPreference);
   const background=await invoke('write_stdin',{session_id:id,yield_time_ms:300000});assert.equal(background.value.running,false);assert.equal(background.value.exit_code,0);assert.equal(background.value.session_id,undefined);assert.match(background.value.output,/WAIT_BACKGROUND/);
   const cancellable=await invoke('exec_command',{cmd:await command('cancel',"process.stdin.resume();setTimeout(()=>process.exit(19),90000)"),yield_time_ms:0});assert.equal(cancellable.value.running,true);
   await configure(300000);
   const cancelled=await invoke('write_stdin',{session_id:cancellable.value.session_id,yield_time_ms:300000},true);
   const info=session.agent.getToolGatewayInfo();assert.equal(info.activeScopes,0);assert.equal(info.drainingScopes,0);
   rows.push({api:model.api,requests:total,configuredCeilingMs:60000,invalidCeilingPreserved:true,preferenceChangePreservedJob:true,explicitInitialFloor:true,nonemptyFloor:true,backgroundCollectedOnce:true,originalID:true,cancelledLongWait:true,historyUnchanged:true,backgroundMs:background.ms,cancelMs:cancelled.ms,activeScopes:info.activeScopes,drainingScopes:info.drainingScopes});
  }
 } catch(e) {failures.push(e);} finally {
  clearTimeout(cancelTimer);armCancel=false;
  const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};
  await cleanup(()=>off());await cleanup(()=>restore(session.agent,'streamFunction',descriptors.stream));await cleanup(()=>restore(runtime,'getAuth',descriptors.auth));await cleanup(()=>session.setModel(before));await cleanup(()=>restore(runtime,'checkAuth',descriptors.check));await cleanup(()=>assert.deepEqual([...session.getActiveToolNames()].sort(),active));
  await writeFile(join(folder,'observations.json'),JSON.stringify({rows,invocations,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});
 }
 if(failures.length)throw new AggregateError(failures,'Native wait acceptance/restoration failed; preserve evidence.');return {...validateUnifiedWait(rows),rows};
}

/** Keep long-wait fixture history out of the scripted parent conversation. No compaction override. */
export async function acceptUnifiedWaitProfile(bundle){
 const profile=await mkdtemp(join(tmpdir(),'unified-wait-profile-'));
 for(const n of ['tmp','roaming','local','workspace'])await mkdir(join(profile,n));
 for(const n of ['gitconfig','npm-user','npm-global'])await writeFile(join(profile,n),'',{flag:'wx'});
 const env={HOME:profile,USERPROFILE:profile,APPDATA:join(profile,'roaming'),LOCALAPPDATA:join(profile,'local'),TEMP:join(profile,'tmp'),TMP:join(profile,'tmp'),PI_CODING_AGENT_DIR:profile,PI_OFFLINE:'1',PI_TELEMETRY:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(profile,'gitconfig'),npm_config_userconfig:join(profile,'npm-user'),npm_config_globalconfig:join(profile,'npm-global')};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','ComSpec','PATHEXT'])if(process.env[key]!==undefined)env[key]=process.env[key];
 await writeFile(join(profile,'started.json'),JSON.stringify({at:new Date().toISOString(),bundle:resolve(bundle),environmentKeys:Object.keys(env).sort(),credentialsInherited:false,compactionOverride:false})+'\n',{flag:'wx'});
 const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--installed-profile',resolve(bundle)],{env,encoding:null,timeout:180000,maxBuffer:8*1024*1024});
 for(const[name,bytes]of [['stdout',p.stdout],['stderr',p.stderr]])await writeFile(join(profile,name+'.log'),bytes??Buffer.alloc(0),{flag:'wx'});
 await writeFile(join(profile,'completed.json'),JSON.stringify({at:new Date().toISOString(),status:p.status,signal:p.signal,error:p.error?.message})+'\n',{flag:'wx'});
 assert.equal(p.error,undefined,'Preserve isolated native-wait fixture; no command replay');assert.equal(p.status,0,'Isolated native-wait fixture failed; inspect retained raw logs');
 const r=JSON.parse(p.stdout);assert.equal(r.state,'passed');assert.equal(r.networkAttempts,0);assert.equal(r.compactionEnabled,true);const {rows,...receipt}=r.nativeUnifiedWait;assert.deepEqual(validateUnifiedWait(rows),receipt);return receipt;
}

async function installedProfile(bundle){
 assert.equal(process.env.PI_OFFLINE,'1');const profile=process.env.PI_CODING_AGENT_DIR;assert.equal(profile,process.env.HOME);assert.equal(profile,process.env.USERPROFILE);assert.ok(profile);
 await verifyBundle(bundle);const cwd=join(profile,'workspace');let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw Error('External transport forbidden');};
 const root=join(bundle,'node_modules/@earendil-works/pi-coding-agent'),pkg=JSON.parse(await readFile(join(root,'package.json')));assert.equal(pkg.name,'@earendil-works/pi-coding-agent');assert.equal(pkg.version,'0.85.1');assert.ok(pkg.exports['.'].import.startsWith('./dist/'));
 const sdk=await import(pathToFileURL(join(root,pkg.exports['.'].import)).href),failures=[];let session,nativeUnifiedWait;
 try{
  const settings=sdk.SettingsManager.inMemory(),resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[join(bundle,'extensions/openai-compatibility/index.ts')],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
  const runtime=await sdk.ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});runtime.hasConfiguredAuth=()=>true;runtime.isUsingOAuth=id=>id==='openai-codex';runtime.getAuth=async()=>({auth:{apiKey:'synthetic-default-profile'}});runtime.checkAuth=async()=>true;
  ({session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model:runtime.getModel('openai','gpt-6-astra'),settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,'sessions')),resourceLoader:resources}));await session.bindExtensions({uiContext:{...session.extensionRunner.createContext().ui,notify(){}}});
  assert.equal(session.autoCompactionEnabled,true);await session.prompt('/openai-tools unified_exec on');await session.prompt('/openai-tools code_mode on');nativeUnifiedWait=await acceptUnifiedWait(session,runtime,session.agent.streamFunction,cwd,profile);assert.equal(networkAttempts,0);assert.equal(session.autoCompactionEnabled,true);
 }catch(e){failures.push(e);}finally{const cleanup=async f=>{try{await f();}catch(e){failures.push(e);}};if(session){await cleanup(()=>session.agent.abort());await cleanup(()=>session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}));await cleanup(()=>session.dispose());}}
 if(failures.length)throw new AggregateError(failures,'Isolated native-wait fixture failed; retain profile and logs');console.log(JSON.stringify({state:'passed',nativeUnifiedWait,networkAttempts,compactionEnabled:true}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--installed-profile');assert.equal(process.platform,'win32');await installedProfile(resolve(process.argv[3]));
}
