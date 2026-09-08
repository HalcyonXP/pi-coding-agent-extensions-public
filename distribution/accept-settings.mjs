// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine installed extension/native settings renderer with synthetic terminal input.
// No real terminal capture, user profile, credentials or model/service requests.
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyBundle} from "./lib.mjs";
import {verifyCuration} from "./curate-payload.mjs";
assert.ok(process.argv.length===3&&process.platform==="win32","Usage: node distribution/accept-settings.mjs <Windows bundle>");
const bundle=resolve(process.argv[2]),{manifest}=await verifyBundle(bundle);
await verifyCuration(bundle,manifest,await readFile(new URL("./payload-policy.json",import.meta.url)));
const profile=await mkdtemp(join(tmpdir(),"pi settings acceptance ")),cwd=join(profile,"workspace");await mkdir(cwd);
process.env.PI_CODING_AGENT_DIR=profile;process.env.PI_OFFLINE="1";process.env.PI_TELEMETRY="0";
let networkAttempts=0;const priorFetch=globalThis.fetch;
globalThis.fetch=async()=>{networkAttempts++;throw Error("Settings acceptance forbids network");};
const frames=[],capabilities=["imagegen","web_search","exec","wait","exec_command","write_stdin"];
const clean=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");
const capture=(name,panel)=>{const lines=panel.render(80).map(clean);assert.ok(lines.every(line=>line.length<160));frames.push({name,text:lines.join("\n")});return lines.join("\n");};
const until=async predicate=>{const end=performance.now()+10000;while(performance.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error("Settings interaction did not settle");};
try{
 const sdk=await import(pathToFileURL(join(bundle,"node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);sdk.initTheme("dark",false);
 for(const excluded of [false,true]){
  const settings=sdk.SettingsManager.inMemory(),resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[join(bundle,"extensions/openai-compatibility/index.ts")],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await resources.reload();assert.deepEqual(resources.getExtensions().errors,[]);
  const runtime=await sdk.ModelRuntime.create({authPath:join(profile,"auth.json"),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false});
  const {session}=await sdk.createAgentSession({cwd,agentDir:profile,modelRuntime:runtime,model:runtime.getModel("openai","gpt-6-astra"),settingsManager:settings,sessionManager:sdk.SessionManager.create(cwd,join(profile,"sessions")),resourceLoader:resources,excludeTools:excluded?capabilities:undefined});
  let drive;const notices=[];
  try{
   const ui=session.extensionRunner.createContext().ui;
   await session.bindExtensions({mode:"tui",uiContext:{...ui,notify:message=>notices.push(message),select:async()=>{throw Error("Old action picker used");},custom:async factory=>{
    let done=false;const panel=await factory({requestRender(){}},ui.theme,{},()=>{done=true;});
    try{assert.ok(panel.children.some(child=>child.constructor.name==="SettingsList"));await drive(panel);panel.handleInput("\x1b");assert.equal(done,true);}finally{panel.dispose?.();}
   }}});
   drive=async panel=>{
    const initial=capture(excluded?"fast-after-exclusions":"fast-before",panel);assert.match(initial,/→ Fast mode\s+(on|off)/);
    if(excluded){assert.match(initial,/→ Fast mode\s+on/);assert.match(initial,/Image generation\s+unavailable/);return;}
    panel.handleInput("\r");assert.match(capture("fast-applying",panel),/applying/);
    await until(()=>!panel.render(80).join("\n").includes("applying…"));assert.equal(JSON.parse(await readFile(join(profile,"openai-compatibility.json"),"utf8")).enabled,true);
    assert.match(capture("fast-saved",panel),/→ Fast mode\s+on/);
   };
   await session.prompt("/openai-tools fast");assert.equal(notices.length,0,"Menu changes stay inline, not notification spam");
   drive=async panel=>{
    const before=capture(excluded?"capabilities-excluded":"capabilities-before",panel);
    assert.match(before,/→ Image generation\s+(on|unavailable)/);
    if(excluded){assert.match(before,/excluded, conflicting or replaced/);panel.handleInput("\r");assert.ok(capabilities.every(name=>!session.getActiveToolNames().includes(name)));return;}
    panel.handleInput("\r");await until(()=>!panel.render(80).join("\n").includes("applying…"));assert.ok(!session.getActiveToolNames().includes("imagegen"));
    for(const char of "Unified")panel.handleInput(char);panel.handleInput("\r");await until(()=>!panel.render(80).join("\n").includes("applying…"));assert.ok(session.getActiveToolNames().includes("exec_command"));assert.match(capture("unified-search-stays-open",panel),/→ Unified exec\s+on/);
    for(let i=0;i<7;i++)panel.handleInput("\x7f");for(const char of "Code mode")panel.handleInput(char);panel.handleInput("\r");await until(()=>!panel.render(80).join("\n").includes("applying…"));assert.ok(session.getActiveToolNames().includes("exec"));assert.ok(session.getActiveToolNames().includes("wait"));assert.match(capture("code-enabled",panel),/→ Code mode\s+on/);
    for(let i=0;i<9;i++)panel.handleInput("\x7f");for(const char of "Web search")panel.handleInput(char);panel.handleInput("\r");await until(()=>!panel.render(80).join("\n").includes("applying…"));assert.ok(session.getActiveToolNames().includes("web_search"));assert.match(capture("web-enabled",panel),/→ Web search\s+on/);
   };
   await session.prompt("/openai-tools");assert.ok(session.getActiveToolNames().includes("read"));assert.ok(session.getActiveToolNames().includes("write"));assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,0);
   drive=async panel=>{
    assert.match(panel.render(80).map(clean).join("\n"),/→ Jobs/);panel.handleInput("\r");
    const view=capture(excluded?"jobs-after-exclusions":"jobs-inside-openai",panel);assert.match(view,/Unified exec jobs/);assert.match(view,/Refresh jobs/);assert.doesNotMatch(view,/Job 1/);
    panel.handleInput("\x1b");await until(()=>!panel.render(80).join("\n").includes("applying…"));assert.match(panel.render(80).map(clean).join("\n"),/→ Jobs/);
   };
   await session.prompt("/openai-tools jobs");assert.equal(notices.length,0,"Jobs navigation stays inside the OpenAI menu");
   await session.prompt("/openai-tools jobs status");assert.equal(notices.at(-1),"[]");
   await session.prompt("/openai-tools status");assert.match(notices.at(-1),/OpenAI capabilities/);
   assert.deepEqual(JSON.parse(await readFile(join(profile,"openai-compatibility-capabilities.json"),"utf8")),{version:1,capabilities:{imagegen:false,web_search:true,unified_exec:true,code_mode:true}});
   if(!excluded){
    const oldContext=session.extensionRunner.createContext();await session.reload();assert.throws(()=>oldContext.toolGatewayInfo);
    assert.ok(!session.getActiveToolNames().includes("imagegen"));for(const name of capabilities.filter(name=>name!=="imagegen"))assert.ok(session.getActiveToolNames().includes(name),`Saved capability restored: ${name}`);
    drive=async panel=>{const view=capture("capabilities-restored",panel);assert.match(view,/→ Image generation\s+off/);for(const name of ["Web search","Unified exec","Code mode"])assert.ok(new RegExp(`${name}\\s+on`).test(view));assert.match(view,/Saved for this Pi profile: off/);};
    await session.prompt("/openai-tools");assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,0);
   }
  }finally{await session.extensionRunner.emit("session_shutdown",{});session.dispose();}
 }
 assert.equal(networkAttempts,0);
 console.log(JSON.stringify({status:"passed",nativeSettingsList:true,syntheticTerminalInput:true,nativeTheme:"dark",normalAndExcludedContexts:true,savedFastPreference:true,savedCapabilityPreferences:true,restoredJobs:false,consolidatedJobs:true,noNotificationSpam:true,networkAttempts,frames}));
}finally{globalThis.fetch=priorFetch;}
