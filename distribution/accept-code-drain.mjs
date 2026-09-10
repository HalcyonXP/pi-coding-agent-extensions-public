// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Real native handlers and contained cells; only model/auth and an owned resource closer are synthetic.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyBundle} from './lib.mjs';
import {responseEvents} from './accept-code-transport.mjs';
async function installedProfile(bundle){
assert.equal(process.env.PI_OFFLINE,'1');assert.equal(process.env.HOME,process.env.USERPROFILE);assert.equal(process.env.PI_CODING_AGENT_DIR,process.env.HOME);assert.ok(process.env.HOME);
assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');await verifyBundle(bundle);
const {CodeCells}=await import(pathToFileURL(join(bundle,'extensions/openai-compatibility/runtime/cells.mjs')).href);
const folder=await mkdtemp(join(tmpdir(),'native-code-drain-'));
let networkAttempts=0; const fetchBefore=globalThis.fetch;
globalThis.fetch=async()=>{networkAttempts++;throw Error('External transport forbidden');};
const agentDirBefore=process.env.PI_CODING_AGENT_DIR;
const barrier=()=>{let release;const promise=new Promise(r=>{release=r;});return{promise,release};};
const within=async(p,ms,label)=>{let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label)),ms);})]);}finally{clearTimeout(timer);}};
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}],details:value});
const rows=[],failures=[];
try{
 const sdkRoot=join(bundle,'node_modules/@earendil-works/pi-coding-agent');
 const pkg=JSON.parse(await readFile(join(sdkRoot,'package.json')));assert.equal(pkg.name,'@earendil-works/pi-coding-agent');assert.equal(pkg.version,'0.85.1');assert.ok(pkg.exports['.'].import.startsWith('./dist/'));
 const sdk=await import(pathToFileURL(join(sdkRoot,pkg.exports['.'].import)).href);
 cohorts: for(const provider of ['openai','openai-codex'])for(const mode of ['context-revoke','manager-close']){
  const profile=join(folder,`${provider}-${mode}`),cwd=join(profile,'workspace');await mkdir(cwd,{recursive:true});process.env.PI_CODING_AGENT_DIR=profile;
  let session,runtime,cells,scope,originalStream,off,closing,waitingPrompt,closeCalls=0,requests=0;
  const cleanup=barrier(),cleanupEntered=barrier(),waitEntered=barrier(),returned=barrier(),outcomes=[],events=[],descriptors={};
  const restore=(object,key,descriptor)=>{if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];};
  try{
   const settings=sdk.SettingsManager.inMemory();
   const resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,extensionFactories:[pi=>{
    pi.registerTool({name:'drain_probe',label:'Drain fixture',description:'Owned offline cleanup barrier',parameters:{type:'object',properties:{},additionalProperties:false},async execute(_id,_args,_signal,_update,ctx){
     assert.equal(ctx.tools.origin,'nested');scope=ctx.tools.scope;assert.ok(scope);scope.ownResource(async()=>{closeCalls++;cleanupEntered.release();await cleanup.promise;});return text({value:'native target finalized'});
    }});
    pi.registerTool({name:'fixture_exec',label:'Cell fixture',description:'Offline native cell start',parameters:{type:'object',properties:{},additionalProperties:false},async execute(_id,_args,_signal,_update,ctx){
     assert.equal(ctx.tools.origin,'direct');assert.equal(cells,undefined);cells=new CodeCells({owner:ctx.sessionManager,contextSignal:ctx.tools.contextSignal});
     const result=await cells.exec({owner:ctx.sessionManager,invocation:ctx.tools,code:'yield_control();await tools.drain_probe({});text("must not leak after cancellation");',tools:['drain_probe'],yield_time_ms:10000});outcomes.push(result);return text(result);
    }});
    pi.registerTool({name:'fixture_wait',label:'Wait fixture',description:'Offline native draining collector',parameters:{type:'object',properties:{cell_id:{type:'string'}},required:['cell_id'],additionalProperties:false},async execute(_id,args,_signal,_update,ctx){
     assert.equal(ctx.tools.origin,'direct');const collecting=cells.wait({owner:ctx.sessionManager,invocation:ctx.tools,cell_id:args.cell_id,yield_time_ms:30000});waitEntered.release();
     const result=await collecting;outcomes.push(result);returned.release(result);return text(result);
    }});
   }]});await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
   runtime=await sdk.ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
   for(const key of ['hasConfiguredAuth','isUsingOAuth','getAuth','checkAuth'])descriptors[key]=Object.getOwnPropertyDescriptor(runtime,key);
   runtime.hasConfiguredAuth=()=>true;runtime.isUsingOAuth=id=>id==='openai-codex';runtime.checkAuth=async id=>['openai','openai-codex'].includes(id);
   runtime.getAuth=async()=>({auth:{apiKey:provider==='openai'?'synthetic-drain':`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-drain'}})).toString('base64url')}.synthetic`}});
   const model=runtime.getModel(provider,'gpt-6-astra');assert.ok(model);
   ({session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model,settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,'sessions')),resourceLoader:resources}));
   await session.bindExtensions({uiContext:{...session.extensionRunner.createContext().ui,notify(){}}});assert.equal(session.autoCompactionEnabled,true);
   off=session.agent.subscribe(e=>{if(e.type==='tool_execution_end')events.push(structuredClone(e));});originalStream=session.agent.streamFunction;descriptors.stream=Object.getOwnPropertyDescriptor(session.agent,'streamFunction');
   const invoke=(name,args)=>{let stageRequests=0;const id=`call_${provider}_${mode}_${name}`;
    session.agent.streamFunction=(selected,context,options)=>originalStream(selected,context,{...options,transport:'sse',maxRetries:0,cacheRetention:'none',fetch:async(url,init)=>{
     assert.equal(String(url),provider==='openai'?'https://api.openai.com/v1/responses':'https://chatgpt.com/backend-api/codex/responses');assert.equal(init.method,'POST');assert.ok(++stageRequests<=2,'No command replay');requests++;
     return responseEvents(stageRequests===1?{type:'function_call',id:`fc_${id}`,call_id:id,name,arguments:JSON.stringify(args),status:'completed'}:{type:'message',id:`msg_${id}`,role:'assistant',content:[{type:'output_text',text:'Synthetic drain fixture done',annotations:[]}],status:'completed'});
    }});return session.prompt('Offline native draining collector acceptance');
   };
   await invoke('fixture_exec',{});assert.equal(requests,2);assert.equal(outcomes[0].status,'running');
   await within(cleanupEntered.promise,10000,'Native cleanup did not begin');assert.equal(scope.signal.aborted,true);assert.equal(closeCalls,1);
   assert.equal(session.agent.getToolGatewayInfo().drainingScopes,1);
   waitingPrompt=invoke('fixture_wait',{cell_id:outcomes[0].cell_id});await within(waitEntered.promise,10000,'Native wait handler not entered');
   const started=performance.now();if(mode==='context-revoke')session.agent.abort();else closing=cells.close();
   const result=await within(returned.promise,2000,'Cancelled native collector remained asleep');
   assert.deepEqual(result,{cell_id:outcomes[0].cell_id,status:'draining',output:[]});
   assert.equal(scope.signal.aborted,true);assert.equal(closeCalls,1);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,1);
   const collectorMs=performance.now()-started;await within(waitingPrompt,10000,'Native prompt did not settle');
   assert.equal(requests,mode==='context-revoke'?3:4);
   const target=events.filter(e=>e.toolName==='drain_probe');assert.equal(target.length,1);assert.equal(target[0].scopeId,scope.id);assert.equal(target[0].isError,false);assert.deepEqual(target[0].result,text({value:'native target finalized'}));
   cleanup.release();await within(cells.close(),2000,'Native closure not confirmed');
   assert.equal(session.autoCompactionEnabled,true);assert.equal(closeCalls,1);assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,0);
   rows.push({api:model.api,mode,requests,collectorMs,status:result.status,output:result.output,nativeCloserCalls:closeCalls,drainRetainedUntilRelease:true,nativeTargetFinalized:true,activeScopes:0,drainingScopes:0});
  }catch(e){failures.push(e);}finally{
   cleanup.release();const restoreSafely=async f=>{try{await f();}catch(e){failures.push(e);}};
   if(cells)await restoreSafely(()=>cells.close());if(waitingPrompt)await restoreSafely(()=>waitingPrompt);if(closing)await restoreSafely(()=>closing);
   if(off)await restoreSafely(()=>off());if(session){await restoreSafely(()=>{restore(session.agent,'streamFunction',descriptors.stream);});await restoreSafely(()=>session.agent.abort());await restoreSafely(()=>session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}));await restoreSafely(()=>session.dispose());}
   if(runtime)for(const key of ['hasConfiguredAuth','isUsingOAuth','getAuth','checkAuth'])await restoreSafely(()=>restore(runtime,key,descriptors[key]));
  }
  if(failures.length)break cohorts;
 }
 assert.equal(rows.length,4);assert.equal(networkAttempts,0);
} catch(e){failures.push(e);}finally{globalThis.fetch=fetchBefore;process.env.PI_CODING_AGENT_DIR=agentDirBefore;}
await writeFile(join(folder,'result.json'),JSON.stringify({rows,networkAttempts,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2),{flag:'wx'});
if(failures.length)throw new AggregateError(failures,'Native draining collector acceptance failed; retain profile and raw logs');
console.log(JSON.stringify({state:'passed',nativeCodeDrain:validateCodeDrain(rows),rows,networkAttempts,compactionEnabled:true}));
}

