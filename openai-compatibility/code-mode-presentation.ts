import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import type { CellOutcome } from "./runtime/cells.mjs";
import { copyCellDiagnostics } from "./runtime/cell-diagnostics.mjs";

// TUI-only data validation. Refusal throws to Pi's ordinary visible fallback.
// These limits do not change execution, retention or model-facing output budgets.
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
export function codeResultView(result: unknown): CellOutcome {
 const r=copyData(result);
 if(!record(r)||!keys(r,["content","details"])||!Array.isArray(r.content)||r.content.length!==1)throw Error("Unfamiliar Code result");
 const block=r.content[0],d=r.details;
 if(!record(block)||Object.keys(block).length!==2||block.type!=="text"||typeof block.text!=="string"||!record(d)||JSON.stringify(d)!==block.text)throw Error("Code content/details mismatch");
 if(!keys(d,["cell_id","status","output","omitted_output_bytes","result"])||typeof d.cell_id!=="string"||!d.cell_id.length||d.cell_id.length>64||!["running","draining","completed","terminated"].includes(d.status as string)||!Array.isArray(d.output)||!d.output.every(s=>typeof s==="string"))throw Error("Unfamiliar Code outcome");
 if(Object.hasOwn(d,"omitted_output_bytes")&&(!Number.isSafeInteger(d.omitted_output_bytes)||(d.omitted_output_bytes as number)<0))throw Error("Unfamiliar output loss");
 if(d.status==="completed"){
  const final=d.result;
  if(!record(final)||!keys(final,["version","status","code","diagnostics"])||final.version!==1||!["ok","error"].includes(final.status as string))throw Error("Unfamiliar cell completion");
  if(final.status==="ok"&&(Object.hasOwn(final,"code")||Object.hasOwn(final,"diagnostics")))throw Error("Unexpected success metadata");
  if(final.status==="error"&&(typeof final.code!=="string"||!/^[A-Z][A-Z0-9_]{0,63}$/.test(final.code)))throw Error("Unfamiliar cell failure");
  if(Object.hasOwn(final,"diagnostics")&&!copyCellDiagnostics(final.diagnostics))throw Error("Unfamiliar cell diagnostics");
 }else if(Object.hasOwn(d,"result")||((d.status==="draining"||d.status==="terminated")&&d.output.length))throw Error("Conflicting cell status");
 return d as unknown as CellOutcome;
}
const clean=(s: string)=>stripTerminalSequences(s).replace(/\r\n?/g,"\n").replace(/\t/g,"    ").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,"�");

/** Shows literal guest text, never infers job facts or summarizes arbitrary JSON.
 * Unknown shapes/partial results/errors from outside CellOutcome use native fallback.
 * Expansion and truncation touch only native components, not the original result.
 */
export const renderCodeResult: NonNullable<ToolDefinition["renderResult"]>=(result,options,theme,context)=>{
 if(options.isPartial||context.isError)throw Error("Use native visible result");
 const d=codeResultView(result),failed=d.result?.status==="error",warning=failed||d.status==="draining"||d.status==="terminated";
 const status=failed?`Cell failed · ${d.result!.code}`:d.status==="draining"?"Cell draining · cleanup unconfirmed":d.status==="terminated"?"Cell terminated":d.status==="running"?"Cell running · collect with wait":"Cell completed";
 const lines=[theme.fg(warning?"error":"toolOutput",status)];
 if(d.omitted_output_bytes)lines.push(theme.fg("error",`Output omitted: ${d.omitted_output_bytes} bytes · not recoverable by expansion`));
 if(d.result?.diagnostics){const v=d.result.diagnostics,last=v.last_delegation;lines.push(theme.fg("error",`Phase: ${v.guest_phase} · delegated ${v.delegated_calls} · returned ${v.returned_results} · tool errors ${v.tool_errors}`),theme.fg("error","External effects: not determined"),theme.fg("error",last?`Last delegation: ${last.operation} · ${last.result}`:"Last delegation: none"));if(last?.shell){const s=last.shell,word=(x:boolean|null)=>x===null?"unknown":x?"yes":"no";lines.push(theme.fg("error",`Shell: ready ${word(s.supervisor_ready)} · running ${word(s.running)} · exit ${s.exit_code??"unknown"} · output ${word(s.output_observed)} · termination ${s.termination}`));}}
 if(d.output.length)lines.push(theme.fg("muted","Coordinator output:"));
 else lines.push(theme.fg("muted","No coordinator text returned."));
 const output=d.output.map(clean).join("\n"),outputText=new Text(theme.fg("toolOutput",output),0,0);
 // Raw native metadata stays inspectable, including cell correlation and diagnostics.
 const detail=new Text(theme.fg("muted",`Cell details:\n${clean(JSON.stringify(d,null,2))}`),0,0);
 const hint=()=>theme.fg("muted",`${keyText("app.tools.expand")} ${options.expanded?"collapse":"details"}`);
 const header=new Text(lines.join("\n"),0,0);
 const component: Component={invalidate(){header.invalidate();outputText.invalidate();detail.invalidate();},render(width){
  if(!Number.isFinite(width)||width<1)return [];
  width=Math.floor(width);
  const rendered=output?outputText.render(width):[],visible=options.expanded||warning?rendered:rendered.slice(0,8),out=[...header.render(width),...visible];
  if(visible.length<rendered.length)out.push(...new Text(theme.fg("muted",`… ${rendered.length-visible.length} more output lines · ${hint()}`),0,0).render(width));
  else out.push(...new Text(hint(),0,0).render(width));
  if(options.expanded)out.push(...detail.render(width));
  return out.map(line=>truncateToWidth(line,width,""));
 }};
 return component;
};
