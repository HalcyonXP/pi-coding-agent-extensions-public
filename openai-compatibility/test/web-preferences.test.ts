// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test,{type TestContext} from "node:test";
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,rmSync,mkdirSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {Value} from "typebox/value";
import type {ExtensionContext} from "@earendil-works/pi-coding-agent";
import {webPreferenceStore,webProfile} from "../web-preferences.ts";
import {capabilityPreferenceStore} from "../capability-preferences.ts";
import {UnifiedExecManager} from "../unified-exec.ts";
import {WebSearchAdapter} from "../web-search.ts";
import {OpenAISettingsPanel} from "../settings-menu.ts";
import {harness} from "./capability-fixture.ts";
const file=(dir:string)=>join(dir,"openai-compatibility-web.json");
function directory(t:TestContext){const dir=mkdtempSync(join(tmpdir(),"pi-web-preferences-"));t.after(()=>{if(Reflect.get(t,"passed")===true)rmSync(dir,{recursive:true});});return dir;}
const signal=()=>new AbortController().signal;
function fixture(dir:string,transport:typeof fetch=async()=>{throw Error("No service request allowed");}){return harness(dir,undefined,{preferences:capabilityPreferenceStore(dir),webPreferences:webPreferenceStore(dir),webSearch:{transport,profile:"verified-v1"}});}
const lookup={weather:[{location:"Example City",start:"2026-09-12",duration:1}]};