export function validateCodeDrain(rows){
 assert.ok(Array.isArray(rows));assert.equal(rows.length,4);
 const order=['openai-responses','openai-codex-responses'].flatMap(api=>['context-revoke','manager-close'].map(mode=>({api,mode})));
 for(const [i,r]of rows.entries()){
  assert.equal(r.api,order[i].api);assert.equal(r.mode,order[i].mode);assert.equal(r.requests,r.mode==='context-revoke'?3:4);
  assert.equal(typeof r.collectorMs,'number');assert.ok(Number.isFinite(r.collectorMs)&&r.collectorMs>=0&&r.collectorMs<2000);
  assert.equal(r.status,'draining');assert.deepEqual(r.output,[]);assert.equal(r.nativeCloserCalls,1);
  for(const k of ['drainRetainedUntilRelease','nativeTargetFinalized'])assert.equal(r[k],true);
  assert.equal(r.activeScopes,0);assert.equal(r.drainingScopes,0);
 }
 return{cancelledCollectorAwakened:true,pendingDrainRetained:true,nativeCloserOnce:true,nativeTargetFinalized:true,nativeScopesReleased:true,syntheticModelRequests:14,scenarios:4,liveServiceCalls:0};
}

export async function acceptCodeDrainProfile(bundle){
 const profile=await mkdtemp(join(tmpdir(),'code-drain-profile-'));
 for(const n of ['tmp','roaming','local','workspace'])await mkdir(join(profile,n));
 for(const n of ['gitconfig','npm-user','npm-global'])await writeFile(join(profile,n),'',{flag:'wx'});
 const env={HOME:profile,USERPROFILE:profile,APPDATA:join(profile,'roaming'),LOCALAPPDATA:join(profile,'local'),TEMP:join(profile,'tmp'),TMP:join(profile,'tmp'),PI_CODING_AGENT_DIR:profile,PI_OFFLINE:'1',PI_TELEMETRY:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:join(profile,'gitconfig'),npm_config_userconfig:join(profile,'npm-user'),npm_config_globalconfig:join(profile,'npm-global')};
 for(const key of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','ComSpec','PATHEXT'])if(process.env[key]!==undefined)env[key]=process.env[key];
 await writeFile(join(profile,'started.json'),JSON.stringify({at:new Date().toISOString(),bundle:resolve(bundle),environmentKeys:Object.keys(env).sort(),credentialsInherited:false,compactionOverride:false})+'\n',{flag:'wx'});
 const p=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--installed-profile',resolve(bundle)],{env,encoding:null,timeout:120000,maxBuffer:8*1024*1024});
 for(const[name,bytes]of [['stdout',p.stdout],['stderr',p.stderr]])await writeFile(join(profile,name+'.log'),bytes??Buffer.alloc(0),{flag:'wx'});
 await writeFile(join(profile,'completed.json'),JSON.stringify({at:new Date().toISOString(),status:p.status,signal:p.signal,error:p.error?.message})+'\n',{flag:'wx'});
 assert.equal(p.error,undefined,'Preserve isolated native-drain fixture; no command replay');assert.equal(p.status,0,'Isolated native-drain fixture failed; inspect retained raw logs');
 const r=JSON.parse(p.stdout);assert.equal(r.state,'passed');assert.equal(r.networkAttempts,0);assert.equal(r.compactionEnabled,true);assert.deepEqual(r.nativeCodeDrain,validateCodeDrain(r.rows));return r.nativeCodeDrain;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,4);assert.equal(process.argv[2],'--installed-profile');assert.equal(process.platform,'win32');await installedProfile(resolve(process.argv[3]));
}
