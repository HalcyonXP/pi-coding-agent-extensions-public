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
test('hosted artifact workflow requires each separate bounded new cohort without deployment',()=>{
 const s=read('../../.github/workflows/private-windows-artifacts.yml');for(const name of['web','media','imagegen','web-profile'])assert.ok(s.includes(`run: node distribution/accept-web-media.mjs '.pi/extracted artifact' ${name}\n`));assert.equal(s.match(/timeout-minutes: 5/g).length,4);assert.match(s,/timeout-minutes: 20/);assert.match(s,/persist-credentials: false/);assert.doesNotMatch(s,/actions\/deploy|gh release/);
});
test('current CLI source requires Web preferences and settings across restart/rollback',()=>{
 const s=read('../accept-profile.mjs');for(const pattern of [/savedWebAdmissionProfile:true/,/validateWebSettings\(settingsMenu.webSettings\)/,/effective: verified-v1/,/effective: experimental/,/Rollback preserves the Web admission profile/,/webPreferenceBefore/])assert.match(s,pattern);
});