test("Web admission preference is passive, exact and independent of other saved choices",t=>{
 const dir=directory(t),store=webPreferenceStore(dir);assert.equal(store.read(),"verified-v1");assert.deepEqual(readdirSync(dir),[]);
 const other=join(dir,"openai-compatibility-unified.json");writeFileSync(other,'{"version":1,"maxBackgroundWaitMs":60000}\n');const bytes=readFileSync(other);
 for(const v of ["experimental","verified-v1"] as const){store.write(v);assert.equal(webPreferenceStore(dir).read(),v);assert.deepEqual(JSON.parse(readFileSync(file(dir),"utf8")),{version:1,profile:v});}
 assert.deepEqual(readFileSync(other),bytes);assert.equal(webPreferenceStore(join(dir,"other")).read(),"verified-v1");assert.equal(readdirSync(dir).filter(p=>p.endsWith(".tmp")).length,0);
 let coerced=0;for(const v of [undefined,null,false,{},"Experimental","verified",{toString(){coerced++;return "experimental";}}])assert.throws(()=>webProfile(v));assert.equal(coerced,0);
});
test("malformed, unsupported, oversized and directory Web preferences are preserved",t=>{
 const dir=directory(t),store=webPreferenceStore(dir);for(const bytes of [Buffer.from("{"),Buffer.from("null"),Buffer.from("[]"),Buffer.from([255]),Buffer.alloc(4097,32),...[
 {version:2,profile:"experimental"},{version:1},{version:1,profile:"other"},{version:1,profile:"experimental",jobs:[]},{version:1,profile:true}
 ].map(v=>Buffer.from(JSON.stringify(v)))]){writeFileSync(file(dir),bytes);assert.throws(()=>store.read(),/unreadable or invalid/);assert.throws(()=>store.write("experimental"),/unreadable or invalid/);assert.deepEqual(readFileSync(file(dir)),bytes);}
 const other=join(dir,"directory");mkdirSync(other);mkdirSync(file(other));assert.throws(()=>webPreferenceStore(other).read());assert.throws(()=>webPreferenceStore(other).write("experimental"));assert.deepEqual(readdirSync(other),["openai-compatibility-web.json"]);
});
test("saved experimental selection never hot-widens schema, resets jobs/search or authenticates",async t=>{
 const dir=directory(t),h=fixture(dir);try{
  await h.emit("session_start");const tool=h.tools.get("web_search")!,parameters=structuredClone(tool.parameters),active=h.active(),revision=h.settings.contextVersion();assert.equal(Value.Check(tool.parameters,lookup),false);
  let resets=0;const ur=UnifiedExecManager.prototype.reset,wr=WebSearchAdapter.prototype.reset;t.mock.method(UnifiedExecManager.prototype,"reset",function(this:UnifiedExecManager){resets++;return ur.call(this);});t.mock.method(WebSearchAdapter.prototype,"reset",function(this:WebSearchAdapter){resets++;return wr.call(this);});
  await h.commands.get("openai-tools").handler("web-profile experimental",h.ctx);assert.equal(webPreferenceStore(dir).read(),"experimental");assert.match(h.notices.at(-1)!,/effective: verified-v1/);assert.match(h.notices.at(-1)!,/Reload extensions or restart/);
  assert.equal(h.tools.get("web_search"),tool);assert.deepEqual(tool.parameters,parameters);assert.deepEqual(h.active(),active);assert.equal(h.settings.contextVersion(),revision);assert.equal(resets,0);assert.equal(h.authCalls(),0);
  await h.emit("session_start");assert.equal(Value.Check(tool.parameters,lookup),false);assert.match((await h.settings.read(h.ctx)).find(r=>r.id==="web_profile")!.description,/effective: verified-v1/);
 }finally{await h.emit("session_shutdown");}
 const reloaded=fixture(dir);try{await reloaded.emit("session_start");assert.equal(Value.Check(reloaded.tools.get("web_search")!.parameters,lookup),true);assert.ok(!reloaded.active().includes("web_search"),"profile selection is not tool activation");assert.match((await reloaded.settings.read(reloaded.ctx)).find(r=>r.id==="web_profile")!.description,/effective: experimental/);assert.equal(reloaded.authCalls(),0);}finally{await reloaded.emit("session_shutdown");}
});
test("saving profile while a verified request awaits transport does not cancel or change it",async t=>{
 const dir=directory(t);capabilityPreferenceStore(dir).write("web_search",true);let entered!:(value?:unknown)=>void,release!:()=>void;const ready=new Promise(r=>entered=r),gate=new Promise<void>(r=>release=r);let body:any,requestSignal:AbortSignal|undefined;
 const h=fixture(dir,async(_url,init)=>{body=JSON.parse(String(init?.body));requestSignal=init?.signal??undefined;entered();await gate;return new Response(JSON.stringify({output:"fixture source",results:[]}),{status:200});});let pending:Promise<unknown>|undefined;
 try{await h.emit("session_start");pending=h.tools.get("web_search")!.execute("waiting",{search_query:[{q:"public fixture"}]},AbortSignal.timeout(5000),undefined,h.ctx);void pending.catch(entered);await ready;assert.ok(body);await h.settings.change("web_profile","experimental",h.ctx,signal());assert.equal(requestSignal?.aborted,false);release();const result=await pending as any;assert.equal(result.details.verification,"subscription-smoke-verified-subset");assert.equal(body.model,"gpt-5.4-mini");assert.equal(Value.Check(h.tools.get("web_search")!.parameters,lookup),false);assert.equal(h.authCalls(),1);}finally{release();if(pending)await pending.catch(()=>{});await h.emit("session_shutdown");}
});
test("invalid loaded Web state blocks only this Web implementation, even after a session boundary",async t=>{
 const dir=directory(t);capabilityPreferenceStore(dir).write("web_search",true);writeFileSync(file(dir),"preserve invalid Web state");const h=fixture(dir);try{
  await h.emit("session_start");assert.ok(h.active().includes("imagegen"));assert.ok(h.active().includes("read"));assert.equal(h.tools.has("web_search"),false);assert.deepEqual(h.settings.jobs(h.ctx).read(),[]);assert.equal((await h.settings.read(h.ctx)).find(r=>r.id==="web_profile")!.values,undefined);
  await h.commands.get("openai-tools").handler("web_search on",h.ctx);assert.match(h.notices.at(-1)!,/Saved Web admission preferences are invalid/);await h.commands.get("openai-tools").handler("web-profile experimental",h.ctx);assert.match(h.notices.at(-1)!,/were not changed/);assert.equal(readFileSync(file(dir),"utf8"),"preserve invalid Web state");
  writeFileSync(file(dir),'{"version":1,"profile":"verified-v1"}');await h.emit("session_start");assert.equal(h.tools.has("web_search"),false,"repair requires extension reload");assert.equal(capabilityPreferenceStore(dir).read().web_search,true);assert.equal(h.authCalls(),0);
 }finally{await h.emit("session_shutdown");}
});
test("Web preference status/invalid commands, cancellation and failed save do not change either selection",async t=>{
 const dir=directory(t),h=fixture(dir);try{await h.emit("session_start");for(const args of ["web-profile","web-profile status","web-profile unknown","web-profile Experimental","web-profile experimental extra"])await h.commands.get("openai-tools").handler(args,h.ctx);assert.deepEqual(readdirSync(dir),[]);
 const abort=new AbortController();abort.abort();await assert.rejects(h.settings.change("web_profile","experimental",h.ctx,abort.signal),{name:"AbortError"});writeFileSync(file(dir),"preserved concurrent corruption");await assert.rejects(h.settings.change("web_profile","experimental",h.ctx,signal()),/unreadable or invalid/);assert.equal((await h.settings.read(h.ctx)).find(r=>r.id==="web_profile")!.value,"verified-v1");assert.equal(readFileSync(file(dir),"utf8"),"preserved concurrent corruption");assert.equal(h.authCalls(),0);assert.deepEqual([...h.commands.keys()],["openai-tools"]);
 }finally{await h.emit("session_shutdown");}
});
test("native settings exposes pending Web profile without closing or hot-changing the schema",async t=>{
 const dir=directory(t),h=fixture(dir);let panel:OpenAISettingsPanel|undefined,closed=0;try{await h.emit("session_start");panel=new OpenAISettingsPanel(await h.settings.read(h.ctx),{read:()=>h.settings.read(h.ctx),isCurrent:()=>true,onBoundary:h.settings.onBoundary,async change(id,value,s){await h.settings.change(id,value,h.ctx,s);return "Saved; reload required, current schema unchanged.";}},{fg:(_tone:string,v:string)=>v} as ExtensionContext["ui"]["theme"],()=>{},()=>closed++,"web_profile");assert.match(panel.render(100).join("\n"),/Web admission profile\s+verified-v1/);panel.handleInput("\r");const end=performance.now()+10000;while(panel.render(100).join("\n").includes("applying…")&&performance.now()<end)await new Promise(r=>setTimeout(r,10));assert.equal(webPreferenceStore(dir).read(),"experimental");assert.match(panel.render(100).join("\n"),/current schema unchanged/);assert.equal(Value.Check(h.tools.get("web_search")!.parameters,lookup),false);assert.equal(closed,0);assert.equal(h.authCalls(),0);}finally{panel?.dispose();await h.emit("session_shutdown");}
});
