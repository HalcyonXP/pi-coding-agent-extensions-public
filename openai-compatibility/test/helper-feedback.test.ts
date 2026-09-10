import assert from 'node:assert/strict';
import test from 'node:test';
import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { codeResult, codeResultView } from '../code-mode-output.ts';
import { renderCodeResult } from '../code-mode-presentation.ts';
import { CodeMode, createCodeModeTools } from '../code-mode.ts';
import { CELL_HELPER_ERRORS, helperFailureHint } from '../runtime/cell-helper-errors.mjs';
const theme={fg:(_tone:string,text:string)=>text} as ExtensionContext['ui']['theme'];
for(const code of CELL_HELPER_ERRORS)test('fixed helper guidance reaches direct output and both native views: '+code,()=>{
 const d={cell_id:'helper-fixture',status:'completed' as const,output:[],result:{version:1 as const,status:'error' as const,code,diagnostics:{guest_phase:'await' as const,delegated_calls:0,returned_results:0,tool_errors:0,last_delegation:null,effects:'not_determined' as const}}};
 const r=codeResult(d,218),saved=JSON.stringify(r),hint=helperFailureHint(code)!;assert.ok(r.content[0].text.includes(hint));assert.equal(codeResultView(r).result?.code,code);
 for(const expanded of [false,true]){const frame=renderCodeResult(r,{expanded,isPartial:false},theme,{isError:false} as Parameters<typeof renderCodeResult>[3]).render(180).join('\n');assert.ok(frame.includes('Cell failed · '+code));assert.ok(frame.includes(hint));assert.ok(frame.includes('External effects: not determined'));assert.ok(frame.includes('Phase: await · delegated 0'));assert.equal(frame.includes('Cell details:'),expanded);}
 assert.equal(JSON.stringify(r),saved);const changed=structuredClone(r);changed.content[0].text=changed.content[0].text.replace(hint,'unreviewed hint');assert.throws(()=>codeResultView(changed));
});
test('model-facing guidance distinguishes primitive output, fixed hints and canonical alias identity',()=>{const d=createCodeModeTools(new CodeMode(()=>[]))[0].description;for(const pattern of [/Serialize arrays\/objects explicitly/,/exact native names win/,/ambiguous aliases are omitted/,/Metadata names stay canonical/,/fixed corrective hints, not raw exception messages/])assert.match(d,pattern);});
test('unknown and prototype names never become helper hints',()=>{for(const value of ['EXECUTION_FAILED','constructor','__proto__','toString',null,{},undefined])assert.equal(helperFailureHint(value),undefined);});
test('helper hint lookup does not coerce an arbitrary value',()=>{let reads=0;assert.equal(helperFailureHint({toString(){reads++;throw Error('never')}}),undefined);assert.equal(reads,0);});
