// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Supervise the genuine CLI gate. Exit zero without its full receipt is failure.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifyBundle} from './lib.mjs';
import {isolatedEnvironment} from './isolated-environment.mjs';
import {frameProfileReceipt,PROFILE_RECEIPT_LIMIT} from './profile-receipt.mjs';
export function requireProfileCompletion(result,identity){
 assert.ok(!result.error&&result.status===0&&!result.signal,'CLI child failed; preserve diagnostics, no replay');
 assert.ok(Buffer.isBuffer(result.stdout)&&result.stdout.length>0,'CLI exited without a completion receipt');
 return frameProfileReceipt(result.stdout,identity);
}
export async function acceptFramedProfile(input){
 assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');const bundle=resolve(input),{manifest}=await verifyBundle(bundle),directory=await mkdtemp(join(tmpdir(),'pi framed CLI acceptance ')),env=isolatedEnvironment(join(directory,'home')),errors=[];let frames;
 await writeFile(join(directory,'started.json'),JSON.stringify({source:manifest.sourceCommit,bundle,timeoutMs:300000,maxBuffer:PROFILE_RECEIPT_LIMIT})+'\n',{flag:'wx'});
 try{
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./accept-profile.mjs',import.meta.url)),bundle],{env,windowsHide:true,encoding:null,timeout:300000,maxBuffer:PROFILE_RECEIPT_LIMIT});
  const save=async f=>{try{await f();}catch(e){errors.push(e);}};
  await save(()=>writeFile(join(directory,'stdout.log'),result.stdout??Buffer.alloc(0),{flag:'wx'}));await save(()=>writeFile(join(directory,'stderr.log'),result.stderr??Buffer.alloc(0),{flag:'wx'}));await save(()=>writeFile(join(directory,'process.json'),JSON.stringify({status:result.status,signal:result.signal,error:result.error?.code,pid:result.pid})+'\n',{flag:'wx'}));
  frames=requireProfileCompletion(result,{source:manifest.sourceCommit,bundle});
 }catch(e){errors.push(e);}finally{
  try{assert.deepEqual((await verifyBundle(bundle)).manifest,manifest,'Bundle changed during CLI acceptance');}catch(e){errors.push(e);}
  try{await writeFile(join(directory,'finished.json'),JSON.stringify({source:manifest.sourceCommit,childReceiptValidated:errors.length===0,frameEmissionPending:errors.length===0,parts:frames?.length,errors:errors.map(e=>({name:e.name,message:e.message,stack:e.stack}))})+'\n',{flag:'wx'});}catch(e){errors.push(e);}
 }
 if(errors.length)throw new AggregateError(errors,'Framed CLI acceptance failed; preserve profiles and receipts, no replay');
 // Each line is <9KiB; await every write, including the final frame.
 for(const frame of frames)await new Promise((done,reject)=>process.stdout.write(JSON.stringify(frame)+'\n',error=>error?reject(error):done()));
 await writeFile(join(directory,'emitted.json'),JSON.stringify({source:manifest.sourceCommit,parts:frames.length,allFrameWritesAcknowledged:true})+'\n',{flag:'wx'});
 return frames;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){assert.equal(process.argv.length,3,'Usage: node distribution/accept-profile-framed.mjs <Windows bundle>');await acceptFramedProfile(process.argv[2]);}
