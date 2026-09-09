import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { Text, stripTerminalSequences, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { codeResultView, codeDiagnosticLines } from "./code-mode-output.ts";
export { codeResultView } from "./code-mode-output.ts";

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
 for(const line of codeDiagnosticLines(d))lines.push(theme.fg("error",line));
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
