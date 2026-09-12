// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {parseSupplementalNotices,verifySupplementalNotices} from "../supplemental-notices.mjs";
import {sha256,writeManifest} from "../lib.mjs";
import {auditBundle} from "../audit-bundle.mjs";
const notice=Buffer.from("Synthetic notice fixture; not a license grant.\n");
const metadata=Buffer.from(JSON.stringify({name:"example",version:"1.2.3",license:"MIT",scripts:{install:"must not execute"}}));
const integrity="sha512-"+Buffer.alloc(64,1).toString("base64");
const base=()=>({version:2,scope:"supplemental-notice-presence-only",entries:[{
 packagePath:"node_modules/example",name:"example",version:"1.2.3",declaredLicense:"MIT",packageJsonSha256:sha256(metadata),npmIntegrity:integrity,
 noticePath:"distribution/notices/LICENSE.example",noticeBytes:notice.length,noticeSha256:sha256(notice),coverage:{kind:"package"},
 upstream:{repository:"example/source",commit:"a".repeat(40),path:"libraries/LICENSE",gitBlob:createHash("sha1").update(Buffer.from(`blob ${notice.length}\0`)).update(notice).digest("hex")},
}]});
const encode=p=>Buffer.from(JSON.stringify(p));
async function fixture(policy=base()){
 const root=await mkdtemp(join(tmpdir(),"pi-supplemental-notice-"));
 await mkdir(join(root,"node_modules/example"),{recursive:true});await mkdir(join(root,"distribution/notices"),{recursive:true});
 await writeFile(join(root,"node_modules/example/package.json"),metadata);await writeFile(join(root,"distribution/notices/LICENSE.example"),notice);
 await writeFile(join(root,"package-lock.json"),JSON.stringify({lockfileVersion:3,packages:{"node_modules/example":{version:"1.2.3",integrity}}}));
 await writeFile(join(root,"distribution/supplemental-notices.json"),encode(policy));return root;
}
test("canonical supplemental source grants retain byte and upstream blob pins",async()=>{
 const bytes=await readFile(new URL("../supplemental-notices.json",import.meta.url)),p=parseSupplementalNotices(bytes);
 assert.equal(p.entries.length,6);const e=p.entries[0];assert.equal(e.name,"standardwebhooks");assert.equal(e.version,"1.1.1");assert.equal(e.upstream.path,"libraries/LICENSE");
 const b=await readFile(new URL("../notices/LICENSE.standardwebhooks",import.meta.url));assert.equal(b.length,e.noticeBytes);assert.equal(sha256(b),e.noticeSha256);
 assert.equal(createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex"),e.upstream.gitBlob);
 assert.match(b.toString(),/Copyright \(c\) 2023 Svix/);assert.match(b.toString(),/Permission is hereby granted/);
});
for(const [label,mutate] of [
 ["unknown field",p=>p.releaseReady=true],["unreviewed version",p=>p.version=3],["clearance claim",p=>p.scope="release-cleared"],
 ["empty rules",p=>p.entries=[]],["duplicate component",p=>p.entries.push(structuredClone(p.entries[0]))],
 ["traversal",p=>p.entries[0].packagePath="node_modules/../outside"],["wrong component path",p=>p.entries[0].packagePath="node_modules/other"],
 ["notice outside destination",p=>p.entries[0].noticePath="host-patches/LICENSE"],["oversized notice",p=>p.entries[0].noticeBytes=65537],
 ["invalid hash",p=>p.entries[0].noticeSha256="x".repeat(64)],["moving upstream ref",p=>p.entries[0].upstream.commit="main"],
 ["unpinned npm bytes",p=>p.entries[0].npmIntegrity="sha512-not-integrity"],
 ["obsolete draft schema",p=>p.version=1],["missing coverage",p=>delete p.entries[0].coverage],
 ["whole-package hidden clearance",p=>p.entries[0].coverage.releaseCleared=true],
])test(`supplemental policy refuses ${label}`,()=>{const p=base();mutate(p);assert.throws(()=>parseSupplementalNotices(encode(p)));});
test("policy parsing is byte-bounded and requires fatal UTF-8",()=>{
 for(const b of [Buffer.from([255]),Buffer.alloc(128*1024+1),Buffer.from("null")])assert.throws(()=>parseSupplementalNotices(b));
});
test("verification binds actual package, lock and notice without altering upstream metadata",async()=>{
 const p=base(),root=await fixture(p),r=await verifySupplementalNotices(root,encode(p));
 assert.equal(r.status,"supplemental-notice-presence-only");assert.equal(r.policySha256,sha256(encode(p)));assert.equal(r.entries.length,1);
 assert.deepEqual(await readFile(join(root,"node_modules/example/package.json")),metadata);assert.equal(Object.hasOwn(r,"releaseReady"),false);
 await assert.rejects(()=>verifySupplementalNotices("relative",encode(p)));
});
for(const [label,path,bytes] of [
 ["package metadata","node_modules/example/package.json",Buffer.from('{"name":"changed"}')],
 ["upstream notice","distribution/notices/LICENSE.example",Buffer.from("changed")],
 ["consumer lock","package-lock.json",Buffer.from('{"lockfileVersion":3,"packages":{}}')],
])test(`verification refuses changed ${label}`,async()=>{const p=base(),root=await fixture(p);await writeFile(join(root,path),bytes);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)));});
test("an unrelated upstream blob cannot certify matching SHA256 notice data",async()=>{
 const p=base();p.entries[0].upstream.gitBlob="b".repeat(40);const root=await fixture(p);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/upstream blob/);
});
test("audited supplement does not erase a missing-own-notice finding or imply clearance",async()=>{
 const p=base(),root=await fixture(p),supplementalNotices=await verifySupplementalNotices(root,encode(p));
 await writeManifest(root,{platform:"win32-x64",sourceCommit:"c".repeat(40),supplementalNotices});
 const r=await auditBundle(root);assert.deepEqual(r.packagesWithoutOwnNoticeCandidate,["node_modules/example"]);
 assert.deepEqual(r.supplementalNotices,supplementalNotices);assert.equal(r.status,"inventory-only-not-release-clearance");
});
test("manifest cannot relabel a verified supplemental notice as release clearance",async()=>{
 const p=base(),root=await fixture(p),supplementalNotices=await verifySupplementalNotices(root,encode(p));supplementalNotices.status="release-cleared";
 await writeManifest(root,{platform:"win32-x64",sourceCommit:"d".repeat(40),supplementalNotices});await assert.rejects(()=>auditBundle(root),/record differs/);
});
test("builder explicitly copies canonical grants and validates the manifested record",async()=>{
 const source=await readFile(new URL("../build.mjs",import.meta.url),"utf8");
 assert.ok(source.includes('new Set(["distribution/supplemental-notices.json","distribution/supplemental-notices.mjs",...supplementalPolicy.entries.map(e=>e.noticePath)])'));assert.ok(source.includes('copySource(path,join(out,path))'));
 assert.ok(source.includes('assert.deepEqual(await verifySupplementalNotices(out,supplementalBytes),manifest.supplementalNotices)'));
});
// Vendored-source scope must remain distinct from its containing npm package.
const sourceBytes=Buffer.from("// Synthetic vendored source, not executable\n");
const consumerBytes=Buffer.from("Synthetic native consumer; must never execute\n");
const vendored=()=>{const p=base();p.entries[0].coverage={kind:"vendored-source",registry:"crates.io",name:"example-core",version:"0.3.1",registryArchiveSha256:"a".repeat(64),sourceFiles:[{path:"node_modules/example/source.rs",bytes:sourceBytes.length,sha256:sha256(sourceBytes)}],declaredNativeConsumers:[{path:"node_modules/example/native.bin",bytes:consumerBytes.length,sha256:sha256(consumerBytes)}]};return p;};
async function vendoredFixture(p=vendored()){const root=await fixture(p);await writeFile(join(root,"node_modules/example/source.rs"),sourceBytes);await writeFile(join(root,"node_modules/example/native.bin"),consumerBytes);return root;}
for(const [label,mutate] of [
 ["empty source set",c=>c.sourceFiles=[]],["unknown scope",c=>c.kind="entire-native-binary"],
 ["source outside parent",c=>c.sourceFiles[0].path="node_modules/other/source.rs"],
 ["consumer outside packages",c=>c.declaredNativeConsumers[0].path="outside/native.bin"],
 ["duplicate source",c=>c.sourceFiles.push(structuredClone(c.sourceFiles[0]))],
 ["overlapping source and consumer",c=>c.declaredNativeConsumers.push(structuredClone(c.sourceFiles[0]))],
 ["unbounded source",c=>c.sourceFiles[0].bytes=2*1024*1024+1],
 ["unbounded consumer",c=>c.declaredNativeConsumers[0].bytes=16*1024*1024+1],
 ["invented binary reproduction",c=>c.binaryReproduced=true],
 ["unversioned crate",c=>c.version="latest"],["missing archive pin",c=>delete c.registryArchiveSha256],
 ["ambiguous registry",c=>c.registry="other-registry"],
])test(`vendored supplemental scope refuses ${label}`,()=>{const p=vendored();mutate(p.entries[0].coverage);assert.throws(()=>parseSupplementalNotices(encode(p)));});
test("vendored notice pins source and declared native bytes without granting the whole parent",async()=>{
 const p=vendored(),root=await vendoredFixture(p),r=await verifySupplementalNotices(root,encode(p));
 assert.equal(r.version,2);assert.deepEqual(r.entries[0].coverage,p.entries[0].coverage);
 await writeManifest(root,{platform:"win32-x64",sourceCommit:"a".repeat(40),supplementalNotices:r});
 const audit=await auditBundle(root);assert.deepEqual(audit.packagesWithoutOwnNoticeCandidate,["node_modules/example"]);
 r.entries[0].coverage={kind:"package"};const forgedRoot=await vendoredFixture(p);
 await writeManifest(forgedRoot,{platform:"win32-x64",sourceCommit:"a".repeat(40),supplementalNotices:r});
 await assert.rejects(()=>auditBundle(forgedRoot),/record differs/);
});
for(const path of ["source.rs","native.bin"])test(`vendored verifier refuses changed ${path}`,async()=>{
 const p=vendored(),root=await vendoredFixture(p),f=join(root,"node_modules/example",path),b=await readFile(f);b[0]^=1;await writeFile(f,b);
 await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/component file bytes changed/);
});
test("supplemental file pins have aggregate bounds and reject case-conflicting identities",()=>{
 const p=vendored(),c=p.entries[0].coverage;c.declaredNativeConsumers=Array.from({length:3},(_,i)=>({path:`node_modules/example/${i}.bin`,bytes:16*1024*1024,sha256:"b".repeat(64)}));
 assert.throws(()=>parseSupplementalNotices(encode(p)),/file budget exceeded/);
 const q=vendored(),other=structuredClone(q.entries[0]);other.coverage.name="different-core";other.coverage.sourceFiles[0].sha256="c".repeat(64);q.entries.push(other);
 assert.throws(()=>parseSupplementalNotices(encode(q)),/Conflicting supplemental file pins/);
});
test("canonical clipboard-rs MIT grant preserves attribution and seven derivative-source pins, not a wrapper grant",async()=>{
 const p=parseSupplementalNotices(await readFile(new URL("../supplemental-notices.json",import.meta.url))),e=p.entries[1];
 assert.equal(e.name,"@mariozechner/clipboard");assert.equal(e.coverage.kind,"vendored-source");assert.equal(e.coverage.name,"clipboard-rs");assert.equal(e.coverage.version,"0.3.1");
 assert.equal(e.coverage.sourceFiles.length,7);assert.equal(e.coverage.declaredNativeConsumers.length,1);
 assert.ok(e.coverage.sourceFiles.every(f=>!f.path.endsWith("wayland.rs")));
 const b=await readFile(new URL("../notices/LICENSE.clipboard-rs",import.meta.url));assert.equal(b.length,e.noticeBytes);assert.equal(sha256(b),e.noticeSha256);
 assert.match(b.toString(),/Copyright \(c\) 2024 桃树夭/);assert.match(b.toString(),/Permission is hereby granted/);
 assert.equal(createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex"),e.upstream.gitBlob);
 assert.equal(Object.hasOwn(e.coverage,"binaryReproduced"),false);
});
const embeddedSource=Buffer.from("Synthetic embedded file; fixture only"),embeddedConsumer=Buffer.concat([Buffer.from("prefix"),embeddedSource,Buffer.from("suffix")]);
const embedded=()=>{const p=base();p.entries[0].coverage={kind:"embedded-file",name:"example.font",registry:"crates.io",sourcePackage:"example-source",sourceVersion:"0.3.3",registryArchiveSha256:"a".repeat(64),sourceFile:{path:"fonts/example.font",bytes:embeddedSource.length,sha256:sha256(embeddedSource),gitBlob:createHash("sha1").update(Buffer.from(`blob ${embeddedSource.length}\0`)).update(embeddedSource).digest("hex")},consumer:{path:"node_modules/example/native.bin",bytes:embeddedConsumer.length,sha256:sha256(embeddedConsumer)},offset:6,attribution:"Synthetic attribution; fixture only"};return p;};
async function embeddedFixture(p=embedded()){const root=await fixture(p);await writeFile(join(root,"node_modules/example/native.bin"),embeddedConsumer);return root;}
for(const [label,mutate] of [
 ["negative offset",c=>c.offset=-1],["fractional offset",c=>c.offset=0.5],["overflowing range",c=>c.offset=c.consumer.bytes],
 ["foreign consumer",c=>c.consumer.path="node_modules/other/native.bin"],["oversized source",c=>c.sourceFile.bytes=2097153],
 ["source traversal",c=>c.sourceFile.path="../font"],["invented binary clearance",c=>c.binaryCleared=true],
 ["missing attribution",c=>delete c.attribution],["moving source version",c=>c.sourceVersion="latest"],
])test(`embedded supplemental scope refuses ${label}`,()=>{const p=embedded();mutate(p.entries[0].coverage);assert.throws(()=>parseSupplementalNotices(encode(p)));});
test("embedded file verification binds the precise source bytes inside the exact consumer",async()=>{
 const p=embedded(),root=await embeddedFixture(p),r=await verifySupplementalNotices(root,encode(p));assert.deepEqual(r.entries[0].coverage,p.entries[0].coverage);
 assert.deepEqual(await readFile(join(root,"node_modules/example/native.bin")),embeddedConsumer);
});
for(const [label,mutate,error] of [
 ["wrong source bytes",c=>c.sourceFile.sha256="b".repeat(64),/embedded source bytes changed/],
 ["wrong source blob",c=>c.sourceFile.gitBlob="b".repeat(40),/embedded source blob changed/],
 ["wrong offset",c=>c.offset=5,/embedded source bytes changed/],
 ["wrong consumer",c=>c.consumer.sha256="b".repeat(64),/embedded consumer changed/],
])test(`embedded verification refuses ${label}`,async()=>{const p=embedded();mutate(p.entries[0].coverage);const root=await embeddedFixture(p);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),error);});
test("Photon supplement identifies only the exact embedded Roboto-Regular font and preserves its grant",async()=>{
 const p=parseSupplementalNotices(await readFile(new URL("../supplemental-notices.json",import.meta.url))),e=p.entries[2],c=e.coverage;
 assert.equal(e.name,"@silvia-odwyer/photon-node");assert.equal(e.version,"0.3.4");assert.equal(c.kind,"embedded-file");assert.equal(c.name,"Roboto-Regular.ttf");
 assert.equal(c.sourcePackage,"photon-rs");assert.equal(c.sourceVersion,"0.3.3");assert.equal(c.offset,1403285);assert.equal(c.sourceFile.bytes,171676);
 assert.equal(c.attribution,"Copyright 2011 Google Inc. All Rights Reserved.");
 const b=await readFile(new URL("../notices/LICENSE.photon-roboto",import.meta.url));assert.equal(b.length,e.noticeBytes);assert.equal(sha256(b),e.noticeSha256);
 assert.equal(createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex"),e.upstream.gitBlob);
 assert.match(b.toString(),/Apache License/);assert.match(b.toString(),/Version 2.0, January 2004/);
 const attributes=await readFile(new URL("../../.gitattributes",import.meta.url),"utf8");assert.match(attributes,/distribution\/notices\/LICENSE\.\* -text/);
 assert.equal(Object.hasOwn(c,"binaryReproduced"),false);
});
// A shared grant is one immutable file associated with distinct declared packages.
const shared=()=>{const p=base(),other=structuredClone(p.entries[0]);other.packagePath="node_modules/second";other.name="second";other.version="4.5.6";other.packageJsonSha256=sha256(Buffer.from(JSON.stringify({name:"second",version:"4.5.6",license:"MIT"})));p.entries.push(other);return p;};
for(const [label,mutate] of [
 ["different bytes",e=>e.noticeBytes++],["different digest",e=>e.noticeSha256="c".repeat(64)],
 ["case alias",e=>e.noticePath="distribution/notices/LICENSE.EXAMPLE"],
 ["different source pin",e=>e.upstream.commit="c".repeat(40)],
])test(`shared notice refuses ${label}`,()=>{const p=shared();mutate(p.entries[1]);assert.throws(()=>parseSupplementalNotices(encode(p)),/Conflicting shared notice pins/);});
test("shared grant binds two separate package identities without certifying their build provenance",async()=>{
 const p=shared(),root=await fixture(p);await mkdir(join(root,"node_modules/second"),{recursive:true});
 await writeFile(join(root,"node_modules/second/package.json"),JSON.stringify({name:"second",version:"4.5.6",license:"MIT"}));
 await writeFile(join(root,"package-lock.json"),JSON.stringify({lockfileVersion:3,packages:{"node_modules/example":{version:"1.2.3",integrity},"node_modules/second":{version:"4.5.6",integrity}}}));
 const r=await verifySupplementalNotices(root,encode(p));assert.equal(r.entries.length,2);assert.equal(new Set(r.entries.map(e=>e.noticePath)).size,1);
 assert.equal(r.status,"supplemental-notice-presence-only");assert.equal(Object.hasOwn(r,"packageSourceProvenance"),false);
 await writeManifest(root,{platform:"win32-x64",sourceCommit:"a".repeat(40),supplementalNotices:r});const a=await auditBundle(root);
 assert.deepEqual(a.packagesWithoutOwnNoticeCandidate,["node_modules/example","node_modules/second"]);
 const invented=shared();invented.entries[1].upstream.npmSourceCommit="b".repeat(40);assert.throws(()=>parseSupplementalNotices(encode(invented)));
});
test("AWS packages share only the reviewed upstream SDK notice, with original attribution",async()=>{
 const p=parseSupplementalNotices(await readFile(new URL("../supplemental-notices.json",import.meta.url))),aws=p.entries.filter(e=>e.name.startsWith("@aws-sdk/"));
 assert.deepEqual(aws.map(e=>[e.name,e.version]),[["@aws-sdk/credential-provider-http","3.972.72"],["@aws-sdk/credential-provider-login","3.972.77"],["@aws-sdk/nested-clients","3.997.44"]]);
 const b=await readFile(new URL("../notices/LICENSE.aws-sdk",import.meta.url));assert.equal(b.length,11352);assert.equal(sha256(b),"edea91454b811f127fbdea3d86f378f6719bd372ed440abf82b232f6fca06c3d");
 for(const e of aws){assert.deepEqual(e.coverage,{kind:"package"});assert.equal(e.declaredLicense,"Apache-2.0");assert.equal(e.noticePath,"distribution/notices/LICENSE.aws-sdk");assert.equal(e.noticeSha256,sha256(b));assert.equal(e.noticeBytes,b.length);assert.deepEqual(e.upstream,{repository:"aws/aws-sdk-js-v3",commit:"313813d9e1f25eb6896cf2880977f01ee7fb2556",path:"LICENSE",gitBlob:"0322cba2eac898acb5c8577a20657e7a74af55a4"});}
 assert.match(b.toString(),/Copyright 2018 Amazon.com, Inc. or its affiliates. All Rights Reserved./);assert.match(b.toString(),/Version 2.0, January 2004/);
});
