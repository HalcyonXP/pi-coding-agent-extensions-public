// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Direct output is not nested projection or execution authority. Historical JSON stays readable.
import type { CellOutcome } from "./runtime/cells.mjs";
import { copyCellDiagnostics } from "./runtime/cell-diagnostics.mjs";

export interface CodeResultMetadata { version: 1; wall_time_ms: number; }
export type CodeResultDetails = CellOutcome & { code_result?: CodeResultMetadata };
// Bounded data copying is shared by direct formatting and TUI validation. Limits unchanged.
function copyData(value: unknown): unknown {
 let nodes=0, chars=0;
 const copy=(v: unknown,depth: number): unknown=>{
  if(++nodes>2048||depth>8)throw Error("Unfamiliar Code result");
  if(typeof v==="string"){chars+=v.length;if(chars>524288)throw Error("Large Code result");return v;}
  if(v===null||v===undefined||typeof v==="boolean"||(typeof v==="number"&&Number.isFinite(v)))return v;
  if(typeof v!=="object")throw Error("Unfamiliar Code data");
  const array=Array.isArray(v),proto=Object.getPrototypeOf(v);
  if(proto!==(array?Array.prototype:Object.prototype)&&!(proto===null&&!array))throw Error("Unfamiliar Code data");
  const keys=Reflect.ownKeys(v);if(keys.length>256)throw Error("Large Code data");
  const out: Record<string,unknown> = Object.create(null);
  for(const key of keys){if(typeof key!=="string")throw Error("Unfamiliar Code data");chars+=key.length;if(chars>524288)throw Error("Large Code data");const d=Object.getOwnPropertyDescriptor(v,key);if(!d||!("value"in d))throw Error("Unfamiliar Code property");out[key]=copy(d.value,depth+1);}
  if(!array)return out;
  if(!Number.isInteger(out.length)||(out.length as number)<0||(out.length as number)>128||keys.length!==(out.length as number)+1)throw Error("Unfamiliar Code array");
  return Array.from({length:out.length as number},(_,n)=>{if(!Object.hasOwn(out,String(n)))throw Error("Sparse Code array");return out[String(n)];});
 };
 return copy(value,0);
}
const record=(v: unknown): v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const keys=(v: Record<string,unknown>,names: string[])=>Object.keys(v).every(k=>names.includes(k));

