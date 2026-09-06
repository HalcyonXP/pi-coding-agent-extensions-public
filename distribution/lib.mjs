import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile,readdir,lstat,writeFile,mkdir} from "node:fs/promises";
import {existsSync,createWriteStream,writeFileSync,readFileSync,unlinkSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {join,dirname} from "node:path";
import {spawnSync} from "node:child_process";
import {createGzip} from "node:zlib";
import {once} from "node:events";
import {finished} from "node:stream/promises";
export const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
export function profileLock(profile,operation){
 const path=join(profile,"openai-running.json"),record=JSON.stringify({version:1,pid:process.pid,nonce:randomUUID(),operation});
 writeFileSync(path,record,{flag:"wx"});
 const release=()=>{try{if(readFileSync(path,"utf8")===record)unlinkSync(path);}catch{/* Unconfirmed crash ownership is never recycled by PID lookup. */}};
 process.once("exit",release);return release;
}
export function safePath(path){assert.ok(typeof path==="string"&&path.length>0&&!/[\\:\x00-\x1f]/.test(path)&&path.split("/").every(s=>s&&s!=="."&&s!==".."),"Unsafe bundle path");return path;}
export async function files(root){
 const table=[],seen=new Set();let bytes=0;
 async function visit(relative=""){
  for(const name of (await readdir(join(root,relative))).sort()){
   const path=safePath(relative?`${relative}/${name}`:name),key=path.toLowerCase(),info=await lstat(join(root,path));
   assert.ok(!seen.has(key)&&!info.isSymbolicLink(),"Duplicate/reparse bundle path");seen.add(key);
   if(info.isDirectory())await visit(path);
   else{assert.ok(info.isFile()&&info.size<=128*1024*1024,"Non-file/oversized bundle input");bytes+=info.size;assert.ok(bytes<=768*1024*1024,"Bundle size bound exceeded");table.push({path,bytes:info.size,sha256:sha256(await readFile(join(root,path)))});}
  }
 }
 await visit();return table.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export function run(command,args,options={}){
 const r=spawnSync(command,args,{encoding:"utf8",maxBuffer:4*1024*1024,timeout:300_000,windowsHide:true,...options});
 if(r.error||r.status!==0)throw new Error(`Command failed (${command}): ${r.error?.message??""}\n${r.stdout??""}${r.stderr??""}`);
 return r.stdout;
}
export function npm(args,cwd,env=process.env){
 const candidates=[join(dirname(process.execPath),"node_modules","npm","bin","npm-cli.js"),join(dirname(process.execPath),"..","lib","node_modules","npm","bin","npm-cli.js")];
 const cli=candidates.find(existsSync);assert.ok(cli,"Cannot find the Node installation's npm CLI; no shell/PATH fallback.");
 return run(process.execPath,[cli,...args],{cwd,env});
}
export async function writeManifest(root,metadata){
 assert.equal(existsSync(join(root,"bundle.json")),false,"Manifest already exists");
 const content={version:1,...metadata,files:await files(root)};
 await writeFile(join(root,"bundle.json"),JSON.stringify(content,null,2)+"\n",{flag:"wx"});return content;
}
export async function verifyBundle(root){
 const manifest=JSON.parse(await readFile(join(root,"bundle.json"),"utf8"));
 assert.equal(manifest.version,1);assert.equal(manifest.platform,"win32-x64");assert.match(manifest.sourceCommit,/^[a-f0-9]{40}$/);
 assert.deepEqual((await files(root)).filter(f=>f.path!=="bundle.json"),manifest.files,"Bundle contents/integrity differ");
 return {manifest,digest:sha256(await readFile(join(root,"bundle.json")))};
}
function header(name,size,type="0",prefix=""){
 const b=Buffer.alloc(512);const text=(value,start,length)=>{assert.ok(Buffer.byteLength(value)<=length);b.write(value,start,length,"utf8");};
 const octal=(value,start,length)=>text(value.toString(8).padStart(length-1,"0")+"\0",start,length);
 text(name,0,100);octal(0o644,100,8);octal(0,108,8);octal(0,116,8);octal(size,124,12);octal(0,136,12);b.fill(32,148,156);text(type,156,1);text("ustar\0",257,6);text("00",263,2);text(prefix,345,155);
 const checksum=b.reduce((a,c)=>a+c,0);text(checksum.toString(8).padStart(6,"0")+"\0 ",148,8);return b;
}
function pathFields(path){if(Buffer.byteLength(path)<=100)return [path,""];for(let i=path.length-1;i>=0;i--)if(path[i]==="/"&&Buffer.byteLength(path.slice(0,i))<=155&&Buffer.byteLength(path.slice(i+1))<=100)return [path.slice(i+1),path.slice(0,i)];}
function paxPath(path){const rest=` path=${path}\n`;let length=Buffer.byteLength(rest)+1;while(String(length).length+Buffer.byteLength(rest)!==length)length=String(length).length+Buffer.byteLength(rest);return Buffer.from(String(length)+rest);}
/** Deterministic file-only tar/gzip: no local names, timestamps, uid/gid or links. */
export async function archive(root,destination){
 assert.equal(existsSync(destination),false,"Archive destination exists");await mkdir(dirname(destination),{recursive:true});
 const output=createWriteStream(destination,{flags:"wx"}),gzip=createGzip({level:9});gzip.pipe(output);
 const completion=Promise.all([finished(output),finished(gzip)]);completion.catch(()=>{});
 const send=async bytes=>{if(!gzip.write(bytes))await once(gzip,"drain");};
 const padded=async bytes=>{await send(bytes);if(bytes.length%512)await send(Buffer.alloc(512-bytes.length%512));};
 try{
  let index=0;
  for(const file of await files(root)){
   const data=await readFile(join(root,file.path));assert.equal(sha256(data),file.sha256,"Archive input changed");let fields=pathFields(file.path);
   if(!fields){const pax=paxPath(file.path);await send(header(`PaxHeaders/${index}`,pax.length,"x"));await padded(pax);fields=[`file-${index}`,""];}
   await send(header(fields[0],data.length,"0",fields[1]));await padded(data);index++;
  }
  await send(Buffer.alloc(1024));gzip.end();await completion;
 }catch(error){gzip.destroy(error);output.destroy(error);await completion.catch(()=>{});throw error;}
 return sha256(await readFile(destination));
}
