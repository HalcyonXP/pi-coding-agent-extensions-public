// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Exact presentation migration, not whitespace normalization or historical rewriting.
import assert from "node:assert/strict";
const changed = new Map([[7,"fast-before"],[8,"fast-applying"],[9,"fast-saved"],[10,"capabilities-before"],
  [11,"unified-search-stays-open"],[12,"code-enabled"],[13,"web-enabled"],[15,"capabilities-restored"],
  [16,"fast-after-exclusions"],[17,"capabilities-excluded"]]);
const labels = new Set(["Fast mode","Image generation","Web search","Unified exec","Code mode","Jobs","Conversation route","Codex subscription"]);
/** Callers independently validate the full native frame contracts. Neither array is mutated. */
export function validateSettingsFrameMigration(previous, current) {
  assert.equal(previous.length,36);assert.equal(current.length,36);
  let count=0;
  const expected=previous.map((frame,index)=>{
    if(!changed.has(index))return frame;
    assert.equal(frame.name,changed.get(index));
    let edits=0;
    const text=frame.text.split("\n").map(line=>{
      const label=line.slice(2,22).trim();
      if(["→ ","  "].includes(line.slice(0,2))&&labels.has(label)&&/^ +$/.test(line.slice(2+label.length,22))) {
        edits++;return line.slice(0,22)+"     "+line.slice(22);
      }
      if(line==="  (1/9)"||line==="  (2/9)"){edits++;return line.replace("/9)","/10)");}
      return line;
    }).join("\n");
    assert.ok(edits>0,"Expected settings frame has no recognized layout change");count++;
    return {...frame,text};
  });
  assert.deepEqual(current,expected,"Only the reviewed ten settings-layout changes are allowed");
  assert.equal(count,10);
  return {historicalFrames:36,currentFrames:36,unchangedFrames:26,settingsFramesChanged:10,
    delta:"settings-value-column-plus-five-and-row-count-nine-to-ten"};
}
