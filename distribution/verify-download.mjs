// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Run ONLY from independently trusted source. Reads local files; never downloads,
// extracts, imports bundle code, installs, signs, publishes or probes a service.
import {createHash} from "node:crypto";
import {lstat,open} from "node:fs/promises";
import {isAbsolute,resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const limits=Object.freeze({archiveBytes:768*1024*1024,manifestBytes:8*1024*1024});
export class DownloadVerificationError extends Error {
 constructor(code){super(code);this.name="DownloadVerificationError";this.code=code;}
}
const demand=(value,code)=>{if(!value)throw new DownloadVerificationError(code);};
const digest=(value,length,code)=>{demand(typeof value==="string"&&new RegExp(`^[a-f0-9]{${length}}$`,"i").test(value),code);return value.toLowerCase();};
const releaseLabel=value=>typeof value==="string"&&value.length<=64&&/^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.test(value);

async function inspectFile(path,maxBytes,retain){
 demand(typeof path==="string"&&isAbsolute(path),"ABSOLUTE_INPUT_PATH_REQUIRED");
 const entry=await lstat(path);demand(entry.isFile()&&!entry.isSymbolicLink(),"REGULAR_INPUT_FILE_REQUIRED");
 demand(entry.size>0&&entry.size<=maxBytes,"INPUT_SIZE_BOUND");
 const handle=await open(path,"r");
 try{
  const before=await handle.stat();demand(before.isFile()&&before.dev===entry.dev&&before.ino===entry.ino,"INPUT_CHANGED");
  demand(before.size>0&&before.size<=maxBytes,"INPUT_SIZE_BOUND");
  const hash=createHash("sha256"),buffer=Buffer.alloc(1024*1024),chunks=[];let total=0;
  while(true){
   const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;
   total+=bytesRead;demand(total<=maxBytes,"INPUT_SIZE_BOUND");const chunk=buffer.subarray(0,bytesRead);hash.update(chunk);if(retain)chunks.push(Buffer.from(chunk));
  }
  const after=await handle.stat();demand(total===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs,"INPUT_CHANGED");
  return {sha256:hash.digest("hex"),bytes:total,content:retain?Buffer.concat(chunks):undefined};
 }finally{await handle.close();}
}

/** Pins must already be trusted together with the exact public source/review/CI.
 * This is byte/identity matching, not signature verification or archive inspection.
 * Keep verified inputs immutable: a later file replacement invalidates this result.
 */
export async function verifyDownload({archive,manifest:manifestPath,expected}={}){
 demand(expected&&typeof expected==="object","EXPECTED_PINS_REQUIRED");
 const source=digest(expected.sourceCommit,40,"EXPECTED_SOURCE_INVALID"),archiveSha256=digest(expected.archiveSha256,64,"EXPECTED_ARCHIVE_DIGEST_INVALID"),manifestSha256=digest(expected.manifestSha256,64,"EXPECTED_MANIFEST_DIGEST_INVALID");
 demand(releaseLabel(expected.release),"EXPECTED_RELEASE_INVALID");
 const detached=await inspectFile(manifestPath,limits.manifestBytes,true);
 demand(detached.sha256===manifestSha256,"MANIFEST_DIGEST_MISMATCH");
 let manifest;try{manifest=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(detached.content));}catch{throw new DownloadVerificationError("MANIFEST_JSON_INVALID");}
 demand(manifest&&typeof manifest==="object"&&!Array.isArray(manifest),"MANIFEST_OBJECT_REQUIRED");
 demand(manifest.version===1,"MANIFEST_VERSION_UNSUPPORTED");
 demand(manifest.sourceCommit===source,"SOURCE_MISMATCH");demand(manifest.release===expected.release,"RELEASE_MISMATCH");
 demand(manifest.platform==="win32-x64","PLATFORM_UNSUPPORTED");
 demand(Array.isArray(manifest.nodeMajors)&&manifest.nodeMajors.length===2&&manifest.nodeMajors[0]===24&&manifest.nodeMajors[1]===25,"NODE_CONTRACT_UNSUPPORTED");
 const payload=await inspectFile(archive,limits.archiveBytes,false);demand(payload.sha256===archiveSha256,"ARCHIVE_DIGEST_MISMATCH");
 return {state:"download-pins-matched-not-installed",sourceCommit:source,release:manifest.release,platform:manifest.platform,nodeMajors:manifest.nodeMajors,archiveSha256,manifestSha256,archiveBytes:payload.bytes,manifestBytes:detached.bytes};
}

export function parseArguments(args){
 const flags=["--archive","--manifest","--source","--release","--archive-sha256","--manifest-sha256"],values=new Map();
 demand(args.length===flags.length*2,"SIX_EXPLICIT_ARGUMENT_PAIRS_REQUIRED");
 for(let i=0;i<args.length;i+=2){demand(flags.includes(args[i])&&!values.has(args[i])&&typeof args[i+1]==="string"&&!args[i+1].startsWith("--"),"UNKNOWN_DUPLICATE_OR_MISSING_ARGUMENT");values.set(args[i],args[i+1]);}
 return {archive:values.get("--archive"),manifest:values.get("--manifest"),expected:{sourceCommit:values.get("--source"),release:values.get("--release"),archiveSha256:values.get("--archive-sha256"),manifestSha256:values.get("--manifest-sha256")}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await verifyDownload(parseArguments(process.argv.slice(2)))));}
 catch(error){console.error(`DOWNLOAD_VERIFICATION_FAILED: ${error instanceof DownloadVerificationError?error.code:"INPUT_UNAVAILABLE"}`);process.exitCode=1;}
}
