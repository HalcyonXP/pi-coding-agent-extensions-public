import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {readUnifiedOutcome,validateNativeUnifiedOutput} from '../unified-output-contract.mjs';
import {unifiedOutputCommands,UNIFIED_BEFORE,UNIFIED_AFTER} from '../accept-unified-output.mjs';
const message=()=>({toolName:'exec_command',isError:false,content:[{type:'text',text:'Wall time: 0.2140 seconds\nProcess exited with code 7\nMore output available with session ID 1701\nSupervisor preamble: received\nTermination: Cancelled by user.\nOutput omitted: 47 bytes · not recoverable by polling or expansion\nOutput:\n  "literal" \\ 雪 🌊\r\n{"literal":true}\n'}],details:{output:'  "literal" \\ 雪 🌊\r\n{"literal":true}\n',exit_code:7,running:false,session_id:1701,supervisor_ready:true,termination:'Cancelled by user.',truncated_bytes:47,unified_result:{version:1,wall_time_ms:214}}});
test('independent direct Unified assertion accepts exact native text/details without changing history',()=>{const r=message(),before=JSON.stringify(r);assert.equal(readUnifiedOutcome(r),r.details);assert.equal(JSON.stringify(r),before);});
for(const [name,alter]of Object.entries({
 'legacy envelope':r=>{r.content[0].text=JSON.stringify(r.details);},
 'wrong tool':r=>{r.toolName='exec';},
 'native invocation error':r=>{r.isError=true;},
 'lost details':r=>{delete r.details;},
 'lost time':r=>{delete r.details.unified_result;},
 'wrong time':r=>{r.details.unified_result.wall_time_ms=1000;},
 'negative time':r=>{r.details.unified_result.wall_time_ms=-1;},
 'fractional time':r=>{r.details.unified_result.wall_time_ms=.1;},
 'unbounded time':r=>{r.details.unified_result.wall_time_ms=Infinity;},
 'extra time':r=>{r.details.unified_result.extra=true;},
 'wrong version':r=>{r.details.unified_result.version=2;},
 'wrong process status':r=>{r.details.running=true;},
 'wrong exit':r=>{r.details.exit_code=0;},
 'legacy string ID':r=>{r.details.session_id='1701';},
 'unsafe ID':r=>{r.details.session_id='bad\nOutput:';},
 'nontext':r=>{r.content[0].type='image';},
 'extra content':r=>{r.content.push({type:'text',text:'HOOK_FEEDBACK'});},
 'extra content metadata':r=>{r.content[0].ref='untrusted';},
 'hook text':r=>{r.content[0].text+='\nHOOK_FEEDBACK';},
 'hidden loss':r=>{r.content[0].text=r.content[0].text.replace('Output omitted: 47 bytes · not recoverable by polling or expansion\n','');},
 'hidden readiness':r=>{delete r.details.supervisor_ready;},
 'hidden termination':r=>{delete r.details.termination;},
 'changed literal output':r=>{r.details.output=r.details.output.trim();},
 'protected completion data':r=>{r.details.output_remaining_bytes=10;},
 'oversized output':r=>{r.details.output='x'.repeat(1024*1024+1);},
}))test(name+' cannot certify direct Unified output',()=>{const r=message();alter(r);assert.throws(()=>readUnifiedOutcome(r));});
test('independent validator refuses data accessors without invoking them',()=>{const r=message();let reads=0;Object.defineProperty(r.details,'output',{get(){reads++;return 'injected';}});assert.throws(()=>readUnifiedOutcome(r));assert.equal(reads,0);});
test('running and unknown-exit zero-output direct results remain distinct',()=>{
 const r=message();r.details={output:'',exit_code:null,running:true,session_id:1702,truncated_bytes:0,unified_result:{version:1,wall_time_ms:0}};r.content[0].text='Wall time: 0.0000 seconds\nProcess running with session ID 1702\nOutput:\n';readUnifiedOutcome(r);
 r.toolName='write_stdin';r.details.running=false;delete r.details.session_id;r.content[0].text='Wall time: 0.0000 seconds\nProcess stopped; exit code unavailable\nOutput:\n';readUnifiedOutcome(r);
});
const rows=()=>['openai-responses','openai-codex-responses'].map(api=>({api,requests:8,nativeFunctionReplay:true,numericSessionIDs:true,sameOwnedSession:true,literalReturnedOutput:true,exitedRetainedOutput:true,nonzeroExitAndLossVisible:true,readinessVisible:true,nativeDirectPresentation:true,measuredCallTimeBoundedByObservation:true,unchangedHistory:true,activeScopes:0,drainingScopes:0,liveServiceCalls:0}));
test('both real-dispatcher fixtures are required; source-only rows do not themselves prove native execution',()=>{const r=validateNativeUnifiedOutput(rows());assert.equal(r.syntheticModelRequests,16);assert.equal(r.liveServiceCalls,0);assert.equal(r.sameOwnedSession,true);});
for(const field of ['requests','nativeFunctionReplay','numericSessionIDs','sameOwnedSession','literalReturnedOutput','exitedRetainedOutput','nonzeroExitAndLossVisible','readinessVisible','nativeDirectPresentation','measuredCallTimeBoundedByObservation','unchangedHistory','activeScopes','drainingScopes','liveServiceCalls'])test('missing native observation '+field+' refuses acceptance',()=>{const r=rows();delete r[1][field];assert.throws(()=>validateNativeUnifiedOutput(r));});
test('fixture is bounded, correctly quoted and preserves child exit status rather than treating READY as success',()=>{
 const [cmd,loss]=unifiedOutputCommands("C:/synthetic node's directory/node.exe");
 assert.ok(cmd.startsWith("& 'C:/synthetic node''s directory/node.exe' -e '"));assert.ok(cmd.endsWith("'; exit $LASTEXITCODE"));
 const script=cmd.slice(cmd.indexOf(" -e '")+5,-"'; exit $LASTEXITCODE".length).replaceAll("''","'");
 assert.ok(script.includes("b.toString()!=='finish\\n'"));assert.ok(script.includes('process.exit(23)'));assert.ok(script.includes('process.exitCode=7'));assert.ok(script.includes('setTimeout(()=>process.exit(19),30000)'));
 assert.doesNotMatch(script,/"/,'Windows node -e must not lose inner double quotes');for(const text of [UNIFIED_BEFORE,UNIFIED_AFTER])assert.ok(script.includes(`Buffer.from('${Buffer.from(text).toString('base64')}','base64')`));assert.equal(loss,"[Console]::Out.Write('x' * (2 * 1024 * 1024)); exit 0");
});
test('installed consumer uses independent details assertions and actual original-dispatcher helper',()=>{
 const accept=readFileSync(new URL('../accept.mjs',import.meta.url),'utf8');assert.ok(accept.includes('readUnifiedOutcome(message)'));assert.ok(accept.includes('await acceptNativeUnifiedOutput(session,runtime,nativeStream,await loadPollingPresentation(bundle,sdk))'));
 const helper=readFileSync(new URL('../accept-unified-output.mjs',import.meta.url),'utf8');assert.ok(helper.includes('nativeStream(selected,context'));assert.ok(helper.includes('maxRetries:0'));assert.ok(helper.includes('preserve every failure'));assert.ok(helper.includes('Math.ceil(observed)+1'));assert.ok(!helper.includes('directUnifiedResult'));
});
