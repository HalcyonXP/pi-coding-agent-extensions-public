import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {acceptImageCopyRecovery} from '../accept-image-recovery.mjs';
// Synthetic comparator/cleanup tests; only installed acceptance uses the native SDK.
for(const scenario of ['valid','outside-original','changed-original','invoke-failure','missing-copy-claim'])test('image recovery comparator: '+scenario,async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'recovery-policy-')),originalFetch=globalThis.fetch,image=Buffer.from('synthetic bytes'),failures=[];
 try {
  const parent=join(cwd,'.pi','Agent','Work','generated_images','fixture');await mkdir(parent,{recursive:true});const canonicalPath=join(parent,'image.png');await writeFile(canonicalPath,scenario==='changed-original'?Buffer.from('different'):image);
  const invoke=async(name,args)=>{assert.equal(name,'exec');assert.match(args.code,/copyStatus/);if(scenario==='invoke-failure')throw Error('synthetic primary failure');
   await globalThis.fetch('https://chatgpt.com/backend-api/codex/images/generations',{method:'POST',headers:{authorization:'Bearer synthetic'},body:JSON.stringify({prompt:'synthetic copy collision',model:'gpt-image-2'})});
   return {result:{status:'ok'},output:[JSON.stringify({canonicalPath:scenario==='outside-original'?join(cwd,'not-canonical.png'):canonicalPath,requestedDestinationPath:scenario==='missing-copy-claim'?undefined:join(cwd,'image-copy-collision.png')})]};};
  if(scenario==='valid')assert.deepEqual(await acceptImageCopyRecovery(invoke,x=>x,cwd,image,'synthetic'),{canonicalOriginalRetained:true,copyFailureVisible:true,competingFileUnchanged:true,nativeReferenceForwarded:true,nestedWrapperPreserved:true,syntheticServiceRequests:1,liveServiceCalls:0});
  else await assert.rejects(acceptImageCopyRecovery(invoke,x=>x,cwd,image,'synthetic'),AggregateError);
  assert.equal(globalThis.fetch,originalFetch);
 }catch(e){failures.push(e);}finally{globalThis.fetch=originalFetch;if(!failures.length)try{await rm(cwd,{recursive:true,force:true});}catch(e){failures.push(e);}}
 if(failures.length)throw new AggregateError(failures,'Image recovery comparator test failed; preserve fixture');
});
