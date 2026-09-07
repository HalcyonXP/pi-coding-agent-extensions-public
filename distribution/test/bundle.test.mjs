// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,writeFile,readFile,mkdir,rm,utimes,cp,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";
import {safePath,files,archive,writeManifest,verifyBundle,profileLock,run} from "../lib.mjs";
const metadata={platform:"win32-x64",sourceCommit:"a".repeat(40)};
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),"pi-bundle-offline-"));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test("bundle paths reject traversal, absolute names, ADS and control characters",()=>{
 for(const path of ["","/a","../x","a/../b","a//b","a\\b","C:/x","a:stream","a\nb","./a"])assert.throws(()=>safePath(path));
 assert.equal(safePath("node_modules/@package/lib/a.mjs"),"node_modules/@package/lib/a.mjs");
});
test("file-only archives are deterministic across directory and timestamp changes",()=>fixture(async root=>{
 const a=join(root,"a"),b=join(root,"b");await mkdir(a);await writeFile(join(a,"x.txt"),"fixed UTF-8 source é");await mkdir(join(a,"nested"));await writeFile(join(a,"nested","empty"),"");await cp(a,b,{recursive:true});await utimes(join(b,"x.txt"),123,456);
 const one=await archive(a,join(root,"one.tar.gz")),two=await archive(b,join(root,"two.tar.gz"));assert.equal(one,two);
 const tar=gunzipSync(await readFile(join(root,"one.tar.gz")));assert.ok(tar.includes(Buffer.from("fixed UTF-8 source é")));assert.equal(tar.length%512,0);
 await assert.rejects(archive(a,join(root,"one.tar.gz")),/destination exists/);
}));
test("long paths use a bounded standard PAX entry, not truncation",()=>fixture(async root=>{
 const directory=join(root,"input"),relative=`${"a".repeat(100)}/${"b".repeat(100)}/${"c".repeat(100)}`;await mkdir(join(directory,"a".repeat(100),"b".repeat(100)),{recursive:true});await writeFile(join(directory,relative),"one");
 await archive(directory,join(root,"long.tar.gz"));const bytes=gunzipSync(await readFile(join(root,"long.tar.gz")));assert.equal(String.fromCharCode(bytes[156]),"x");assert.ok(bytes.includes(Buffer.from(` path=${relative}\n`)));
}));
test("bundle manifests reject changed, missing or extra files",()=>fixture(async root=>{
 await writeFile(join(root,"x"),"first");await writeManifest(root,metadata);await verifyBundle(root);
 await writeFile(join(root,"x"),"other");await assert.rejects(verifyBundle(root));await writeFile(join(root,"x"),"first");await writeFile(join(root,"extra"),"not accepted");await assert.rejects(verifyBundle(root));await rm(join(root,"extra"));await rm(join(root,"x"));await assert.rejects(verifyBundle(root));
}));
test("reparse input is never packaged as an ordinary file",()=>fixture(async root=>{
 const directory=join(root,"source"),foreign=join(root,"foreign");await mkdir(directory);await mkdir(foreign);await writeFile(join(foreign,"hidden"),"no");await symlink(foreign,join(directory,"link"),process.platform==="win32"?"junction":"dir");await assert.rejects(files(directory),/reparse/);
}));
test("profile coordination requires exclusive ownership and never recycles a stale PID",()=>fixture(async root=>{
 const release=profileLock(root,"test");assert.throws(()=>profileLock(root,"second"),/EEXIST/);release();
 const other=profileLock(root,"replacement");await writeFile(join(root,"openai-running.json"),JSON.stringify({pid:0,nonce:"foreign"}));other();assert.match(await readFile(join(root,"openai-running.json"),"utf8"),/foreign/);assert.throws(()=>profileLock(root,"PID cannot release it"),/EEXIST/);
}));
test("native command paths with spaces use argument arrays, never shell interpolation",()=>{
 assert.equal(run(process.execPath,["-e","process.stdout.write(process.argv[1])","space ; & literal"]),"space ; & literal");
});