function outcome(d: unknown): asserts d is CodeResultDetails {
 if(!record(d))throw Error("Unfamiliar Code outcome");
 if(!keys(d,["cell_id","status","output","omitted_output_bytes","result","code_result"])||typeof d.cell_id!=="string"||!d.cell_id.length||d.cell_id.length>64||!["running","draining","completed","terminated"].includes(d.status as string)||!Array.isArray(d.output)||!d.output.every(s=>typeof s==="string"))throw Error("Unfamiliar Code outcome");
 if(Object.hasOwn(d,"omitted_output_bytes")&&(!Number.isSafeInteger(d.omitted_output_bytes)||(d.omitted_output_bytes as number)<0))throw Error("Unfamiliar output loss");
 if(d.status==="completed"){
  const final=d.result;
  if(!record(final)||!keys(final,["version","status","code","diagnostics"])||final.version!==1||!["ok","error"].includes(final.status as string))throw Error("Unfamiliar cell completion");
  if(final.status==="ok"&&(Object.hasOwn(final,"code")||Object.hasOwn(final,"diagnostics")))throw Error("Unexpected success metadata");
  if(final.status==="error"&&(typeof final.code!=="string"||!/^[A-Z][A-Z0-9_]{0,63}$/.test(final.code)))throw Error("Unfamiliar cell failure");
  if(Object.hasOwn(final,"diagnostics")&&!copyCellDiagnostics(final.diagnostics))throw Error("Unfamiliar cell diagnostics");
 }else if(Object.hasOwn(d,"result")||((d.status==="draining"||d.status==="terminated")&&d.output.length))throw Error("Conflicting cell status");

 if(Object.hasOwn(d,"code_result")){const m=d.code_result;if(!record(m)||Object.keys(m).length!==2||!keys(m,["version","wall_time_ms"])||m.version!==1||!Number.isSafeInteger(m.wall_time_ms)||(m.wall_time_ms as number)<0)throw Error("Unfamiliar Code result timing");}
}
/** For already validated outcomes: fixed native observations, not guest exceptions or inferred effects. */
export function codeDiagnosticLines(d: CellOutcome): string[] {
 const v=d.result?.diagnostics;if(!v)return [];const last=v.last_delegation;
 const lines=[`Phase: ${v.guest_phase} · delegated ${v.delegated_calls} · returned ${v.returned_results} · tool errors ${v.tool_errors}`,"External effects: not determined",last?`Last delegation: ${last.operation} · ${last.result}`:"Last delegation: none"];
 if(last?.shell){const s=last.shell,word=(x:boolean|null)=>x===null?"unknown":x?"yes":"no";lines.push(`Shell: ready ${word(s.supervisor_ready)} · running ${word(s.running)} · exit ${s.exit_code??"unknown"} · output ${word(s.output_observed)} · termination ${s.termination}`);}
 return lines;
}
// The header follows the pinned exposed Code contract. Draining and bounded
// diagnostic/loss notices are explicit Pi safety extensions, not upstream parity.
function outputText(d: CodeResultDetails): string {
 const m=d.code_result;if(!m)throw Error("Code result timing required");
 if(!/^[A-Za-z0-9_-]{1,64}$/.test(d.cell_id))throw Error("Unfamiliar direct-result cell identifier");
 const failed=d.result?.status==="error",status=failed?"Script failed":d.status==="running"?`Script running with cell ID ${d.cell_id}`:d.status==="draining"?`Script draining with cell ID ${d.cell_id} · cleanup unconfirmed`:d.status==="terminated"?"Script terminated":"Script completed";
 const lines=[...d.output];
 if(failed)lines.push([`Script error:\n${d.result!.code}`,...codeDiagnosticLines(d)].join("\n"));
 if(d.omitted_output_bytes)lines.push(`Output omitted: ${d.omitted_output_bytes} bytes · not recoverable by expansion`);
 return `${status}\nWall time ${(Math.round(m.wall_time_ms/100)/10).toFixed(1)} seconds\nOutput:\n${lines.join("\n")}`;
}
/** Called only after the actual awaited extension operation returns. Time is
 * measured per exec/wait call, not cell age, child runtime, authority or entitlement. */
export function codeResult(value: CellOutcome, wallTimeMs: number) {
 if(!Number.isSafeInteger(wallTimeMs)||wallTimeMs<0)throw Error("Invalid measured Code call time");
 const copy=copyData(value);outcome(copy);if(Object.hasOwn(copy,"code_result"))throw Error("Runtime cannot supply direct-result metadata");
 const details:CellOutcome & {code_result:CodeResultMetadata}={...copy,code_result:{version:1,wall_time_ms:wallTimeMs}};
 return {content:[{type:"text" as const,text:outputText(details)}],details};
}
/** Read-only transition: exact canonical new content or exact historical JSON.
 * Unknown/mismatched/hook-added data must remain on Pi's ordinary visible fallback. */
export function codeResultView(result: unknown): CodeResultDetails {
 const r=copyData(result);
 if(!record(r)||!keys(r,["content","details"])||!Array.isArray(r.content)||r.content.length!==1)throw Error("Unfamiliar Code result");
 const block=r.content[0],d=r.details;
 if(!record(block)||Object.keys(block).length!==2||block.type!=="text"||typeof block.text!=="string")throw Error("Code content/details mismatch");
 outcome(d);
 if(block.text!==(Object.hasOwn(d,"code_result")?outputText(d):JSON.stringify(d)))throw Error("Code content/details mismatch");
 return d;
}
