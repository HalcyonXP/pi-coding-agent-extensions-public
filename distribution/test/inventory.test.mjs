// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {auditBundle,inventoryFiles,ownsPackageFile} from "../audit-bundle.mjs";
import {sha256,writeManifest} from "../lib.mjs";
const fixture=entries=>({files:Object.entries(entries).map(([path,text])=>({path,bytes:Buffer.byteLength(text),sha256:sha256(Buffer.from(text))})),read:async path=>Buffer.from(entries[path])});
const metadata=(name="parent",license="MIT",version="1.0.0")=>JSON.stringify({name,version,license,author:"not inventory data",repository:"not inventory data"});
test("nested notice ownership never leaks into parent package",()=>{
 assert.equal(ownsPackageFile("node_modules/parent","node_modules/parent/LICENSE"),true);
 for(const path of ["node_modules/parent/node_modules/child/LICENSE","node_modules/parent/deep/node_modules/@scope/child/LICENSE","node_modules/parent-other/LICENSE"])assert.equal(ownsPackageFile("node_modules/parent",path),false);
 assert.equal(ownsPackageFile("node_modules/parent/node_modules/@scope/child","node_modules/parent/node_modules/@scope/child/LICENSE"),true);
});
test("a child license cannot hide a parent missing-notice finding",async()=>{
 const f=fixture({"node_modules/parent/package.json":metadata(),"node_modules/parent/node_modules/child/package.json":metadata("child"),"node_modules/parent/node_modules/child/LICENSE":"MIT"});
 const r=await inventoryFiles(f.files,f.read);assert.deepEqual(r.packagesWithoutOwnNoticeCandidate,["node_modules/parent"]);assert.equal(r.packages.find(p=>p.name==="parent").ownedFileCount,1);
});
test("all versions and locations remain distinct rather than last-name-wins",async()=>{
 const f=fixture({"node_modules/a/package.json":metadata("a","MIT","1.0.0"),"node_modules/parent/node_modules/a/package.json":metadata("a","MIT","2.0.0")});
 const r=await inventoryFiles(f.files,f.read);assert.deepEqual(r.packages.map(p=>p.version),["1.0.0","2.0.0"]);
});
test("complete README grants are candidates but a license mention alone is not",async()=>{
 const f=fixture({"node_modules/a/package.json":metadata("a"),"node_modules/a/README.md":"Permission is hereby granted ... THE SOFTWARE IS PROVIDED ...","node_modules/b/package.json":metadata("b"),"node_modules/b/README.md":"MIT licensed. See upstream."});
 const r=await inventoryFiles(f.files,f.read);assert.equal(r.packages[0].noticeCandidates[0].kind,"readme-grant-candidate");assert.deepEqual(r.packagesWithoutOwnNoticeCandidate,["node_modules/b"]);
});
test("root and vendored notices are retained separately with actual byte pins",async()=>{
 const f=fixture({"host-patches/pi/LICENSE.pi":"shared license","node_modules/a/package.json":metadata("a"),"node_modules/a/vendor/COPYING":"other terms"});
 const r=await inventoryFiles(f.files,f.read);assert.equal(r.nonPackageNoticeCandidates[0].sha256,f.files[0].sha256);assert.equal(r.packages[0].noticeCandidates[0].path,"node_modules/a/vendor/COPYING");assert.match(r.status,/not-release-clearance/);assert.equal(Object.hasOwn(r,"releaseReady"),false);
});
test("native executables, WASM and archives are visible even in optional demos",async()=>{
 const f=fixture({"artifacts/host.tgz":"archive","node_modules/pi/examples/demo/game.wasm":"wasm","node_modules/native/driver.node":"native","runtime/Helper.exe":"pe","plain.js":"js"});
 const r=await inventoryFiles(f.files,f.read);assert.equal(r.nativePayloads.length,3);assert.equal(r.archives.length,1);
});
test("inventory emits only bounded identity fields, never authors or unknown metadata",async()=>{
 const f=fixture({"node_modules/a/package.json":JSON.stringify({name:"bad\nname",version:"untrusted version",license:{text:"payload"},author:"hidden author",scripts:{install:"not executed"}})});
 const r=await inventoryFiles(f.files,f.read);assert.equal(r.packages[0].name,"UNDECLARED");assert.equal(r.packages[0].version,"UNDECLARED");assert.equal(r.packages[0].declaredLicense,"UNDECLARED");assert.ok(!JSON.stringify(r).includes("hidden author"));
});
test("invalid paths and case-colliding manifest entries fail closed",async()=>{
 for(const entries of [{"../outside":"x"},{"node_modules/A/LICENSE":"x","node_modules/a/license":"y"}]){const f=fixture(entries);await assert.rejects(()=>inventoryFiles(f.files,f.read));}
 assert.throws(()=>ownsPackageFile("../outside","node_modules/a/LICENSE"));
});
test("invalid UTF-8, non-object and oversized package metadata are rejected",async()=>{
 for(const bytes of [Buffer.from([0xff]),Buffer.from("[]"),Buffer.alloc(1024*1024+1,32)])await assert.rejects(()=>inventoryFiles([{path:"node_modules/a/package.json",bytes:bytes.length,sha256:sha256(bytes)}],async()=>bytes));
});
test("stable ordering makes inventory independent of filesystem enumeration",async()=>{
 const f=fixture({"node_modules/z/package.json":metadata("z"),"node_modules/a/package.json":metadata("a"),"NOTICE":"notice"});
 assert.deepEqual(await inventoryFiles(f.files,f.read),await inventoryFiles([...f.files].reverse(),f.read));
});
test("actual manifested inventory is read-only and refuses changed bytes",async()=>{
 const root=await mkdtemp(join(tmpdir(),"pi-inventory-"));await mkdir(join(root,"node_modules/a"),{recursive:true});await writeFile(join(root,"node_modules/a/package.json"),metadata("a"));
 await writeManifest(root,{platform:"win32-x64",sourceCommit:"1".repeat(40),release:"0.3.0-private.1",nodeMajors:[24,25]});
 const before=await auditBundle(root),after=await auditBundle(root);assert.deepEqual(before,after);assert.equal(before.packages.length,1);
 await writeFile(join(root,"node_modules/a/package.json"),metadata("changed"));await assert.rejects(()=>auditBundle(root));await assert.rejects(()=>auditBundle("relative"));
});
test("CLI failure never prints the rejected path and cannot execute package scripts",()=>{
 const script=fileURLToPath(new URL("../audit-bundle.mjs",import.meta.url));
 const result=spawnSync(process.execPath,[script,"unpublished-input"],{encoding:"utf8"});assert.equal(result.status,1);assert.equal(result.stdout,"");assert.ok(!result.stderr.includes("unpublished-input"));assert.match(result.stderr,/BUNDLE_INVENTORY_FAILED/);
 assert.throws(()=>execFileSync(process.execPath,[script,"--help","extra"],{stdio:"pipe"}));
});
