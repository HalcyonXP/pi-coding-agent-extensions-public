// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Separate actual-bundle cohorts: each owns a fresh pre-import SDK environment.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyBundle} from './lib.mjs';
import {verifyCuration} from './curate-payload.mjs';
import {isolatedEnvironment} from './isolated-environment.mjs';
const [input,cohort]=process.argv.slice(2);
assert.ok(process.argv.length===4&&process.platform==='win32'&&process.arch==='x64'&&['web','media','imagegen','web-profile'].includes(cohort),'Usage: node distribution/accept-web-media.mjs <Windows bundle> <web|media|imagegen|web-profile>');
const bundle=resolve(input),{manifest}=await verifyBundle(bundle);await verifyCuration(bundle,manifest,await readFile(new URL('./payload-policy.json',import.meta.url)));
const directory=await mkdtemp(join(tmpdir(),'pi Web media acceptance ')),home=join(directory,'home'),env=isolatedEnvironment(home),profile=env.PI_CODING_AGENT_DIR,cwd=join(home,'workspace');await mkdir(cwd);
for(const key of Object.keys(process.env))delete process.env[key];Object.assign(process.env,env);
let session,result,externalAttempts=0,fixture;const failures=[],priorFetch=globalThis.fetch;
globalThis.fetch=async()=>{externalAttempts++;throw Error('Installed Web/media acceptance forbids external requests');};
try{
 const {exerciseWebProjection,webProjectionTransport}=await import('./web-projection-scenarios.mjs');
 const {exerciseMediaInput,mediaInputTransport}=await import('./media-input-scenarios.mjs');
 const {exerciseImagegenProjection}=await import('./imagegen-projection-scenarios.mjs');
 const {exerciseWebProfile,webProfileTransport}=await import('./web-profile-scenarios.mjs');
 fixture=cohort==='web'?webProjectionTransport():cohort==='web-profile'?webProfileTransport():mediaInputTransport(cohort==='imagegen'?'projection':'edit');globalThis.fetch=fixture.fetch;
 const sdk=await import(pathToFileURL(join(bundle,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href),settings=sdk.SettingsManager.inMemory();
 const resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[join(bundle,'extensions/openai-compatibility/index.ts')],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
 const runtime=await sdk.ModelRuntime.create({authPath:join(profile,'auth.json'),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});runtime.hasConfiguredAuth=()=>true;runtime.isUsingOAuth=id=>id==='openai-codex';runtime.getAuth=async()=>({auth:{apiKey:'synthetic-installed-media'}});runtime.checkAuth=async()=>true;
 ({session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model:runtime.getModel('openai','gpt-6-astra'),settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,'sessions')),resourceLoader:resources}));
 await session.bindExtensions({uiContext:{...session.extensionRunner.createContext().ui,notify(message){fixture.state.notices?.push(message);}}});assert.equal(session.autoCompactionEnabled,true);
 await session.prompt('/openai-tools unified_exec on');await session.prompt('/openai-tools code_mode on');
 if(['web','web-profile'].includes(cohort))await session.prompt('/openai-tools web_search on');else await fixture.prepare(bundle);
 const stream=session.agent.streamFunction;
 result=cohort==='web'?await exerciseWebProjection(session,runtime,stream,cwd,resources,fixture):cohort==='web-profile'?await exerciseWebProfile(session,runtime,stream,cwd,profile,fixture):cohort==='imagegen'?await exerciseImagegenProjection(session,runtime,stream,cwd,resources,fixture):await exerciseMediaInput(session,runtime,stream,cwd,fixture);
 if(cohort==='media'){assert.equal(result.descriptorSafeImageInputs,true);assert.deepEqual(result.rows.map(row=>[row.api,row.descriptorSafeImageInputs]),[['openai-responses',true],['openai-codex-responses',true]]);}
 assert.equal(externalAttempts,0);assert.equal(fixture.state.externalAttempts,0);assert.equal(session.autoCompactionEnabled,true);
}catch(e){failures.push(e);}finally{
 const clean=async f=>{try{await f();}catch(e){failures.push(e);}};
 if(session){await clean(()=>session.agent.abort());await clean(()=>session.extensionRunner.emit({type:'session_shutdown',reason:'quit'}));await clean(()=>session.dispose());}
 globalThis.fetch=priorFetch;
 await writeFile(join(directory,'acceptance.json'),JSON.stringify({kind:'actual-bundle-native-web-media',cohort,bundleSource:manifest.sourceCommit,bundleManifestSha256:createHash('sha256').update(await readFile(join(bundle,'bundle.json'))).digest('hex'),profile,result,externalAttempts:externalAttempts+(fixture?.state.externalAttempts??0),failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+'\n',{flag:'wx'});
}
if(failures.length)throw new AggregateError(failures,'Installed Web/media cohort failed; preserve profile and receipts, no effect replay');
console.log(JSON.stringify({kind:'actual-bundle-native-web-media',cohort,bundleSource:manifest.sourceCommit,profile,externalAttempts:0,result}));
