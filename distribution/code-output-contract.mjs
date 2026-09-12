// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only assertion of current installed SDK output, independent of the
// extension formatter. This is not a tool-result parser granting execution authority.
import assert from 'node:assert/strict';
// Deliberately independent of the product hint formatter.
const helperHints = {
 TEXT_VALUE_UNSUPPORTED:'text() requires a primitive. Use text(JSON.stringify(value)) for arrays/objects, or print individual strings.',
 IMAGE_REFERENCE_REQUIRED:'image() requires a native image reference or bounded canonical PNG/JPEG/GIF/WebP inline data. No paths, network URLs or detail hints; byte/canvas limits apply.',
 GENERATED_IMAGE_INPUT_REQUIRED:'generatedImage() requires {image_url: ownedRefOrDataUrl, output_hint?: string}. Image limits apply; hints are at most4096 UTF-8 bytes and not save receipts.',
 TIMER_CALLBACK_REQUIRED:'setTimeout() requires a function callback, not a command string.',
};
export function readCodeOutcome(message) {
 assert.ok(message&&['exec','wait'].includes(message.toolName));assert.equal(message.isError,false);
 const d=message.details;assert.ok(d&&typeof d==='object');assert.ok(typeof d.cell_id==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(d.cell_id));assert.ok(['running','draining','completed','terminated'].includes(d.status));assert.ok(Array.isArray(d.output)&&d.output.every(t=>typeof t==='string'));
 const m=d.code_result;assert.ok(m);assert.deepEqual(Object.keys(m).sort(),['version','wall_time_ms']);assert.equal(m.version,1);assert.ok(Number.isSafeInteger(m.wall_time_ms)&&m.wall_time_ms>=0);
 assert.equal(message.content.length,1);assert.deepEqual(Object.keys(message.content[0]).sort(),['text','type']);assert.equal(message.content[0].type,'text');
 const failed=d.result?.status==='error',status=failed?'Script failed':d.status==='running'?`Script running with cell ID ${d.cell_id}`:d.status==='draining'?`Script draining with cell ID ${d.cell_id} · cleanup unconfirmed`:d.status==='terminated'?'Script terminated':'Script completed';
 const lines=[...d.output];
 if(failed){assert.match(d.result.code,/^[A-Z][A-Z0-9_]{0,63}$/);const error=[`Script error:\n${d.result.code}`],v=d.result.diagnostics;if(Object.hasOwn(helperHints,d.result.code))error.push(`Helper: ${helperHints[d.result.code]}`);if(v){const last=v.last_delegation;error.push(`Phase: ${v.guest_phase} · delegated ${v.delegated_calls} · returned ${v.returned_results} · tool errors ${v.tool_errors}`,'External effects: not determined',last?`Last delegation: ${last.operation} · ${last.result}`:'Last delegation: none');if(last?.shell){const s=last.shell,word=x=>x===null?'unknown':x?'yes':'no';error.push(`Shell: ready ${word(s.supervisor_ready)} · running ${word(s.running)} · exit ${s.exit_code??'unknown'} · output ${word(s.output_observed)} · termination ${s.termination}`);}}lines.push(error.join('\n'));}
 if(d.omitted_output_bytes)lines.push(`Output omitted: ${d.omitted_output_bytes} bytes · not recoverable by expansion`);
 const expected=`${status}\nWall time ${(Math.round(m.wall_time_ms/100)/10).toFixed(1)} seconds\nOutput:\n${lines.join('\n')}`;assert.equal(message.content[0].text,expected,'Actual model output and structured native details disagree');return d;
}
export function validateCodeOutputAcceptance(messages) {
 const code=messages.filter(m=>['exec','wait'].includes(m.toolName)&&!m.isError),rows=code.map(m=>({name:m.toolName,value:readCodeOutcome(m)}));
 for(const name of ['exec','wait'])assert.ok(rows.some(r=>r.name===name));for(const status of ['running','completed','terminated'])assert.ok(rows.some(r=>r.value.status===status));
 assert.ok(rows.some(r=>r.value.result?.status==='error'&&r.value.output.length===0&&r.value.result.diagnostics));assert.ok(rows.some(r=>r.value.omitted_output_bytes>0&&r.value.output.length===0));assert.ok(rows.some(r=>r.value.output.length>0));
 return {nativeExec:true,nativeWait:true,plainModelOutput:true,measuredPerCallWallTime:true,structuredDetailsRetained:true,failureAndLossVisible:true,legacyJsonEnvelopeNotReturned:true,nestedProjectionCovered:false};
}
