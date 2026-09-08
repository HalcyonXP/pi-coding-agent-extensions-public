// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {validateQuietPolling} from "../accept-quiet-polls.mjs";
import {loadPollingPresentation} from "../polling-presentation.mjs";
import {mkdtemp,mkdir,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
async function moduleFixture(t,{missingTui=false}={}) {
 const root=await mkdtemp(join(tmpdir(),"pi-poll-entry-test-"));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [name,path,code]of [["pi-tui",missingTui?"alternate.js":"dist/index.js","export class Container {}"],["pi-coding-agent","dist/modes/interactive/local-poll-presentation.js","export class LocalPollPresentation {}"]]){
  const dir=join(root,"node_modules/@earendil-works",name);await mkdir(join(dir,"dist/modes/interactive"),{recursive:true});
  await writeFile(join(dir,"package.json"),JSON.stringify({name:"@earendil-works/"+name,version:"0.85.1",type:"module",main:missingTui?"alternate.js":"dist/index.js"}),{flag:"wx"});await writeFile(join(dir,path),code,{flag:"wx"});
 }
 return root;
}
test("native polling bootstrap loads the fixed TUI main-only package entry without conditional exports",async t=>{
 const root=await moduleFixture(t),sdk={InteractiveMode:class {},initTheme(){}};
 const native=await loadPollingPresentation(root,sdk);assert.equal(native.InteractiveMode,sdk.InteractiveMode);assert.equal(native.initTheme,sdk.initTheme);assert.equal(typeof native.Container,"function");assert.equal(typeof native.LocalPollPresentation,"function");
});
test("native polling bootstrap refuses a missing pinned dist entry instead of following alternate main",async t=>{
 const root=await moduleFixture(t,{missingTui:true});await assert.rejects(loadPollingPresentation(root,{}),{code:"ERR_MODULE_NOT_FOUND"});
});
const rows=()=>{
 const common={modelRequestsDuringWork:2,shellStarts:3,quietPolls:4,quietCards:0,quietAudits:0,inFlightInputChanged:false,visibleMeaningfulResults:6,meaningfulResults:6,pendingPresentation:0,activeScopes:0,drainingScopes:0};
 return [{...common,aborted:false,terminalResults:3,collectedCell:true,followupAudits:6,expectedAudits:6},{...common,aborted:true,startsAfterAbort:0,errorResults:1}];
};
test("quiet-poll acceptance requires both actual workflow and intentional abort observations",()=>{
 const r=validateQuietPolling(rows());assert.equal(r.quietPollsHidden,true);assert.equal(r.noQuietPollAudits,true);assert.equal(r.modelRequestsDuringWork,2);assert.equal(r.liveTokenOrQuotaMeasurement,false);assert.equal(r.automaticIdleTurns,false);
});
for(const [name,index,changes] of [
 ["UI noise",0,{quietCards:1}], ["model audit noise",0,{quietAudits:1}], ["extra inference",0,{modelRequestsDuringWork:3}],
 ["missing native classification",0,{quietPolls:0}], ["lost real output",0,{visibleMeaningfulResults:5}], ["lost terminal",0,{terminalResults:2}],
 ["uncollected cell",0,{collectedCell:false}], ["mutated in-flight input",0,{inFlightInputChanged:true}], ["lost meaningful context",0,{followupAudits:5}],
 ["unconfirmed cleanup",1,{drainingScopes:1}], ["post-abort execution",1,{startsAfterAbort:1}], ["hidden cancellation",1,{errorResults:0}], ["pending UI",1,{pendingPresentation:1}]
])test(`quiet-poll acceptance refuses ${name}`,()=>{const value=rows();Object.assign(value[index],changes);assert.throws(()=>validateQuietPolling(value));});
