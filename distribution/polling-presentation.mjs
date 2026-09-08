// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only acceptance bootstrap: actual installed native subscription, handlers and
// components; no real terminal, keyboard/profile discovery or execution authority.
import assert from "node:assert/strict";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
// The caller has verified this immutable bundle. Fixed pinned dist entries only:
// pi-tui 0.85.1 uses main, not the SDK/AI conditional-exports layout. No fallback.
export async function loadPollingPresentation(bundle,sdk) {
 const {Container}=await import(pathToFileURL(join(bundle,"node_modules/@earendil-works/pi-tui/dist/index.js")).href);
 const {LocalPollPresentation}=await import(pathToFileURL(join(bundle,"node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/local-poll-presentation.js")).href);
 return {InteractiveMode:sdk.InteractiveMode,LocalPollPresentation,Container,initTheme:sdk.initTheme};
}
// Keep the original quiet/terminal contracts and twelve settings frames; explicitly add five compact-group frames.
export function validatePollingFrames(frames) {
 assert.deepEqual(frames.map(f=>f.name),["local-poll-empty-hidden","local-poll-terminal-visible","local-jobs-three-compact","local-jobs-expanded","local-jobs-audit-history","local-jobs-error-visible","local-jobs-direct-unchanged","fast-before","fast-applying","fast-saved","capabilities-before","unified-search-stays-open","code-enabled","web-enabled","jobs-inside-openai","capabilities-restored","fast-after-exclusions","capabilities-excluded","jobs-after-exclusions"]);
 assert.equal(frames[0].text,"");assert.match(frames[1].text,/Local job update/);assert.match(frames[1].text,/Synthetic terminal result/);
 assert.equal(frames[2].text.split("\n").length,4);assert.match(frames[2].text,/6 call audits/);assert.doesNotMatch(frames[2].text,/session_id|code-mode-evidence/);for(let n=0;n<3;n++)assert.ok(frames[2].text.includes('RENDER_OK_'+n));
 assert.match(frames[3].text,/Scope: synthetic-group/);assert.match(frames[3].text,/session_id/);assert.match(frames[3].text,/Code mode: exec_command returned\./);
 assert.equal(frames[4].text.split("\n").length,1);assert.match(frames[4].text,/history only/);assert.match(frames[4].text,/6 call audits/);assert.doesNotMatch(frames[4].text,/running|exited/);
 assert.match(frames[5].text,/error \(exit 7\)/);assert.match(frames[5].text,/SYNTHETIC_NONZERO/);
 assert.match(frames[6].text,/exec_command/);assert.match(frames[6].text,/SYNTHETIC_DIRECT/);assert.doesNotMatch(frames[6].text,/Local job/);
 for(const frame of frames.slice(7))assert.ok(typeof frame.text==="string"&&frame.text.length>0,"Original settings frame missing");
 return true;
}
export function pollingPresentation(session,{InteractiveMode,LocalPollPresentation,Container,initTheme}) {
 assert.equal(typeof InteractiveMode?.prototype?.subscribeToAgent,"function");
 assert.equal(typeof LocalPollPresentation,"function");initTheme("dark",false);
 const view=Object.create(InteractiveMode.prototype),forwarded=[],tasks=new Set(),failures=[];let sink;
 const sessionView={agent:session.agent,settingsManager:session.settingsManager,sessionManager:session.sessionManager,get extensionRunner(){return session.extensionRunner;},get modelRuntime(){return session.modelRuntime;},getToolDefinition:session.getToolDefinition.bind(session),subscribe:listener=>{sink=listener;return session.subscribe(listener);}};
 Object.assign(view,{runtimeHost:{session:sessionView},isInitialized:true,localPollPresentation:new LocalPollPresentation(),pendingTools:new Map(),chatContainer:new Container(),loadedResourcesContainer:new Container(),footer:{invalidate(){}},ui:{requestRender(){},terminal:{setProgress(){}}},toolOutputExpanded:false,clearStatusIndicator(){}});
 const nativeHandle=InteractiveMode.prototype.handleEvent;
 view.handleEvent=event=>{
  if(!["tool_execution_start","tool_execution_update","tool_execution_end","agent_start","agent_end"].includes(event.type)&&!(event.type==="message_start"&&event.message.role==="custom"&&event.message.customType==="code-mode-evidence"))return Promise.resolve();
  forwarded.push(event);
  const task=nativeHandle.call(view,event).catch(error=>{failures.push(error);}).finally(()=>tasks.delete(task));tasks.add(task);return task;
 };
 view.subscribeToAgent();
 return {forwarded,
  async settle(){await Promise.all([...tasks]);assert.deepEqual(failures,[]);},
  // Only for explicitly synthetic presentation frames; not a native invocation gateway.
  async fixtureEvent(event){await sink(event);await this.settle();},
  frame(width=80){return view.chatContainer.render(width).map(line=>line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"")).join("\n");},
  groups(){return view.chatContainer.children.filter(c=>typeof c.hasCall==="function"&&typeof c.addAudit==="function");},
  groupFrame(width=80){return this.groups().flatMap(c=>c.render(width)).map(line=>line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"")).join("\n");},
  expand(value){view.setToolsExpanded(value);},
  // Re-render only the supplied synthetic/owned history; this performs no profile discovery.
  history(messages){view.chatContainer.clear();view.renderSessionItems(messages);},
  pending(){return view.pendingTools.size;},
  close(){view.unsubscribe?.();view.localPollPresentation.clear();},
 };
}

