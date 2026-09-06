// Explicit build-tool acquisition, not runtime/installation logic. No global SDK changes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { toolchainRoot, toolchainPins, treeDigest, verifyToolchain } from "../../openai-compatibility/runtime/native/toolchain.mjs";
import { sha256 } from "../../openai-compatibility/runtime/native/artifact.mjs";
if (process.platform !== "win32" || process.arch !== "x64" || process.argv.length !== 2) throw new Error("Usage: explicit Windows x64 compiler preparation, without overrides.");
const pins = await toolchainPins();
await mkdir(toolchainRoot, {recursive:true});
for (const pin of Object.values(pins.packages)) {
  const root = join(toolchainRoot, pin.directory), archive = join(root, pin.archive), extracted = join(root,"package");
  if (existsSync(root)) {
    if (sha256(await readFile(archive)) !== pin.sha256 || await treeDigest(extracted) !== pin.treeSha256) throw new Error("Existing build inputs invalid; preserve and inspect, never overwrite.");
    continue;
  }
  await mkdir(root);
  const response = await fetch(pin.url, {redirect:"error",signal:AbortSignal.timeout(120_000)});
  if (!response.ok || !response.body) throw new Error("Pinned build-tool download failed.");
  const chunks=[]; let size=0;
  for await (const chunk of response.body) {
    size+=chunk.length; if(size>64*1024*1024)throw new Error("Build-tool archive exceeds bound.");
    chunks.push(chunk);
  }
  const bytes=Buffer.concat(chunks);
  if(sha256(bytes)!==pin.sha256)throw new Error("Pinned build-tool archive hash mismatch.");
  await writeFile(archive,bytes,{flag:"wx"});
  // Extract only the verified, immutable package. Path values are environment data,
  // not command interpolation. ZipFile rejects traversal; destination is new.
  const systemRoot=process.env.SystemRoot??"C:\\Windows";
  const ps=join(systemRoot,"System32","WindowsPowerShell","v1.0","powershell.exe");
  const result=spawnSync(ps,["-NoLogo","-NoProfile","-NonInteractive","-Command","$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:PI_NATIVE_ARCHIVE,$env:PI_NATIVE_EXTRACT)"],{timeout:120_000,windowsHide:true,encoding:"utf8",env:{SystemRoot:systemRoot,PI_NATIVE_ARCHIVE:archive,PI_NATIVE_EXTRACT:extracted}});
  if(result.error||result.status!==0||await treeDigest(extracted)!==pin.treeSha256)throw new Error("Pinned build-tool extraction failed; preserve and inspect.");
}
await verifyToolchain();
console.log("Pinned private build tools verified. No global installation, helper execution or authentication.");
