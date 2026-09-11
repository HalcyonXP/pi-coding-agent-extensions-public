// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {validateSettingsFrameMigration} from "../settings-frame-migration.mjs";
import {validateWaitSettings} from "../settings-scenarios.mjs";
const affected=[[7,"fast-before"],[8,"fast-applying"],[9,"fast-saved"],[10,"capabilities-before"],[11,"unified-search-stays-open"],[12,"code-enabled"],[13,"web-enabled"],[15,"capabilities-restored"],[16,"fast-after-exclusions"],[17,"capabilities-excluded"]];
function frames(){
 const previous=Array.from({length:36},(_,i)=>({name:`synthetic-${i}`,text:"unchanged synthetic contract"}));
 for(const [i,name]of affected)previous[i]={name,text:"→ Fast mode           on\n  (1/9)\nDescription unchanged"};
 const current=structuredClone(previous);for(const [i]of affected)current[i].text="→ Fast mode                on\n  (1/10)\nDescription unchanged";
 return {previous,current};
}
test("frame migration permits only the exact observed layout change without modifying historical frames",()=>{
 const {previous,current}=frames(),saved=JSON.stringify(previous);
 assert.deepEqual(validateSettingsFrameMigration(previous,current),{historicalFrames:36,currentFrames:36,unchangedFrames:26,settingsFramesChanged:10,delta:"settings-value-column-plus-five-and-row-count-nine-to-ten"});assert.equal(JSON.stringify(previous),saved);
 for(const mutate of [r=>r.pop(),r=>r.reverse(),r=>r[0].text+="changed",r=>r[7].text=r[7].text.replace("on","off"),r=>r[7].text=r[7].text.replace("Description unchanged","lost warning"),r=>r[7].text=r[7].text.replace("/10)","/11)"),r=>r[7].text=r[7].text.replace("                on","               on"),r=>r[11].name="wrong"]){const r=structuredClone(current);mutate(r);assert.throws(()=>validateSettingsFrameMigration(previous,r));}
 assert.throws(()=>validateSettingsFrameMigration(previous,previous));
});
function receipt(){return {savedCeiling:true,restoredCeiling:true,failedSaveUnchanged:true,invalidFilePreserved:true,exclusionsPreserved:true,frames:[
 {name:"wait-before",text:"→ Background wait ceiling 300000"},{name:"wait-saved",text:"→ Background wait ceiling 5000\nBackground wait ceiling: 5000 ms"},
 {name:"wait-restored",text:"→ Background wait ceiling 55001"},{name:"wait-save-failed",text:"→ Background wait ceiling 55001\nChange failed: retained"},
 {name:"wait-invalid",text:"→ Background wait ceiling unavailable"},{name:"wait-excluded",text:"→ Background wait ceiling 55001"},{name:"wait-excluded-saved",text:"→ Background wait ceiling 60000"}]};}
test("wait-settings receipt requires every observed control, restoration and failure view",()=>{
 assert.equal(validateWaitSettings(receipt()),true);
 for(const key of Object.keys(receipt())){const r=receipt();delete r[key];assert.throws(()=>validateWaitSettings(r));}
 for(const index of [0,1,2,3,4,5,6]){const r=receipt();r.frames[index].text="missing state";assert.throws(()=>validateWaitSettings(r));}
 const r=receipt();r.frames.reverse();assert.throws(()=>validateWaitSettings(r));
});
test("installed settings remain fixed to the actual bundle, with shared scenarios and CLI restart/rollback requirements",()=>{
 const entry=readFileSync(new URL("../accept-settings.mjs",import.meta.url),"utf8"),profile=readFileSync(new URL("../accept-profile.mjs",import.meta.url),"utf8");
 assert.match(entry,/process\.argv\.length===3/);assert.match(entry,/verifyBundle\(bundle\)/);assert.match(entry,/exerciseSettings\(sdk,bundle,profile,cwd,join\(bundle,"extensions\/openai-compatibility\/index.ts"\)\)/);
 assert.match(profile,/validateWaitSettings\(settingsMenu.waitSettings\)/);assert.match(profile,/savedUnifiedWaitPreference:true/);assert.match(profile,/Rollback preserves the wait ceiling/);
});
