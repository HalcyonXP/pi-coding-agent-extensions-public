// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {validateQuietPolling} from "../accept-quiet-polls.mjs";
import {loadPollingPresentation,validatePollingFrames} from "../polling-presentation.mjs";
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
const presentationFrames=()=>[
 {name:"local-poll-empty-hidden",text:""},{name:"local-poll-terminal-visible",text:"Local job update\nSynthetic terminal result"},
 {name:"local-jobs-three-compact",text:"6 call audits\nRENDER_OK_0\nRENDER_OK_1\nRENDER_OK_2"},
 {name:"local-jobs-expanded",text:"Scope: synthetic-group\nsession_id\nCode mode: exec_command returned."},
 {name:"local-jobs-audit-history",text:"history only · 6 call audits"},
 {name:"local-jobs-error-visible",text:"error (exit 7)\nSYNTHETIC_NONZERO"},
 {name:"local-jobs-direct-unchanged",text:"exec_command\nSYNTHETIC_DIRECT"},
 ...["fast-before","fast-applying","fast-saved","capabilities-before","unified-search-stays-open","code-enabled","web-enabled","jobs-inside-openai","capabilities-restored","fast-after-exclusions","capabilities-excluded","jobs-after-exclusions"].map(name=>({name,text:"Synthetic existing native settings frame"}))
];
test("profile frame contract retains twelve settings and two polling contracts plus five compact-group frames",()=>assert.equal(validatePollingFrames(presentationFrames()),true));
for(const [name,change]of [
 ["obsolete twelve-only list",frames=>frames.splice(0,7)],
 ["obsolete fourteen-only list",frames=>frames.splice(2,5)],
 ["oversized compact group",frames=>frames[2].text+='\nextra row'],
 ["lost compact output",frames=>frames[2].text=frames[2].text.replace('RENDER_OK_1','lost')],
 ["raw collapsed metadata",frames=>frames[2].text+=' session_id'],
 ["lost expandable details",frames=>frames[3].text='missing'],
 ["restored running audit jobs",frames=>frames[4].text+=' running'],
 ["concealed nonzero exit",frames=>frames[5].text='SYNTHETIC_NONZERO'],
 ["grouped ordinary tool",frames=>frames[6].text+=' Local job'],

 ["quiet placeholder noise",frames=>frames[0].text=" "],
 ["missing local label",frames=>frames[1].text="Synthetic terminal result"],
 ["lost terminal result",frames=>frames[1].text="Local job update"],
 ["replaced original frame",frames=>frames[7].name="other"],
 ["blank original frame",frames=>frames[7].text=""]
])test(`profile frame contract refuses ${name}`,()=>{const frames=presentationFrames();change(frames);assert.throws(()=>validatePollingFrames(frames));});
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
