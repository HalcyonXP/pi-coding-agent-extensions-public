// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WebSearchProfile } from "./web-search-tool.ts";

export interface WebPreferenceStore {
 read(): WebSearchProfile;
 write(profile: WebSearchProfile): void;
}
export function webProfile(value: unknown): WebSearchProfile {
 if(value!=="verified-v1"&&value!=="experimental"&&value!=="experimental-context")throw new Error("Web admission profile must be verified-v1, experimental or experimental-context.");
 return value;
}
const failure=()=>new Error("Web admission preferences are unreadable or invalid; preserve the profile file, repair it and reload. No alternate profile is activated.");
/** A saved admission contract, not authority or entitlement. Applies only on a new
 * extension load. Atomic replacement is not cross-process synchronization or a
 * hostile-filesystem sandbox; malformed/unknown-version state is never replaced.
 */
export function webPreferenceStore(agentDir:string):WebPreferenceStore{
 const target=join(agentDir,"openai-compatibility-web.json"),max=4096;
 function read():WebSearchProfile{
  let fd:number|undefined;
  try{
   try{if(!lstatSync(target).isFile())throw failure();}catch(e){if((e as NodeJS.ErrnoException)?.code==="ENOENT")return "verified-v1";throw e;}
   fd=openSync(target,"r");const stat=fstatSync(fd);if(!stat.isFile()||stat.size>max)throw failure();
   const bytes=Buffer.alloc(max+1);let length=0;while(length<bytes.length){const n=readSync(fd,bytes,length,bytes.length-length,null);if(!n)break;length+=n;}if(length>max)throw failure();
   const v:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(0,length)));
   if(v===null||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length!==2||!Object.hasOwn(v,"version")||!Object.hasOwn(v,"profile"))throw failure();
   const r=v as Record<string,unknown>;if(r.version!==1)throw failure();return webProfile(r.profile);
  }catch{throw failure();}finally{if(fd!==undefined)closeSync(fd);}
 }
 return{read,write(value){const profile=webProfile(value);read();const temporary=`${target}.${process.pid}.${randomUUID()}.tmp`;let created=false;
  try{mkdirSync(agentDir,{recursive:true});writeFileSync(temporary,JSON.stringify({version:1,profile},null,2)+"\n",{encoding:"utf8",mode:0o600,flag:"wx"});created=true;renameSync(temporary,target);}
  catch{throw new Error("Could not save Web admission profile; saved selection and effective schema were not changed. Preserve the profile file.");}
  finally{if(created)rmSync(temporary,{force:true});}
 }};
}
