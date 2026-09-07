// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only: only a newly created, trusted-local build tree is eligible.
import assert from "node:assert/strict";
import {mkdir,rename,lstat,writeFile,readFile} from "node:fs/promises";
import {resolve,dirname,join,isAbsolute} from "node:path";
import {files,sha256,safePath} from "./lib.mjs";
export const retainedSuffix=".build-inputs";
const roots=["artifacts","node_modules/@earendil-works/pi-coding-agent/examples/extensions/doom-overlay"];
const archivePath=path=>/\.(?:tgz|tbz2?|txz|tar(?:\.(?:gz|bz2|xz|zst))?|zip|7z|rar|cab)$/i.test(path);
const omitted=path=>roots.some(root=>path===root||path.startsWith(root+"/"));
async function absent(path){try{await lstat(path);}catch(error){if(error.code==="ENOENT")return;throw error;}throw new Error("Retention output exists; preserve it and choose a new build path");}
export function parsePolicy(bytes){
 assert.ok(bytes instanceof Uint8Array&&bytes.byteLength<=64*1024,"Bounded policy bytes required");
 const p=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 assert.deepEqual(Object.keys(p).sort(),["name","preservedFiles","roots","version"]);
 assert.equal(p.version,1);assert.equal(p.name,"cohesive-windows-without-demo-or-install-archives");assert.deepEqual(p.roots,roots);
 assert.ok(Array.isArray(p.preservedFiles)&&p.preservedFiles.length===16,"Exact reviewed exclusion inventory required");
 const seen=new Set();for(const f of p.preservedFiles){safePath(f.path);assert.ok(omitted(f.path)&&!roots.includes(f.path));assert.ok(!seen.has(f.path.toLowerCase()));seen.add(f.path.toLowerCase());assert.ok(Number.isSafeInteger(f.bytes)&&f.bytes>=0&&f.bytes<=128*1024*1024);assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.deepEqual(Object.keys(f).sort(),["bytes","path","sha256"]);}
 assert.equal(p.preservedFiles.filter(f=>f.path.startsWith("artifacts/")).length,6);
 return {policy:p,digest:sha256(bytes)};
}
/** Retain original inputs outside the runtime tree; never repack or delete them. */
export async function curatePayload(root,policyBytes,sourceCommit){
 assert.ok(isAbsolute(root));assert.match(sourceCommit,/^[a-f0-9]{40}$/);root=resolve(root);
 const retained=root+retainedSuffix;await absent(retained);
 const {policy,digest}=parsePolicy(policyBytes),before=await files(root);
 assert.deepEqual(before.filter(f=>omitted(f.path)),policy.preservedFiles,"Exclusion inputs changed; review new bytes instead of regenerating the policy during build");
 const remaining=before.filter(f=>!omitted(f.path));assert.ok(remaining.every(f=>!archivePath(f.path)),"Unreviewed archive elsewhere in runtime payload");
 // All checks precede the first move. Partial failures leave evidence, not a reusable output.
 await mkdir(retained);
 for(const prefix of roots){const target=join(retained,prefix);await mkdir(dirname(target),{recursive:true});await rename(join(root,prefix),target);}
 assert.deepEqual(await files(root),remaining,"A retained runtime file changed during curation");
 assert.deepEqual(await files(retained),policy.preservedFiles,"Original inputs were not retained byte-identically");
 const record={version:1,policy:policy.name,policySha256:digest,retainedBuildInputsSuffix:retainedSuffix,preservedFiles:policy.preservedFiles};
 await writeFile(join(retained,"preservation.json"),JSON.stringify({sourceCommit,...record},null,2)+"\n",{flag:"wx"});
 return record;
}
/** Matching-source installed check; a curation record is not redistribution clearance. */
export async function verifyCuration(root,manifest,policyBytes){
 const {policy,digest}=parsePolicy(policyBytes);
 assert.deepEqual(manifest.curation,{version:1,policy:policy.name,policySha256:digest,retainedBuildInputsSuffix:retainedSuffix,preservedFiles:policy.preservedFiles});
 const actual=await files(root);assert.ok(actual.every(f=>!omitted(f.path)&&!archivePath(f.path)),"Excluded demo or archive is present in runtime payload");
 // This source pin is also packaged, so consumer provenance is self-contained.
 assert.equal(sha256(await readFile(join(root,"distribution","payload-policy.json"))),digest);
}
