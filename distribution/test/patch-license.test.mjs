// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {readFile,mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {isolatedEnvironment} from "../isolated-environment.mjs";
const read=path=>readFile(new URL(`../../${path}`,import.meta.url),"utf8");
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
test("native patch contributions have a complete MIT grant with non-personal attribution",async()=>{
 const license=await read("host-patches/LICENSE");
 assert.ok(license.startsWith("MIT License\n\nCopyright (c) 2026 Project Maintainers\n"));
 for(const term of ["Permission is hereby granted, free of charge", "sublicense, and/or sell", "The above copyright notice and this permission notice shall be included", 'THE SOFTWARE IS PROVIDED "AS IS"', "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE"])
  assert.ok(license.includes(term));
});
test("patch grant explicitly separates original additions, upstream context and Apache components",async()=>{
 const notice=await read("host-patches/NOTICE");
 for(const term of ["Original first-party contributions", "applied or compiled form", "pi-0.85.1", "pi-0.85.0", "licensing rights", "It does not relicense upstream code", "LICENSE.pi", "Apache-2.0", "not a blanket license"])
  assert.ok(notice.includes(term),term);
});
test("licensing clarification preserves native patch and upstream notice byte pins",async()=>{
 for(const version of ["0.85.0","0.85.1"]){
  const dir=`host-patches/pi-${version}/`,p=JSON.parse(await read(dir+"provenance.json"));
  assert.equal(hash(await readFile(new URL(`../../${dir}${p.patch}`,import.meta.url))),p.patchSha256);
  if(p.licenseSha256)assert.equal(hash(await readFile(new URL(`../../${dir}${p.license}`,import.meta.url))),p.licenseSha256);
 }
 for(const path of ["openai-compatibility/LICENSE","distribution/LICENSE","docs/openai-integration/LICENSE"])
  assert.match(await read(path),/Apache License/);
});
test("builder copies both native grants and their scope notice from canonical source",async()=>{
 const builder=await read("distribution/build.mjs");
 const copyLoop=builder.split(/\r?\n/).find(line=>line.startsWith("for(const path of [")&&line.includes('"distribution/lib.mjs"'));
 assert.ok(copyLoop);for(const path of ["host-patches/LICENSE","host-patches/NOTICE","host-patches/pi-0.85.1/LICENSE.pi"])
  assert.ok(copyLoop.includes(JSON.stringify(path)),path);
 assert.ok(copyLoop.endsWith("await copySource(path,join(out,path));"));
 const checked=spawnSync(process.execPath,["--check",fileURLToPath(new URL("../build.mjs",import.meta.url))],{windowsHide:true,encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
 assert.equal(checked.status,0,checked.stderr);assert.equal(checked.error,undefined);
});
test("isolated CRLF Git checkout retains canonical patch grants and complete builder lines",async()=>{
 const root=await mkdtemp(join(tmpdir(),"patch-grant-checkout-")),env=isolatedEnvironment(join(root,"home"));let passed=false;
 try{
  const git=(args,input)=>{const r=spawnSync("git",args,{cwd:root,env,input,windowsHide:true,encoding:null,timeout:30000,maxBuffer:2*1024*1024});assert.equal(r.status,0,r.stderr?.toString());assert.equal(r.error,undefined);return r.stdout.toString("utf8").trim();};
  // No commits, credentials, network or global configuration changes. Only this
  // synthetic repository's index/configuration and ordinary checkout are used.
  git(["init","--template="]);git(["config","--local","core.autocrlf","true"]);
  const paths=[".gitattributes","host-patches/LICENSE","host-patches/NOTICE","distribution/build.mjs"],originals=new Map();
  for(const path of paths){const bytes=await readFile(new URL(`../../${path}`,import.meta.url));originals.set(path,bytes);const oid=git(["hash-object","-w","--stdin"],bytes);git(["update-index","--add","--cacheinfo","100644",oid,path]);}
  git(["checkout-index","--all"]);
  for(const path of ["host-patches/LICENSE","host-patches/NOTICE"]){const bytes=await readFile(join(root,path));assert.equal(bytes.includes(13),false);assert.ok(bytes.equals(originals.get(path)));}
  const builder=await readFile(join(root,"distribution/build.mjs"),"utf8");assert.ok(builder.includes("\r\n"));
  const line=builder.split(/\r?\n/).find(s=>s.startsWith("for(const path of [")&&s.includes('"distribution/lib.mjs"'));assert.ok(line.endsWith("await copySource(path,join(out,path));"));passed=true;
 }finally{if(passed)await rm(root,{recursive:true,force:true});}
});
test("public navigation distinguishes the patch grant from redistribution clearance",async()=>{
 assert.ok((await read("README.md")).includes("host-patches/LICENSE"));
 const doc=await read("docs/openai-integration/REDISTRIBUTION.md");
 assert.ok(doc.includes("resolves our contribution-grant ambiguity, not third-party coverage"));
 assert.ok(doc.includes("public binary release blocked"));
});
