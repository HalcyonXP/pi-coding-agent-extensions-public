// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Shared native settings scenarios. Callers own pre-import isolation and provenance.
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {loadPollingPresentation,pollingPresentationFrames} from "./polling-presentation.mjs";
import {readableCodeFrames} from "./code-result-presentation.mjs";
import {unifiedOutputFrames,validateAllOutputFrames} from "./unified-output-presentation.mjs";
export function validateWaitSettings(result){
 for(const key of ["savedCeiling","restoredCeiling","failedSaveUnchanged","invalidFilePreserved","exclusionsPreserved"])assert.equal(result[key],true);
 assert.deepEqual(result.frames.map(f=>f.name),["wait-before","wait-saved","wait-restored","wait-save-failed","wait-invalid","wait-excluded","wait-excluded-saved"]);
 for(const f of result.frames)assert.ok(typeof f.text==="string"&&f.text.trim());
 for(const [index,value]of [[0,300000],[1,5000],[2,55001],[3,55001],[5,55001],[6,60000]])assert.match(result.frames[index].text,new RegExp(`→ Background wait ceiling\\s+${value}\\b`));
 assert.match(result.frames[1].text,/Background wait ceiling: 5000 ms/);
 assert.match(result.frames[3].text,/Change failed:/);assert.match(result.frames[4].text,/→ Background wait ceiling\s+unavailable/);
 return true;
}
export async function exerciseSettings(sdk,bundle,profile,cwd,extensionPath){
const failures=[],waitFrames=[];let completed=false;
const frames=[],codeFrames=[],unifiedFrames=[],capabilities=["imagegen","web_search","exec","wait","exec_command","write_stdin"];
const clean=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"");
const capture=(name,panel)=>{const lines=panel.render(80).map(clean);assert.ok(lines.every(line=>line.length<160));frames.push({name,text:lines.join("\n")});return lines.join("\n");};
const until=async predicate=>{const end=performance.now()+10000;while(performance.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error("Settings interaction did not settle");};
const waitFile=join(profile,"openai-compatibility-unified.json");
const captureWait=(name,panel)=>{const text=panel.render(80).map(clean).join("\n");waitFrames.push({name,text});return text;};
try{
sdk.initTheme("dark",false);
 const pollingNative=await loadPollingPresentation(bundle,sdk);
 for(const excluded of [false,true]){
  const settings=sdk.SettingsManager.inMemory(),resources=new sdk.DefaultResourceLoader({cwd,agentDir:profile,settingsManager:settings,additionalExtensionPaths:[extensionPath],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
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
   if(!excluded)frames.push(...await pollingPresentationFrames(session,pollingNative));
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
    codeFrames.push(...await readableCodeFrames(session,pollingNative));
    unifiedFrames.push(...await unifiedOutputFrames(session,pollingNative));
   }
   const fastBefore=await readFile(join(profile,"openai-compatibility.json")),capabilitiesBefore=await readFile(join(profile,"openai-compatibility-capabilities.json"));
   drive=async panel=>{
    for(const char of "Background wait")panel.handleInput(char);
    assert.match(captureWait(excluded?"wait-excluded":"wait-before",panel),new RegExp(`→ Background wait ceiling\\s+${excluded?55001:300000}`));
    panel.handleInput("\r");await until(()=>!panel.render(80).join("\n").includes("applying…"));
    assert.match(captureWait(excluded?"wait-excluded-saved":"wait-saved",panel),new RegExp(`→ Background wait ceiling\\s+${excluded?60000:5000}`));
    assert.equal(JSON.parse(await readFile(waitFile,"utf8")).maxBackgroundWaitMs,excluded?60000:5000);
   };
   await session.prompt("/openai-tools");
   if(excluded)assert.ok(capabilities.every(name=>!session.getActiveToolNames().includes(name)));
   else{
    await session.prompt("/openai-tools background-wait 55001");const saved=await readFile(waitFile);
    await session.reload();
    drive=async panel=>{
     for(const char of "Background wait")panel.handleInput(char);
     assert.match(captureWait("wait-restored",panel),/→ Background wait ceiling\s+55001/);
     await writeFile(waitFile,"invalid preserved fixture");
     panel.handleInput("\r");await until(()=>!panel.render(80).join("\n").includes("applying…"));
     assert.match(captureWait("wait-save-failed",panel),/Change failed:/);
     assert.equal(await readFile(waitFile,"utf8"),"invalid preserved fixture");
    };
    await session.prompt("/openai-tools");await session.reload();
    assert.ok(!session.getActiveToolNames().includes("exec_command"));assert.ok(session.getActiveToolNames().includes("exec"));assert.ok(session.getActiveToolNames().includes("web_search"));
    drive=async panel=>{for(const char of "Background wait")panel.handleInput(char);assert.match(captureWait("wait-invalid",panel),/→ Background wait ceiling\s+unavailable/);panel.handleInput("\r");};
    await session.prompt("/openai-tools");assert.equal(await readFile(waitFile,"utf8"),"invalid preserved fixture");
    await session.prompt("/openai-tools jobs status");assert.equal(notices.at(-1),"[]");
    await writeFile(waitFile,saved); // Restore only this successfully asserted, owned fixture.
   }
   assert.deepEqual(await readFile(join(profile,"openai-compatibility.json")),fastBefore);assert.deepEqual(await readFile(join(profile,"openai-compatibility-capabilities.json")),capabilitiesBefore);
  }catch(error){failures.push(error);}finally{
   for(const close of [()=>session.extensionRunner.emit({type:"session_shutdown",reason:"quit"}),()=>session.dispose()])try{await close();}catch(error){failures.push(error);}
  }
  if(failures.length)throw new AggregateError(failures,"Native settings scenario/cleanup failed; preserve evidence");
 }
 frames.push(...codeFrames,...unifiedFrames);validateAllOutputFrames(frames);
 const waitSettings={savedCeiling:true,restoredCeiling:true,failedSaveUnchanged:true,invalidFilePreserved:true,exclusionsPreserved:true,frames:waitFrames};validateWaitSettings(waitSettings);completed=true;
 return {status:"passed",waitSettings,nativeSettingsList:true,syntheticTerminalInput:true,nativeTheme:"dark",normalAndExcludedContexts:true,savedFastPreference:true,savedCapabilityPreferences:true,restoredJobs:false,consolidatedJobs:true,noNotificationSpam:true,quietPollingPresentation:true,compactLocalJobPresentation:true,readableCodePresentation:true,nativeUnifiedOutputPresentation:true,frames};
}catch(error){if(!failures.includes(error))failures.push(error);throw error;}finally{
 try{await writeFile(join(profile,"settings-observations.json"),JSON.stringify({completed,frames,waitFrames,failures:failures.map(e=>({name:e.name,message:e.message,stack:e.stack}))},null,2)+"\n",{flag:"wx"});}catch(error){throw new AggregateError([...failures,error],"Settings scenario/evidence capture failed");}
}
}
