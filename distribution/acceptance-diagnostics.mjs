// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only acceptance diagnostics. Never print guest output, paths or payloads.
import {ERROR_CODES} from "../openai-compatibility/runtime/protocol.mjs";
export function shellAcceptanceDiagnostic(outcome,markerRecorded){
 return JSON.stringify({phase:"synthetic-shell-readiness",cellStatus:["completed","running","draining","terminated"].includes(outcome?.status)?outcome.status:"unknown",resultStatus:["ok","error"].includes(outcome?.result?.status)?outcome.result.status:"unknown",code:ERROR_CODES.includes(outcome?.result?.code)?outcome.result.code:"UNCLASSIFIED",markerRecorded:markerRecorded===true});
}
