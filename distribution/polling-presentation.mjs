// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only acceptance bootstrap: actual installed native subscription, handlers and
// components; no real terminal, keyboard/profile discovery or execution authority.
import assert from "node:assert/strict";
export function pollingPresentation(session,{InteractiveMode,LocalPollPresentation,Container,initTheme}) {
 assert.equal(typeof InteractiveMode?.prototype?.subscribeToAgent,"function");
 assert.equal(typeof LocalPollPresentation,"function");initTheme("dark",false);
 const view=Object.create(InteractiveMode.prototype),forwarded=[],tasks=new Set(),failures=[];let sink;
 const sessionView={agent:session.agent,settingsManager:session.settingsManager,sessionManager:session.sessionManager,getToolDefinition:session.getToolDefinition.bind(session),subscribe:listener=>{sink=listener;return session.subscribe(listener);}};
 Object.assign(view,{runtimeHost:{session:sessionView},isInitialized:true,localPollPresentation:new LocalPollPresentation(),pendingTools:new Map(),chatContainer:new Container(),footer:{invalidate(){}},ui:{requestRender(){},terminal:{setProgress(){}}},toolOutputExpanded:false,clearStatusIndicator(){}});
 const nativeHandle=InteractiveMode.prototype.handleEvent;
 view.handleEvent=event=>{
  if(!["tool_execution_start","tool_execution_update","tool_execution_end","agent_start","agent_end"].includes(event.type))return Promise.resolve();
  forwarded.push(event);
  const task=nativeHandle.call(view,event).catch(error=>{failures.push(error);}).finally(()=>tasks.delete(task));tasks.add(task);return task;
 };
 view.subscribeToAgent();
 return {forwarded,
  async settle(){await Promise.all([...tasks]);assert.deepEqual(failures,[]);},
  // Only for explicitly synthetic presentation frames; not a native invocation gateway.
  async fixtureEvent(event){await sink(event);await this.settle();},
  frame(){return view.chatContainer.render(80).map(line=>line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,"")).join("\n");},
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
  return [quiet,visible];
 }finally{p.close();}
}
