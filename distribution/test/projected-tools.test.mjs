// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {validateProjectedTools} from '../accept-projected-tools.mjs';
const flags=['targetFields','numericRetainedID','completeOutput','nativeWrappersUnchanged','hookFallbackVisible','bridgeTimeBounded','nativeCustomReplay','historyUnchanged'];
const rows=()=>['openai-responses','openai-codex-responses'].map(api=>({api,requests:8,scenarios:4,...Object.fromEntries(flags.map(k=>[k,true])),activeScopes:0,drainingScopes:0,liveServiceCalls:0}));
test('installed projection receipt requires both routes and all native observations',()=>{assert.deepEqual(validateProjectedTools(rows()),{optInUnifiedProjection:true,defaultWrappersUnchanged:true,numericRetainedID:true,hookFallbackVisible:true,bridgeTimeObserved:true,nativeScopesReleased:true,syntheticModelRequests:16,scenarios:8,liveServiceCalls:0});});
for(const flag of flags)test('projection receipt refuses absent/false '+flag,()=>{for(const index of [0,1])for(const value of [false,undefined]){const r=rows();r[index][flag]=value;assert.throws(()=>validateProjectedTools(r));}});
for(const key of ['requests','scenarios','activeScopes','drainingScopes','liveServiceCalls'])test('projection receipt refuses altered '+key,()=>{for(const index of [0,1]){const r=rows();r[index][key]++;assert.throws(()=>validateProjectedTools(r));}});
test('projection receipt refuses missing, duplicate and reordered routes',()=>{const r=rows();for(const input of [[],[r[0]],[r[0],r[0]],[...r].reverse(),[...r,r[1]]])assert.throws(()=>validateProjectedTools(input));});
test('installed aggregate requires projection in a separate pre-import isolated profile',()=>{const source=readFileSync(new URL('../accept-projected-tools.mjs',import.meta.url),'utf8'),aggregate=readFileSync(new URL('../accept.mjs',import.meta.url),'utf8');assert.match(aggregate,/const nativeProjectedTools=await acceptProjectedToolsProfile\(bundle\)/);assert.match(source,/const env=\{HOME:profile,USERPROFILE:profile/);assert.match(source,/encoding:null,timeout:180000/);assert.match(source,/await verifyBundle\(bundle\)/);assert.match(source,/assert\.equal\(session\.autoCompactionEnabled,true\)/);assert.doesNotMatch(source,/setAutoCompactionEnabled\(false\)/);assert.match(source,/assert\.deepEqual\(validateProjectedTools\(rows\),receipt\)/);assert.match(source,/acceptProjectedTools\(session,runtime,session\.agent\.streamFunction,cwd,resources\)/);});
