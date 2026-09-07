// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {shellAcceptanceDiagnostic,createShellObserver} from "../acceptance-diagnostics.mjs";
import {RPC_ERRORS} from "../../openai-compatibility/runtime/rpc-protocol.mjs";
const read=path=>readFile(new URL("../../"+path,import.meta.url),"utf8");
test("scoped Apache grants preserve the complete existing license text",async()=>{
 const canonical=execFileSync("git",["show","HEAD:openai-compatibility/LICENSE"],{cwd:fileURLToPath(new URL("../../",import.meta.url)),encoding:"utf8"});
 for(const dir of ["distribution","docs/openai-integration"]){assert.equal(await read(dir+"/LICENSE"),canonical);assert.match(await read(dir+"/NOTICE"),/Copyright 2026 Project Maintainers/);assert.match(await read(dir+"/NOTICE"),/first-party/);}
 assert.match(await read("README.md"),/scoped grants do not license otherwise unlicensed components/);
});
test("scoped grants keep canonical bytes even with Windows autocrlf enabled",async()=>{
 const cwd=fileURLToPath(new URL("../../",import.meta.url));
 for(const path of ["distribution/LICENSE","distribution/NOTICE","docs/openai-integration/LICENSE","docs/openai-integration/NOTICE"]){const canonical=execFileSync("git",["show","HEAD:"+path],{cwd});const checkout=execFileSync("git",["-c","core.autocrlf=true","cat-file","--filters","HEAD:"+path],{cwd});assert.deepEqual(checkout,canonical,path);}
});
test("shell acceptance diagnostics expose fixed status/code and marker presence only",()=>{
 const result=JSON.parse(shellAcceptanceDiagnostic({status:"completed",result:{status:"error",code:"WALL_LIMIT",output:["unpublished payload"],path:"unpublished path"}},true));
 assert.deepEqual(result,{phase:"synthetic-shell-readiness",cellStatus:"completed",resultStatus:"error",code:"WALL_LIMIT",markerRecorded:true});
 const unknown=shellAcceptanceDiagnostic({status:"unpublished status",result:{status:"unpublished result",code:"unpublished code"}},"unpublished marker");assert.ok(!unknown.includes("unpublished"));assert.equal(JSON.parse(unknown).code,"UNCLASSIFIED");assert.equal(JSON.parse(shellAcceptanceDiagnostic(null)).cellStatus,"unknown");
});
test("shell diagnostics preserve every bounded RPC failure code without guest text",()=>{
 for(const code of RPC_ERRORS){const text=shellAcceptanceDiagnostic({status:"completed",result:{status:"error",code,output:["unpublished output"]}},false);assert.equal(JSON.parse(text).code,code);assert.ok(!text.includes("unpublished output"));}
});
test("native shell observation retains only bounded phase and status fields",()=>{
 const observer=createShellObserver();observer.observe({type:"tool_execution_start",toolName:"exec_command",args:{cmd:"unpublished command"}});
 observer.observe({type:"tool_execution_end",toolName:"exec_command",isError:false,result:{details:{running:false,supervisor_ready:false,exit_code:1,termination:"Native supervisor admission failed.",output:"unpublished output",session_id:"unpublished identity"}}});
 assert.deepEqual(observer.snapshot(),{starts:1,ends:1,operation:"launch",toolError:false,running:false,supervisorReady:false,exitCode:1,termination:"supervisor-admission",hadOutput:true});
 assert.ok(!shellAcceptanceDiagnostic(null,false,observer).includes("unpublished"));
});
test("unknown native diagnostics cannot serialize caller payload or unlimited counters",()=>{
 const observer=createShellObserver();for(let i=0;i<100;i++)observer.observe({type:"tool_execution_start",toolName:"write_stdin"});
 observer.observe({type:"tool_execution_end",toolName:"write_stdin",isError:"unpublished",result:{details:{running:"unpublished",supervisor_ready:"unpublished",exit_code:Infinity,termination:"unpublished"}}});
 observer.observe({type:"tool_execution_end",toolName:"unpublished",result:"unpublished"});
 assert.equal(observer.snapshot().supervisorReady,null);assert.equal(observer.snapshot().starts,65);assert.equal(observer.snapshot().ends,1);assert.equal(observer.snapshot().termination,"other");assert.equal(observer.snapshot().exitCode,null);assert.ok(!JSON.stringify(observer.snapshot()).includes("unpublished"));
 const fake={snapshot(){throw Error("must not call caller code");}};assert.equal(JSON.parse(shellAcceptanceDiagnostic(null,false,fake)).native.status,"unavailable");
});
test("native shell observation is source-only and cannot alter the bounded guest program",async()=>{
 const code=await read("distribution/accept.mjs");assert.match(code,/session\.agent\.subscribe/);assert.match(code,/finally\{unsubscribeShell\(\);\}/);
 const guest=await read("distribution/acceptance-diagnostics.mjs");assert.match(guest,/i<30/);assert.match(guest,/yield_time_ms:300/);assert.match(code,/activeScopes,0/);assert.match(code,/drainingScopes,0/);
 const runtimePackage=JSON.parse(await read("experiments/code-mode-runtime/package.json"));assert.equal(runtimePackage.scripts.test,"node --test --test-concurrency=1 test/*.test.mjs");assert.ok((await read(".github/scripts/validate-openai.mjs")).includes('["--test", "--test-concurrency=1", "test/*.test.mjs"]'));
});
test("root distribution license metadata does not change the private prerelease contract",async()=>{
 const pkg=JSON.parse(await read("distribution/locks/package.json")),lock=JSON.parse(await read("distribution/locks/package-lock.json"));
 assert.equal(pkg.license,"Apache-2.0");assert.equal(lock.packages[""].license,"Apache-2.0");assert.equal(pkg.private,true);assert.equal(pkg.version,"0.3.0-private.1");assert.equal(lock.packages[""].version,pkg.version);assert.deepEqual(pkg.dependencies,lock.packages[""].dependencies);
});
test("consumer contract separates trusted pins from byte matching and delivery authorization",async()=>{
 const doc=await read("docs/openai-integration/RELEASE-CONTRACT.md");
 for(const phrase of ["R_kgDOUQewAQ","independently trusted matching source checkout","download-pins-matched-not-installed","no accepted asset identity","separate explicit authorization","No executable upload or automatic deployment","a filesystem sandbox","COMMENTED"] )assert.ok(doc.includes(phrase),phrase);
 for(const flag of ["--archive","--manifest","--source","--release","--archive-sha256","--manifest-sha256"])assert.ok(doc.includes("'"+flag+"'"));
 assert.match(doc,/if \(\$LASTEXITCODE -ne 0\)/);assert.match(doc,/Get-FileHash/);assert.match(doc,/Test-Path -LiteralPath/);
});
test("consumer links target packaged guides; development privacy link is explicitly source-only",async()=>{
 const validation=await read("docs/openai-integration/VALIDATION.md");assert.ok(!validation.includes("](../../PUBLICATION.md)"));assert.match(validation,/privacy policy is repository-only/);
 for(const file of ["docs/openai-integration/README.md","docs/openai-integration/PRIVATE-RELEASE.md","distribution/README.md"])assert.ok((await read(file)).includes("RELEASE-CONTRACT.md"));
});
test("pre-execution checker imports only Node built-ins and has no active side-effect API",async()=>{
 const code=await read("distribution/verify-download.mjs");
 const imports=[...code.matchAll(/from "([^"]+)"/g)].map(m=>m[1]);assert.ok(imports.length>=3);assert.ok(imports.every(path=>path.startsWith("node:")));
 assert.doesNotMatch(code,/child_process|\bfetch\s*\(|\bwriteFile\b|\bmkdir\b|\bimport\s*\(/);
});
