// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('new installed Web/media cohorts use exact artifact extension with isolation before SDK import',()=>{
 const s=read('../accept-web-media.mjs');assert.match(s,/process\.argv\.length===4/);assert.match(s,/await verifyBundle\(bundle\)/);assert.match(s,/await verifyCuration\(bundle/);assert.match(s,/join\(bundle,'extensions\/openai-compatibility\/index.ts'\)/);assert.doesNotMatch(s,/source-on-predecessor|additionalExtensionPaths:\[join\(source/);
 assert.ok(s.indexOf('Object.assign(process.env,env)')<s.indexOf('const sdk=await import'));assert.ok(s.indexOf('globalThis.fetch=async')<s.indexOf("await import('./web-projection"));assert.match(s,/runtime\.getAuth=async/);assert.match(s,/runtime\.checkAuth=async/);assert.match(s,/allowModelNetwork:false,refreshOnCreate:false/);assert.match(s,/assert\.equal\(session\.autoCompactionEnabled,true\)/);assert.doesNotMatch(s,/setAutoCompactionEnabled\(false\)/);assert.match(s,/session\.extensionRunner\.emit\(\{type:'session_shutdown'/);assert.match(s,/session\.dispose\(\)/);assert.match(s,/flag:'wx'/);
});
function assertCohortWorkflow(source){
 // Git checkout line endings are not UI frame whitespace or a workflow change.
 const lines=source.split(/\r?\n/);
 for(const name of['web','media','imagegen','web-profile']){
  const index=lines.indexOf(`        run: node distribution/accept-web-media.mjs '.pi/extracted artifact' ${name}`);
  assert.ok(index>0,`Missing exact ${name} cohort command`);
  assert.equal(lines[index-1],'        timeout-minutes: 5',`Missing separate ${name} budget`);
 }
 assert.equal(lines.filter(line=>line==='        timeout-minutes: 5').length,4);
 assert.match(source,/timeout-minutes: 20/);assert.match(source,/persist-credentials: false/);assert.doesNotMatch(source,/actions\/deploy|gh release/);
}
for(const ending of['\n','\r\n'])test(`hosted artifact workflow requires separate bounded cohorts with ${JSON.stringify(ending)} checkout lines`,()=>{
 const source=read('../../.github/workflows/private-windows-artifacts.yml').split(/\r?\n/).join(ending);assertCohortWorkflow(source);
});
test('workflow line-ending compatibility cannot hide missing, changed or unbounded cohorts',()=>{
 const source=read('../../.github/workflows/private-windows-artifacts.yml');
 for(const name of['web','media','imagegen','web-profile']){
  const command=`        run: node distribution/accept-web-media.mjs '.pi/extracted artifact' ${name}`;
  assert.throws(()=>assertCohortWorkflow(source.replace(command,command+' extra')));
  const lines=source.split(/\r?\n/),index=lines.indexOf(command);assert.ok(index>0);lines[index-1]='        timeout-minutes: 6';
  assert.throws(()=>assertCohortWorkflow(lines.join('\r\n')));
 }
});
test('current CLI source requires Web preferences and settings across restart/rollback',()=>{
 const s=read('../accept-profile.mjs');for(const pattern of [/savedWebAdmissionProfile:true/,/validateWebSettings\(settingsMenu.webSettings\)/,/effective: verified-v1/,/effective: experimental/,/Rollback preserves the Web admission profile/,/webPreferenceBefore/])assert.match(s,pattern);
});
