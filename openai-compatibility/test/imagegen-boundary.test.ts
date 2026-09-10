import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, png } from "./capability-fixture.ts";

async function fixture(body: (h: ReturnType<typeof harness>, dir: string) => Promise<void>, queue?: Parameters<typeof harness>[1]) {
 const dir=await mkdtemp(join(tmpdir(),"image-boundary-")),h=harness(dir,queue),oldFetch=globalThis.fetch,errors:unknown[]=[];
 try { await h.emit("session_start");await body(h,dir); }
 catch(e){errors.push(e);}
 finally{globalThis.fetch=oldFetch;try{await h.emit("session_shutdown");}catch(e){errors.push(e);}if(!errors.length)try{await rm(dir,{recursive:true,force:true});}catch(e){errors.push(e);}}
 if(errors.length)throw new AggregateError(errors,"Image boundary fixture and/or cleanup failed; retain owned files");
}
for(const params of [
 {prompt:"x",unknown:true},{prompt:"x",num_last_images_to_include:0},{prompt:"x",referenced_image_paths:[]},
 {prompt:"x",referenced_image_refs:[]},{prompt:"x",referenced_image_refs:["img_not-a-reference"]},
 {prompt:"x",destination_path:0},{prompt:"x",num_last_images_to_include:1.5},
])test("image execution independently rejects invalid/hook-modified arguments: "+JSON.stringify(params),async()=>{
 await fixture(async h=>{let requests=0;globalThis.fetch=async()=>{requests++;return Response.json({data:[{b64_json:png}]});};
 await assert.rejects(h.tools.get("imagegen")!.execute("invalid",params,undefined,undefined,h.ctx));assert.equal(h.authCalls(),0);assert.equal(requests,0);});
});
test("image destination and prompt cannot change during authentication",async()=>{
 await fixture(async(h,dir)=>{const args={prompt:"original prompt",destination_path:"requested.png"};
 const auth=h.ctx.modelRegistry.getProviderAuth.bind(h.ctx.modelRegistry);(h.ctx.modelRegistry as any).getProviderAuth=async(id:string)=>{args.prompt="changed prompt";args.destination_path="changed.png";return auth(id);};
 globalThis.fetch=async(_url,init)=>{assert.equal(JSON.parse(String(init?.body)).prompt,"original prompt");return Response.json({data:[{b64_json:png}]});};
 const result=await h.tools.get("imagegen")!.execute("snapshot",args,undefined,undefined,h.ctx);
 assert.equal((result.details as any).destinationPath,join(dir,"requested.png"));assert.deepEqual(await readFile(join(dir,"requested.png")),Buffer.from(png,"base64"));await assert.rejects(readFile(join(dir,"changed.png")),{code:"ENOENT"});});
});
test("a copy collision after generation returns the preserved original and an explicit copy failure",async()=>{
 await fixture(async(h,dir)=>{globalThis.fetch=async()=>{await writeFile(join(dir,"copy.png"),"competing owned writer");return Response.json({data:[{b64_json:png}]});};
 const result=await h.tools.get("imagegen")!.execute("copy-race",{prompt:"synthetic image",destination_path:"copy.png"},undefined,undefined,h.ctx),details=result.details as any;
 assert.equal(details.status,"completed");assert.equal(details.copyStatus,"failed");assert.equal(details.destinationPath,undefined);assert.equal(details.requestedDestinationPath,join(dir,"copy.png"));
 assert.equal(result.content[0].type,"image");assert.match((result.content[1] as any).text,/copy failed/i);assert.match((result.content[1] as any).text,/do not regenerate/i);
 assert.deepEqual(await readFile(details.canonicalPath),Buffer.from(png,"base64"));assert.equal(await readFile(join(dir,"copy.png"),"utf8"),"competing owned writer");assert.equal(h.authCalls(),1);});
});
test("copy cancellation remains a refusal while the saved original survives",async()=>{
 let calls=0,revoke!:()=>Promise<unknown>;
 await fixture(async(h,dir)=>{revoke=()=>h.emit("session_shutdown");globalThis.fetch=async()=>Response.json({data:[{b64_json:png}]});
 await assert.rejects(h.tools.get("imagegen")!.execute("cancel-copy",{prompt:"x",destination_path:"cancelled.png"},undefined,undefined,h.ctx));
 assert.deepEqual(await readFile(join(dir,".pi","Agent","Work","generated_images","test-session","cancel-copy.png")),Buffer.from(png,"base64"));await assert.rejects(readFile(join(dir,"cancelled.png")),{code:"ENOENT"});},async(_file,operation)=>{if(++calls===2){await revoke();throw Error("synthetic copy cancellation");}return operation();});
});
test("canonical save failure is not converted into a successful image result",async()=>{
 await fixture(async h=>{globalThis.fetch=async()=>Response.json({data:[{b64_json:png}]});await assert.rejects(h.tools.get("imagegen")!.execute("no-original",{prompt:"x"},undefined,undefined,h.ctx),/synthetic canonical failure/);assert.equal(h.authCalls(),1);},async()=>{throw Error("synthetic canonical failure");});
});
test("noncanonical conversation base64 is refused before authentication",async()=>{
 await fixture(async h=>{(h.ctx.sessionManager as any).getBranch=()=>[{type:"message",message:{content:[{type:"image",mimeType:"image/png",data:png+"!ignored"}]}}];
 globalThis.fetch=async()=>Response.json({data:[{b64_json:png}]});await assert.rejects(h.tools.get("imagegen")!.execute("bad-image",{prompt:"edit",num_last_images_to_include:1},undefined,undefined,h.ctx));assert.equal(h.authCalls(),0);});
});
