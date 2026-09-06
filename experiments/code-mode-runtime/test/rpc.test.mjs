import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { after, test } from "node:test";
import { AsyncRuntimeProbe } from "../rpc-host.mjs";
import { workerEnvironment } from "../host.mjs";
import { FrameDecoder, encodeFrame, RPC_LIMITS } from "../rpc-protocol.mjs";

const probe = new AsyncRuntimeProbe();
after(() => probe.close());
const ok = (output) => ({ version: 1, status: "ok", output });
const error = (code) => ({ version: 1, status: "error", code });
const result = (text, details = {}) => ({ result: { content: [{ type: "text", text }], details }, isError: false });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Transport-only double, NOT evidence of Pi hook enforcement. Real AgentSession tests are separate.
function options(invoke = async () => result("approved")) {
  return { allowedTools: ["target"], gateway: { invoke, signal: new AbortController().signal } };
}
function fixture(source, children = []) {
  return () => {
    const child = spawn(process.execPath, ["-e", source], { env: workerEnvironment(), stdio: "pipe", windowsHide: true });
    children.push(child);
    return child;
  };
}

test("async RPC preserves arguments, Unicode/NUL, finalized content and citation details", async () => {
  const evidence = { sources: [{ url: "https://example.invalid/source", title: "Synthetic", start: 0, end: 4 }] };
  let args;
  const received = result("🌿 before\0after", evidence);
  const out = await probe.run(`const r=await tools.call("target",{text:"🌿 x\\u0000y",nested:{x:[1,true,null]}}); emit(JSON.stringify(r));`, options(async (_name, value) => { args = value; return received; }));
  assert.deepEqual(out, ok([JSON.stringify(received)]));
  assert.deepEqual(args, { text: "🌿 x\0y", nested: { x: [1, true, null] } });
});

test("sequential and four parallel calls correlate out-of-order replies", async () => {
  const out = await probe.run(`
    const first=await tools.call("target",{n:9}); emit(first.result.content[0].text);
    const values=await Promise.all([0,1,2,3].map(n=>tools.call("target",{n})));
    emit(values.map(v=>v.result.content[0].text).join(","));
  `, options(async (_name, args) => { await delay(Math.max(0, (4 - args.n) * 10)); return result(String(args.n)); }));
  assert.deepEqual(out, ok(["9", "0,1,2,3"]));
});

test("idle tool waits do not consume engine time, but resumed loops remain bounded", async () => {
  assert.deepEqual(await probe.run('await tools.call("target",{}); emit("resumed")', options(async () => { await delay(650); return result("done"); })), ok(["resumed"]));
  assert.deepEqual(await probe.run('await tools.call("target",{}); while(true){}', options()), error("EXECUTION_LIMIT"));
});

test("guest mutations cannot expose bridge host objects or change captured JSON codecs", async () => {
  assert.deepEqual(await probe.run(`
    JSON.stringify=()=>"poison"; JSON.parse=()=>({poison:true});
    const r=await tools.call("target",{});
    emit(r.result.content[0].text);
    emit(tools.call.constructor("return typeof process")());
    emit(typeof tools.invoke); emit(typeof tools.parentToolCallId); emit(String(Object.getPrototypeOf(tools)));
  `, options()), ok(["approved", "undefined", "undefined", "undefined", "null"]));
});

test("tool policy, missing gateway, invalid host allowlist and pre-cancel fail before launch", async () => {
  let launches = 0;
  const p = new AsyncRuntimeProbe({ launch() { launches++; throw Error("must not launch"); } });
  assert.deepEqual(await p.run("", { allowedTools: ["target"] }), error("GATEWAY_UNAVAILABLE"));
  for (const allowedTools of [[], ["exec"], ["wait"], ["target", "target"], ["../target"], ["x".repeat(65)]]) {
    assert.deepEqual(await p.run("", { ...options(), allowedTools }), error("INVALID_REQUEST"));
  }
  assert.deepEqual(await p.run("", { ...options(), signal: AbortSignal.abort() }), error("CANCELLED"));
  const cancelled = options(); cancelled.gateway.signal = AbortSignal.abort();
  assert.deepEqual(await p.run("", cancelled), error("CANCELLED"));
  assert.equal(launches, 0);
  await p.close();
  assert.deepEqual(await p.run("", options()), error("CLOSED"));
});

test("guest cannot invoke orchestration, unlisted or malformed tool names", async () => {
  let calls = 0;
  for (const name of ["exec", "wait", "unknown", "__proto__", "target\0extra"]) {
    assert.deepEqual(await probe.run(`try { await tools.call(${JSON.stringify(name)},{}); } catch {} emit("late")`, options(async () => { calls++; return result("bad"); })), error("TOOL_DENIED"));
  }
  assert.equal(calls, 0);
});

test("invalid objects and serialization loops cannot cross the host boundary", async () => {
  let calls = 0;
  const opts = options(async () => { calls++; return result("bad"); });
  for (const args of ["null", "[]", "42", '"text"']) {
    assert.deepEqual(await probe.run(`try { await tools.call("target",${args}); } catch {}`, opts), error("INVALID_TOOL_CALL"));
  }
  assert.deepEqual(await probe.run('await tools.call("target",{get secret(){while(true){}}})', opts), error("EXECUTION_LIMIT"));
  assert.equal(calls, 0);
});

