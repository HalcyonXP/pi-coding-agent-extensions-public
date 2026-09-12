// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Each actual-bundle cohort owns a fresh pre-import SDK environment.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyBundle} from './lib.mjs';
import {verifyCuration} from './curate-payload.mjs';
import {isolatedEnvironment} from './isolated-environment.mjs';
import {assertNativeContextResult,assertNativeContextReceipt} from './native-context-contract.mjs';
const [input,cohort]=process.argv.slice(2);
assert.ok(process.argv.length===4&&process.platform==='win32'&&process.arch==='x64'&&['context','notifications'].includes(cohort),'Usage: node distribution/accept-native-context.mjs <Windows bundle> <context|notifications>');
const bundle=resolve(input),{manifest}=await verifyBundle(bundle);await verifyCuration(bundle,manifest,await readFile(new URL('./payload-policy.json',import.meta.url)));
const directory=await mkdtemp(join(tmpdir(),'pi native context acceptance ')),env=isolatedEnvironment(join(directory,'home')),profile=env.PI_CODING_AGENT_DIR,cwd=join(directory,'workspace');await mkdir(cwd);
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
if(cohort==='context')await writeFile(join(profile,'openai-compatibility-web.json'),JSON.stringify({version:1,profile:'experimental-context'})+'\n',{flag:'wx'});
let session,runtime,fixture,result,externalAttempts=0;const errors=[],seams=[],priorFetch=globalThis.fetch;
globalThis.fetch=async()=>{externalAttempts++;throw Error('Native context acceptance forbids external requests');};
try{
 const {webContextTransport,exerciseWebContext}=await import('./web-context-scenarios.mjs');const {exerciseNativeNotifications}=await import('./notification-scenarios.mjs');
 if(cohort==='context'){fixture=webContextTransport();globalThis.fetch=fixture.fetch;}
 const sdk=await import(pathToFileURL(join(bundle,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href),settings=sdk.SettingsManager.inMemory();
 const resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[join(bundle,'extensions/openai-compatibility/index.ts')],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
 runtime=await sdk.ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});for(const key of ['hasConfiguredAuth','isUsingOAuth','getAuth','checkAuth'])seams.push([key,Object.getOwnPropertyDescriptor(runtime,key)]);
 runtime.hasConfiguredAuth=()=>true;runtime.isUsingOAuth=id=>id==='openai-codex';runtime.getAuth=async()=>({auth:{apiKey:'synthetic-native-context-setup'}});runtime.checkAuth=async()=>true;
 ({session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model:runtime.getModel('openai','gpt-6-astra'),settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,'sessions')),resourceLoader:resources}));
 await session.bindExtensions({uiContext:{...session.extensionRunner.createContext().ui,notify(){}}});assert.equal(session.autoCompactionEnabled,true);
 if(cohort==='context'){await session.prompt('/openai-tools web_search on');result=await exerciseWebContext(session,runtime,session.agent.streamFunction,cwd,fixture);}
 else{await session.prompt('/openai-tools unified_exec on');await session.prompt('/openai-tools code_mode on');const {loadNotificationPresentation}=await import('./notification-presentation.mjs');const active=await exerciseNativeNotifications(session,runtime,session.agent.streamFunction,cwd,await loadNotificationPresentation(bundle,sdk));const {exerciseNotificationLifecycle}=await import('./notification-lifecycle.mjs');const lifecycle=await exerciseNotificationLifecycle(session,runtime,session.agent.streamFunction,cwd);result={...active,syntheticModelRequests:active.syntheticModelRequests+lifecycle.syntheticModelRequests,scenarios:active.scenarios+lifecycle.scenarios,lifecycle};}
 assert.equal(externalAttempts+(fixture?.state.externalAttempts??0),0);assert.equal(session.autoCompactionEnabled,true);assertNativeContextResult(cohort,result);
}catch(e){errors.push(e);}finally{
 const clean=async f=>{try{await f();}catch(e){errors.push(e);}};
 if(session){await clean(()=>session.agent.abort());await clean(()=>session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}));await clean(()=>session.dispose());}
 for(const[key,descriptor]of seams)await clean(()=>descriptor?Object.defineProperty(runtime,key,descriptor):delete runtime[key]);globalThis.fetch=priorFetch;
 await clean(async()=>assert.deepEqual((await verifyBundle(bundle)).manifest,manifest,'Actual bundle changed during execution'));
 await clean(async()=>writeFile(join(directory,'acceptance.json'),JSON.stringify({kind:'actual-bundle-native-context',cohort,bundleSource:manifest.sourceCommit,bundleManifestSha256:createHash('sha256').update(await readFile(join(bundle,'bundle.json'))).digest('hex'),profile,result,externalAttempts:externalAttempts+(fixture?.state.externalAttempts??0),errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'}));
}
if(errors.length)throw new AggregateError(errors,'Installed native context cohort failed; preserve profiles and receipts, no effect replay');
const receipt={kind:'actual-bundle-native-context',cohort,bundleSource:manifest.sourceCommit,profile,externalAttempts:0,result};assertNativeContextReceipt(receipt,{source:manifest.sourceCommit,cohort});console.log(JSON.stringify(receipt));