export async function pollingPresentationFrames(session,native) {
 const p=pollingPresentation(session,native);
 const start={type:"tool_execution_start",toolCallId:"synthetic-poll",toolName:"write_stdin",scopeId:"synthetic-presentation-only",localPoll:"pending",args:{session_id:"synthetic"}};
 const result=text=>({content:[{type:"text",text}],details:{}});
 try{
  await p.fixtureEvent(start);await p.fixtureEvent({type:"tool_execution_end",toolCallId:start.toolCallId,toolName:start.toolName,scopeId:start.scopeId,localPoll:"quiet",isError:false,result:result("")});
  assert.equal(p.frame(),"");const quiet={name:"local-poll-empty-hidden",text:p.frame()};
  await p.fixtureEvent({...start,toolCallId:"synthetic-terminal"});await p.fixtureEvent({type:"tool_execution_end",toolCallId:"synthetic-terminal",toolName:start.toolName,scopeId:start.scopeId,isError:false,result:result("Synthetic terminal result")});
  const visible={name:"local-poll-terminal-visible",text:p.frame()};assert.match(visible.text,/Local job update/);assert.match(visible.text,/Synthetic terminal result/);assert.equal(p.pending(),0);
  return [quiet,visible,...await compactJobFrames(session,native)];
 }finally{p.close();}
}

// Display-only native events and fixed evidence; no calls/IDs are adopted or executed.
async function compactJobFrames(session,native) {
 const ui=pollingPresentation(session,native),frames=[],messages=[];
 const start=(id,toolName,args,scopeId="synthetic-group")=>({type:"tool_execution_start",toolCallId:id,toolName,args,scopeId});
 const result=detail=>({content:[{type:"text",text:JSON.stringify(detail)}],details:detail});
 const finish=(s,details)=>ui.fixtureEvent({type:"tool_execution_end",toolCallId:s.toolCallId,toolName:s.toolName,scopeId:s.scopeId,result:result(details),isError:false});
 const record=name=>frames.push({name,text:ui.groupFrame()});
 try{
  for(let n=0;n<3;n++){const s=start('synthetic-start-'+n,'exec_command',{cmd:'synthetic display only'});await ui.fixtureEvent(s);await finish(s,{session_id:'synthetic-job-'+n,output:'',exit_code:null,running:true,supervisor_ready:false,truncated_bytes:0});}
  for(let n=0;n<3;n++){const s={...start('synthetic-poll-'+n,'write_stdin',{session_id:'synthetic-job-'+n}),localPoll:'pending'};await ui.fixtureEvent(s);await finish(s,{session_id:undefined,output:'RENDER_OK_'+n+'\n',exit_code:0,running:false,supervisor_ready:true,truncated_bytes:0,termination:undefined});}
  for(let n=0;n<3;n++)for(const toolName of ['exec_command','write_stdin']){const m={role:'custom',customType:'code-mode-evidence',display:true,content:[{type:'text',text:`Code mode: ${toolName} returned.`}],details:{toolName,toolCallId:'synthetic-audit-'+toolName+n,isError:false,auditOnly:true,journalId:'synthetic-journal-'+toolName+n,scopeId:'synthetic-group'},timestamp:0};messages.push(m);await ui.fixtureEvent({type:'message_start',message:m});}
  assert.equal(ui.groups().length,1);record('local-jobs-three-compact');ui.expand(true);record('local-jobs-expanded');ui.expand(false);
  const before=JSON.stringify(messages);ui.history(messages);record('local-jobs-audit-history');assert.equal(JSON.stringify(messages),before);
  ui.history([]);const bad=start('synthetic-bad','exec_command',{cmd:'synthetic nonzero only'});await ui.fixtureEvent(bad);await finish(bad,{output:'SYNTHETIC_NONZERO',exit_code:7,running:false,truncated_bytes:0});record('local-jobs-error-visible');
  ui.history([]);const direct=start('synthetic-direct','exec_command',{cmd:'synthetic direct display only'},undefined);delete direct.scopeId;await ui.fixtureEvent(direct);await finish(direct,{output:'SYNTHETIC_DIRECT',exit_code:0,running:false,truncated_bytes:0});assert.equal(ui.groups().length,0);frames.push({name:'local-jobs-direct-unchanged',text:ui.frame()});assert.equal(ui.pending(),0);
  return frames;
 }finally{ui.close();}
}