test("argument size, concurrency and total call attempts have sticky bounds", async () => {
  assert.deepEqual(await probe.run(`await tools.call("target",{text:"x".repeat(${RPC_LIMITS.argumentBytes})})`, options()), error("TOOL_LIMIT"));
  assert.deepEqual(await probe.run('await Promise.all(Array.from({length:5},()=>tools.call("target",{})))', options()), error("TOOL_LIMIT"));
  assert.deepEqual(await probe.run(`for(let i=0;i<${RPC_LIMITS.calls + 1};i++) await tools.call("target",{});`, options()), error("TOOL_LIMIT"));
  assert.deepEqual(await probe.run('for(let i=0;i<6;i++) await tools.call("target",{text:"x".repeat(50000)});', options()), error("TOOL_LIMIT"));
});

test("oversized, malformed and failing gateway results withhold all prior output", async () => {
  for (const value of [null, { result: {}, isError: false }, { result: {content: []}, isError: "false" }]) {
    assert.deepEqual(await probe.run('emit("withheld"); await tools.call("target",{})', options(async () => value)), error("GATEWAY_FAILED"));
  }
  assert.deepEqual(await probe.run('emit("withheld"); await tools.call("target",{})', options(async () => result("x".repeat(RPC_LIMITS.resultBytes)))), error("TOOL_RESULT_LIMIT"));
  assert.deepEqual(await probe.run('for(let i=0;i<6;i++) await tools.call("target",{})', options(async () => result("x".repeat(50000)))), error("TOOL_RESULT_LIMIT"));
  assert.deepEqual(await probe.run('try { await tools.call("target",{}) } catch {} emit("late")', options(async () => { throw Error("private-token-fixture"); })), error("GATEWAY_FAILED"));
});

test("ordinary tool error is data, not a raw host exception", async () => {
  assert.deepEqual(await probe.run('emit(String((await tools.call("target",{})).isError))', options(async () => ({ ...result("denied"), isError: true }))), ok(["true"]));
});

test("abandoned async calls fail closed and cancelled callbacks are drained", async () => {
  let active = 0;
  const out = await probe.run('tools.call("target",{}); emit("withheld");', options(async (_n, _a, { signal }) => {
    active++;
    if (!signal.aborted) await once(signal, "abort");
    await delay(30);
    active--;
    return result("late");
  }));
  assert.deepEqual(out, error("DETACHED_TOOL"));
  assert.equal(active, 0);
});

test("gateway revocation cancels a started invocation and waits for cooperative cleanup", async () => {
  const owner = new AbortController();
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  let cleaned = false;
  const opts = options(async (_n, _a, { signal }) => {
    started();
    await once(signal, "abort");
    await delay(40);
    cleaned = true;
    return result("private late value");
  });
  opts.gateway.signal = owner.signal;
  const running = probe.run('emit("withheld"); await tools.call("target",{}); emit("late")', opts);
  await ready;
  owner.abort();
  assert.deepEqual(await running, error("CANCELLED"));
  assert.equal(cleaned, true);
  assert.equal(probe.activeCount, 0);
});

test("runtime close does not pretend an uncooperative tool has stopped", async () => {
  const p = new AsyncRuntimeProbe();
  let started, release;
  const ready = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  const running = p.run('await tools.call("target",{})', options(async () => { started(); await pending; return result("late"); }));
  await ready;
  let drained = false;
  const closing = p.close().then(() => { drained = true; });
  await delay(50);
  assert.equal(drained, false);
  assert.equal(p.activeCount, 1);
  release();
  assert.deepEqual(await running, error("CANCELLED"));
  await closing;
  assert.equal(p.activeCount, 0);
});

test("duplex frame decoder handles arbitrary chunking and rejects invalid bytes/bounds", () => {
  const data = encodeFrame({ text: "🌿\0\n" });
  const decoder = new FrameDecoder();
  const frames = [];
  for (const byte of data) frames.push(...decoder.push(Buffer.from([byte])));
  assert.deepEqual(frames, [{ text: "🌿\0\n" }]);
  decoder.end();
  assert.throws(() => new FrameDecoder().push(Buffer.alloc(RPC_LIMITS.frameBytes, 65)));
  assert.throws(() => new FrameDecoder().push(Buffer.from([34, 0xff, 34, 10])));
  assert.throws(() => new FrameDecoder().push(Buffer.from("{}\n".repeat(RPC_LIMITS.frames + 1))));
  const partial = new FrameDecoder(); partial.push(Buffer.from("{}")); assert.throws(() => partial.end());
  assert.throws(() => encodeFrame({ text: "x".repeat(RPC_LIMITS.frameBytes) }));
});

