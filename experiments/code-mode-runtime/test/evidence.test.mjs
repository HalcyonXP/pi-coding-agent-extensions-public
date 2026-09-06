import assert from "node:assert/strict";
import test from "node:test";
import { CellEvidence, EVIDENCE_LIMITS } from "../../../openai-compatibility/runtime/evidence.mjs";
import { resultJSON } from "../../../openai-compatibility/runtime/rpc-protocol.mjs";
const png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
function fixture(publish = async()=>{}) {
 const epoch = new AbortController(), controller = new AbortController();
 const broker = new CellEvidence(epoch.signal);
 const scope = {id:"native",signal:controller.signal,publishEvidence:publish};
 return {broker,scope,epoch,controller};
}
const event = (content=[{type:"image",data:png,mimeType:"image/png"}], name="imagegen") => ({scopeId:"native",toolCallId:"child",toolName:name,result:{content,details:{}},isError:false});
const outcome = e => ({result:e.result,isError:e.isError});
test("protected finalized images are projected only after native receipt, never bytes through views",async()=>{
 const published=[];const {broker,scope}=fixture(async e=>published.push(e));const e=event();await broker.capture(scope,e);
 const p=broker.project(outcome(e));resultJSON(p);const ref=p.result.content[0].ref;
 assert.match(ref,/^img_/);assert.equal(JSON.stringify(p).includes(png),false);assert.equal(published[0].content[0].data,png);
 assert.equal(broker.resolveImage(ref).data,png);
 const view=await broker.apply({kind:"evidence",ref:p.result.protected_evidence.ref,offset:0,length:8192},scope);
 assert.ok(!view.text.includes(png));assert.ok(view.text.includes(ref));
 await broker.apply({kind:"image",ref},scope);assert.equal(published.length,2);broker.close();assert.throws(()=>broker.resolveImage(ref));
});
test("large source results retain full native evidence and explicit bounded projection",async()=>{
 let published;const {broker,scope}=fixture(async e=>{published=e});const e=event([{type:"text",text:"https://example.com/source "+"x".repeat(90000)}],"web_search");
 assert.throws(()=>resultJSON(outcome(e)),/LIMIT/);await broker.capture(scope,e);const p=broker.project(outcome(e));resultJSON(p);
 assert.equal(p.result.protected_evidence.projected,true);assert.equal(published.content[0].text,e.result.content[0].text);
 assert.equal((await broker.apply({kind:"evidence",ref:p.result.protected_evidence.ref,offset:0,length:64},scope)).text.length,64);broker.close();
});
test("ordinary results keep the original atomic limit rather than silently becoming references",async()=>{
 const {broker,scope}=fixture();const e=event([{type:"text",text:"x".repeat(90000)}],"ordinary");await broker.capture(scope,e);
 const value=outcome(e);assert.equal(broker.project(value),value);
 assert.throws(()=>resultJSON(broker.project(outcome(e))),/LIMIT/);broker.close();
});
test("foreign, forged, failed-publication and revoked references fail closed",async()=>{
 const f=fixture(), e=event();await f.broker.capture(f.scope,e);const p=f.broker.project(outcome(e));const ref=p.result.content[0].ref;
 assert.throws(()=>fixture().broker.resolveImage(ref));assert.throws(()=>f.broker.resolveImage("img_00000000-0000-0000-0000-000000000000"));
 const failed=fixture(async()=>{throw Error("private failure")});await assert.rejects(failed.broker.capture(failed.scope,e),/UNAVAILABLE/);
 assert.throws(()=>failed.broker.project(outcome(e)),/UNAVAILABLE/);
 f.epoch.abort();assert.throws(()=>f.broker.resolveImage(ref));failed.broker.close();
});
test("native retention and input bounds are atomic and do not execute serializers",async()=>{
 const f=fixture();let calls=0;const bad=event();bad.result.details={get secret(){calls++;return "private"}};
 await assert.rejects(f.broker.capture(f.scope,bad));assert.equal(calls,0);
 for(let n=0;n<EVIDENCE_LIMITS.images;n++)await f.broker.capture(f.scope,event());
 await assert.rejects(f.broker.capture(f.scope,event()),/UNAVAILABLE/);
 await assert.rejects(f.broker.capture(f.scope,event([{type:"image",mimeType:"image/png",data:"invalid=="}])));
 f.broker.close();
});

test("reference retention expires monotonically even without a provider change",async t=>{
 let now=0;t.mock.method(performance,"now",()=>now);const f=fixture();const e=event();await f.broker.capture(f.scope,e);
 const ref=f.broker.project(outcome(e)).result.content[0].ref;now=EVIDENCE_LIMITS.lifetimeMs;
 assert.throws(()=>f.broker.resolveImage(ref));f.broker.close();
});
