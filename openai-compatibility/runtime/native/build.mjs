// Explicit OFFLINE build. First acquire pinned build tools with the separate
// prepare-native-compiler script. Never called by a tool, launcher or installer.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { artifactPaths, nativeSource, sha256, verifiedExecutable } from "./artifact.mjs";
import { verifyToolchain } from "./toolchain.mjs";
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Native build requires Windows x64; no global SDK is installed.");
if (process.argv.length !== 2) throw new Error("No build overrides are accepted.");
const paths = await artifactPaths();
if (existsSync(paths.directory)) {
  await verifiedExecutable();
  console.log("Existing immutable native artifact verified; not rebuilt or overwritten.");
} else {
  const {compiler,references:referenceRoot,pins}=await verifyToolchain();
  const compilerSha256=sha256(await readFile(compiler));
  const names=["mscorlib.dll","System.dll","System.Core.dll"];
  const references=names.map(name=>join(referenceRoot,name));
  const referenceSha256=Object.fromEntries(await Promise.all(names.map(async name=>[name,sha256(await readFile(join(referenceRoot,name)))])));
  await mkdir(new URL("./bin/", import.meta.url), {recursive:true});
  await mkdir(paths.directory); // exclusive; failed evidence is never silently replaced
  const builds=[];
  for(const variant of ["a","b"]){
    const directory=join(paths.directory,`build-${variant}`);
    await mkdir(directory);
    const source=join(directory,"WindowsRuntime.cs"),output=join(directory,"WindowsRuntime.exe");
    await copyFile(nativeSource,source);
    const result=spawnSync(compiler,["/nologo","/noconfig","/nostdlib+","/optimize+","/debug-","/deterministic+","/langversion:5","/target:exe","/platform:x64","/errorreport:none",`/pathmap:${directory}=/_/native`,...references.map(file=>`/reference:${file}`),`/out:${output}`,source],{cwd:directory,encoding:"utf8",timeout:60_000,windowsHide:true,env:{SystemRoot:process.env.SystemRoot??"C:\\Windows",TEMP:tmpdir(),TMP:tmpdir()}});
    if(result.error||result.status!==0)throw new Error(`Pinned native compilation failed; preserve and inspect. ${result.stdout??""}`);
    builds.push(await readFile(output));
  }
  if(!builds[0].equals(builds[1]))throw new Error("Relocated deterministic builds differ; do not distribute.");
  const current=await artifactPaths();
  if(current.sourceSha256!==paths.sourceSha256||current.recipeSha256!==paths.recipeSha256)throw new Error("Build inputs changed; preserve and inspect.");
  await verifyToolchain();
  await writeFile(paths.executable,builds[0],{flag:"wx"});
  const manifest={version:1,sourceSha256:paths.sourceSha256,recipeSha256:paths.recipeSha256,binarySha256:sha256(builds[0]),compilerSha256,referenceSha256,binaryBytes:builds[0].length,architecture:"x64",framework:".NET Framework 4.8",deterministic:true,compilerPackageSha256:pins.packages.compiler.sha256,referencePackageSha256:pins.packages.references.sha256};
  await writeFile(paths.manifest,JSON.stringify(manifest,null,2)+"\n",{flag:"wx"});
  await verifiedExecutable();
  console.log(JSON.stringify(manifest));
}
