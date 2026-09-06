import assert from "node:assert/strict";
import { after, test } from "node:test";
import { RuntimeProbe } from "../host.mjs";
import { LIMITS } from "../protocol.mjs";

const probe = new RuntimeProbe();
after(() => probe.close());
const ok = (output) => ({ version: 1, status: "ok", output });
const error = (code) => ({ version: 1, status: "error", code });

test("fresh engine executes filtering and explicit text output", async () => {
  assert.deepEqual(await probe.run('emit(JSON.stringify([1,2,3,4].filter(x=>x%2===0)))'), ok(["[2,4]"]));
});

test("await and bounded promise jobs work without host event-loop objects", async () => {
  assert.deepEqual(await probe.run('await Promise.resolve(); emit("resolved");'), ok(["resolved"]));
  assert.deepEqual(await probe.run('await new Promise(()=>{}); emit("late")'), error("PENDING_PROMISE"));
  assert.deepEqual(await probe.run('await Promise.reject(new Error("private-fixture"))'), error("EXECUTION_FAILED"));
});

test("Node, browser, filesystem, network, credential and tool globals are absent", async () => {
  const names = ["process", "require", "module", "Buffer", "global", "fetch", "XMLHttpRequest", "WebSocket",
    "WebAssembly", "Worker", "Deno", "Bun", "std", "os", "readFile", "setTimeout", "console", "tools", "store", "load"];
  assert.deepEqual(await probe.run(`emit(JSON.stringify(${JSON.stringify(names)}.map(k=>typeof globalThis[k])))`),
    ok([JSON.stringify(names.map(() => "undefined"))]));
});

test("constructor/eval paths stay in QuickJS rather than reaching Node", async () => {
  assert.deepEqual(await probe.run(`
    emit(Function("return typeof process")());
    emit(emit.constructor("return typeof require")());
    emit(({}).constructor.constructor("return typeof fetch")());
    emit(eval("typeof Buffer"));
  `), ok(["undefined", "undefined", "undefined", "undefined"]));
});

for (const specifier of ["node:fs", "node:child_process", "https://example.invalid/module.js", "file:///C:/private.js", "./host.mjs", "data:text/javascript,export default 1"]) {
  test(`module loader fails closed: ${specifier}`, async () => {
    assert.deepEqual(await probe.run(`try { await import(${JSON.stringify(specifier)}); } catch {} emit("caught")`), error("IMPORT_DENIED"));
  });
}

test("static imports cannot load even through syntax detection", async () => {
  assert.deepEqual(await probe.run('import fs from "node:fs"; emit("loaded")'), error("EXECUTION_FAILED"));
});

test("infinite loops and microtask floods are interrupted", async () => {
  assert.deepEqual(await probe.run('emit("withheld"); while(true) {}'), error("EXECUTION_LIMIT"));
  assert.deepEqual(await probe.run('const f=()=>Promise.resolve().then(f); f();'), error("EXECUTION_LIMIT"));
  assert.deepEqual(await probe.run('await Promise.resolve(); while(true) {}'), error("EXECUTION_LIMIT"));
});

test("allocation pressure and stack recursion fail without crashing the parent", async () => {
  assert.deepEqual(await probe.run(`new ArrayBuffer(${LIMITS.heapBytes * 2});`), error("EXECUTION_FAILED"));
  assert.deepEqual(await probe.run('(function recurse(){return recurse()})()'), error("EXECUTION_FAILED"));
  assert.deepEqual(await probe.run('emit("healthy")'), ok(["healthy"]));
});

test("guest can recover from a denied allocation without gaining a larger heap", async () => {
  assert.deepEqual(await probe.run(`try { new ArrayBuffer(${LIMITS.heapBytes * 2}); emit("unbounded"); } catch { emit("bounded"); }`), ok(["bounded"]));
});

test("UTF-8 output and count limits are sticky even when guest continues", async () => {
  assert.deepEqual(await probe.run(`emit("é".repeat(${LIMITS.outputBytes / 2 + 1})); emit("late");`), error("OUTPUT_LIMIT"));
  assert.deepEqual(await probe.run(`for(let i=0;i<${LIMITS.outputCount + 1};i++) emit("");`), error("OUTPUT_LIMIT"));
  assert.deepEqual(await probe.run(`try { emit("x".repeat(${LIMITS.outputBytes + 1})); } catch {} emit("recovered")`), error("OUTPUT_LIMIT"));
});

test("maximum escaped output survives bounded transport without truncation", async () => {
  const text = "\u0001".repeat(LIMITS.outputBytes);
  assert.deepEqual(await probe.run(`emit("\\u0001".repeat(${LIMITS.outputBytes}))`), ok([text]));
  assert.deepEqual(await probe.run('emit("🌿 café\\nquote: \\\" \\\\ end")'), ok(['🌿 café\nquote: " \\ end']));
});

test("NUL and lone surrogate text survive transfer and guest JSON mutation", async () => {
  assert.deepEqual(await probe.run('JSON.stringify=()=>"poison"; emit("before\\u0000after"); emit("\\ud800");'), ok(["before\0after", "\ud800"]));
});

test("object output never invokes guest getters or coercion", async () => {
  assert.deepEqual(await probe.run('emit({toString(){while(true){}}, get then(){while(true){}}})'), error("INVALID_OUTPUT"));
  assert.deepEqual(await probe.run('emit()'), error("INVALID_OUTPUT"));
  assert.deepEqual(await probe.run('emit("one", "two")'), error("INVALID_OUTPUT"));
});

test("guest error objects and output preceding failure are not serialized", async () => {
  assert.deepEqual(await probe.run('emit("private-fixture"); throw {get message(){while(true){}}, toString(){while(true){}}};'), error("EXECUTION_FAILED"));
});

test("fresh calls cannot observe prior globals or prototype mutations", async () => {
  assert.deepEqual(await probe.run('globalThis.privateFixture=42; Object.prototype.privateFixture=43; emit("first")'), ok(["first"]));
  assert.deepEqual(await probe.run('emit(typeof privateFixture); emit(typeof ({}).privateFixture)'), ok(["undefined", "undefined"]));
});

test("body delimiters cannot escape compilation and corrupt completion ownership", async () => {
  for (const code of ['}); emit("outside"); (() => {', '}); emit("outside"); (() => { return 42;']) {
    assert.deepEqual(await probe.run(code), error("EXECUTION_FAILED"));
  }
  assert.deepEqual(await probe.run('return 42;'), ok([]));
});

test("invalid or oversized source is rejected before launching", async () => {
  let launches = 0;
  const never = new RuntimeProbe({ launch() { launches++; throw Error("must not launch"); } });
  for (const code of [undefined, {}, "\0", "x".repeat(LIMITS.codeBytes + 1), "é".repeat(LIMITS.codeBytes)]) {
    assert.deepEqual(await never.run(code), error("INVALID_REQUEST"));
  }
  assert.equal(launches, 0);
  await never.close();
});
