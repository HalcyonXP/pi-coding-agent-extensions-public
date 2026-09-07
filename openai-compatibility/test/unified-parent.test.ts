import assert from "node:assert/strict";
import test from "node:test";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {removeOwnedFixture,withFixtureCleanup} from "./fixture-cleanup.ts";
import {tmpdir} from "node:os";
import {join} from "node:path";
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function until(check:()=>Promise<boolean>|boolean,ms:number){const deadline=Date.now()+ms;while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error("Native parent fixture deadline");}
for(const mode of ["before-admission","after-admission"])test(`Windows supervisor owns parent death ${mode}`,{skip:process.platform!=="win32",timeout:120000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),"unified-parent-")),ownerFile=join(directory,"owner.json"),marker=join(directory,"command.json"),program=join(directory,"command.cjs"),parentFile=join(directory,"parent.mjs");
 let supervisor:number|undefined,info:{pid:number;child:number}|undefined;
 // Independent safety deadlines guarantee that even a deliberately broken
 // supervision implementation cannot leave an indefinite fixture process.
 await writeFile(program,'const child=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000);setTimeout(()=>process.exit(),60000)"],{stdio:"ignore",windowsHide:true});require("node:fs").writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,child:child.pid}));setInterval(()=>{},1000);setTimeout(()=>process.exit(),60000);');
 const q=(s:string)=>`'${s.replaceAll("'","''")}'`,command=`& ${q(process.execPath)} ${q(program)} ${q(marker)}; exit $LASTEXITCODE`;
 const imports=`import {UnifiedExecManager,nativeShell} from ${JSON.stringify(new URL("../unified-exec.ts",import.meta.url).href)};import {spawn} from "node:child_process";import {writeFileSync} from "node:fs";`;
 const body=mode==="after-admission"?`const manager=new UnifiedExecManager();await manager.start("fixture",${JSON.stringify(command)},${JSON.stringify(directory)},1,64);writeFileSync(${JSON.stringify(ownerFile)},JSON.stringify({pid:manager.inspect("fixture")[0].pid}));`:
 `const launch=await nativeShell(${JSON.stringify(command)});const child=spawn(launch.executable,launch.args,{stdio:"pipe",windowsHide:true});let stderr="";child.stderr.on("data",chunk=>{stderr+=chunk;if(stderr.includes("PI_UNIFIED_READY_V1"))writeFileSync(${JSON.stringify(ownerFile)},JSON.stringify({pid:child.pid}));});child.stdout.resume();child.stdin.on("error",()=>{});`;
 await writeFile(parentFile,imports+body+'setInterval(()=>{},1000);');
 const parent=spawn(process.execPath,[parentFile],{stdio:"pipe",windowsHide:true});parent.stdout.resume();parent.stderr.resume();parent.stdin.on("error",()=>{});
 let parentClosed=false,launchError:Error|undefined;
 parent.once("close",()=>{parentClosed=true;});parent.once("error",error=>{launchError=error;});
 await withFixtureCleanup(async()=>{
  await until(async()=>{if(launchError)throw launchError;try{supervisor=JSON.parse(await readFile(ownerFile,"utf8")).pid;return true;}catch{return false;}},20000);
  if(mode==="after-admission")await until(async()=>{try{info=JSON.parse(await readFile(marker,"utf8"));return true;}catch{return false;}},20000);
  else await assert.rejects(readFile(marker),/ENOENT/);
  assert.ok(supervisor&&alive(supervisor));if(info)assert.ok(alive(info.pid)&&alive(info.child));
  parent.kill("SIGKILL"); // held fixture-parent handle, never an unrelated PID lookup
  // PID observations remain supplementary. Require the held parent's genuine
  // close event within the same original post-kill deadline, not another wait budget.
  await until(()=>parentClosed&&!alive(supervisor!)&&(!info||(!alive(info.pid)&&!alive(info.child))),10000);
  if(mode==="before-admission")await assert.rejects(readFile(marker),/ENOENT/);
 },async bodyPassed=>{
  if(parent.exitCode===null&&parent.signalCode===null)parent.kill("SIGKILL");
  // Do not kill by a possibly reused PID during failure cleanup. Our synthetic
  // command/descendant self-expire; wait for their bounded safety deadlines.
  await until(()=>parentClosed&&(!supervisor||!alive(supervisor))&&(!info||(!alive(info.pid)&&!alive(info.child))),70000);
  // Never remove failed-fixture evidence, or let rmdir mask a native assertion.
  // A short bounded EBUSY retry releases no lock and runs no command again.
  if(bodyPassed)await removeOwnedFixture(directory);
 });
});
