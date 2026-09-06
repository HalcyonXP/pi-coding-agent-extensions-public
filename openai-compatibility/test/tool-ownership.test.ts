import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { harness, token } from "./capability-fixture.ts";
const foreign = (name: string): ToolDefinition => ({ name, label: name, description: "Foreign fixture", parameters: Type.Object({}), async execute() { throw new Error("Foreign handler must not run"); } });

test("registration waits for bound metadata; repeated session start is idempotent", async () => {
 const h = harness(tmpdir());
 assert.equal(h.tools.size, 0);
 try {
  await h.emit("session_start"); const original = h.tools.get("imagegen");
  assert.ok(original); await h.emit("session_start"); assert.equal(h.tools.get("imagegen"), original);
  assert.ok(h.active().includes("read") && h.active().includes("powershell") && h.active().includes("imagegen"));
 } finally { await h.emit("session_shutdown"); }
});

test("preexisting imagegen is not overwritten, exposed or callable through reserved hooks", async () => {
 const h = harness(tmpdir()); const existing = foreign("imagegen"); h.tools.set("imagegen", existing);
 h.pi.setActiveTools([...h.active(), "imagegen"]);
 try {
  await h.emit("session_start"); assert.equal(h.tools.get("imagegen"), existing); assert.ok(!h.active().includes("imagegen"));
  h.pi.setActiveTools([...h.active(), "imagegen"]);
  assert.equal((await h.emit("tool_call", { toolName: "imagegen" })).block, true);
  assert.equal((await h.emit("tool_result", { toolName: "imagegen", toolCallId: "foreign" })).isError, true);
  await h.commands.get("openai-tools").handler("status", h.ctx);
  assert.match(h.notices.at(-1)!, /ownership: unavailable\/conflicting\/excluded: imagegen/);
  assert.equal(h.authCalls(), 0);
 } finally { await h.emit("session_shutdown"); }
});

test("a Unified exec name collision prevents partial paired registration", async () => {
 const h = harness(tmpdir()); const existing = foreign("write_stdin"); h.tools.set("write_stdin", existing);
 try {
  await h.emit("session_start"); await h.commands.get("openai-tools").handler("unified_exec on", h.ctx);
  assert.equal(h.tools.has("exec_command"), false); assert.equal(h.tools.get("write_stdin"), existing);
  assert.ok(!h.active().includes("exec_command") && !h.active().includes("write_stdin"));
  assert.ok(h.active().includes("imagegen"));
 } finally { await h.emit("session_shutdown"); }
});

test("structurally identical replacement schemas do not authenticate saved handlers", async () => {
 const h = harness(tmpdir());
 try {
  await h.emit("session_start"); const saved = h.tools.get("imagegen")!;
  h.tools.set("imagegen", { ...saved, parameters: structuredClone(saved.parameters) });
  await assert.rejects(saved.execute("stale", { prompt: "fixture" }, undefined, undefined, h.ctx), /conflicting, excluded, or replaced/);
  assert.equal(h.authCalls(), 0);
 } finally { await h.emit("session_shutdown"); }
});

test("replacement during authentication prevents transport and quarantines late results", async () => {
 const h = harness(tmpdir()); let release!: () => void; let entered!: () => void;
 const previousFetch = globalThis.fetch; let requests = 0;
 globalThis.fetch = async () => { requests++; throw new Error("Unexpected offline transport"); };
 const ready = new Promise<void>(resolve => { entered = resolve; });
 const wait = new Promise<void>(resolve => { release = resolve; });
 h.setAuth(async () => { entered(); await wait; return { auth: { apiKey: token } }; });
 try {
  await h.emit("session_start"); const saved = h.tools.get("imagegen")!;
  const running = saved.execute("replacement", { prompt: "fixture" }, undefined, undefined, h.ctx);
  await ready; h.tools.set("imagegen", foreign("imagegen")); release();
  await assert.rejects(running); assert.equal(requests, 0);
  assert.equal((await h.emit("tool_result", { toolName: "imagegen", toolCallId: "replacement" })).isError, true);
 } finally { release(); globalThis.fetch = previousFetch; await h.emit("session_shutdown"); }
});

