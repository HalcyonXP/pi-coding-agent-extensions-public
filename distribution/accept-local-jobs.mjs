// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Presentation acceptance, separate from protected-evidence/native ownership assertions.
import assert from "node:assert/strict";
export function validateCompactLocalJobs(rows) {
 assert.equal(rows.length,2);
 for(const row of rows){assert.equal(row.groupCount,1);assert.equal(row.presentationMutatedHistory,false);assert.equal(row.expandedNativeDetails,true);}
 const [normal,abort]=rows;
 assert.equal(normal.compactLines,4);assert.equal(normal.compactOutputs,3);assert.equal(normal.groupAudits,normal.expectedAudits);assert.ok(normal.groupAudits>=6);
 assert.equal(abort.aborted,true);assert.equal(abort.prominentAbort,true);
 return {nativeGroupedJobs:true,threeJobsFourLines:true,expandedNativeDetails:true,ordinaryAuditsPreserved:true,presentationDoesNotMutateHistory:true,intentionalAbortVisible:true};
}
