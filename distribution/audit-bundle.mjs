// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only, read-only inventory. Notice candidates are not redistribution clearance.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {isAbsolute,join,posix,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {safePath,verifyBundle} from "./lib.mjs";
const packageFile=/(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/;
const namedNotice=/(?:^|\/)(?:licen[cs]e[^/]*|copying[^/]*|notice[^/]*|third[-_]party[^/]*|copyright[^/]*)$/i;
const executable=/\.(?:exe|dll|node|wasm|so|a|lib|dylib)$/i;
const archive=/\.(?:tgz|tar(?:\.gz)?|zip|7z)$/i;
const compare=(a,b)=>a<b?-1:a>b?1:0;
const identity=(value,pattern)=>typeof value==="string"&&value.length<=214&&pattern.test(value)?value:"UNDECLARED";
export function ownsPackageFile(directory,path){
 safePath(directory);safePath(path);
 if(!path.startsWith(directory+"/"))return false;
 // A nested dependency's notice never covers its parent, including an immediate node_modules child.
 return !path.slice(directory.length+1).split("/").includes("node_modules");
}
/** Input files/reader must come from an already integrity-verified bundle, never executed package imports. */
export async function inventoryFiles(files,read){
 assert.ok(Array.isArray(files)&&files.length<=100000);
 const table=new Map();
 for(const f of files){safePath(f.path);assert.ok(!table.has(f.path.toLowerCase()));table.set(f.path.toLowerCase(),f);}
 const entry=f=>({path:f.path,bytes:f.bytes,sha256:f.sha256});
 const packages=[];
 for(const file of files.filter(f=>packageFile.test(f.path)).sort((a,b)=>compare(a.path,b.path))){
  const bytes=await read(file.path);assert.ok(bytes.length<=1024*1024,"Package metadata size bound");
  const p=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  assert.ok(p&&typeof p==="object"&&!Array.isArray(p));
  const directory=posix.dirname(file.path),owned=files.filter(f=>ownsPackageFile(directory,f.path));
  const notices=owned.filter(f=>namedNotice.test(f.path)).map(f=>({...entry(f),kind:"named-notice-candidate"}));
  // Some upstreams put the complete grant in README rather than a LICENSE file.
  for(const f of owned.filter(f=>/^readme(?:\.[^/]*)?$/i.test(f.path.slice(directory.length+1))&&f.bytes<=1024*1024)){
   const text=new TextDecoder("utf-8",{fatal:true}).decode(await read(f.path));
   if(/Permission is hereby granted/.test(text)&&/THE SOFTWARE IS PROVIDED/.test(text))notices.push({...entry(f),kind:"readme-grant-candidate"});
  }
  packages.push({path:directory,name:identity(p.name,/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/),version:identity(p.version,/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.+-]+)?$/),declaredLicense:identity(p.license,/^[A-Za-z0-9() .+_-]+$/),packageJson:entry(file),ownedFileCount:owned.length,noticeCandidates:notices.sort((a,b)=>compare(a.path,b.path))});
 }
 return {version:1,status:"inventory-only-not-release-clearance",packages,packagesWithoutOwnNoticeCandidate:packages.filter(p=>!p.noticeCandidates.length).map(p=>p.path),nonPackageNoticeCandidates:files.filter(f=>namedNotice.test(f.path)&&!packages.some(p=>ownsPackageFile(p.path,f.path))).map(entry).sort((a,b)=>compare(a.path,b.path)),nativePayloads:files.filter(f=>executable.test(f.path)).map(entry).sort((a,b)=>compare(a.path,b.path)),archives:files.filter(f=>archive.test(f.path)).map(entry).sort((a,b)=>compare(a.path,b.path)),limitations:["A candidate notice is not a license-scope or rights determination; shared and embedded notices require review.","Installed package metadata does not enumerate host-bundled JavaScript, vendored code, or native/WASM dependencies.","Archive members are not inspected here; inventory is not source, security, signing or release acceptance."]};
}
export async function auditBundle(bundle){
 assert.ok(isAbsolute(bundle),"Absolute verified bundle path required");
 const {manifest,digest}=await verifyBundle(bundle);
 return {sourceCommit:manifest.sourceCommit,manifestSha256:digest,release:manifest.release,...await inventoryFiles(manifest.files,path=>readFile(join(bundle,path)))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{assert.equal(process.argv.length,3);console.log(JSON.stringify(await auditBundle(process.argv[2]),null,2));}
 catch{console.error("BUNDLE_INVENTORY_FAILED; use matching trusted source and one absolute verified bundle path. No input paths or payloads reported.");process.exitCode=1;}
}
