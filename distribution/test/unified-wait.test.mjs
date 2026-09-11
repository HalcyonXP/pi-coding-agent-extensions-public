// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import test from 'node:test';
import {validateUnifiedWait} from '../accept-unified-wait.mjs';
const rows=()=>['openai-responses','openai-codex-responses'].map(api=>({api,requests:11,explicitInitialFloor:true,nonemptyFloor:true,backgroundCollectedOnce:true,originalID:true,cancelledLongWait:true,historyUnchanged:true,backgroundMs:34500,cancelMs:150,activeScopes:0,drainingScopes:0}));
test('native wait receipt requires both original routes, real long collection and cancelled cleanup',()=>{
 assert.deepEqual(validateUnifiedWait(rows()),{explicitWaitClamping:true,backgroundWaitBeyond30Seconds:true,originalIDCollected:true,longWaitCancelled:true,nativeScopesReleased:true,syntheticModelRequests:22,scenarios:6,liveServiceCalls:0});
 for(const change of [r=>r.pop(),r=>r.reverse(),r=>r.push(r[0]),r=>delete r[0],r=>r[0].api=r[1].api]){const r=rows();change(r);assert.throws(()=>validateUnifiedWait(r));}
});
test('native wait receipt refuses missing observations, shortened waits, delayed cancellation and leaked scopes',()=>{
 for(const key of Object.keys(rows()[0])){const r=rows();delete r[0][key];assert.throws(()=>validateUnifiedWait(r),key);}
 for(const [key,value] of [['requests',12],['activeScopes',1],['drainingScopes',1],['backgroundMs',30000],['backgroundMs',60000],['backgroundMs',NaN],['backgroundMs','34500'],['cancelMs',-1],['cancelMs',5000],['cancelMs',Infinity],['cancelMs','150'],...['explicitInitialFloor','nonemptyFloor','backgroundCollectedOnce','originalID','cancelledLongWait','historyUnchanged'].map(k=>[k,false])]){const r=rows();r[1][key]=value;assert.throws(()=>validateUnifiedWait(r),key);}
});
