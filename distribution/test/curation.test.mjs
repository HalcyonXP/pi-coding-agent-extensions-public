// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,readFile,writeFile,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {existsSync} from "node:fs";
import {files,archive,writeManifest,verifyBundle,run} from "../lib.mjs";
import {curatePayload,parsePolicy,verifyCuration,retainedSuffix} from "../curate-payload.mjs";
const source="a".repeat(40),demo="node_modules/@earendil-works/pi-coding-agent/examples/extensions/doom-overlay";
async function put(root,path,bytes){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);}
async function fixture(fn){
 const parent=await mkdtemp(join(tmpdir(),"pi curation ")),root=join(parent,"new bundle");await mkdir(root);
 try{
  for(let i=0;i<6;i++)await put(root,`artifacts/host-${i}.tgz`,`original tar ${i}`);
  for(let i=0;i<10;i++)await put(root,`${demo}/${i===0?"doom.wasm":`file-${i}.txt`}`,`original example ${i}`);
  await put(root,"node_modules/runtime/index.js","ordinary runtime unchanged");await put(root,"node_modules/runtime/LICENSE","original license unchanged");
  const policy={version:1,name:"cohesive-windows-without-demo-or-install-archives",roots:["artifacts",demo],preservedFiles:(await files(root)).filter(f=>f.path.startsWith("artifacts/")||f.path.startsWith(demo+"/"))},bytes=Buffer.from(JSON.stringify(policy)+"\n");
  await fn({parent,root,policy,bytes});
 }finally{await rm(parent,{recursive:true,force:true});}
}
test("curation retains every original outside the payload and leaves runtime/notices byte-identical",()=>fixture(async({root,bytes,policy})=>{
 const before=await files(root),record=await curatePayload(root,bytes,source),after=await files(root);
 assert.deepEqual(after,before.filter(f=>!policy.preservedFiles.some(p=>p.path===f.path)));
 const preserved=(await files(root+retainedSuffix)).filter(f=>f.path!=="preservation.json");assert.deepEqual(preserved,policy.preservedFiles);
 const receipt=JSON.parse(await readFile(join(root+retainedSuffix,"preservation.json")));assert.equal(receipt.sourceCommit,source);assert.equal(receipt.policySha256,record.policySha256);
 assert.equal(existsSync(join(root,"artifacts")),false);assert.equal(existsSync(join(root,demo)),false);
}));
for(const change of ["changed","missing","extra","nested archive","retention exists"]){
 test(`curation refuses ${change} before moving any input`,()=>fixture(async({root,bytes})=>{
  if(change==="changed")await put(root,demo+"/doom.wasm","different bytes");
  if(change==="missing")await rm(join(root,demo,"doom.wasm"));
  if(change==="extra")await put(root,demo+"/new.txt","not reviewed");
  if(change==="nested archive")await put(root,"node_modules/runtime/archive.tar.gz","not reviewed");
  if(change==="retention exists")await mkdir(root+retainedSuffix);
  const before=await files(root);await assert.rejects(curatePayload(root,bytes,source));assert.deepEqual(await files(root),before);
  if(change!=="retention exists")assert.equal(existsSync(root+retainedSuffix),false);
 }));
}
test("curation refuses a link anywhere before moving originals",()=>fixture(async({root,parent,bytes})=>{
 const target=join(parent,"foreign");await mkdir(target);await symlink(target,join(root,"unexpected"),process.platform==="win32"?"junction":"dir");await assert.rejects(curatePayload(root,bytes,source),/reparse/);assert.equal(existsSync(root+retainedSuffix),false);assert.equal(existsSync(join(root,"artifacts")),true);
}));
test("curation refuses retention links even when their target is missing",()=>fixture(async({root,parent,bytes})=>{
 await symlink(join(parent,"missing"),root+retainedSuffix,process.platform==="win32"?"junction":"dir");await assert.rejects(curatePayload(root,bytes,source),/Retention output exists/);assert.equal(existsSync(join(root,"artifacts")),true);
}));
test("curation policy rejects unsafe, duplicate, oversized and incomplete records",()=>fixture(async({policy})=>{
 for(const mutate of [p=>p.roots.push("node_modules/runtime"),p=>p.preservedFiles.pop(),p=>p.preservedFiles[0].path="../outside",p=>p.preservedFiles[1].path=p.preservedFiles[0].path,p=>p.preservedFiles[0].bytes=Infinity,p=>p.preservedFiles[0].sha256="not a digest",p=>p.preservedFiles[0].extra="unreviewed"]){const p=structuredClone(policy);mutate(p);assert.throws(()=>parsePolicy(Buffer.from(JSON.stringify(p))));}
 assert.throws(()=>parsePolicy(Buffer.from([0xff])));
}));
test("curated archive actually extracts without demo or original archives, independently of retained inputs",()=>fixture(async({parent,root,bytes})=>{
 const curation=await curatePayload(root,bytes,source);await put(root,"distribution/payload-policy.json",bytes);
 const manifest=await writeManifest(root,{platform:"win32-x64",sourceCommit:source,curation});await verifyBundle(root);await verifyCuration(root,manifest,bytes);
 const first=await archive(root,join(parent,"first.tar.gz")),second=await archive(root,join(parent,"second.tar.gz"));assert.equal(first,second);
 const extracted=join(parent,"real spaced extraction");await mkdir(extracted);run("tar",["-xzf",join(parent,"first.tar.gz"),"-C",extracted]);await verifyBundle(extracted);await verifyCuration(extracted,manifest,bytes);
 assert.equal(existsSync(extracted+retainedSuffix),false);assert.equal(existsSync(join(extracted,demo)),false);assert.equal(existsSync(join(extracted,"artifacts")),false);
}));
for(const tamper of ["record","demo","archive","policy"]){
 test(`installed curation proof rejects changed ${tamper}`,()=>fixture(async({root,bytes})=>{
  const curation=await curatePayload(root,bytes,source);await put(root,"distribution/payload-policy.json",bytes);const manifest={curation};
  if(tamper==="record")manifest.curation.policySha256="b".repeat(64);
  if(tamper==="demo")await put(root,demo+"/doom.wasm","not permitted");
  if(tamper==="archive")await put(root,"new.zip","not reviewed");
  if(tamper==="policy")await put(root,"distribution/payload-policy.json","{}");
  await assert.rejects(verifyCuration(root,manifest,bytes));
 }));
}
test("builder and both actual installed checks enforce curation without lock regeneration",async()=>{
 const read=p=>readFile(new URL("../../"+p,import.meta.url),"utf8"),builder=await read("distribution/build.mjs");
 assert.ok(builder.indexOf('npm(["ci"')<builder.indexOf("await curatePayload"));assert.ok(builder.indexOf("await curatePayload")<builder.indexOf("await archive"));
 assert.match(builder,/sourceCommit}:distribution\/payload-policy\.json/);assert.match(builder,/out\+retainedSuffix/);
 for(const p of ["distribution/accept.mjs","distribution/accept-profile.mjs"])assert.match(await read(p),/await verifyCuration/);
 assert.doesNotMatch(builder,/npm\(\["(?:install|update)"/);
 const policy=parsePolicy(await readFile(new URL("../payload-policy.json",import.meta.url))).policy;assert.equal(policy.preservedFiles.length,16);
});
