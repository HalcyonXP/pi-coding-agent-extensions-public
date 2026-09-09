// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';import test from 'node:test';
import {CODE_RESULT_FRAMES,CODE_OUTPUT_FRAMES,validateCodeResultFrames,validateCodeOutputFrames,validateReadableFrames,inspectCodeResult} from '../code-result-presentation.mjs';
const frames=()=>[
 'Cell running · collect with wait',
 'Cell completed\nCoordinator output:\nTask one: SAMPLE_ALPHA · exit 0\nTask two: SAMPLE_BETA · exit 0\nEmpty-running polls: 4',
 'Cell details:\nsynthetic-readable-cell\n"version": 1',
 'Cell failed · EXECUTION_FAILED\nPhase: compile\nExternal effects: not determined',
 'Cell draining · cleanup unconfirmed',
 'Cell terminated',
 'Output omitted: 47 bytes · not recoverable by expansion',
 'SYNTHETIC_UNKNOWN_METADATA',
].map((text,n)=>({name:CODE_RESULT_FRAMES[n],text}));
const prior=()=>[
 {name:'local-poll-empty-hidden',text:''},{name:'local-poll-terminal-visible',text:'Local job update\nSynthetic terminal result'},
 {name:'local-jobs-three-compact',text:'6 call audits\nRENDER_OK_0\nRENDER_OK_1\nRENDER_OK_2'},
 {name:'local-jobs-expanded',text:'Scope: synthetic-group\nsession_id\nCode mode: exec_command returned.'},
 {name:'local-jobs-audit-history',text:'history only · 6 call audits'},
 {name:'local-jobs-error-visible',text:'error (exit 7)\nSYNTHETIC_NONZERO'},
 {name:'local-jobs-direct-unchanged',text:'exec_command\nSYNTHETIC_DIRECT'},
 ...['fast-before','fast-applying','fast-saved','capabilities-before','unified-search-stays-open','code-enabled','web-enabled','jobs-inside-openai','capabilities-restored','fast-after-exclusions','capabilities-excluded','jobs-after-exclusions'].map(name=>({name,text:'Synthetic prior settings frame'}))
];
const current=()=>[frames()[1].text,'Cell details:\nsynthetic-readable-cell\n"code_result"\n"wall_time_ms": 1250','SYNTHETIC_OUTPUT_HOOK_FEEDBACK',frames()[6].text].map((text,n)=>({name:CODE_OUTPUT_FRAMES[n],text}));
test('readable frame contract preserves all twenty-seven predecessors and adds four current-output views',()=>assert.equal(validateReadableFrames([...prior(),...frames(),...current()]),true));
for(let n=0;n<4;n++)test('refuse lost current output frame '+CODE_OUTPUT_FRAMES[n],()=>{const f=current();f[n].text='lost';assert.throws(()=>validateCodeOutputFrames(f));});
test('legacy-only twenty-seven frames cannot certify the current output contract',()=>assert.throws(()=>validateReadableFrames([...prior(),...frames()])));
test('current/legacy collapsed and loss views must agree exactly',()=>{for(const n of [0,3]){const c=current();c[n].text+=' unexpected';assert.throws(()=>validateReadableFrames([...prior(),...frames(),...c]));}});
for(let n=0;n<8;n++)test('refuse lost readable frame '+CODE_RESULT_FRAMES[n],()=>{const f=frames();f[n].text='lost';assert.throws(()=>validateCodeResultFrames(f));});
test('obsolete nineteen-only list cannot accept the new product',()=>assert.throws(()=>validateReadableFrames(prior())));
test('lost prior frame and hidden native error are not excused by new views',()=>{const p=prior();p[5].text='lost';assert.throws(()=>validateReadableFrames([...p,...frames(),...current()]));});
test('raw wrappers cannot pass the human-readable success frame',()=>{const f=frames();f[1].text+=' "cell_id"';assert.throws(()=>validateCodeResultFrames(f));});
const uiFixture=()=>{let expanded=false,history='synthetic history';const details={cell_id:'synthetic-cell',status:'completed',output:['Synthetic human summary'],result:{version:1,status:'ok'},code_result:{version:1,wall_time_ms:1}},message={toolCallId:'synthetic-call',toolName:'exec',isError:false,details,content:[{type:'text',text:'Script completed\nWall time 0.0 seconds\nOutput:\nSynthetic human summary'}]};const ui={expand(v){expanded=v;},historySnapshot(){return history;},toolFrame(){return expanded?'Cell completed\nCell details:\nsynthetic-cell':'Cell completed\nSynthetic human summary';}};return{ui,message,mutateHistory(){history+=' changed';}};};
test('installed observation requires native collapse/expand, correlation and unchanged history/wire',()=>{const f=uiFixture();assert.equal(inspectCodeResult(f.ui,f.message,'completed','Synthetic human summary'),true);});
for(const kind of['missing title','missing details','lost correlation','mutated wire','mutated history','raw wrapper'])test('installed observation refuses '+kind,()=>{const f=uiFixture(),old=f.ui.toolFrame;f.ui.toolFrame=()=>{const text=old();if(kind==='missing title')return '';if(kind==='missing details')return text.replace('Cell details:','lost');if(kind==='lost correlation')return text.replace('synthetic-cell','other');if(kind==='raw wrapper')return text+' "output"';return text;};const oldExpand=f.ui.expand;if(kind==='mutated wire')f.ui.expand=v=>{oldExpand(v);f.message.extra=v;};if(kind==='mutated history')f.ui.expand=v=>{oldExpand(v);f.mutateHistory();};assert.throws(()=>inspectCodeResult(f.ui,f.message,'completed'));});
