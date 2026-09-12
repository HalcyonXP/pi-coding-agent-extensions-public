// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Data-only verification. A pinned supplemental notice is not redistribution clearance.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,lstat} from "node:fs/promises";
import {isAbsolute,join} from "node:path";
import {safePath,sha256} from "./lib.mjs";
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),expected.sort());
const text=(value,pattern,max=214)=>{assert.equal(typeof value,"string");assert.ok(value.length<=max);assert.match(value,pattern);};
const digest=value=>text(value,/^[a-f0-9]{64}$/,64);
const decode=(bytes,max)=>{assert.ok(bytes instanceof Uint8Array&&bytes.byteLength<=max);return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));};
export function parseSupplementalNotices(bytes){
 const policy=decode(bytes,128*1024);
 keys(policy,["version","scope","entries"]);assert.equal(policy.version,2);assert.equal(policy.scope,"supplemental-notice-presence-only");
 assert.ok(Array.isArray(policy.entries)&&policy.entries.length>0&&policy.entries.length<=64);
 const seen=new Set(),files=new Map(),notices=new Map();
 const pin=(f,prefix,max)=>{
  keys(f,["path","bytes","sha256"]);safePath(f.path);assert.ok(f.path.startsWith(prefix));
  assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>0&&f.bytes<=max);digest(f.sha256);
  const key=f.path.toLowerCase();if(files.has(key))assert.deepEqual(files.get(key),f,"Conflicting supplemental file pins");else files.set(key,f);
 };
 for(const e of policy.entries){
  keys(e,["packagePath","name","version","declaredLicense","packageJsonSha256","npmIntegrity","noticePath","noticeBytes","noticeSha256","upstream","coverage"]);
  safePath(e.packagePath);assert.ok(e.packagePath.startsWith("node_modules/"));text(e.name,/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/);
  assert.ok(e.packagePath.endsWith("/"+e.name));
  const c=e.coverage;let identity=e.packagePath+"#package";
  if(c.kind==="package")keys(c,["kind"]);
  else if(c.kind==="embedded-file"){
   keys(c,["kind","name","registry","sourcePackage","sourceVersion","registryArchiveSha256","sourceFile","consumer","offset","attribution"]);
   text(c.name,/^[A-Za-z0-9._-]+$/);assert.equal(c.registry,"crates.io");text(c.sourcePackage,/^[a-z0-9_-]+$/);
   text(c.sourceVersion,/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/);digest(c.registryArchiveSha256);
   keys(c.sourceFile,["path","bytes","sha256","gitBlob"]);safePath(c.sourceFile.path);digest(c.sourceFile.sha256);text(c.sourceFile.gitBlob,/^[a-f0-9]{40}$/,40);
   assert.ok(Number.isSafeInteger(c.sourceFile.bytes)&&c.sourceFile.bytes>0&&c.sourceFile.bytes<=2*1024*1024);
   pin(c.consumer,e.packagePath+"/",16*1024*1024);
   assert.ok(Number.isSafeInteger(c.offset)&&c.offset>=0&&c.offset+c.sourceFile.bytes<=c.consumer.bytes,"Embedded source range outside consumer");
   text(c.attribution,/^[^\u0000-\u001f]+$/,1024);identity=e.packagePath+"#embedded-file:"+c.name;
  }
  else{
   keys(c,["kind","name","version","registry","registryArchiveSha256","sourceFiles","declaredNativeConsumers"]);assert.equal(c.kind,"vendored-source");assert.equal(c.registry,"crates.io");
   text(c.name,/^[a-z0-9_-]+$/);text(c.version,/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/);digest(c.registryArchiveSha256);
   assert.ok(Array.isArray(c.sourceFiles)&&c.sourceFiles.length>0&&c.sourceFiles.length<=64);
   assert.ok(Array.isArray(c.declaredNativeConsumers)&&c.declaredNativeConsumers.length<=16);
   const local=new Set();
   for(const f of [...c.sourceFiles,...c.declaredNativeConsumers]){assert.ok(!local.has(f.path.toLowerCase()),"Duplicate supplemental file");local.add(f.path.toLowerCase());}
   for(const f of c.sourceFiles)pin(f,e.packagePath+"/",2*1024*1024);
   for(const f of c.declaredNativeConsumers)pin(f,"node_modules/",16*1024*1024);
   identity=e.packagePath+"#vendored-source:"+c.name+"@"+c.version;
  }
  assert.ok(!seen.has(identity.toLowerCase()));seen.add(identity.toLowerCase());
  text(e.version,/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/);text(e.declaredLicense,/^[A-Za-z0-9() .+_-]+$/);
  digest(e.packageJsonSha256);text(e.npmIntegrity,/^sha512-[A-Za-z0-9+/]{86}==$/,95);
  assert.equal(Buffer.from(e.npmIntegrity.slice(7),"base64").toString("base64"),e.npmIntegrity.slice(7));
  safePath(e.noticePath);assert.match(e.noticePath,/^distribution\/notices\/LICENSE\.[A-Za-z0-9._-]+$/);
  assert.ok(Number.isSafeInteger(e.noticeBytes)&&e.noticeBytes>0&&e.noticeBytes<=64*1024);digest(e.noticeSha256);
  keys(e.upstream,["repository","commit","path","gitBlob"]);text(e.upstream.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
  text(e.upstream.commit,/^[a-f0-9]{40}$/,40);safePath(e.upstream.path);text(e.upstream.gitBlob,/^[a-f0-9]{40}$/,40);
  // upstream identifies the notice source, not a claim about the npm build's source commit.
  const noticeKey=e.noticePath.toLowerCase(),noticePin={path:e.noticePath,bytes:e.noticeBytes,sha256:e.noticeSha256,upstream:e.upstream};
  if(notices.has(noticeKey))assert.deepEqual(notices.get(noticeKey),noticePin,"Conflicting shared notice pins");else notices.set(noticeKey,noticePin);
 }
 assert.ok(files.size<=512&&[...files.values()].reduce((n,f)=>n+f.bytes,0)<=32*1024*1024,"Supplemental file budget exceeded");
 return policy;
}
async function boundedFile(path,max){const s=await lstat(path);assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.size<=max);const b=await readFile(path);assert.ok(b.length<=max);return b;}
/** Input is an integrity-verified bundle or freshly curated, integrity-locked build tree.
 * No package imports, registry access, copying, license inference or dependency-closure claims.
 */
