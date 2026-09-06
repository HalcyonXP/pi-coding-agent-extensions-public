import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdir,mkdtemp,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../../",import.meta.url));
const version="8.30.1";
const pins={
 win32:{archive:`gitleaks_${version}_windows_x64.zip`,sha256:"d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",executable:"gitleaks.exe"},
 linux:{archive:`gitleaks_${version}_linux_x64.tar.gz`,sha256:"551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",executable:"gitleaks"},
};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function run(exe,args,extra={}){return execFileSync(exe,args,{cwd:root,encoding:"utf8",maxBuffer:64*1024*1024,timeout:330_000,stdio:["pipe","pipe","pipe"],...extra});}
async function download(name){
 let url=new URL(`https://github.com/gitleaks/gitleaks/releases/download/v${version}/${name}`);
 for(let redirects=0;redirects<=3;redirects++){
  if(url.protocol!=="https:"||url.username||url.password||!["github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"].includes(url.hostname))throw Error("Unplanned scanner download origin");
  const response=await fetch(url,{redirect:"manual",signal:AbortSignal.timeout(120_000)});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get("location"),url);continue;}
  if(!response.ok)throw Error("Pinned public scanner download unavailable");
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>32*1024*1024)throw Error("Scanner archive download bound");chunks.push(chunk);}return Buffer.concat(chunks);
 }
 throw Error("Scanner download redirect bound");
}
async function main(){
 if(process.argv.length!==2||process.arch!=="x64"||!pins[process.platform])throw Error("Scanner requires Windows/Linux x64 and no arguments");
 if(run("git",["rev-parse","--is-shallow-repository"]).trim()!=="false")throw Error("Scanner requires complete available history");
 const pin=pins[process.platform],cache=join(root,".pi","publication-tools");await mkdir(cache,{recursive:true});
 const archive=join(cache,pin.archive);let bytes;try{bytes=await readFile(archive);}catch(error){if(error.code!=="ENOENT")throw error;bytes=await download(pin.archive);if(hash(bytes)!==pin.sha256)throw Error("Pinned scanner archive mismatch");await writeFile(archive,bytes,{flag:"wx"});}
 if(hash(bytes)!==pin.sha256)throw Error("Existing scanner archive differs; never silently replace it");
 const directory=await mkdtemp(join(cache,"scan-"));
 // Extract only the named executable from the verified publisher archive into a fresh directory.
 run("tar",["-xf",archive,"-C",directory,pin.executable]);
 const executable=join(directory,pin.executable),config=join(directory,"rules.toml"),ignore=join(directory,"empty.ignore"),blobs=join(directory,"blobs");
 await writeFile(config,"[extend]\nuseDefault = true\n");await writeFile(ignore,"");await mkdir(blobs);
 const objects=run("git",["rev-list","--objects","--all"]).trim().split("\n").filter(Boolean).map(line=>line.split(" ")[0]);
 let size=0,count=0;for(const oid of new Set(objects)){
  if(run("git",["cat-file","-t",oid]).trim()!=="blob")continue;
  const value=run("git",["cat-file","blob",oid],{encoding:"buffer"});size+=value.length;if(++count>20_000||value.length>16*1024*1024||size>128*1024*1024)throw Error("Scanner blob allocation bound");await writeFile(join(blobs,oid),value,{flag:"wx"});
 }
 const findings=[];
 for(const [mode,target] of [["git",root],["dir",blobs]]){
  const args=[mode,target,"--config",config,"--gitleaks-ignore-path",ignore,"--ignore-gitleaks-allow","--max-decode-depth=5","--no-banner","--log-level","error","--redact=100","--report-format","json","--report-path","-","--timeout","300"];
  if(mode==="git")args.push("--log-opts=--all --full-history");let output;
  try{output=run(executable,args);}catch(error){if(error.status!==1)throw Error("Secret scanner failed; raw diagnostics withheld");output=String(error.stdout);}
  for(const result of JSON.parse(output||"[]"))findings.push({mode,rule:result.RuleID,file:result.File,line:result.StartLine,commit:result.Commit});
 }
 await writeFile(join(directory,"summary.json"),JSON.stringify({scanner:`Gitleaks ${version}`,blobs:count,bytes:size,findings},null,2)+"\n");
 console.log(JSON.stringify({scanner:`Gitleaks ${version}`,blobs:count,bytes:size,detections:findings.length,matchedValues:"withheld"}));
 if(findings.length)throw Error("Secret-scan findings require private triage; do not publish");
}
main().catch(()=>{console.error("SECRET_SCAN_FAILED_NO_RAW_PAYLOAD_LOGGED");process.exitCode=1;});
