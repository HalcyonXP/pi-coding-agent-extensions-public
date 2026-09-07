// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile,readFile,rm,mkdir,symlink,open,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {verifyDownload,parseArguments,limits} from "../verify-download.mjs";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const source="a".repeat(40),release="0.3.0-private.1",cli=fileURLToPath(new URL("../verify-download.mjs",import.meta.url));
const code=value=>error=>error.code===value;
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),"pi download pins "));
 try{
  // Byte pinning is deliberately not a tar parser. Even these bytes are never executed.
  const archive=join(root,"archive ; & literal.tar.gz"),manifest=join(root,"bundle.json"),payload=Buffer.from('throw new Error("downloaded code must never run");');
  const metadata={version:1,release,sourceCommit:source,platform:"win32-x64",nodeMajors:[24,25],files:[]};
  await writeFile(archive,payload);await writeFile(manifest,JSON.stringify(metadata));
  const input={archive,manifest,expected:{sourceCommit:source,release,archiveSha256:hash(payload),manifestSha256:hash(await readFile(manifest))}};
  const repinManifest=async value=>{await writeFile(manifest,typeof value==="string"||Buffer.isBuffer(value)?value:JSON.stringify(value));input.expected.manifestSha256=hash(await readFile(manifest));};
  await fn({root,input,metadata,repinManifest});
 }finally{await rm(root,{recursive:true,force:true});}
}
const argv=input=>["--archive",input.archive,"--manifest",input.manifest,"--source",input.expected.sourceCommit,"--release",input.expected.release,"--archive-sha256",input.expected.archiveSha256,"--manifest-sha256",input.expected.manifestSha256];
test("external byte/identity pins match without executing, extracting or writing inputs",()=>fixture(async({root,input})=>{
 const before=await readdir(root),archive=await readFile(input.archive),manifest=await readFile(input.manifest);
 const result=await verifyDownload(input);assert.equal(result.state,"download-pins-matched-not-installed");assert.equal(result.sourceCommit,source);assert.equal(result.archiveSha256,input.expected.archiveSha256);
 assert.deepEqual(await readdir(root),before);assert.deepEqual(await readFile(input.archive),archive);assert.deepEqual(await readFile(input.manifest),manifest);
}));
test("uppercase externally supplied hexadecimal pins normalize",()=>fixture(async({input})=>{for(const key of ["sourceCommit","archiveSha256","manifestSha256"])input.expected[key]=input.expected[key].toUpperCase();assert.equal((await verifyDownload(input)).sourceCommit,source);}));
for(const field of ["sourceCommit","archiveSha256","manifestSha256"])test(`malformed expected ${field} is rejected before file access`,async()=>{
 const expected={sourceCommit:source,release,archiveSha256:"b".repeat(64),manifestSha256:"c".repeat(64),[field]:"not-a-pin"};await assert.rejects(verifyDownload({archive:"missing",manifest:"missing",expected}),error=>error.code.startsWith("EXPECTED_"));
});
test("expected pins and bounded version label are mandatory",async()=>{await assert.rejects(verifyDownload({}),code("EXPECTED_PINS_REQUIRED"));await fixture(async({input})=>{for(const value of ["",undefined,"latest","0.3.0\n--override","1.2.3-"+"x".repeat(65)]){input.expected.release=value;await assert.rejects(verifyDownload(input),code("EXPECTED_RELEASE_INVALID"));}});});
test("changed archive bytes do not inherit matching manifest acceptance",()=>fixture(async({input})=>{await writeFile(input.archive,"different bytes");await assert.rejects(verifyDownload(input),code("ARCHIVE_DIGEST_MISMATCH"));}));
test("changed detached manifest rejects before JSON parsing",()=>fixture(async({input})=>{await writeFile(input.manifest,"not JSON");await assert.rejects(verifyDownload(input),code("MANIFEST_DIGEST_MISMATCH"));}));
test("valid JSON and strict UTF-8 are required even when bytes are pinned",()=>fixture(async({input,repinManifest})=>{for(const value of ["not JSON",Buffer.from([0xff,0xfe])]){await repinManifest(value);await assert.rejects(verifyDownload(input),code("MANIFEST_JSON_INVALID"));}}));
test("manifest must be an object rather than null or an array",()=>fixture(async({input,repinManifest})=>{for(const value of ["null","[]"]){await repinManifest(value);await assert.rejects(verifyDownload(input),code("MANIFEST_OBJECT_REQUIRED"));}}));
for(const [field,value,error] of [["sourceCommit","b".repeat(40),"SOURCE_MISMATCH"],["release","0.3.0-other.1","RELEASE_MISMATCH"],["version",2,"MANIFEST_VERSION_UNSUPPORTED"],["platform","linux-x64","PLATFORM_UNSUPPORTED"],["nodeMajors",[22,24,25],"NODE_CONTRACT_UNSUPPORTED"]])test(`pinned but incompatible manifest ${field} fails closed`,()=>fixture(async({input,metadata,repinManifest})=>{await repinManifest({...metadata,[field]:value});await assert.rejects(verifyDownload(input),code(error));}));
test("missing identity and reversed or duplicate Node contract are rejected",()=>fixture(async({input,metadata,repinManifest})=>{for(const nodeMajors of [undefined,[25,24],[24,24]]){await repinManifest({...metadata,nodeMajors});await assert.rejects(verifyDownload(input),code("NODE_CONTRACT_UNSUPPORTED"));}}));
test("relative inputs and directories are refused",()=>fixture(async({root,input})=>{await assert.rejects(verifyDownload({...input,manifest:"bundle.json"}),code("ABSOLUTE_INPUT_PATH_REQUIRED"));await assert.rejects(verifyDownload({...input,archive:root}),code("REGULAR_INPUT_FILE_REQUIRED"));}));
test("leaf reparse inputs are refused rather than followed",()=>fixture(async({root,input})=>{const target=join(root,"target"),link=join(root,"link");await mkdir(target);await symlink(target,link,process.platform==="win32"?"junction":"dir");await assert.rejects(verifyDownload({...input,manifest:link}),code("REGULAR_INPUT_FILE_REQUIRED"));}));
test("empty and oversized inputs fail before allocation or archive streaming",()=>fixture(async({input})=>{
 await writeFile(input.archive,"");await assert.rejects(verifyDownload(input),code("INPUT_SIZE_BOUND"));
 const archive=await open(input.archive,"r+");try{await archive.truncate(limits.archiveBytes+1);}finally{await archive.close();}await assert.rejects(verifyDownload(input),code("INPUT_SIZE_BOUND"));
 const manifest=await open(input.manifest,"r+");try{await manifest.truncate(limits.manifestBytes+1);}finally{await manifest.close();}await assert.rejects(verifyDownload(input),code("INPUT_SIZE_BOUND"));
}));
test("CLI parsing requires all six unique explicit pairs and rejects overrides",()=>fixture(async({input})=>{
 const valid=argv(input);assert.deepEqual(parseArguments(valid),input);
 for(const invalid of [[],valid.slice(0,-2),[...valid,"--force","true"],[...valid.slice(0,-2),"--archive",input.archive],["--url","unplanned",...valid.slice(2)],[...valid.slice(0,-1),"--missing"]])assert.throws(()=>parseArguments(invalid));
}));
test("actual CLI handles spaced literal paths without a shell or executing payload",()=>fixture(async({input})=>{const result=spawnSync(process.execPath,[cli,...argv(input)],{encoding:"utf8",timeout:10000});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).state,"download-pins-matched-not-installed");}));
test("actual CLI failures never print an input path, payload or raw filesystem diagnostics",()=>fixture(async({root,input})=>{
 const missing=join(root,"sensitive-input-name.tar.gz");const result=spawnSync(process.execPath,[cli,...argv({...input,archive:missing})],{encoding:"utf8",timeout:10000});assert.equal(result.status,1);assert.equal(result.stdout,"");assert.equal(result.stderr.trim(),"DOWNLOAD_VERIFICATION_FAILED: INPUT_UNAVAILABLE");assert.ok(!result.stderr.includes(root));
}));
