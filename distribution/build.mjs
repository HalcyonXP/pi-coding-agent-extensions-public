// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Private Windows distribution only. Never deploys, publishes or edits an active profile.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,copyFile,rm,mkdtemp} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join,resolve,isAbsolute,dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {sha256,run,npm,writeManifest,verifyBundle,archive} from "./lib.mjs";
import {verifyHostArtifacts} from "../.github/scripts/pi-host-provenance.mjs";
import {artifactPaths,verifiedExecutable} from "../openai-compatibility/runtime/native/artifact.mjs";
const root=fileURLToPath(new URL("../",import.meta.url));
const args=process.argv.slice(2);
assert.ok(args.length===4&&args[0]==="--host"&&args[2]==="--out","Usage: node distribution/build.mjs --host <prepared-pinned-source> --out <new-absolute-directory>");
assert.equal(process.platform,"win32");assert.equal(process.arch,"x64");assert.ok([24,25].includes(Number(process.versions.node.split(".")[0])));
const host=resolve(args[1]),out=args[3];assert.ok(isAbsolute(out)&&!existsSync(out)&&!existsSync(out+".tar.gz"),"Output must be new; preserve previous artifacts.");
const git=(args,options={})=>run("git",args,{cwd:root,...options}).trim();
assert.equal(git(["status","--porcelain"]),"","Build only a committed clean source snapshot; no dirty-source release override.");
const sourceCommit=git(["rev-parse","HEAD"]),{provenance,patch}=verifyHostArtifacts();
const copySource=async(path,target)=>{await mkdir(dirname(target),{recursive:true});await writeFile(target,run("git",["show",`${sourceCommit}:${path}`],{cwd:root,encoding:null}),{flag:"wx"});};
assert.equal(git(["rev-parse","HEAD"],{cwd:host}),provenance.commit);
const patchBytes=await readFile(patch),paths=[...patchBytes.toString().matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map(m=>m[1]);assert.equal(paths.length,15);
const changed=git(["diff","--name-only","HEAD"],{cwd:host}).split(/\r?\n/).filter(Boolean);assert.ok(changed.every(p=>paths.includes(p)),"Unreviewed native source changes");
const extra=git(["ls-files","--others","--exclude-standard"],{cwd:host}).split(/\r?\n/).filter(Boolean);assert.ok(extra.every(p=>paths.includes(p)||p==="packages/coding-agent/test/suite/code-mode-rpc.test.ts"),"Unreviewed native inputs");
const index=join(root,".pi",`package-proof-${randomUUID()}.index`),indexEnv={...process.env,GIT_INDEX_FILE:index};
try{
 run("git",["read-tree","HEAD"],{cwd:host,env:indexEnv});run("git",["add","--",...paths],{cwd:host,env:indexEnv});
 const diff=run("git",["-c","core.abbrev=7","diff","--cached","--no-ext-diff","--binary","--",...paths],{cwd:host,env:indexEnv});assert.equal(sha256(Buffer.from(diff)),provenance.patchSha256,"Prepared native tree differs from reviewed patch");
}finally{await rm(index,{force:true});}
await verifiedExecutable();const native=await artifactPaths(),nativeManifest=JSON.parse(await readFile(native.manifest,"utf8"));assert.equal(nativeManifest.deterministic,true,"Distribution requires the pinned reproducible helper, not a historical compiler build");
await mkdir(out);await mkdir(join(out,"artifacts"));
const config=await mkdtemp(join(root,".pi","private-npm-config-"));
for(const name of ["user.npmrc","global.npmrc"])await writeFile(join(config,name),"",{flag:"wx"});
const env={PI_OFFLINE:"1",PI_TELEMETRY:"0",npm_config_registry:"https://registry.npmjs.org",npm_config_audit:"false",npm_config_fund:"false",npm_config_userconfig:join(config,"user.npmrc"),npm_config_globalconfig:join(config,"global.npmrc")};
for(const key of ["PATH","Path","SystemRoot","SYSTEMROOT","WINDIR","COMSPEC","ComSpec","PATHEXT","TEMP","TMP","USERPROFILE","HOME","APPDATA","LOCALAPPDATA"])if(process.env[key])env[key]=process.env[key];
console.log(npm(["run","build:offline"],host,env));
const packageDirs=["chord","telemetry","ai","tui","agent","coding-agent"];
for(const dir of packageDirs){const text=npm(["pack","--ignore-scripts","--json","--pack-destination",join(out,"artifacts")],join(host,"packages",dir),env);const value=JSON.parse(text),packed=Array.isArray(value)?value[0]:Object.values(value)[0];assert.ok(packed.filename.endsWith(".tgz"));}
for(const name of ["package.json","package-lock.json"])await copySource(`distribution/locks/${name}`,join(out,name));
// Locked consumer installation selects private tarballs via exact file overrides.
// npm integrity errors are release blockers, never regenerated locks/fallbacks here.
console.log(npm(["ci","--ignore-scripts","--omit=dev","--no-audit","--no-fund"],out,env));
const selected=git(["ls-files","-z","--","openai-compatibility"]).split("\0").filter(Boolean).filter(path=>!path.includes("/test/")&&!/\.test\.(ts|mjs)$/.test(path));
// Copy canonical Git blobs, not platform-dependent checkout line endings.
for(const path of selected)await copySource(path,join(out,"extensions",path));
const nativeDestination=join(out,"extensions","openai-compatibility","runtime","native","bin",native.directory.split(/[\\/]/).filter(Boolean).at(-1));await mkdir(nativeDestination,{recursive:true});
await copyFile(native.executable,join(nativeDestination,"WindowsRuntime.exe"));await copyFile(native.manifest,join(nativeDestination,"manifest.json"));
for(const path of ["distribution/lib.mjs","distribution/launch.mjs","distribution/install.mjs","distribution/README.md","distribution/LICENSE","distribution/NOTICE","docs/openai-integration/LICENSE","docs/openai-integration/NOTICE","host-patches/pi-0.85.1/LICENSE.pi","host-patches/pi-0.85.1/provenance.json","host-patches/pi-0.85.1/parent-bound-invocation.patch"])await copySource(path,join(out,path));
// Include canonical offline installation/acceptance/contracts, not just links to
// repository-only guides. No generated concept images or local receipts/auth.
const documents=git(["ls-files","-z","--","docs/openai-integration/*.md"]).split("\0").filter(Boolean);
assert.ok(documents.includes("docs/openai-integration/PRIVATE-RELEASE.md"),"Release guide must be committed");
for(const path of documents)await copySource(path,join(out,path));
const metadata={release:"0.3.0-private.1",platform:"win32-x64",nodeMajors:[24,25],sourceCommit,host:provenance,native:nativeManifest};
const manifest=await writeManifest(out,metadata);await verifyBundle(out);
const digest=await archive(out,out+".tar.gz");
await writeFile(out+".tar.gz.sha256",`${digest}  ${out.split(/[\\/]/).at(-1)}.tar.gz\n`,{flag:"wx"});
console.log(JSON.stringify({archive:out+".tar.gz",sha256:digest,files:manifest.files.length,uncompressedBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),sourceCommit}));
