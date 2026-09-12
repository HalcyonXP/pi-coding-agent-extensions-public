// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
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
 const copyLoop=builder.split("\n").find(line=>line.startsWith("for(const path of [")&&line.includes('"distribution/lib.mjs"'));
 assert.ok(copyLoop);for(const path of ["host-patches/LICENSE","host-patches/NOTICE","host-patches/pi-0.85.1/LICENSE.pi"])
  assert.ok(copyLoop.includes(JSON.stringify(path)),path);
 assert.ok(copyLoop.endsWith("await copySource(path,join(out,path));"));
 const checked=spawnSync(process.execPath,["--check",fileURLToPath(new URL("../build.mjs",import.meta.url))],{windowsHide:true,encoding:"utf8",timeout:30000,maxBuffer:1024*1024});
 assert.equal(checked.status,0,checked.stderr);assert.equal(checked.error,undefined);
});
test("public navigation distinguishes the patch grant from redistribution clearance",async()=>{
 assert.ok((await read("README.md")).includes("host-patches/LICENSE"));
 const doc=await read("docs/openai-integration/REDISTRIBUTION.md");
 assert.ok(doc.includes("resolves our contribution-grant ambiguity, not third-party coverage"));
 assert.ok(doc.includes("public binary release blocked"));
});
