// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Independent receipt shape/count expectations, not execution authority.
import assert from 'node:assert/strict';
const apis=['openai-responses','openai-codex-responses'];
export function expectedNativeContextResult(cohort){
 assert.ok(['context','notifications'].includes(cohort));
 if(cohort==='context')return {nativeSerializedContext:true,forwardedHistory:true,preAuthRedactionRefusal:true,syntheticModelRequests:12,syntheticServiceRequests:2,scenarios:4,coverage:['visible','serialized-redaction'],liveServiceCalls:0,rows:apis.flatMap(api=>['visible','serialized-redaction'].map(scenario=>({api,scenario,modelRequests:3,serviceRequests:scenario==='visible'?1:0,webAuthCalls:scenario==='visible'?1:0,serializedBoundary:true,activeScopes:0,drainingScopes:0})))};
 return {nativeNotifications:true,originalExecIdentity:true,adoptedWait:true,zeroGuestBudget:true,nativeCustomOutput:true,nativeNotificationCards:true,replayedNotificationCards:true,syntheticModelRequests:22,scenarios:6,liveServiceCalls:0,lifecycle:{idleRefusal:true,reloadRevocation:true,syntheticModelRequests:16,scenarios:4,liveServiceCalls:0,rows:apis.flatMap(api=>['idle','reload'].map(scenario=>({api,scenario,modelRequests:4,notifications:0,noIdleTurn:true,noSourceReplay:true,confirmedCleanup:true,staleLookupRefused:scenario==='reload',activeScopes:0,drainingScopes:0})))},rows:apis.map(api=>({api,modelRequests:3,notifications:2,toolCompletions:2,originalExecIdentity:true,adoptedWait:true,zeroGuestBudget:true,nativeCustomOutput:true,nativeNotificationCards:true,replayedNotificationCards:true,activeScopes:0,drainingScopes:0}))};
}
export function assertNativeContextResult(cohort,result){assert.deepEqual(result,expectedNativeContextResult(cohort));return result;}
export function assertNativeContextReceipt(value,{source,cohort}){
 assert.match(source,/^[a-f0-9]{40}$/);assert.ok(value&&typeof value==='object');
 assert.deepEqual(Object.keys(value).sort(),['bundleSource','cohort','externalAttempts','kind','profile','result']);
 assert.equal(value.kind,'actual-bundle-native-context');assert.equal(value.bundleSource,source);assert.equal(value.cohort,cohort);assert.equal(value.externalAttempts,0);assert.ok(typeof value.profile==='string'&&value.profile.length>0);
 assertNativeContextResult(cohort,value.result);return value;
}
