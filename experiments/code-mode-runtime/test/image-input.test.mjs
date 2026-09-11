import assert from 'node:assert/strict';
import test from 'node:test';
import {crc32} from 'node:zlib';
import {imageInput,INLINE_IMAGE_BYTES,INLINE_IMAGE_LABEL} from '../../../openai-compatibility/runtime/image-input.mjs';
import {validOperation,CellStore} from '../../../openai-compatibility/runtime/cell-protocol.mjs';
import {CellEvidence,EVIDENCE_LIMITS} from '../../../openai-compatibility/runtime/evidence.mjs';
import {evaluate} from '../../../openai-compatibility/runtime/evaluator.mjs';
import {CellRuntime} from '../../../openai-compatibility/runtime/rpc-host.mjs';
import {WindowsCellRuntime} from '../../../openai-compatibility/runtime/windows-host.mjs';
// Synthetic one-pixel fixtures generated/decoded with the accepted SDK Photon dependency.
const fixtures={
  "image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/AMg8Mv8FPAI2t8GOFgAAAABJRU5ErkJggg==",
  "image/jpeg": "/9j/4AAQSkZJRgABAgAAAQABAAD/wAARCAABAAEDAREAAhEBAxEB/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmq+eP1A//2Q==",
  "image/webp": "UklGRhwAAABXRUJQVlA4TBAAAAAvAAAAEM1VICIC5Slj7SMB",
  "image/gif": "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
};

