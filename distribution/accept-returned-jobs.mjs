// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only installed acceptance: actual native scope admission and Windows jobs,
// synthetic assistant orchestration. No live service, user timer or desktop replay.
import assert from "node:assert/strict";
export async function acceptReturnedJobs(session, invoke, outcome) {
 const quote=s=>`'${s.replaceAll("'","''")}'`;
 const program="process.stdout.write('DIRECT_READY\\n');setTimeout(()=>process.exit(19),30000);process.stdin.once('data',()=>{process.stdout.write('DIRECT_DONE\\n');process.exit(0)})";
 const cmd=`& ${quote(process.execPath)} -e ${quote(program)}`;
 const jobs=[];
 for(let n=0;n<2;n++){
  const job=outcome(await invoke("exec_command",{cmd,yield_time_ms:1}));assert.equal(job.running,true);assert.equal(typeof job.session_id,"string");jobs.push(job);
 }
 assert.equal(session.agent.getToolGatewayInfo().activeScopes,2);
 const third=await invoke("exec_command",{cmd:"Write-Output MUST_NOT_LAUNCH",yield_time_ms:1});assert.equal(third.isError,true);assert.match(third.content.filter(c=>c.type==="text").map(c=>c.text).join(""),/Durable scope admission unavailable or prior cleanup incomplete/);
 // The denied third invocation and unrelated ordinary tool work must not revoke
 // either already admitted job. This tests native contexts, not UUID adoption.
 assert.equal((await invoke("read",{path:"input.txt"})).isError,false);
 for(const job of jobs){
  let r=job,output=job.output;
  for(let n=0;n<30&&!output.split(/\r?\n/).includes("DIRECT_READY");n++){
   r=outcome(await invoke("write_stdin",{session_id:job.session_id,yield_time_ms:300}));output+=r.output;
  }
  assert.ok(output.split(/\r?\n/).includes("DIRECT_READY"),"Direct job must reach an exact readiness line within the unchanged poll budget");assert.equal(r.running,true);assert.equal(r.supervisor_ready,true);
  r=outcome(await invoke("write_stdin",{session_id:job.session_id,chars:"finish\n",yield_time_ms:300}));output+=r.output;
  for(let n=0;n<30&&r.running;n++){r=outcome(await invoke("write_stdin",{session_id:job.session_id,yield_time_ms:300}));output+=r.output;}
  assert.equal(r.running,false);assert.equal(r.exit_code,0);assert.ok(output.split(/\r?\n/).includes("DIRECT_DONE"));
 }
 assert.equal(session.agent.getToolGatewayInfo().activeScopes,0);assert.equal(session.agent.getToolGatewayInfo().drainingScopes,0);
 return {twoDirectJobs:true,thirdAdmissionDenied:true,ordinaryWorkBetweenPolls:true,completedByPolling:true,automaticCompletionTurns:false};
}