test("parent independently rejects hostile RPC frames before invoking a tool", async () => {
  for (const frame of [
    { type: "call", id: 1, name: "exec", args: {} },
    { type: "call", id: 1, name: "wait", args: {} },
    { type: "call", id: 1, name: "other", args: {} },
    { type: "call", id: 2, name: "target", args: {} },
    { type: "call", id: 1, name: "target", args: {}, parentToolCallId: "forged" },
    { type: "call", id: 1, name: "target", args: [] },
  ]) {
    let calls = 0;
    const p = new AsyncRuntimeProbe({ launch: fixture(`process.stdin.resume(); process.stdout.write(${JSON.stringify(JSON.stringify(frame) + "\n")});`) });
    const out = await p.run("", options(async () => { calls++; return result("bad"); }));
    assert.equal(out.status, "error"); assert.equal(calls, 0);
    await p.close();
  }
});

test("duplicate completion, malformed and partial response are never successful", async () => {
  const done = JSON.stringify({ type: "done", result: ok(["withheld"]) }) + "\n";
  for (const output of [done + done, done + "{", "{}\n", "not json\n"]) {
    const p = new AsyncRuntimeProbe({ launch: fixture(`process.stdout.end(${JSON.stringify(output)});`) });
    assert.deepEqual(await p.run("", options()), error("PROTOCOL_ERROR"));
    await p.close();
  }
});

test("independent wall watchdog cancels hanging async tools and drains the worker", async () => {
  let aborted = false;
  assert.deepEqual(await probe.run('await tools.call("target",{})', options(async (_n, _a, { signal }) => {
    if (!signal.aborted) await once(signal, "abort");
    aborted = true;
    return result("withheld");
  })), error("WALL_LIMIT"));
  assert.equal(aborted, true);
});

test("result transfer rejects accessors, toJSON, cycles and deep data without executing host serializers", async () => {
  let accessed = 0;
  const cyclic = {}; cyclic.self = cyclic;
  let deep = {}; for (let i = 0; i < 40; i++) deep = { next: deep };
  for (const details of [
    { get secret() { accessed++; return "private fixture"; } },
    { toJSON() { accessed++; return "flattened evidence"; } },
    { nonfinite: Infinity },
  ]) {
    assert.deepEqual(await probe.run('await tools.call("target",{})', options(async () => result("withheld", details))), error("GATEWAY_FAILED"));
  }
  for (const details of [cyclic, deep, Array.from({length:RPC_LIMITS.nodes + 1}, () => null)]) {
    assert.deepEqual(await probe.run('await tools.call("target",{})', options(async () => result("withheld", details))), error("TOOL_RESULT_LIMIT"));
  }
  assert.equal(accessed, 0);
});

test("argument depth and node counts are bounded before reaching the gateway", async () => {
  let calls = 0;
  const opts = options(async () => { calls++; return result("bad"); });
  assert.deepEqual(await probe.run('let args={}; for(let i=0;i<40;i++) args={next:args}; await tools.call("target",args)', opts), error("TOOL_LIMIT"));
  assert.deepEqual(await probe.run(`await tools.call("target",{values:Array(${RPC_LIMITS.nodes + 1}).fill(0)})`, opts), error("TOOL_LIMIT"));
  assert.equal(calls, 0);
});

test("async helper does not weaken import, heap, output, microtask or source isolation", async () => {
  for (const [code, expected] of [
    ['await tools.call("target",{}); try {await import("node:fs")} catch {}', "IMPORT_DENIED"],
    ['await tools.call("target",{}); new ArrayBuffer(33554432)', "EXECUTION_FAILED"],
    ['await tools.call("target",{}); emit("x".repeat(65537))', "OUTPUT_LIMIT"],
    ['await tools.call("target",{}); const f=()=>Promise.resolve().then(f); f()', "EXECUTION_LIMIT"],
    ['}); emit("escaped"); (()=>{', "EXECUTION_FAILED"],
  ]) assert.deepEqual(await probe.run(code, options()), error(expected));
  assert.deepEqual(await probe.run('globalThis.privateFixture=1; await tools.call("target",{});', options()), ok([]));
  assert.deepEqual(await probe.run('emit(typeof privateFixture); emit(typeof process); emit(typeof fetch);', options()), ok(["undefined", "undefined", "undefined"]));
});

test("async runtime admission and close bound every worker including startup", async () => {
  const children = [];
  const p = new AsyncRuntimeProbe({ launch: fixture('process.stdin.resume(); setInterval(()=>{},1000);', children) });
  const runs = Array.from({length:4}, () => p.run("", options()));
  assert.deepEqual(await p.run("", options()), error("BUSY"));
  await p.close();
  for (const out of await Promise.all(runs)) assert.deepEqual(out, error("CANCELLED"));
  for (const child of children) assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(p.activeCount, 0);
});

test("a crashed or missing RPC host cannot trigger a gateway fallback or expose stderr", async () => {
  let calls = 0;
  for (const launch of [
    () => { throw Error("private path fixture"); },
    fixture('process.stderr.write("private fixture"); process.exitCode=7;'),
  ]) {
    const p = new AsyncRuntimeProbe({ launch });
    assert.deepEqual(await p.run("", options(async () => { calls++; return result("bad"); })), error("HOST_FAILED"));
    await p.close();
  }
  assert.equal(calls, 0);
});
