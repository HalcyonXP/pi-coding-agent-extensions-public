// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
export function expectedNotificationAckResult(){return {nativeAcknowledgementBoundary:true,syntheticModelRequests:18,scenarios:6,quarantinedScopes:4,liveServiceCalls:0,rows:['openai-responses','openai-codex-responses'].flatMap(api=>['confirm','throw','invalid'].map(mode=>({api,mode,modelRequests:3,nativePublications:1,journalRecords:1,nativeFinalizationHeld:true,replacementTurnRefusedWhilePending:true,originalExecIdentity:true,noPublicationReplay:true,confirmedDrainResumes:mode==='confirm',uncertaintyQuarantined:mode!=='confirm',activeScopes:0,drainingScopes:mode==='confirm'?0:1})))};}
export function assertNotificationAckReceipt(receipt,source){
 assert.match(source,/^[a-f0-9]{40}$/);assert.ok(receipt&&typeof receipt==='object');assert.deepEqual(Object.keys(receipt).sort(),['bundleSource','externalAttempts','kind','profile','result']);assert.equal(receipt.kind,'actual-bundle-native-notification-ack');assert.equal(receipt.bundleSource,source);assert.equal(receipt.externalAttempts,0);assert.ok(typeof receipt.profile==='string'&&receipt.profile.length>0);assert.deepEqual(receipt.result,expectedNotificationAckResult());return receipt;
}