test("missing or throwing metadata fails closed without echoing registry errors", async () => {
 const h = harness(tmpdir()); h.pi.getAllTools = () => { throw new Error(token); };
 try {
  await h.emit("session_start"); assert.equal(h.tools.size, 0);
  assert.equal((await h.emit("tool_call", { toolName: "imagegen" })).block, true);
  await h.commands.get("openai-tools").handler("status", h.ctx);
  assert.ok(!h.notices.join("").includes(token)); assert.deepEqual(h.active(), ["read", "powershell"]);
 } finally { await h.emit("session_shutdown"); }
});

test("removing a conflict permits registration only on the next session start", async () => {
 const h = harness(tmpdir()); h.tools.set("imagegen", foreign("imagegen"));
 try {
  await h.emit("session_start"); h.tools.delete("imagegen");
  await h.commands.get("openai-tools").handler("imagegen on", h.ctx); assert.ok(!h.active().includes("imagegen"));
  await h.emit("session_start"); assert.ok(h.tools.has("imagegen") && h.active().includes("imagegen"));
 } finally { await h.emit("session_shutdown"); }
});

test("public factory schemas cannot impersonate this installation's private registration", async () => {
 const { ImagegenParams } = await import("../imagegen/tool.ts");
 const h = harness(tmpdir());
 try {
  await h.emit("session_start"); const saved = h.tools.get("imagegen")!;
  assert.notEqual(saved.parameters, ImagegenParams);
  h.tools.set("imagegen", { ...foreign("imagegen"), parameters: ImagegenParams });
  await assert.rejects(saved.execute("shared-schema", { prompt: "fixture" }, undefined, undefined, h.ctx), /conflicting, excluded, or replaced/);
  assert.equal(h.authCalls(), 0);
 } finally { await h.emit("session_shutdown"); }
});

test("Code mode reserves a pair only on marked hosts and rejects either member's replacement/exclusion",async()=>{
 for(const mode of ["stock","collision","replacement","exclusion"]){
  const h=harness(tmpdir());
  if(mode!=="stock")Object.assign(h.ctx,{toolGatewayInfo:{version:1,protectedResults:true,activeScopes:0,drainingScopes:0,maxScopes:2}});
  const existing=foreign("wait");
  if(mode==="stock"||mode==="collision"){h.tools.set("wait",existing);h.pi.setActiveTools([...h.active(),"wait"]);}
  try{
   await h.emit("session_start");
   if(mode==="stock"){assert.equal(h.tools.has("exec"),false);assert.equal(h.tools.get("wait"),existing);assert.ok(h.active().includes("wait"));}
   else if(mode==="collision"){assert.equal(h.tools.has("exec"),false);assert.equal(h.tools.get("wait"),existing);assert.ok(!h.active().includes("wait"));}
   else{
    const saved=h.tools.get("exec")!,wait=h.tools.get("wait")!;assert.ok(saved&&wait);
    if(mode==="replacement")h.tools.set("wait",{...wait,parameters:structuredClone(wait.parameters)});else h.tools.delete("wait");
    await assert.rejects(saved.execute("stale-pair",{code:"text(1)"},undefined,undefined,h.ctx),/conflicting, excluded, or replaced/);
   }
   assert.ok(h.active().includes("read")&&h.active().includes("powershell"));assert.equal(h.authCalls(),0);
  }finally{await h.emit("session_shutdown");}
 }
});

test("a pending Code mode preference cannot enable a newer session after preflight yields",async()=>{
 const h=harness(tmpdir());Object.assign(h.ctx,{toolGatewayInfo:{version:1,protectedResults:true,activeScopes:0,drainingScopes:0,maxScopes:2}});
 try{
  await h.emit("session_start");const pending=h.commands.get("openai-tools").handler("code_mode on",h.ctx);
  await h.emit("session_start");await pending;
  assert.match(h.notices.at(-1)!,/preference change revoked/);assert.ok(!h.active().includes("exec")&&!h.active().includes("wait"));assert.equal(h.authCalls(),0);
 }finally{await h.emit("session_shutdown");}
});
