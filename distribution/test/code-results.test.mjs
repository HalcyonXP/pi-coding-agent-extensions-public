// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';import test from 'node:test';
import {CODE_RESULT_FRAMES,validateCodeResultFrames,validateReadableFrames,inspectCodeResult} from '../code-result-presentation.mjs';
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
test('readable frame contract preserves all nineteen predecessors and adds eight explicit views',()=>assert.equal(validateReadableFrames([...prior(),...frames()]),true));
for(let n=0;n<8;n++)test('refuse lost readable frame '+CODE_RESULT_FRAMES[n],()=>{const f=frames();f[n].text='lost';assert.throws(()=>validateCodeResultFrames(f));});
test('obsolete nineteen-only list cannot accept the new product',()=>assert.throws(()=>validateReadableFrames(prior())));
test('lost prior frame and hidden native error are not excused by new views',()=>{const p=prior();p[5].text='lost';assert.throws(()=>validateReadableFrames([...p,...frames()]));});
test('raw wrappers cannot pass the human-readable success frame',()=>{const f=frames();f[1].text+=' "cell_id"';assert.throws(()=>validateCodeResultFrames(f));});
const uiFixture=()=>{let expanded=false,history='synthetic history';const message={toolCallId:'synthetic-call',content:[{type:'text',text:'{"cell_id":"synthetic-cell"}'}]};const ui={expand(v){expanded=v;},historySnapshot(){return history;},toolFrame(){return expanded?'Cell completed\nCell details:\nsynthetic-cell':'Cell completed\nSynthetic human summary';}};return{ui,message,mutateHistory(){history+=' changed';}};};
test('installed observation requires native collapse/expand, correlation and unchanged history/wire',()=>{const f=uiFixture();assert.equal(inspectCodeResult(f.ui,f.message,'completed','Synthetic human summary'),true);});
for(const kind of['missing title','missing details','lost correlation','mutated wire','mutated history','raw wrapper'])test('installed observation refuses '+kind,()=>{const f=uiFixture(),old=f.ui.toolFrame;f.ui.toolFrame=()=>{const text=old();if(kind==='missing title')return '';if(kind==='missing details')return text.replace('Cell details:','lost');if(kind==='lost correlation')return text.replace('synthetic-cell','other');if(kind==='raw wrapper')return text+' "output"';return text;};const oldExpand=f.ui.expand;if(kind==='mutated wire')f.ui.expand=v=>{oldExpand(v);f.message.extra=v;};if(kind==='mutated history')f.ui.expand=v=>{oldExpand(v);f.mutateHistory();};assert.throws(()=>inspectCodeResult(f.ui,f.message,'completed'));});
