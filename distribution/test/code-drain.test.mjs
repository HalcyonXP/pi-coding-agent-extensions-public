import assert from 'node:assert/strict';
import test from 'node:test';
import {validateCodeDrain} from '../accept-code-drain.mjs';
const rows=()=>['openai-responses','openai-codex-responses'].flatMap(api=>['context-revoke','manager-close'].map(mode=>({api,mode,requests:mode==='context-revoke'?3:4,collectorMs:1,status:'draining',output:[],nativeCloserCalls:1,drainRetainedUntilRelease:true,nativeTargetFinalized:true,activeScopes:0,drainingScopes:0})));
test('drain receipt separates collector cancellation from later confirmed native closure',()=>{
 assert.deepEqual(validateCodeDrain(rows()),{cancelledCollectorAwakened:true,pendingDrainRetained:true,nativeCloserOnce:true,nativeTargetFinalized:true,nativeScopesReleased:true,syntheticModelRequests:14,scenarios:4,liveServiceCalls:0});
});
for(const i of [0,1,2,3])for(const key of Object.keys(rows()[0]))test(`drain receipt refuses altered or missing ${i}.${key}`,()=>{
 const r=rows();r[i][key]=key==='collectorMs'?2000:typeof r[i][key]==='boolean'?false:typeof r[i][key]==='number'?r[i][key]+1:key==='output'?['cancelled guest output']:'unknown';
 assert.throws(()=>validateCodeDrain(r));delete r[i][key];assert.throws(()=>validateCodeDrain(r));
});
for(const shape of ['missing','duplicate','reversed','sparse','null'])test(`drain receipt refuses ${shape} cohorts`,()=>{
 const r=rows();if(shape==='missing')r.pop();if(shape==='duplicate')r[1]=r[0];if(shape==='reversed')r.reverse();if(shape==='sparse')delete r[0];
 assert.throws(()=>validateCodeDrain(shape==='null'?null:r));
});
for(const time of [NaN,Infinity,-Infinity,-1,'1',null])test(`drain receipt refuses invalid collector time ${String(time)}`,()=>{const r=rows();r[0].collectorMs=time;assert.throws(()=>validateCodeDrain(r));});
test('collector timing is bounded observation, not a fixed performance baseline',()=>{for(const time of [0,0.01,1999.99]){const r=rows();r[0].collectorMs=time;assert.equal(validateCodeDrain(r).scenarios,4);}});