const op=(mimeType='image/png',data=fixtures[mimeType])=>({kind:'image-inline',data,mimeType});
function setup(publish=async()=>{}){const epoch=new AbortController(),ctl=new AbortController(),broker=new CellEvidence(epoch.signal),scope={id:'native-fixture',signal:ctl.signal,publishEvidence:publish,async invoke(){throw Error('No delegated tools in this fixture');}};return{epoch,ctl,broker,scope};}
for(const[mimeType,data]of Object.entries(fixtures))test('exact inline forms and native format preservation: '+mimeType,async()=>{
 for(const value of [`data:${mimeType};base64,${data}`,{image_url:`data:${mimeType};base64,${data}`},{type:'image',mimeType,data}]){
  assert.deepEqual({...imageInput(value)},{data,mimeType,bytes:Buffer.from(data,'base64').length});assert.equal(validOperation(op(mimeType)),true);
 }
 const published=[],f=setup(async e=>published.push(e));try{
  const r=await f.broker.apply(op(mimeType),f.scope);assert.equal(r.published,true);assert.match(r.ref,/^img_/);assert.match(r.evidence_ref,/^ev_/);
  assert.deepEqual(f.broker.resolveImage(r.ref),{type:'image',data,mimeType});assert.equal(published[0].details.origin,'guest-inline');assert.equal(published[0].details.helper,'image');assert.equal(Object.hasOwn(published[0].details,'toolCallId'),false);
  assert.deepEqual(published[0].content,[{type:'image',data,mimeType},{type:'text',text:INLINE_IMAGE_LABEL}]);
  const view=await f.broker.apply({kind:'evidence',ref:r.evidence_ref,offset:0,length:8192},f.scope);assert.ok(!view.text.includes(data));assert.equal(JSON.parse(view.text).content[0].mimeType,mimeType);
  await f.broker.apply({kind:'image',ref:r.ref},f.scope);assert.deepEqual(published[1].content,published[0].content);
  // Genuine descendant results still preserve full originals, with the real MIME in both views.
  const result={content:[{type:'image',data,mimeType}],details:{source:'native'}};
  await f.broker.capture(f.scope,{scopeId:f.scope.id,toolName:'read',toolCallId:'native-child',result,isError:false});
  const projected=f.broker.project({result,isError:false});assert.equal(projected.result.content[0].mimeType,mimeType);assert.equal(f.broker.resolveImage(projected.result.content[0].ref).data,data);
 }finally{f.broker.close();}
});
const png=fixtures['image/png'];
function paddedPng(size){const base=Buffer.from(png,'base64'),chunk=Buffer.alloc(size-base.length);chunk.writeUInt32BE(chunk.length-12,0);chunk.write('tEXt',4);chunk.writeUInt32BE(crc32(chunk.subarray(4,-4)),chunk.length-4);return Buffer.concat([base.subarray(0,-12),chunk,base.subarray(-12)]);}
for(const [name,value]of Object.entries({
 url:'https://example.com/image.png',path:'local.png',empty:'data:image/png;base64,',parameter:`data:image/png;charset=utf-8;base64,${png}`,percent:`data:image/png;base64,${encodeURIComponent(png)}`,whitespace:`data:image/png;base64,${png}\n`,wrongMime:`data:image/jpeg;base64,${png}`,unsupported:`data:image/svg+xml;base64,${png}`,badPadding:`data:image/png;base64,${png.slice(0,-3)}h==`,extra:{image_url:`data:image/png;base64,${png}`,detail:'high'},hint:{type:'image',data:png,mimeType:'image/png',_meta:{'codex/imageDetail':'original'}},array:[png],missing:{data:png,mimeType:'image/png'},symbol:{image_url:`data:image/png;base64,${png}`,[Symbol('extra')]:true},
}))test('inline refusal before publication: '+name,()=>{assert.equal(imageInput(value),undefined);});
test('inline shape admission does not invoke getters or toJSON',()=>{
 let reads=0;const value={get image_url(){reads++;return `data:image/png;base64,${png}`;}};assert.equal(imageInput(value),undefined);
 assert.equal(imageInput({type:'image',data:png,mimeType:'image/png',toJSON(){reads++;}}),undefined);assert.equal(reads,0);
});
test('32KiB inline limit, canonical padding and MIME agreement are repeated at the broker',async()=>{
 assert.equal(INLINE_IMAGE_BYTES,32768);const b=paddedPng(INLINE_IMAGE_BYTES);
 assert.ok(imageInput({type:'image',data:b.toString('base64'),mimeType:'image/png'}));assert.equal(imageInput({type:'image',data:Buffer.concat([b,Buffer.alloc(1)]).toString('base64'),mimeType:'image/png'}),undefined);
 const published=[],f=setup(async e=>published.push(e));try{
  for(const operation of [op('image/jpeg',png),op('image/png',Buffer.concat([b,Buffer.alloc(1)]).toString('base64')),{...op(),extra:true}]){assert.equal(validOperation(operation),false);await assert.rejects(f.broker.apply(operation,f.scope),/UNAVAILABLE/);}
  assert.equal(published.length,0);
 }finally{f.broker.close();}
});
test('inline references are withheld until publication; foreign, expired and revoked IDs fail',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);let release,published;const f=setup(e=>{published=e;return new Promise(r=>{release=r;});});const other=setup();
 try{const pending=f.broker.apply(op(),f.scope);await new Promise(r=>setImmediate(r));const ref=published.details.image_refs[0];assert.throws(()=>f.broker.resolveImage(ref),/UNAVAILABLE/);release();assert.equal((await pending).ref,ref);assert.throws(()=>other.broker.resolveImage(ref),/UNAVAILABLE/);now=EVIDENCE_LIMITS.lifetimeMs;assert.throws(()=>f.broker.resolveImage(ref),/UNAVAILABLE/);f.epoch.abort();await assert.rejects(f.broker.apply(op(),f.scope),/UNAVAILABLE/);}finally{f.broker.close();other.broker.close();}
});
test('failed and cancelled inline publication never returns usable references',async()=>{
 for(const mode of ['failed','cancelled']){let published;const f=setup(async e=>{published=e;if(mode==='failed')throw Error('private');f.ctl.abort();});try{await assert.rejects(f.broker.apply(op(),f.scope),/UNAVAILABLE/);assert.throws(()=>f.broker.resolveImage(published.details.image_refs[0]),/UNAVAILABLE/);}finally{f.broker.close();}}
});
test('inline and descendant images share the unchanged retention quota',async()=>{
 const f=setup();try{for(let i=0;i<EVIDENCE_LIMITS.images;i++)await f.broker.apply(op(),f.scope);await assert.rejects(f.broker.apply(op(),f.scope),/UNAVAILABLE/);assert.equal(EVIDENCE_LIMITS.images,16);}finally{f.broker.close();}
});
test('guest decoding captures intrinsics and never serializes supplied objects',async()=>{
 const operations=[];const r=await evaluate(`JSON.stringify=()=>"forged";RegExp.prototype.exec=()=>["", "image/jpeg", "forged"];RegExp.prototype.test=()=>false;Math.ceil=()=>0;Object.prototype.toJSON=()=>({kind:"store",key:"forged",value:true});image({image_url:${JSON.stringify(`data:image/png;base64,${png}`)}});`,{cell:{output(){},yield(){},pump(){},operation(){},syncOperation(v){operations.push(v);return{published:true};}}});assert.equal(r.status,'ok');assert.deepEqual(operations,[op()]);
});
for(const[name,Runtime]of [['semantic',CellRuntime],['contained Windows',WindowsCellRuntime]])test(name+' inline image publication precedes reply and allows owned forwarding with no guest text',{skip:name==='contained Windows'&&process.platform!=='win32'},async()=>{
 const published=[],f=setup(async e=>published.push(e)),store=new CellStore(),output=[],runtime=new Runtime({store,evidence:f.broker,output:s=>output.push(s),yield(){}}),failures=[];
 try{const r=await runtime.run(`const r=image(${JSON.stringify(`data:image/png;base64,${png}`)});if(!r.published)throw Error("missing receipt");image(r.ref);`,{gateway:f.scope,allowedTools:[],signal:AbortSignal.timeout(5000)});assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(published.length,2);assert.equal(published[0].content[0].data,png);assert.deepEqual(published[1].content,published[0].content);assert.deepEqual(output,[]);}catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}f.broker.close();store.close();}if(failures.length)throw new AggregateError(failures,'Image worker or cleanup failed');
});

