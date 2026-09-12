// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Log transport only: a checksum is consistency, never native authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateAllOutputFrames} from './unified-output-presentation.mjs';
import {validateWaitSettings,validateWebSettings,validateContextSettings} from './settings-scenarios.mjs';
export const PROFILE_RECEIPT_LIMIT=4*1024*1024;
const kind='actual-bundle-cli-receipt-v1',chunkBytes=6144,maxParts=Math.ceil(PROFILE_RECEIPT_LIMIT/chunkBytes),hash=b=>createHash('sha256').update(b).digest('hex');
const exact=(v,keys)=>assert.deepEqual(Object.keys(v).sort(),[...keys].sort());
export function validateProfileReceipt(r,bundle){
 exact(r,['status','savedUnifiedWaitPreference','savedWebAdmissionProfile','savedContextProfile','bundle','profile','nativeCli','rollback','credentialsCopied','hostedRequests','settingsAndOriginalsPreserved','savedCapabilityPreferences','settingsMenu']);
 assert.equal(r.status,'passed');assert.equal(r.bundle,bundle);assert.ok(typeof r.profile==='string'&&r.profile.length>0);assert.equal(r.nativeCli,'actual bundled RPC');assert.equal(r.rollback,'native exclusions, Fast retained');assert.equal(r.credentialsCopied,false);assert.equal(r.hostedRequests,0);
 for(const k of ['savedUnifiedWaitPreference','savedWebAdmissionProfile','savedContextProfile','settingsAndOriginalsPreserved','savedCapabilityPreferences'])assert.equal(r[k],true);
 const m=r.settingsMenu;assert.equal(m.status,'passed');assert.equal(m.networkAttempts,0);for(const k of ['normalAndExcludedContexts','consolidatedJobs','savedCapabilityPreferences','quietPollingPresentation','compactLocalJobPresentation','readableCodePresentation','nativeUnifiedOutputPresentation'])assert.equal(m[k],true);
 validateAllOutputFrames(m.frames);validateWaitSettings(m.waitSettings);validateWebSettings(m.webSettings);validateContextSettings(m.contextSettings);return r;
}
export function frameProfileReceipt(raw,{source,bundle}){
 assert.match(source,/^[a-f0-9]{40}$/);const bytes=Buffer.from(raw);assert.ok(bytes.length>0&&bytes.length<=PROFILE_RECEIPT_LIMIT);assert.equal(Buffer.from(bytes.toString('utf8')).compare(bytes),0,'Invalid UTF-8 receipt');validateProfileReceipt(JSON.parse(bytes.toString('utf8')),bundle);
 const parts=Math.ceil(bytes.length/chunkBytes),sha256=hash(bytes);return Array.from({length:parts},(_,part)=>({kind,source,part,parts,bytes:bytes.length,sha256,data:bytes.subarray(part*chunkBytes,(part+1)*chunkBytes).toString('base64')}));
}
export function readProfileReceiptFrames(frames,{source,bundle}){
 assert.match(source,/^[a-f0-9]{40}$/);assert.ok(Array.isArray(frames)&&frames.length>0&&frames.length<=maxParts);const first=frames[0],pieces=[];assert.ok(Number.isSafeInteger(first.bytes)&&first.bytes>0&&first.bytes<=PROFILE_RECEIPT_LIMIT);assert.equal(first.parts,Math.ceil(first.bytes/chunkBytes));assert.equal(frames.length,first.parts);assert.match(first.sha256,/^[a-f0-9]{64}$/);
 for(const[f,r]of frames.entries()){exact(r,['kind','source','part','parts','bytes','sha256','data']);assert.equal(r.kind,kind);assert.equal(r.source,source);assert.equal(r.part,f);assert.equal(r.parts,first.parts);assert.equal(r.bytes,first.bytes);assert.equal(r.sha256,first.sha256);assert.ok(typeof r.data==='string'&&r.data.length>0&&r.data.length<=8192);const b=Buffer.from(r.data,'base64');assert.equal(b.toString('base64'),r.data,'Noncanonical frame data');assert.equal(b.length,f===frames.length-1?first.bytes-f*chunkBytes:chunkBytes);pieces.push(b);}
 const raw=Buffer.concat(pieces);assert.equal(hash(raw),first.sha256);assert.equal(Buffer.from(raw.toString('utf8')).compare(raw),0);return validateProfileReceipt(JSON.parse(raw.toString('utf8')),bundle);
}
