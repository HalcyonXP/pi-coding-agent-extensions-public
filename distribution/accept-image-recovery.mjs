// Offline installed acceptance: a generated original survives a failed optional copy.
// The invocation/owning workspace are provided by the genuine installed SDK fixture.
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import {join,resolve,relative,dirname} from "node:path";

export async function acceptImageCopyRecovery(invoke,outcome,cwd,image,token) {
 const originalFetch=globalThis.fetch,failures=[];let requests=0,result;
 const destination=join(cwd,"image-copy-collision.png"),marker="synthetic competing writer";
 try {
  globalThis.fetch=async(url,init)=>{
   assert.equal(++requests,1,"No retry of paid work");assert.equal(String(url),"https://chatgpt.com/backend-api/codex/images/generations");
   assert.equal(init?.method,"POST");assert.equal(new Headers(init.headers).get("authorization"),`Bearer ${token}`);
   const body=JSON.parse(String(init.body));assert.equal(body.prompt,"synthetic copy collision");assert.equal(body.model,"gpt-image-2");
   await writeFile(destination,marker,{flag:"wx"});return Response.json({data:[{b64_json:image.toString("base64")}]});
  };
  result=outcome(await invoke("exec",{code:'const r=await tools.imagegen(JSON.stringify({prompt:"synthetic copy collision",destination_path:"image-copy-collision.png"}));if(r.isError||r.result.details.status!=="completed"||r.result.details.copyStatus!=="failed"||r.result.details.destinationPath!==undefined)throw Error("copy failure concealed");image(r.result.content[0]);text(JSON.stringify({canonicalPath:r.result.details.canonicalPath,requestedDestinationPath:r.result.details.requestedDestinationPath}));'}));
  assert.equal(result.result.status,"ok");assert.equal(requests,1);
  const paths=JSON.parse(result.output[0]);assert.equal(paths.requestedDestinationPath,destination);
  const local=relative(join(cwd,".pi","Agent","Work","generated_images"),resolve(paths.canonicalPath));assert.ok(!local.startsWith("..")&&!local.includes(":"));assert.match(local.replaceAll("\\","/"),/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\.png$/);assert.notEqual(dirname(local),".");
  assert.deepEqual(await readFile(paths.canonicalPath),image);assert.equal(await readFile(destination,"utf8"),marker);
 }catch(e){failures.push(e);}finally{try{globalThis.fetch=originalFetch;assert.equal(globalThis.fetch,originalFetch);}catch(e){failures.push(e);}}
 if(failures.length)throw new AggregateError(failures,"Image recovery acceptance and/or transport restoration failed; preserve every failure");
 return {canonicalOriginalRetained:true,copyFailureVisible:true,competingFileUnchanged:true,nativeReferenceForwarded:true,nestedWrapperPreserved:true,syntheticServiceRequests:requests,liveServiceCalls:0};
}
