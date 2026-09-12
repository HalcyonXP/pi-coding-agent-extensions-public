// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Separate cohort: uncertain receipts deliberately retain a quarantined native scope.
// Do not weaken the zero-scope requirements of successful notification cohorts.
import assert from 'node:assert/strict';
import{mkdtemp,mkdir,readFile,writeFile}from'node:fs/promises';
import{join,resolve}from'node:path';import{tmpdir}from'node:os';import{pathToFileURL,fileURLToPath}from'node:url';import{createHash}from'node:crypto';
import{verifyBundle}from'./lib.mjs';import{verifyCuration}from'./curate-payload.mjs';import{isolatedEnvironment}from'./isolated-environment.mjs';
import{assertNotificationAckReceipt}from'./notification-ack-contract.mjs';
export async function acceptNotificationAcknowledgements(input){
 assert.ok(process.platform==='win32'&&process.arch==='x64');
 const bundle=resolve(input),{manifest}=await verifyBundle(bundle);await verifyCuration(bundle,manifest,await readFile(new URL('./payload-policy.json',import.meta.url)));
 const directory=await mkdtemp(join(tmpdir(),'pi native acknowledgement ')),env=isolatedEnvironment(join(directory,'home'));
 for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
 const priorFetch=globalThis.fetch,errors=[],rows=[];let externalAttempts=0,receipt;
 globalThis.fetch=async()=>{externalAttempts++;throw Error('Notification acknowledgement acceptance forbids external requests');};
 try{
  const sdk=await import(pathToFileURL(join(bundle,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href),{exerciseNotificationAcknowledgement}=await import('./notification-acknowledgement.mjs');
  for(const provider of ['openai','openai-codex'])for(const mode of ['confirm','throw','invalid']){
   const profile=join(directory,provider+'-'+mode),cwd=join(profile,'workspace');await mkdir(cwd,{recursive:true});let session,runtime;const seams=[];
   try{
    const settings=sdk.SettingsManager.inMemory(),resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[join(bundle,'extensions/openai-compatibility/index.ts')],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
    runtime=await sdk.ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});for(const key of ['hasConfiguredAuth','isUsingOAuth','getAuth','checkAuth'])seams.push([key,Object.getOwnPropertyDescriptor(runtime,key)]);
    runtime.hasConfiguredAuth=()=>true;runtime.isUsingOAuth=id=>id==='openai-codex';runtime.checkAuth=async()=>true;runtime.getAuth=async()=>({auth:{apiKey:`synthetic.${Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-acknowledgement'}})).toString('base64url')}.synthetic`}});
    ({session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model:runtime.getModel(provider,'gpt-6-astra'),settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,'sessions')),resourceLoader:resources}));
    await session.bindExtensions({uiContext:{...session.extensionRunner.createContext().ui,notify(){}}});await session.prompt('/openai-tools unified_exec on');await session.prompt('/openai-tools code_mode on');
    rows.push(await exerciseNotificationAcknowledgement(session,session.agent.streamFunction,cwd,mode));
   }catch(e){errors.push(e);}finally{
    const clean=async f=>{try{await f();}catch(e){errors.push(e);}};
    if(session){await clean(()=>session.agent.abort());await clean(()=>session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}));await clean(()=>session.dispose());const info=session.agent.getToolGatewayInfo();await clean(()=>assert.equal(info.activeScopes,0));await clean(()=>assert.equal(info.drainingScopes,mode==='confirm'?0:1));}
    for(const[key,d]of seams)await clean(()=>d?Object.defineProperty(runtime,key,d):delete runtime[key]);
   }
   if(errors.length)throw new AggregateError(errors.splice(0),'Native acknowledgement case or cleanup failed');
  }
  receipt={kind:'actual-bundle-native-notification-ack',bundleSource:manifest.sourceCommit,profile:directory,externalAttempts,result:{nativeAcknowledgementBoundary:true,syntheticModelRequests:18,scenarios:6,quarantinedScopes:4,liveServiceCalls:0,rows}};
  assertNotificationAckReceipt(receipt,manifest.sourceCommit);
 }catch(e){errors.push(e);}finally{
  globalThis.fetch=priorFetch;const clean=async f=>{try{await f();}catch(e){errors.push(e);}};
  await clean(()=>assert.equal(externalAttempts,0));await clean(async()=>assert.deepEqual((await verifyBundle(bundle)).manifest,manifest,'Actual bundle changed during acknowledgement cohort'));
  await clean(async()=>writeFile(join(directory,'acceptance.json'),JSON.stringify({bundleSource:manifest.sourceCommit,bundleManifestSha256:createHash('sha256').update(await readFile(join(bundle,'bundle.json'))).digest('hex'),directory,rows,externalAttempts,errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack,errors:e.errors?.map(x=>({name:x.name,message:x.message,stack:x.stack}))}))},null,2)+'\n',{flag:'wx'}));
 }
 if(errors.length)throw new AggregateError(errors,'Actual acknowledgement cohort failed; preserve profiles and receipts, no replay');
 console.log(JSON.stringify(receipt));return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,3,'Usage: node distribution/accept-notification-ack.mjs <Windows bundle>');await acceptNotificationAcknowledgements(process.argv[2]);}
