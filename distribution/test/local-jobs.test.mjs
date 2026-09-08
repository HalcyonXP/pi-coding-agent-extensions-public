// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {validateCompactLocalJobs} from "../accept-local-jobs.mjs";
const rows=()=>[{aborted:false,groupCount:1,presentationMutatedHistory:false,expandedNativeDetails:true,compactLines:4,compactOutputs:3,groupAudits:6,expectedAudits:6},{aborted:true,groupCount:1,presentationMutatedHistory:false,expandedNativeDetails:true,prominentAbort:true}];
test("compact native job acceptance requires visible output, expandable details and unchanged evidence/history",()=>{
 const r=validateCompactLocalJobs(rows());assert.equal(r.threeJobsFourLines,true);assert.equal(r.ordinaryAuditsPreserved,true);assert.equal(r.intentionalAbortVisible,true);
});
for(const[name,index,change]of [["no native group",0,{groupCount:0}],["multiple groups for one cell",0,{groupCount:2}],["oversized job UI",0,{compactLines:5}],["missing output",0,{compactOutputs:2}],["lost ordinary audit",0,{groupAudits:5}],["modified model history",0,{presentationMutatedHistory:true}],["lost expanded metadata",0,{expandedNativeDetails:false}],["hidden abort",1,{prominentAbort:false}],["missing abort exercise",1,{aborted:false}]])test(`compact native job acceptance refuses ${name}`,()=>{const r=rows();Object.assign(r[index],change);assert.throws(()=>validateCompactLocalJobs(r));});