export async function verifySupplementalNotices(root,policyBytes){
 assert.ok(isAbsolute(root));
 const policy=parseSupplementalNotices(policyBytes);
 const lock=decode(await boundedFile(join(root,"package-lock.json"),8*1024*1024),8*1024*1024);
 assert.equal(lock.lockfileVersion,3);assert.ok(lock.packages&&typeof lock.packages==="object");
 const entries=[],verifiedFiles=new Set();
 for(const e of policy.entries){
  const packageBytes=await boundedFile(join(root,e.packagePath,"package.json"),1024*1024);
  const p=decode(packageBytes,1024*1024);assert.equal(sha256(packageBytes),e.packageJsonSha256,"Supplemental notice package bytes changed");
  assert.deepEqual([p.name,p.version,p.license],[e.name,e.version,e.declaredLicense]);
  assert.equal(lock.packages[e.packagePath]?.version,e.version);assert.equal(lock.packages[e.packagePath]?.integrity,e.npmIntegrity);
  const notice=await boundedFile(join(root,e.noticePath),64*1024);assert.equal(notice.length,e.noticeBytes);assert.equal(sha256(notice),e.noticeSha256);
  new TextDecoder("utf-8",{fatal:true}).decode(notice);
  const blob=createHash("sha1").update(Buffer.from(`blob ${notice.length}\0`)).update(notice).digest("hex");
  assert.equal(blob,e.upstream.gitBlob,"Supplemental notice differs from reviewed upstream blob");
  if(e.coverage.kind==="vendored-source")for(const f of [...e.coverage.sourceFiles,...e.coverage.declaredNativeConsumers]){
   if(verifiedFiles.has(f.path))continue;
   const bytes=await boundedFile(join(root,f.path),f.bytes);
   assert.equal(bytes.length,f.bytes,"Supplemental component file size changed");assert.equal(sha256(bytes),f.sha256,"Supplemental component file bytes changed");verifiedFiles.add(f.path);
  }
  if(e.coverage.kind==="embedded-file"){
   const c=e.coverage,bytes=await boundedFile(join(root,c.consumer.path),c.consumer.bytes);
   assert.equal(bytes.length,c.consumer.bytes);assert.equal(sha256(bytes),c.consumer.sha256,"Supplemental embedded consumer changed");
   const embedded=bytes.subarray(c.offset,c.offset+c.sourceFile.bytes);
   assert.equal(sha256(embedded),c.sourceFile.sha256,"Supplemental embedded source bytes changed");
   assert.equal(createHash("sha1").update(Buffer.from(`blob ${embedded.length}\0`)).update(embedded).digest("hex"),c.sourceFile.gitBlob,"Supplemental embedded source blob changed");
  }
  entries.push({packagePath:e.packagePath,name:e.name,version:e.version,noticePath:e.noticePath,noticeSha256:e.noticeSha256,coverage:e.coverage});
 }
 return {version:2,status:policy.scope,policySha256:sha256(policyBytes),entries};
}
