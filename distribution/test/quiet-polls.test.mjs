// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {validateQuietPolling} from "../accept-quiet-polls.mjs";
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
