// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Synthetic contract fixture, not execution or rendered-product evidence.
import{CODE_RESULT_FRAMES,CODE_OUTPUT_FRAMES}from'../../code-result-presentation.mjs';
import{UNIFIED_OUTPUT_FRAMES}from'../../unified-output-presentation.mjs';
const codeFrames=()=>[
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
const current=()=>[codeFrames()[1].text,'Cell details:\nsynthetic-readable-cell\n"code_result"\n"wall_time_ms": 1250','SYNTHETIC_OUTPUT_HOOK_FEEDBACK',codeFrames()[6].text].map((text,n)=>({name:CODE_OUTPUT_FRAMES[n],text}));
const unifiedFrames=()=>[
 'Process running with session ID synthetic-unified\nSupervisor preamble: not confirmed',
 'Process exited with code 7\nMore output available with session ID synthetic-unified\nmore lines',
 'UNIFIED_LITERAL_12\n{"literal JSON":"not a summary"}',
 'Output omitted: 47 bytes\nTermination: Cancelled by user.',
 'SYNTHETIC_UNIFIED_HOOK_FEEDBACK',
].map((text,n)=>({name:UNIFIED_OUTPUT_FRAMES[n],text}));
function receipt(){return {savedCeiling:true,restoredCeiling:true,failedSaveUnchanged:true,invalidFilePreserved:true,exclusionsPreserved:true,frames:[
 {name:"wait-before",text:"→ Background wait ceiling 300000"},{name:"wait-saved",text:"→ Background wait ceiling 5000\nBackground wait ceiling: 5000 ms"},
 {name:"wait-restored",text:"→ Background wait ceiling 55001"},{name:"wait-save-failed",text:"→ Background wait ceiling 55001\nChange failed: retained"},
 {name:"wait-invalid",text:"→ Background wait ceiling unavailable"},{name:"wait-excluded",text:"→ Background wait ceiling 55001"},{name:"wait-excluded-saved",text:"→ Background wait ceiling 60000"}]};}
function webReceipt(){return{savedProfile:true,reloadRequired:true,restoredSchema:true,failedSaveUnchanged:true,invalidFilePreserved:true,exclusionsPreserved:true,preferencesIndependent:true,frames:['before','saved','restored','save-failed','invalid','excluded','excluded-saved'].map((n,i)=>({name:'web-profile-'+n,text:'→ Web admission profile '+['verified-v1','experimental','experimental','experimental','unavailable','experimental','verified-v1'][i]+(i===1?'\nReload extensions or restart Pi':i===3?'\nChange failed: preserved':'')}))};}
function contextReceipt(){return {explicitDisclosure:true,reloadRequired:true,contextFreeRestored:true,exclusionsPreserved:true,frames:['before','saved','effective','restored','excluded-saved'].map((n,i)=>({name:'context-profile-'+n,text:[1,2,4].includes(i)?'experimental-context; not secret-scrubbed; Reload extensions or restart Pi; effective: experimental-context':'experimental'}))};}
export function syntheticProfileReceipt(){return{status:'passed',savedUnifiedWaitPreference:true,savedWebAdmissionProfile:true,savedContextProfile:true,bundle:'/synthetic bundle',profile:'/synthetic profile',nativeCli:'actual bundled RPC',rollback:'native exclusions, Fast retained',credentialsCopied:false,hostedRequests:0,settingsAndOriginalsPreserved:true,savedCapabilityPreferences:true,settingsMenu:{status:'passed',networkAttempts:0,normalAndExcludedContexts:true,consolidatedJobs:true,savedCapabilityPreferences:true,quietPollingPresentation:true,compactLocalJobPresentation:true,readableCodePresentation:true,nativeUnifiedOutputPresentation:true,frames:[...prior(),...codeFrames(),...current(),...unifiedFrames()],waitSettings:receipt(),webSettings:webReceipt(),contextSettings:contextReceipt()}};}
