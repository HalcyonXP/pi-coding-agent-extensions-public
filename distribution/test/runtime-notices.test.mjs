// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp,mkdir,writeFile,readFile} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {parseSupplementalNotices,verifySupplementalNotices,supplementalNoticeFiles} from "../supplemental-notices.mjs";
import {sha256,writeManifest} from "../lib.mjs";
import {auditBundle} from "../audit-bundle.mjs";
import {inspectText} from "../../.github/scripts/check-publication.mjs";
const encode=p=>Buffer.from(JSON.stringify(p));
const blob=b=>createHash("sha1").update(Buffer.from(`blob ${b.length}\0`)).update(b).digest("hex");
const notice=Buffer.from("Synthetic notice\r\nFixture, not a grant.\r\n"),other=Buffer.from("A second synthetic notice.\n");
const prefix=Buffer.from("/* Synthetic source α */\r\n"),source=Buffer.concat([prefix,notice,other,Buffer.from("/* inert suffix */\n")]);
const consumer=Buffer.from("Synthetic consumer, never executable\n"),metadata=encode({name:"example",version:"1.2.3",license:"MIT"}),integrity="sha512-"+Buffer.alloc(64,1).toString("base64");
const pin=(path,bytes)=>({path,bytes:bytes.length,sha256:sha256(bytes)});
const base=()=>({version:3,scope:"supplemental-notice-presence-only",entries:[{
 packagePath:"node_modules/example",name:"example",version:"1.2.3",declaredLicense:"MIT",packageJsonSha256:sha256(metadata),npmIntegrity:integrity,
 noticePath:"distribution/notices/LICENSE.example",noticeBytes:notice.length,noticeSha256:sha256(notice),
 upstream:{repository:"example/source",commit:"a".repeat(40),path:"runtime/source.c",gitBlob:blob(source)},
 coverage:{kind:"runtime-notice",name:"example-runtime",sourceRelease:"example-1.2.3",consumers:[pin("node_modules/example/native.bin",consumer)],noticeSource:{kind:"excerpt",sourceFile:pin("distribution/notices/LICENSE.source-example",source),offset:prefix.length}},
}]});
async function fixture(p=base(),sourceBytes=source){
 const root=await mkdtemp(join(tmpdir(),"pi-runtime-notice-"));
 await mkdir(join(root,"distribution/notices"),{recursive:true});await mkdir(join(root,"node_modules/example"),{recursive:true});
 for(const [path,bytes]of [["distribution/notices/LICENSE.example",notice],["distribution/notices/LICENSE.source-example",sourceBytes],["node_modules/example/native.bin",consumer],["node_modules/example/package.json",metadata],["package-lock.json",encode({lockfileVersion:3,packages:{"node_modules/example":{version:"1.2.3",integrity}}})],["distribution/supplemental-notices.json",encode(p)]])await writeFile(join(root,path),bytes);
 return root;
}
for(const [label,mutate]of [
 ["v2 hidden runtime scope",p=>p.version=2],
 ["invented provenance",p=>p.entries[0].coverage.binaryReproduced=true],
 ["unknown kind",p=>p.entries[0].coverage.kind="runtime-clearance"],
 ["unversioned release",p=>p.entries[0].coverage.sourceRelease="latest"],
 ["empty consumers",p=>p.entries[0].coverage.consumers=[]],
 ["too many consumers",p=>p.entries[0].coverage.consumers=Array.from({length:17},(_,i)=>pin(`node_modules/example/${i}.bin`,consumer))],
 ["duplicate consumer",p=>p.entries[0].coverage.consumers.push(structuredClone(p.entries[0].coverage.consumers[0]))],
 ["foreign consumer",p=>p.entries[0].coverage.consumers[0].path="node_modules/other/native.bin"],
 ["consumer size cap",p=>p.entries[0].coverage.consumers[0].bytes=16777217],
 ["source size cap",p=>p.entries[0].coverage.noticeSource.sourceFile.bytes=2097153],
 ["source hash",p=>p.entries[0].coverage.noticeSource.sourceFile.sha256="bad"],
 ["source outside witnesses",p=>p.entries[0].coverage.noticeSource.sourceFile.path="node_modules/example/source.c"],
 ["source traversal",p=>p.entries[0].coverage.noticeSource.sourceFile.path="distribution/notices/LICENSE.source-../source.c"],
 ["source nested path",p=>p.entries[0].coverage.noticeSource.sourceFile.path="distribution/notices/LICENSE.source-dir/source.c"],
 ["reserved notice path",p=>p.entries[0].noticePath="distribution/notices/LICENSE.source-example"],
 ["negative offset",p=>p.entries[0].coverage.noticeSource.offset=-1],
 ["fractional offset",p=>p.entries[0].coverage.noticeSource.offset=0.5],
 ["non-numeric offset",p=>p.entries[0].coverage.noticeSource.offset="0"],
 ["overflowing offset",p=>p.entries[0].coverage.noticeSource.offset=Number.MAX_SAFE_INTEGER],
 ["out-of-range excerpt",p=>p.entries[0].coverage.noticeSource.offset=source.length],
 ["unreviewed excerpt kind",p=>p.entries[0].coverage.noticeSource.kind="normalized-excerpt"],
 ["extraneous source authority",p=>p.entries[0].coverage.noticeSource.sourceFile.verified=true],
 ["whole-file hidden range",p=>p.entries[0].coverage.noticeSource.kind="whole-file"],
])test(`runtime notice policy refuses ${label}`,()=>{const p=base();mutate(p);assert.throws(()=>parseSupplementalNotices(encode(p)));});
test("runtime notice witnesses and consumers share the unchanged aggregate budgets",()=>{
 const p=base();p.entries[0].coverage.consumers=Array.from({length:3},(_,i)=>({path:`node_modules/example/${i}.bin`,bytes:16777216,sha256:"a".repeat(64)}));assert.throws(()=>parseSupplementalNotices(encode(p)),/file budget exceeded/);
 const count=base();count.entries=Array.from({length:33},(_,i)=>{const e=structuredClone(count.entries[0]);e.coverage.name=`component-${i}`;e.coverage.noticeSource={kind:"whole-file"};e.coverage.consumers=Array.from({length:16},(_,j)=>({path:`node_modules/example/${i}-${j}`,bytes:1,sha256:"a".repeat(64)}));return e;});assert.ok(encode(count).length<=128*1024);assert.throws(()=>parseSupplementalNotices(encode(count)),/file budget exceeded/);
 const q=base(),entry=structuredClone(q.entries[0]);entry.coverage.name="second";entry.upstream.commit="b".repeat(40);q.entries.push(entry);assert.throws(()=>parseSupplementalNotices(encode(q)),/Conflicting source witness pins/);
 const r=base(),alias=structuredClone(r.entries[0]);alias.coverage.name="second";alias.coverage.noticeSource.sourceFile.path="distribution/notices/LICENSE.source-EXAMPLE";r.entries.push(alias);assert.throws(()=>parseSupplementalNotices(encode(r)),/Conflicting supplemental file pins/);
 const s=base(),changed=structuredClone(s.entries[0]);changed.coverage.name="second";changed.coverage.noticeSource.offset++;s.entries.push(changed);assert.throws(()=>parseSupplementalNotices(encode(s)),/Conflicting shared notice pins/);
});
test("runtime excerpt verification preserves exact CRLF bytes and byte-based UTF-8 offsets",async()=>{
 const p=base(),root=await fixture(p),r=await verifySupplementalNotices(root,encode(p));assert.equal(r.version,3);assert.equal(r.status,"supplemental-notice-presence-only");assert.deepEqual(r.entries[0].coverage,p.entries[0].coverage);
 assert.equal(Object.hasOwn(r,"binaryReproduced"),false);assert.deepEqual(await readFile(join(root,p.entries[0].noticePath)),notice);assert.deepEqual(await readFile(join(root,p.entries[0].coverage.noticeSource.sourceFile.path)),source);
 p.entries[0].coverage.noticeSource.offset=prefix.toString("utf8").length;await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/excerpt differs/);
});
for(const [label,path,expected]of [
 ["consumer","node_modules/example/native.bin",/Runtime consumer bytes changed/],
 ["witness","distribution/notices/LICENSE.source-example",/Runtime notice source bytes changed/],
])test(`runtime verification refuses same-size modified ${label}`,async()=>{const p=base(),root=await fixture(p),bytes=await readFile(join(root,path));bytes[0]^=1;await writeFile(join(root,path),bytes);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),expected);});
test("matching excerpt SHA256 cannot substitute for the full source Git blob",async()=>{
 const p=base();p.entries[0].upstream.gitBlob=blob(notice);const root=await fixture(p);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/upstream blob/);
});
test("forged source SHA256 alone cannot bless changes outside the notice",async()=>{
 const p=base(),changed=Buffer.from(source);changed[0]^=1;p.entries[0].coverage.noticeSource.sourceFile.sha256=sha256(changed);const root=await fixture(p,changed);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/upstream blob/);
});
test("matching notice SHA256 cannot bless unrelated text at the pinned source range",async()=>{
 const p=base(),changed=Buffer.from(notice);changed[0]^=1;p.entries[0].noticeSha256=sha256(changed);const root=await fixture(p);await writeFile(join(root,p.entries[0].noticePath),changed);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/excerpt differs/);
});
test("a source witness must be fatal UTF-8 even with matching data pins",async()=>{
 const p=base(),changed=Buffer.from(source);changed[0]=255;p.entries[0].coverage.noticeSource.sourceFile.sha256=sha256(changed);p.entries[0].upstream.gitBlob=blob(changed);const root=await fixture(p,changed);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/encoded data/);
});
test("whole-file runtime grants bind notice blobs directly without source witnesses",async()=>{
 const p=base(),e=p.entries[0];e.coverage.noticeSource={kind:"whole-file"};e.upstream.gitBlob=blob(notice);const root=await fixture(p),r=await verifySupplementalNotices(root,encode(p));assert.equal(r.version,3);assert.deepEqual(supplementalNoticeFiles(encode(p)),[e.noticePath]);
});
test("two distinct notices may share one unchanged source witness and consumer",async()=>{
 const p=base(),entry=structuredClone(p.entries[0]);entry.noticePath="distribution/notices/LICENSE.other";entry.noticeBytes=other.length;entry.noticeSha256=sha256(other);entry.coverage.name="second";entry.coverage.noticeSource.offset=prefix.length+notice.length;p.entries.push(entry);
 assert.deepEqual(supplementalNoticeFiles(encode(p)),[p.entries[0].noticePath,p.entries[0].coverage.noticeSource.sourceFile.path,entry.noticePath]);const root=await fixture(p);await writeFile(join(root,entry.noticePath),other);const r=await verifySupplementalNotices(root,encode(p));assert.equal(r.entries.length,2);
});
test("runtime notice audit preserves own-notice findings and refuses a forged manifested scope",async()=>{
 const p=base(),root=await fixture(p),r=await verifySupplementalNotices(root,encode(p));await writeManifest(root,{platform:"win32-x64",sourceCommit:"a".repeat(40),supplementalNotices:r});const a=await auditBundle(root);assert.equal(a.status,"inventory-only-not-release-clearance");assert.deepEqual(a.packagesWithoutOwnNoticeCandidate,["node_modules/example"]);
 const forged=await fixture(p);r.entries[0].coverage={kind:"package"};await writeManifest(forged,{platform:"win32-x64",sourceCommit:"a".repeat(40),supplementalNotices:r});await assert.rejects(()=>auditBundle(forged),/record differs/);
});
test("v2 package policies remain readable, including formerly unreserved filenames",async()=>{
 const p=base(),e=p.entries[0];p.version=2;e.coverage={kind:"package"};e.upstream.gitBlob=blob(notice);const root=await fixture(p);assert.equal((await verifySupplementalNotices(root,encode(p))).version,2);e.noticePath="distribution/notices/LICENSE.source-legacy";assert.deepEqual(supplementalNoticeFiles(encode(p)),[e.noticePath]);
});
test("canonical runtime notices retain pinned full grants, source witnesses and exact ranges",async()=>{
 const bytes=await readFile(new URL("../supplemental-notices.json",import.meta.url)),p=parseSupplementalNotices(bytes),entries=p.entries.filter(e=>e.coverage.kind==="runtime-notice");assert.equal(entries.length,54);assert.equal(supplementalNoticeFiles(bytes).length,107);
 assert.equal(entries.filter(e=>e.coverage.noticeSource.kind==="excerpt").length,49);
 const core=entries.filter(e=>e.coverage.name.startsWith("quickjs-core-"));assert.equal(core.length,11);
 assert.ok(core.every(e=>e.upstream.path.startsWith("vendor/quickjs/")&&e.coverage.noticeSource.kind==="excerpt"));
 const engine=core.find(e=>e.upstream.path==="vendor/quickjs/quickjs.c");assert.ok(engine);assert.equal(engine.coverage.noticeSource.sourceFile.bytes,1964029);
 assert.match(await readFile(new URL("../../"+engine.noticePath,import.meta.url),"utf8"),/2017-2025 Fabrice Bellard/);
 const headers=entries.filter(e=>e.coverage.name.startsWith("emscripten-header-"));assert.equal(headers.length,9);
 assert.ok(headers.every(e=>e.upstream.path.endsWith(".h")&&e.coverage.consumers.length===1));
 assert.ok(headers.some(e=>e.upstream.path==="system/lib/libc/musl/src/math/exp_data.h"));
 assert.ok(headers.every(e=>!Object.hasOwn(e.coverage,"headerClosure")));
 for(const e of entries){const notice=await readFile(new URL("../../"+e.noticePath,import.meta.url));assert.equal(notice.length,e.noticeBytes);assert.equal(sha256(notice),e.noticeSha256);assert.deepEqual(inspectText(notice.toString(),e.noticePath),[]);let witness=notice;
  if(e.coverage.noticeSource.kind==="excerpt"){const n=e.coverage.noticeSource;witness=await readFile(new URL("../../"+n.sourceFile.path,import.meta.url));assert.equal(witness.length,n.sourceFile.bytes);assert.equal(sha256(witness),n.sourceFile.sha256);assert.deepEqual(witness.subarray(n.offset,n.offset+notice.length),notice);assert.deepEqual(inspectText(witness.toString(),n.sourceFile.path),[]);assert.deepEqual(inspectText(Buffer.concat([witness.subarray(0,n.offset),witness.subarray(n.offset+notice.length)]).toString(),"source-outside-notice"),[]);}
  if(e.upstream.kind==="published-file"){
   assert.equal(p.version,4);assert.equal(e.upstream.bytes,notice.length);assert.equal(e.upstream.sha256,sha256(notice));
   assert.equal(e.coverage.sourceRelease,"unicode-data-17.0.0");assert.equal(e.coverage.noticeSource.kind,"whole-file");
  }else{
  assert.equal(blob(witness),e.upstream.gitBlob);
  if(core.includes(e)){assert.equal(e.upstream.repository,"justjake/quickjs-emscripten");assert.equal(e.upstream.commit,"df4efb9ef2cb25c417ecb57986da462d11b244ed");assert.equal(e.coverage.sourceRelease,"quickjs-wasmfile-release-sync-0.32.0");}
  else{assert.equal(e.upstream.repository,"emscripten-core/emscripten");assert.equal(e.upstream.commit,"8c5f43157a3f069ade75876e23061330521eabde");assert.equal(e.coverage.sourceRelease,"emscripten-5.0.1");}
  }
  assert.ok(e.coverage.consumers.every(f=>f.path.startsWith(e.packagePath+"/dist/")));assert.equal(e.coverage.consumers[0].sha256,e.coverage.name.startsWith("emscripten-js-")?"3b0757e4b1051a5f344322ad6a02c075dadff70cdb50d37b7df6c120d4af77e9":"105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232");
 }
 const grants=await Promise.all(["emscripten","musl","compiler-rt"].map(name=>readFile(new URL("../notices/LICENSE."+name,import.meta.url),"utf8")));assert.match(grants[0],/University of Illinois/);assert.match(grants[1],/public header files/);assert.match(grants[2],/LLVM Exceptions/);
 const attributes=await readFile(new URL("../../.gitattributes",import.meta.url),"utf8");assert.match(attributes,/distribution\/notices\/LICENSE\.\* -text/);
});
const published=()=>{const p=base(),e=p.entries[0];p.version=4;e.coverage.noticeSource={kind:"whole-file"};e.upstream={kind:"published-file",url:"https://www.unicode.org/license.txt",bytes:notice.length,sha256:sha256(notice)};return p;};
for(const [label,mutate]of [
 ["v2",p=>p.version=2],["v3",p=>p.version=3],["future schema",p=>p.version=5],
 ["package scope",p=>p.entries[0].coverage={kind:"package"}],
 ["excerpt scope",p=>p.entries[0].coverage.noticeSource=base().entries[0].coverage.noticeSource],
 ["invented Git pin",p=>p.entries[0].upstream.gitBlob="a".repeat(40)],
 ["invented authentication",p=>p.entries[0].upstream.authenticated=true],
 ["unrecognized source kind",p=>p.entries[0].upstream.kind="download"],
 ["missing digest",p=>delete p.entries[0].upstream.sha256],
 ["different digest",p=>p.entries[0].upstream.sha256="a".repeat(64)],
 ["different size",p=>p.entries[0].upstream.bytes++],
 ["oversize grant",p=>p.entries[0].upstream.bytes=65537],
 ["HTTP",p=>p.entries[0].upstream.url="http://www.unicode.org/license.txt"],
 ["credentials",p=>{const url=new URL(p.entries[0].upstream.url);url.username="example";url.password="fixture";p.entries[0].upstream.url=url.href;}],
 ["port",p=>p.entries[0].upstream.url="https://www.unicode.org:443/license.txt"],
 ["query",p=>p.entries[0].upstream.url+="?version=17"],
 ["fragment",p=>p.entries[0].upstream.url+="#license"],
 ["different release",p=>p.entries[0].upstream.url="https://www.unicode.org/Public/18.0.0/ucd/ReadMe.txt"],
 ["lookalike host",p=>p.entries[0].upstream.url="https://www.unicode.org.example.invalid/license.txt"],
 ["encoded path",p=>p.entries[0].upstream.url="https://www.unicode.org/%6cicense.txt"],
 ["local file",p=>p.entries[0].upstream.url="file:///example/license.txt"],
 ["reserved witness name",p=>p.entries[0].noticePath="distribution/notices/LICENSE.source-example"],
])test(`published-file notices refuse ${label}`,()=>{const p=published();mutate(p);assert.throws(()=>parseSupplementalNotices(encode(p)));});
test("published-file notice verification is local, byte-bound and presence-only",async()=>{
 const p=published(),root=await fixture(p),previous=globalThis.fetch;globalThis.fetch=()=>{throw new Error("Notice verification must not fetch");};
 try{const r=await verifySupplementalNotices(root,encode(p));assert.equal(r.version,4);assert.equal(r.status,"supplemental-notice-presence-only");assert.equal(Object.hasOwn(r,"authenticated"),false);
  assert.deepEqual(supplementalNoticeFiles(encode(p)),[p.entries[0].noticePath]);await writeManifest(root,{platform:"win32-x64",sourceCommit:"0".repeat(40),syntheticFixtureCommit:true,supplementalNotices:r});assert.deepEqual((await auditBundle(root)).supplementalNotices,r);
 }finally{globalThis.fetch=previous;}
 const changed=Buffer.from(notice);changed[0]^=1;await writeFile(join(root,p.entries[0].noticePath),changed);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)));
 p.entries[0].noticeSha256=sha256(changed);assert.throws(()=>parseSupplementalNotices(encode(p)),/Published notice source digest differs/);
});
test("schema v4 keeps Git-source blob verification and shared-source conflicts intact",async()=>{
 const p=base();p.version=4;const root=await fixture(p);assert.equal((await verifySupplementalNotices(root,encode(p))).version,4);
 p.entries[0].upstream.gitBlob="a".repeat(40);await assert.rejects(()=>verifySupplementalNotices(root,encode(p)),/upstream blob/);
 const q=published(),second=structuredClone(q.entries[0]);second.coverage.name="second";second.upstream.url="https://www.unicode.org/Public/17.0.0/ucd/ReadMe.txt";q.entries.push(second);assert.throws(()=>parseSupplementalNotices(encode(q)),/Conflicting shared notice pins/);
 const cap=published();cap.entries=Array.from({length:65},(_,i)=>{const e=structuredClone(cap.entries[0]);e.coverage.name=`notice-${i}`;return e;});assert.throws(()=>parseSupplementalNotices(encode(cap)));
});
test("Unicode supplements retain published grant and final release description, never repository templates",async()=>{
 const p=parseSupplementalNotices(await readFile(new URL("../supplemental-notices.json",import.meta.url)));assert.equal(p.version,4);
 const entries=p.entries.filter(e=>e.upstream.kind==="published-file");assert.equal(entries.length,2);
 const expected=new Map([["https://www.unicode.org/license.txt",[1995,"e7a93b009565cfce55919a381437ac4db883e9da2126fa28b91d12732bc53d96"]],["https://www.unicode.org/Public/17.0.0/ucd/ReadMe.txt",[740,"9fe1a90bd32659d7953616283dc2bffaa165518aae9ace026040c42c559ba606"]]]);
 assert.deepEqual(new Set(entries.map(e=>e.upstream.url)),new Set(expected.keys()));
 for(const e of entries){assert.deepEqual([e.upstream.bytes,e.upstream.sha256],expected.get(e.upstream.url));assert.deepEqual(e.coverage.consumers,[{path:e.packagePath+"/dist/emscripten-module.wasm",bytes:503134,sha256:"105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232"}]);assert.equal(e.coverage.sourceRelease,"unicode-data-17.0.0");assert.equal(e.coverage.noticeSource.kind,"whole-file");
  const text=await readFile(new URL("../../"+e.noticePath,import.meta.url),"utf8");assert.doesNotMatch(text,/PUB_DATE|COPY_YEAR|PUB_STATUS|UNI_VER|2001-2024/);
  if(e.upstream.url.endsWith("license.txt")){assert.match(text,/UNICODE LICENSE V3/);assert.match(text,/1991-2026 Unicode, Inc\./);assert.match(text,/associated Documentation/);}
  else{assert.match(text,/# Date: 2025-08-15/);assert.match(text,/# © 2025 Unicode/);assert.match(text,/contains final data files/);assert.match(text,/Version 17\.0\.0/);}
 }
});
test("generated-JS supplements preserve six distinct source comments with the full root grant, not WASM reachability",async()=>{
 const p=parseSupplementalNotices(await readFile(new URL("../supplemental-notices.json",import.meta.url)));
 const entries=p.entries.filter(e=>e.coverage.name?.startsWith("emscripten-js-"));assert.equal(entries.length,6);
 const expected=new Map([["src/shell.js","2010"],["src/memoryprofiler.js","2015"],["src/node_shell_read.js","2019"],["src/runtime_debug.js","2020"],["src/runtime_exceptions.js","2023"],["src/minimum_runtime_check.js","2024"]]);
 assert.deepEqual(new Set(entries.map(e=>e.upstream.path)),new Set(expected.keys()));
 const root=p.entries.find(e=>e.coverage.name==="emscripten");assert.ok(root);assert.equal(root.coverage.noticeSource.kind,"whole-file");assert.equal(root.noticeSha256,"620a78084fc7ca97c0b5dea9abf891f3ffcadfdbf305276f099c9c4e12fc1d86");
 for(const e of entries){
  assert.deepEqual(e.coverage.consumers,[{path:e.packagePath+"/dist/emscripten-module.mjs",bytes:10208,sha256:"3b0757e4b1051a5f344322ad6a02c075dadff70cdb50d37b7df6c120d4af77e9"}]);
  assert.ok(root.coverage.consumers.some(c=>JSON.stringify(c)===JSON.stringify(e.coverage.consumers[0])));
  assert.equal(e.coverage.noticeSource.kind,"excerpt");assert.equal(e.coverage.noticeSource.offset,0);
  const notice=await readFile(new URL("../../"+e.noticePath,import.meta.url),"utf8");
  assert.equal(notice,`/**\n * @license\n * Copyright ${expected.get(e.upstream.path)} The Emscripten Authors\n * SPDX-License-Identifier: MIT\n */`);
  assert.deepEqual(Object.keys(e.coverage).sort(),["consumers","kind","name","noticeSource","sourceRelease"]);
 }
});
