// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Actual native renderer, instance-local synthetic terminal fields; no invocation authority.
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
export async function loadNotificationPresentation(bundle,sdk){
 const {Container,Text}=await import(pathToFileURL(join(bundle,'node_modules/@earendil-works/pi-tui/dist/index.js')).href);sdk.initTheme('dark',false);
 return session=>{
  const chat=new Container(),pendingTools=new Map(),tasks=new Set(),errors=[];let starts=0,ends=0;
  const fields={isInitialized:true,footer:{invalidate(){}},ui:{requestRender(){}},chatContainer:chat,outputPad:1,toolOutputExpanded:false,getMarkdownThemeWithSettings:()=>undefined,pendingTools,localPollPresentation:{resetPresentation(){}},session:{settingsManager:session.settingsManager,agent:session.agent,extensionRunner:{getMessageRenderer(){throw Error('Native notifications cannot use custom-message renderers');}}}};
  const view=Object.defineProperties(Object.create(sdk.InteractiveMode.prototype),Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{value,writable:true,configurable:true}])));
  const off=session.subscribe(event=>{
   if(event.type==='tool_execution_end'&&event.toolName==='exec'&&!event.scopeId){chat.addChild(new Text(event.result.content.map(b=>b.type==='text'?b.text:'').join('\n'),0,0));pendingTools.set(event.toolCallId,{updateResult(){throw Error('Notification overwrote original result');}});}
   if(!['message_start','message_end'].includes(event.type)||event.message.role!=='toolResult'||event.message.notification!==true)return;
   if(event.type==='message_start')starts++;else ends++;
   const task=view.handleEvent(event).catch(error=>errors.push(error)).finally(()=>tasks.delete(task));tasks.add(task);
  });
  let closed=false;const close=async()=>{if(!closed){closed=true;off();}await Promise.all([...tasks]);if(errors.length)throw new AggregateError(errors,'Native notification presentation failed');};
  return {close,async finish(notes,original){await close();assert.equal(starts,2);assert.equal(ends,2);assert.equal(pendingTools.size,1);
   const strip=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,''),live=strip(chat.render(180).join('\n'));assert.ok(live.includes('Script running with cell ID'));
   const replay=new Container();view.chatContainer=replay;view.renderSessionItems(notes);const history=strip(replay.render(180).join('\n'));
   for(const text of [live,history]){assert.ok(text.includes(original.toolCallId));for(const note of notes)assert.equal(text.split(note.content[0].text).length-1,1);}
   return {live,history,nativeNotificationCards:true,replayedNotificationCards:true};
  }};
 };
}
