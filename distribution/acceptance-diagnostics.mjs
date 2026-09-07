// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only acceptance diagnostics. Never print guest output, paths or payloads.
import {ERROR_CODES} from "../openai-compatibility/runtime/protocol.mjs";
import {RPC_ERRORS} from "../openai-compatibility/runtime/rpc-protocol.mjs";
const knownCodes=new Set([...ERROR_CODES,...RPC_ERRORS]);
// Same bounded acceptance program, factored for deterministic failure-path tests.
// No runtime/poll/teardown budget is widened and no service call is introduced.
export function shellReadinessCode(command){
 if(typeof command!=="string")throw new TypeError("Shell acceptance command must be a string");
 return `let r=await tools.exec_command({cmd:${JSON.stringify(command)},yield_time_ms:1});if(r.isError)throw Error("launch denied");let o=r.result.details.output;for(let i=0;i<30&&!o.includes("READY");i++){r=await tools.write_stdin({session_id:r.result.details.session_id,yield_time_ms:300});if(r.isError)throw Error("poll denied");o+=r.result.details.output;}if(!o.includes("READY"))throw Error("not ready");`;
}
export function shellAcceptanceDiagnostic(outcome,markerRecorded){
 return JSON.stringify({phase:"synthetic-shell-readiness",cellStatus:["completed","running","draining","terminated"].includes(outcome?.status)?outcome.status:"unknown",resultStatus:["ok","error"].includes(outcome?.result?.status)?outcome.result.status:"unknown",code:knownCodes.has(outcome?.result?.code)?outcome.result.code:"UNCLASSIFIED",markerRecorded:markerRecorded===true});
}