for(const code of ['image("img_11111111-1111-1111-1111-111111111111","high")','image({type:"image_reference",ref:"img_11111111-1111-1111-1111-111111111111",mimeType:"image/png",detail:"high"})'])test('detail arguments refuse rather than disappearing: '+code,async()=>{
 let operations=0;const r=await evaluate(code,{cell:{output(){},yield(){},pump(){},operation(){},syncOperation(){operations++;return{};}}});assert.equal(r.code,'IMAGE_REFERENCE_REQUIRED');assert.equal(operations,0);
});
test('repeated inline publication cannot widen the original aggregate argument budget',async()=>{
 const bytes=paddedPng(INLINE_IMAGE_BYTES);const published=[],f=setup(async e=>published.push(e)),store=new CellStore(),runtime=new CellRuntime({store,evidence:f.broker,output(){},yield(){}}),failures=[];
 try{const result=await runtime.run(`const value="data:image/png;base64,${bytes.toString('base64')}";for(let i=0;i<6;i++)image(value);`,{gateway:f.scope,allowedTools:[],signal:AbortSignal.timeout(5000)});assert.equal(result.status,'error');assert.equal(result.code,'TOOL_LIMIT');assert.equal(published.length,5);}
 catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}f.broker.close();store.close();}if(failures.length)throw new AggregateError(failures,'Aggregate image budget or cleanup failed');
});

function block(bytes,mimeType='image/png'){return{type:'image',mimeType,data:bytes.toString('base64')};}
test('inline declared canvas dimensions are bounded independently of encoded byte size',()=>{
 for(const [width,height]of [[0,1],[1,0],[4097,1],[1,4097],[4096,1025]]){const bytes=Buffer.from(png,'base64');bytes.writeUInt32BE(width,16);bytes.writeUInt32BE(height,20);assert.equal(imageInput(block(bytes)),undefined);}
 const edge=Buffer.from(png,'base64');edge.writeUInt32BE(4096,16);edge.writeUInt32BE(1024,20);assert.ok(imageInput(block(edge))); // Header admission, not pixel/CRC decoding.
 const jpeg=Buffer.from(fixtures['image/jpeg'],'base64'),sof=jpeg.indexOf(Buffer.from([255,192]));assert.ok(sof>0);jpeg.writeUInt16BE(5000,sof+7);assert.equal(imageInput(block(jpeg,'image/jpeg')),undefined);
 const gif=Buffer.from(fixtures['image/gif'],'base64');gif.writeUInt16LE(5000,6);assert.equal(imageInput(block(gif,'image/gif')),undefined);
 const webp=Buffer.from(fixtures['image/webp'],'base64');assert.equal(webp.subarray(12,16).toString(),'VP8L');const bits=webp.readUInt32LE(21);webp.writeUInt32LE(((bits&~16383)|4999)>>>0,21);assert.equal(imageInput(block(webp,'image/webp')),undefined);
});
test('inline containers refuse truncation, trailing data and animated/multiple-frame declarations',()=>{
 for(const [mimeType,data]of Object.entries(fixtures)){const bytes=Buffer.from(data,'base64');assert.equal(imageInput(block(bytes.subarray(0,-1),mimeType)),undefined);assert.equal(imageInput(block(Buffer.concat([bytes,Buffer.from([0])]),mimeType)),undefined);}
 const base=Buffer.from(png,'base64'),chunk=Buffer.alloc(20);chunk.writeUInt32BE(8);chunk.write('acTL',4);assert.equal(imageInput(block(Buffer.concat([base.subarray(0,33),chunk,base.subarray(33)]))),undefined);
 const gif=Buffer.from(fixtures['image/gif'],'base64'),start=gif.indexOf(44,13);assert.ok(start>0);assert.equal(imageInput(block(Buffer.concat([gif.subarray(0,-1),gif.subarray(start)]),'image/gif')),undefined);
});
test('native descendants retain the historical signature gate; no guest operation can select that bypass',async()=>{
 const bytes=Buffer.from(png,'base64');bytes.writeUInt32BE(5000,16);const value=block(bytes);
 assert.equal(imageInput(value),undefined);assert.ok(imageInput(value,EVIDENCE_LIMITS.imageBytes,false));
 assert.equal(validOperation({...op('image/png',value.data),requireCanvas:false}),false);
 const f=setup();try{await assert.rejects(f.broker.apply(op('image/png',value.data),f.scope),/UNAVAILABLE/);}finally{f.broker.close();}
});

