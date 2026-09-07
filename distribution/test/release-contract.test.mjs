// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
const read=path=>readFile(new URL("../../"+path,import.meta.url),"utf8");
test("scoped Apache grants preserve the complete existing license text",async()=>{
 const canonical=await read("openai-compatibility/LICENSE");
 for(const dir of ["distribution","docs/openai-integration"]){assert.equal(await read(dir+"/LICENSE"),canonical);assert.match(await read(dir+"/NOTICE"),/Copyright 2026 Project Maintainers/);assert.match(await read(dir+"/NOTICE"),/first-party/);}
 assert.match(await read("README.md"),/scoped grants do not license otherwise unlicensed components/);
});
test("root distribution license metadata does not change the private prerelease contract",async()=>{
 const pkg=JSON.parse(await read("distribution/locks/package.json")),lock=JSON.parse(await read("distribution/locks/package-lock.json"));
 assert.equal(pkg.license,"Apache-2.0");assert.equal(lock.packages[""].license,"Apache-2.0");assert.equal(pkg.private,true);assert.equal(pkg.version,"0.3.0-private.1");assert.equal(lock.packages[""].version,pkg.version);assert.deepEqual(pkg.dependencies,lock.packages[""].dependencies);
});
test("consumer contract separates trusted pins from byte matching and delivery authorization",async()=>{
 const doc=await read("docs/openai-integration/RELEASE-CONTRACT.md");
 for(const phrase of ["R_kgDOUQewAQ","independently trusted matching source checkout","download-pins-matched-not-installed","no accepted asset identity","separate explicit authorization","No executable upload or automatic deployment","a filesystem sandbox","COMMENTED"] )assert.ok(doc.includes(phrase),phrase);
 for(const flag of ["--archive","--manifest","--source","--release","--archive-sha256","--manifest-sha256"])assert.ok(doc.includes("'"+flag+"'"));
 assert.match(doc,/if \(\$LASTEXITCODE -ne 0\)/);assert.match(doc,/Get-FileHash/);assert.match(doc,/Test-Path -LiteralPath/);
});
test("consumer links target packaged guides; development privacy link is explicitly source-only",async()=>{
 const validation=await read("docs/openai-integration/VALIDATION.md");assert.ok(!validation.includes("](../../PUBLICATION.md)"));assert.match(validation,/privacy policy is repository-only/);
 for(const file of ["docs/openai-integration/README.md","docs/openai-integration/PRIVATE-RELEASE.md","distribution/README.md"])assert.ok((await read(file)).includes("RELEASE-CONTRACT.md"));
});
test("pre-execution checker imports only Node built-ins and has no active side-effect API",async()=>{
 const code=await read("distribution/verify-download.mjs");
 const imports=[...code.matchAll(/from "([^"]+)"/g)].map(m=>m[1]);assert.ok(imports.length>=3);assert.ok(imports.every(path=>path.startsWith("node:")));
 assert.doesNotMatch(code,/child_process|\bfetch\s*\(|\bwriteFile\b|\bmkdir\b|\bimport\s*\(/);
});
