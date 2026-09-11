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

const webCountFrames=new Map([[7,'fast-before'],[8,'fast-applying'],[9,'fast-saved'],[10,'capabilities-before'],[15,'capabilities-restored'],[16,'fast-after-exclusions'],[17,'capabilities-excluded']]);
const webGuidanceFrames=new Map([[7,'fast-before'],[10,'capabilities-before'],[14,'jobs-inside-openai'],[15,'capabilities-restored'],[16,'fast-after-exclusions'],[17,'capabilities-excluded'],[18,'jobs-after-exclusions']]);
const waitGuidanceFrames=new Map([[0,'wait-before'],[2,'wait-restored'],[4,'wait-invalid'],[5,'wait-excluded']]);
const oldGuidance=' Changes apply immediately. Tool changes cancel running capability work.'.padEnd(80);
const newGuidance=[' Capability switches cancel running work. Web admission profile changes require'.padEnd(80),' reload.'.padEnd(80)];
/** PR32 frames are immutable inputs. Permit only the observed row count and
 * explicit reload-guidance replacement, never broad whitespace normalization.
 */
export function validateWebProfileFrameMigration(previous,current){
 assert.equal(previous.frames.length,36);assert.equal(current.frames.length,36);assert.equal(previous.waitSettings.frames.length,7);assert.equal(current.waitSettings.frames.length,7);
 function migrate(frame,index,counts,guidance){
  if(counts.has(index))assert.equal(frame.name,counts.get(index));if(guidance.has(index))assert.equal(frame.name,guidance.get(index));let count=0,hint=0;
  const text=frame.text.split('\n').flatMap(line=>{
   if(counts.has(index)&&(line==='  (1/10)'||line==='  (2/10)')){count++;return[line.replace('/10)','/11)')];}
   if(guidance.has(index)&&line===oldGuidance){hint++;return newGuidance;}
   return[line];
  }).join('\n');assert.equal(count,counts.has(index)?1:0);assert.equal(hint,guidance.has(index)?1:0);return{...frame,text};
 }
 assert.deepEqual(current.frames,previous.frames.map((f,i)=>migrate(f,i,webCountFrames,webGuidanceFrames)),'Only exact Web profile row count/reload guidance changes are allowed');
 assert.deepEqual(current.waitSettings.frames,previous.waitSettings.frames.map((f,i)=>migrate(f,i,new Map(),waitGuidanceFrames)),'Wait values, failures and other native text must remain exact');
 return{historicalFrames:43,currentHistoricalFrames:43,unchangedHistoricalFrames:30,mainFramesChanged:9,waitFramesChanged:4,delta:'web-profile-row-count-ten-to-eleven-and-reload-guidance'};
}
