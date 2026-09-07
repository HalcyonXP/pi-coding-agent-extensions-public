// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {join,resolve,isAbsolute} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {verifyBundle,profileLock} from "./lib.mjs";
const root=fileURLToPath(new URL("../",import.meta.url)),args=process.argv.slice(2);
assert.ok(args.length>=2&&args[0]==="--profile"&&isAbsolute(args[1]),"Usage: node distribution/launch.mjs --profile <installed-isolated-profile> [Pi arguments]");
assert.equal(process.platform,"win32");assert.equal(process.arch,"x64");assert.ok([24,25].includes(Number(process.versions.node.split(".")[0])),"Private Code mode profile requires Node 24/25");
const profile=resolve(args[1]),{digest}=await verifyBundle(root),receipt=JSON.parse(await readFile(join(profile,"openai-profile.json"),"utf8"));
assert.equal(receipt.version,1);assert.equal(receipt.bundle,resolve(root));assert.equal(receipt.bundleDigest,digest);assert.equal(receipt.state,"installed");
profileLock(profile,"Pi session"); // held until process exit, including asynchronous native CLI lifetime
const rollbackPath=join(profile,"openai-rollback.json"),rolledBack=existsSync(rollbackPath);
if(rolledBack){const record=JSON.parse(await readFile(rollbackPath,"utf8"));assert.equal(record.version,1);assert.equal(record.state,"capabilities-disabled");assert.deepEqual(record.previous,receipt);}
assert.deepEqual(JSON.parse(await readFile(join(profile,"settings.json"),"utf8")).extensions,[join(root,"extensions","openai-compatibility","index.ts")],"Extension configuration changed; reconcile explicitly. Ordinary model/Fast preferences may change normally.");
process.env.PI_CODING_AGENT_DIR=profile;process.env.PI_TELEMETRY="0";
process.chdir(join(profile,"workspace"));
const cli=join(root,"node_modules","@earendil-works","pi-coding-agent","dist","bundle","cli.js");
const extensions=["--extension",join(root,"extensions","openai-compatibility","index.ts")],nativeArgs=args.slice(2);
const exclusions=[];
if(rolledBack){
 const names=new Set(["imagegen","web_search","exec","wait","exec_command","write_stdin"]);
 for(let i=0;i<nativeArgs.length;i++)if(["--exclude-tools","-xt"].includes(nativeArgs[i])&&nativeArgs[i+1])for(const name of nativeArgs[++i].split(","))if(name.trim())names.add(name.trim());
 exclusions.push("--exclude-tools",[...names].join(","));
}
// Discovery stays isolated. Explicit extra trusted extensions are the user's choice;
// ordinary built-ins/providers remain native. Rollback keeps Fast/footer and native
// model ownership, but even a later on command cannot defeat host tool exclusions.
process.argv=[process.execPath,cli,"--no-extensions",...extensions,...nativeArgs,...exclusions];
await import(pathToFileURL(cli).href);
