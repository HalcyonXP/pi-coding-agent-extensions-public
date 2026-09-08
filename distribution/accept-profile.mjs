// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine bundled CLI/RPC and actual installer/rollback. No model/service requests.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {createInterface} from "node:readline";
import {mkdtemp,readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {verifyBundle,run,sha256} from "./lib.mjs";
import {verifyCuration} from "./curate-payload.mjs";
import {validatePollingFrames} from "./polling-presentation.mjs";
assert.ok(process.argv.length===3&&process.platform==="win32","Usage: node distribution/accept-profile.mjs <Windows bundle>");
const bundle=resolve(process.argv[2]),{manifest}=await verifyBundle(bundle);
await verifyCuration(bundle,manifest,await readFile(new URL("./payload-policy.json",import.meta.url)));
const guide=await readFile(join(bundle,"docs","openai-integration","PRIVATE-RELEASE.md"),"utf8");assert.match(guide,/0\.3\.0-private\.1/);assert.match(guide,/--rollback/);assert.match(await readFile(join(bundle,"docs","openai-integration","FINAL-ACCEPTANCE.md"),"utf8"),/Explicit supported surface and deviations/);
assert.match(await readFile(join(bundle,"docs","openai-integration","RELEASE-CONTRACT.md"),"utf8"),/download-pins-matched-not-installed/);
for(const path of ["distribution/LICENSE","distribution/NOTICE","docs/openai-integration/LICENSE","docs/openai-integration/NOTICE"])assert.deepEqual(await readFile(join(bundle,path)),await readFile(new URL("../"+path,import.meta.url)),"Installed scoped license/notice must match canonical source");
assert.equal(existsSync(join(bundle,"distribution","verify-download.mjs")),false,"Pre-execution verifier must come from independently trusted source, not the unverified bundle");
const directory=await mkdtemp(join(tmpdir(),"pi profile acceptance ")),profile=join(directory,"isolated profile"),installer=join(bundle,"distribution","install.mjs"),launcher=join(bundle,"distribution","launch.mjs");
const env={...process.env,PI_OFFLINE:"1",PI_TELEMETRY:"0"};
run(process.execPath,[installer,"--create",profile],{env});assert.throws(()=>run(process.execPath,[installer,"--create",profile],{env}),/existing profile/);
const originals=join(profile,"workspace","preserved-originals");await mkdir(originals);await writeFile(join(originals,"original.bin"),Buffer.from([1,2,3,4]));await writeFile(join(profile,"auth.json"),"{}\n");
const authBefore=sha256(await readFile(join(profile,"auth.json"))),originalBefore=sha256(await readFile(join(originals,"original.bin")));
async function cli(rolledBack,restarted=false){
 const child=spawn(process.execPath,[launcher,"--profile",profile,"--mode","rpc","--provider","openai","--model","gpt-6-astra"],{env,stdio:["pipe","pipe","pipe"],windowsHide:true});
 const frames=[];let stderr="";child.stderr.on("data",bytes=>{stderr+=bytes;if(stderr.length>65536)child.kill();});
 const input=createInterface({input:child.stdout});input.on("line",line=>{try{frames.push(JSON.parse(line));}catch{stderr+=line;}});
 let n=0;const wait=async predicate=>{const deadline=performance.now()+30000;while(performance.now()<deadline){const value=frames.find(predicate);if(value)return value;if(child.exitCode!==null)throw Error(`CLI exited: ${stderr}`);await new Promise(r=>setTimeout(r,25));}throw Error(`RPC deadline: ${stderr}`);};
 const command=async value=>{const id=String(++n);child.stdin.write(JSON.stringify({...value,id})+"\n");const response=await wait(f=>f.type==="response"&&f.id===id);assert.equal(response.success,true,JSON.stringify(response));return response;};
 const prompt=async message=>{const before=frames.length;await command({type:"prompt",message});await wait(f=>frames.indexOf(f)>=before&&f.type==="extension_ui_request"&&f.method==="notify");return frames.slice(before).filter(f=>f.type==="extension_ui_request"&&f.method==="notify").map(f=>f.message).join("\n");};
 try{
  const state=await command({type:"get_state"});assert.equal(state.data.model.id,"gpt-6-astra");
  const commands=await command({type:"get_commands"});assert.ok(commands.data.commands.some(c=>c.name==="openai-tools"),"Common OpenAI command retained");assert.ok(!commands.data.commands.some(c=>["fast","openai-jobs"].includes(c.name)),"No redundant standalone Fast/jobs commands");
  assert.match(await prompt(rolledBack?"/openai-tools fast status":"/openai-tools fast on"),/Fast mode: ON/,"Fast preference persists across native CLI restart and rollback");
  const status=await prompt("/openai-tools status");assert.match(status,/native preflight ready/);
  assert.throws(()=>run(process.execPath,[installer,"--rollback",profile],{env}),/EEXIST/,"Active native CLI ownership blocks rollback");
  if(!rolledBack&&!restarted){
   assert.match(status,/Image generation: enabled/);assert.match(await prompt("/openai-tools imagegen off"),/Image generation: unavailable\/disabled/);
   assert.match(await prompt("/openai-tools web_search on"),/Web search: enabled/);assert.match(await prompt("/openai-tools unified_exec on"),/Unified exec: enabled/);assert.match(await prompt("/openai-tools code_mode on"),/Code mode: enabled/);
  }else if(!rolledBack){
   assert.match(status,/Image generation: unavailable\/disabled/);for(const name of ["Web search","Code mode","Unified exec"])assert.ok(status.includes(`${name}: enabled`),"Every saved capability restores across genuine CLI restart");assert.match(status,/Saved profile preferences: imagegen=off, web_search=on, unified_exec=on, code_mode=on/);
  }else{assert.match(status,/Image generation: unavailable\/disabled/);assert.match(await prompt("/openai-tools code_mode on"),/namespace is conflicting/);assert.match(await prompt("/openai-tools imagegen on"),/namespace is conflicting, excluded/);}
 }finally{
  const closed=once(child,"close");child.stdin.end();const timer=setTimeout(()=>child.kill(),10000);await closed;clearTimeout(timer);input.close();
 }
 assert.equal(existsSync(join(profile,"openai-running.json")),false,"Confirmed ordinary CLI exit releases profile coordination");
}
await cli(false);
const preferencePath=join(profile,"openai-compatibility-capabilities.json"),preferencesBefore=sha256(await readFile(preferencePath));
assert.deepEqual(JSON.parse(await readFile(preferencePath,"utf8")),{version:1,capabilities:{imagegen:false,web_search:true,unified_exec:true,code_mode:true}});
await cli(false,true);assert.equal(sha256(await readFile(preferencePath)),preferencesBefore);
// Ordinary settings can change through normal native UI; rollback preserves them.
const settings=JSON.parse(await readFile(join(profile,"settings.json"),"utf8"));settings.defaultThinkingLevel="low";await writeFile(join(profile,"settings.json"),JSON.stringify(settings,null,2)+"\n");
const settingsBefore=sha256(await readFile(join(profile,"settings.json")));
run(process.execPath,[installer,"--rollback",profile],{env});assert.equal(sha256(await readFile(join(profile,"settings.json"))),settingsBefore);
await cli(true);assert.equal(sha256(await readFile(preferencePath)),preferencesBefore,"Rollback/excluded on commands never erase or change saved choices");
assert.equal(sha256(await readFile(join(profile,"auth.json"))),authBefore);assert.equal(sha256(await readFile(join(originals,"original.bin"))),originalBefore);
const settingsMenu=JSON.parse(run(process.execPath,[fileURLToPath(new URL("./accept-settings.mjs",import.meta.url)),bundle],{env}));
assert.equal(settingsMenu.status,"passed");assert.equal(settingsMenu.networkAttempts,0);assert.equal(settingsMenu.normalAndExcludedContexts,true);assert.equal(settingsMenu.consolidatedJobs,true);assert.equal(settingsMenu.savedCapabilityPreferences,true);assert.equal(settingsMenu.quietPollingPresentation,true);assert.equal(settingsMenu.compactLocalJobPresentation,true);validatePollingFrames(settingsMenu.frames);
console.log(JSON.stringify({status:"passed",bundle,profile,nativeCli:"actual bundled RPC",rollback:"native exclusions, Fast retained",credentialsCopied:false,hostedRequests:0,settingsAndOriginalsPreserved:true,savedCapabilityPreferences:true,settingsMenu}));
