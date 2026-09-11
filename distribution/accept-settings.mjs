// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Genuine installed extension/native settings renderer with synthetic terminal input.
// No real terminal capture, user profile, credentials or model/service requests.
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {verifyBundle} from "./lib.mjs";
import {verifyCuration} from "./curate-payload.mjs";
import {exerciseSettings} from "./settings-scenarios.mjs";
assert.ok(process.argv.length===3&&process.platform==="win32","Usage: node distribution/accept-settings.mjs <Windows bundle>");
const bundle=resolve(process.argv[2]),{manifest}=await verifyBundle(bundle);
await verifyCuration(bundle,manifest,await readFile(new URL("./payload-policy.json",import.meta.url)));
const profile=await mkdtemp(join(tmpdir(),"pi settings acceptance ")),cwd=join(profile,"workspace");await mkdir(cwd);
process.env.PI_CODING_AGENT_DIR=profile;process.env.PI_OFFLINE="1";process.env.PI_TELEMETRY="0";
let networkAttempts=0;const priorFetch=globalThis.fetch;
globalThis.fetch=async()=>{networkAttempts++;throw Error("Settings acceptance forbids network");};
try{
 const sdk=await import(pathToFileURL(join(bundle,"node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href);
 const result=await exerciseSettings(sdk,bundle,profile,cwd,join(bundle,"extensions/openai-compatibility/index.ts"));
 assert.equal(networkAttempts,0);console.log(JSON.stringify({...result,networkAttempts}));
}finally{globalThis.fetch=priorFetch;}
