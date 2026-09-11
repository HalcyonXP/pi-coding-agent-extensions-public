import assert from 'node:assert/strict';import test from 'node:test';import {readFileSync} from 'node:fs';
import {UNIFIED_OUTPUT_FRAMES,validateUnifiedOutputFrames,validateAllOutputFrames} from '../unified-output-presentation.mjs';
import {acceptNativeUnifiedOutput} from '../accept-unified-output.mjs';
const frames=()=>[
 'Process running with session ID synthetic-unified\nSupervisor preamble: not confirmed',
 'Process exited with code 7\nMore output available with session ID synthetic-unified\nmore lines',
 'UNIFIED_LITERAL_12\n{"literal JSON":"not a summary"}',
 'Output omitted: 47 bytes\nTermination: Cancelled by user.',
 'SYNTHETIC_UNIFIED_HOOK_FEEDBACK',
].map((text,n)=>({name:UNIFIED_OUTPUT_FRAMES[n],text}));
test('five distinct native direct views require visible status, retained output, expansion, loss and hook feedback',()=>assert.equal(validateUnifiedOutputFrames(frames()),true));
for(let n=0;n<5;n++)test('missing native Unified frame '+UNIFIED_OUTPUT_FRAMES[n]+' refuses acceptance',()=>{const f=frames();f[n].text='lost';assert.throws(()=>validateUnifiedOutputFrames(f));});
test('a stopped retained ID cannot be labelled a running process',()=>{const f=frames();f[1].text+='\nProcess running';assert.throws(()=>validateUnifiedOutputFrames(f));});
test('partial or legacy-only frame lists cannot certify the combined contract',()=>{for(const n of [0,19,27,31,35,37])assert.throws(()=>validateAllOutputFrames(Array.from({length:n},()=>({name:'synthetic',text:'unaccepted'}))));});
test('real profile/settings consumers require the whole 36-frame contract while the prior 31 validator stays intact',()=>{
 const profile=readFileSync(new URL('../accept-profile.mjs',import.meta.url),'utf8'),settings=readFileSync(new URL('../accept-settings.mjs',import.meta.url),'utf8'),validator=readFileSync(new URL('../unified-output-presentation.mjs',import.meta.url),'utf8');
 assert.ok(profile.includes('validateAllOutputFrames(settingsMenu.frames)'));assert.ok(settings.includes('exerciseSettings(sdk,bundle,profile,cwd,join(bundle,"extensions/openai-compatibility/index.ts"))') && readFileSync(new URL('../settings-scenarios.mjs',import.meta.url),'utf8').includes('frames.push(...codeFrames,...unifiedFrames);validateAllOutputFrames(frames)'));assert.ok(validator.includes('validateReadableFrames(frames.slice(0,31))'));
});
test('native helper refuses unsupported platforms or preserves both primary and restoration failures',async()=>{
 if(process.platform!=='win32'){await assert.rejects(acceptNativeUnifiedOutput({}, {}, ()=>{}));return;}
 let sets=0;const original=()=>{},failures=[Error('synthetic primary output failure'),Error('synthetic output restoration failure')];
 const session={model:{id:'original'},agent:{streamFunction:original},getToolDefinition(){},subscribe(){return()=>{};},async setModel(){throw failures[sets++];}};
 const runtime={getAuth:original,checkAuth:original,getModel(){return{id:'synthetic',api:'openai-responses'};}};
 const native={Container:class{},LocalPollPresentation:class{clear(){}},initTheme(){},InteractiveMode:class{subscribeToAgent(){} handleEvent(){}}};
 await assert.rejects(acceptNativeUnifiedOutput(session,runtime,original,native),e=>e instanceof AggregateError&&e.errors[0]===failures[0]&&e.errors[1]===failures[1]);
 assert.equal(sets,2);assert.equal(session.agent.streamFunction,original);assert.equal(runtime.getAuth,original);assert.equal(runtime.checkAuth,original);
});