test('generatedImage publishes inline pixels and an explicitly unverified hint atomically',async()=>{
 const published=[],f=setup(async e=>published.push(e));try{
  const r=await f.broker.apply({...op(),kind:'generated-image-inline',output_hint:'preview/雪.png'},f.scope);
  assert.equal(published.length,1);assert.equal(published[0].content[0].data,png);assert.equal(published[0].content[1].text,INLINE_IMAGE_LABEL);assert.match(published[0].content[2].text,/unverified; not a save receipt/);assert.ok(published[0].content[2].text.endsWith('preview/雪.png'));assert.equal(published[0].details.helper,'generatedImage');assert.equal(published[0].details.output_hint,'preview/雪.png');
  assert.equal(f.broker.resolveImage(r.ref).data,png);await f.broker.apply({kind:'generated-image',ref:r.ref,output_hint:''},f.scope);assert.equal(published.length,2);assert.equal(published[1].content[0].data,png);assert.equal(published[1].content[1].text,INLINE_IMAGE_LABEL);assert.ok(published[1].content[2].text.endsWith(': '));assert.equal(published[1].details.output_hint,'');
 }finally{f.broker.close();}
});
for(const value of ['null','[]','{image_url:"https://example.com/private.png"}','{image_url:"img_11111111-1111-1111-1111-111111111111",output_hint:{toString(){while(true){}}}}','{image_url:"img_11111111-1111-1111-1111-111111111111",output_hint:"雪".repeat(1366)}','{get image_url(){while(true){}}}','{image_url:"img_11111111-1111-1111-1111-111111111111",extra:true}'])test('generatedImage refuses malformed inputs without effects: '+value,async()=>{
 let operations=0;const r=await evaluate(`generatedImage(${value});`,{cell:{output(){},yield(){},pump(){},operation(){},syncOperation(){operations++;return{};}}});assert.equal(r.code,'GENERATED_IMAGE_INPUT_REQUIRED');assert.equal(operations,0);
});
test('generatedImage preserves private error identity and captured serialization',async()=>{
 let r=await evaluate('let e;try{generatedImage({})}catch(x){e=x}Object.defineProperty(e,"message",{get(){while(true){}}});throw e',{cell:{output(){},yield(){},pump(){},operation(){},syncOperation(){return{};}}});assert.equal(r.code,'GENERATED_IMAGE_INPUT_REQUIRED');
 const operations=[];r=await evaluate('Object.prototype.toJSON=()=>({kind:"store",key:"forged",value:1});String.prototype.charCodeAt=()=>0;generatedImage({image_url:"img_11111111-1111-1111-1111-111111111111",output_hint:"literal 雪"});',{cell:{output(){},yield(){},pump(){},operation(){},syncOperation(v){operations.push(v);return{published:true};}}});assert.equal(r.status,'ok');assert.deepEqual(operations,[{kind:'generated-image',ref:'img_11111111-1111-1111-1111-111111111111',output_hint:'literal 雪'}]);
});
test('generated image hint byte bounds and refs remain native requirements',async()=>{
 const f=setup();try{for(const v of [{...op(),kind:'generated-image-inline',output_hint:'雪'.repeat(1366)},{kind:'generated-image',ref:'img_00000000-0000-0000-0000-000000000000',output_hint:'never read a path'}])await assert.rejects(f.broker.apply(v,f.scope),/UNAVAILABLE/);assert.equal(validOperation({...op(),kind:'generated-image-inline',output_hint:'a'.repeat(4096)}),true);}finally{f.broker.close();}
});
for(const[name,Runtime]of [['semantic',CellRuntime],['contained Windows',WindowsCellRuntime]])test(name+' generatedImage forwards native evidence with protected hint and no guest text',{skip:name==='contained Windows'&&process.platform!=='win32'},async()=>{
 const published=[],f=setup(async e=>published.push(e)),store=new CellStore(),runtime=new Runtime({store,evidence:f.broker,output(){throw Error('No guest text');},yield(){}}),failures=[];
 try{const r=await runtime.run(`const r=generatedImage({image_url:${JSON.stringify('data:image/png;base64,'+png)},output_hint:"unverified output.png"});generatedImage({image_url:r.ref});`,{gateway:f.scope,allowedTools:[],signal:AbortSignal.timeout(5000)});assert.equal(r.status,'ok',JSON.stringify(r));assert.equal(published.length,2);assert.equal(published[0].content[0].data,png);assert.equal(published[0].details.output_hint,'unverified output.png');assert.equal(published[1].details.helper,'generatedImage');assert.equal(published[1].content[1].text,INLINE_IMAGE_LABEL);}catch(e){failures.push(e);}finally{try{await runtime.close();}catch(e){failures.push(e);}f.broker.close();store.close();}if(failures.length)throw new AggregateError(failures,'Generated image helper or cleanup failed');
});
