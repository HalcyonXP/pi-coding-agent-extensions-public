// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import {validateNativeCodeTransport,acceptNativeCodeTransport,codeHookOwner} from "../accept-code-transport.mjs";
const rows=()=>["openai-responses","openai-codex-responses"].map(api=>({api,nativeCatalogGrammar:true,requests:12,customDeclaration:true,internalOutputSchemaSerialized:false,ordinaryToolsRetained:true,rawSourcePreserved:true,customReplay:true,wrapperPreserved:true,nativeDelegations:2,rejectedDelegations:0,hookFeedbackVisible:true,cases:["raw","bad-pragma","legacy-options","hook-arguments","hook-block","hook-result"],activeScopes:0,drainingScopes:0,liveServiceCalls:0}));
test("installed Code transport requires both native APIs and all input/hook/result scenarios",()=>{
 const result=validateNativeCodeTransport(rows());assert.equal(result.nativeResponses,true);assert.equal(result.nativeCodexResponses,true);assert.equal(result.syntheticModelRequests,24);assert.equal(result.scenarios,12);assert.equal(result.liveServiceCalls,0);
});
for(const [name,change]of Object.entries({
 "catalog assumption":{nativeCatalogGrammar:false},"JSON provider fallback":{customDeclaration:false},"omitted scenario":{requests:10},"unexpected extra request":{requests:13},"serialized internal output schema":{internalOutputSchemaSerialized:true},"lost ordinary tools":{ordinaryToolsRetained:false},"rewritten raw source":{rawSourcePreserved:false},"wrong history pair":{customReplay:false},"broken existing wrapper":{wrapperPreserved:false},"missing real delegation":{nativeDelegations:1},"rejected input executed":{rejectedDelegations:1},"hidden hook feedback":{hookFeedbackVisible:false},"unconfirmed cleanup":{drainingScopes:1},"remaining authority":{activeScopes:1},"live service":{liveServiceCalls:1},"dropped hook case":{cases:["raw","bad-pragma","legacy-options","hook-arguments","hook-block"]},
}))test(`installed native Code transport refuses ${name}`,()=>{const value=rows();Object.assign(value[1],change);assert.throws(()=>validateNativeCodeTransport(value));});
test("an acceptance assertion and owned cleanup failure are both retained, with seams/hooks restored",async()=>{
 const call=()=>{},result=()=>{},calls=[call],results=[result],handlers=new Map([["tool_call",calls],["tool_result",results]]);
 const auth=async()=>{},checkAuth=async()=>false,stream=()=>{};let off=0;
 const runtime={getAuth:auth,checkAuth,getModel:()=>undefined};
 const session={model:{provider:"openai"},agent:{streamFunction:stream,subscribe:()=>()=>off++},getActiveToolNames:()=>["exec","wait","read"],setModel:async()=>{throw Error("synthetic owned cleanup failure");}};
 await assert.rejects(acceptNativeCodeTransport(session,runtime,{getExtensions:()=>({extensions:[{handlers,tools:new Map([['exec',{}],['wait',{}]])}]})},stream),error=>{assert.ok(error instanceof AggregateError);assert.equal(error.errors.length,2);assert.equal(error.errors[0].name,"AssertionError");assert.equal(error.errors[1].message,"synthetic owned cleanup failure");return true;});
 assert.equal(off,1);assert.equal(runtime.getAuth,auth);assert.equal(runtime.checkAuth,checkAuth);assert.equal(session.agent.streamFunction,stream);assert.deepEqual(calls,[call]);assert.deepEqual(results,[result]);
});
test('hook selection requires exactly the Code owner plus explicitly named hook-free native fixtures',()=>{const owner={tools:new Map([['exec',{}],['wait',{}]])},fixture={tools:new Map([['helper-probe-read',{}]]),handlers:new Map(),commands:new Map(),flags:new Map(),shortcuts:new Map()};assert.equal(codeHookOwner([owner]),owner);assert.equal(codeHookOwner([fixture,owner],['helper-probe-read']),owner);assert.throws(()=>codeHookOwner([fixture,owner]));assert.throws(()=>codeHookOwner([owner,owner],['helper-probe-read']));assert.throws(()=>codeHookOwner([owner,fixture],['wrong']));assert.throws(()=>codeHookOwner([fixture],[]));fixture.handlers.set('tool_call',[()=>{}]);assert.throws(()=>codeHookOwner([owner,fixture],['helper-probe-read']));});
test("one native provider is not both provider contracts",()=>{const value=rows();value[1].api=value[0].api;assert.throws(()=>validateNativeCodeTransport(value));assert.throws(()=>validateNativeCodeTransport(value.slice(0,1)));});
