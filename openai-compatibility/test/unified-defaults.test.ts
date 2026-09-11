import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createUnifiedExecTools, type UnifiedExecManager } from "../unified-exec.ts";

// Nonexecuting manager seams test defaults at the original handler boundary.
function fixture(nested = false, getBackgroundWaitMs?: () => number) {
 const calls: unknown[][] = [], controller = new AbortController(); let released = 0;
 const manager = { async start(...args: unknown[]) { calls.push(args); return { output: "owned fixture", exit_code: 0, running: false, truncated_bytes: 0 }; }, async write(...args: unknown[]) { calls.push(args); return { output: "owned fixture", exit_code: 0, running: false, truncated_bytes: 0 }; } } as unknown as UnifiedExecManager;
 const tools = createUnifiedExecTools(manager, () => ({ signal: controller.signal, assertCurrent() {}, release() { released++; } }), getBackgroundWaitMs);
 const scope = { id: "synthetic-defaults", signal: controller.signal, ownResource() { return () => {}; } };
 const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "synthetic-defaults" }, ...(nested ? { tools: { origin: "nested", scope, contextSignal: controller.signal } } : {}) } as unknown as ExtensionContext;
 return { tools, ctx, calls, released: () => released };
}
for (const nested of [false, true]) {
 test(`configured background ceiling snapshots once per ${nested ? "nested" : "direct"} invocation and leaves other controls unchanged`, async () => {
  let ceiling = 60000, reads = 0; const f = fixture(nested, () => { reads++; return ceiling; });
  await f.tools[1].execute("poll", { session_id: 1701, yield_time_ms: 300000 }, undefined, undefined, f.ctx);
  assert.equal(f.calls.at(-1)![3], 60000); assert.equal(reads, 1);
  ceiling = 5000;
  await f.tools[1].execute("poll2", { session_id: 1701, yield_time_ms: 300000 }, undefined, undefined, f.ctx);
  assert.equal(f.calls.at(-1)![3], 5000); assert.equal(reads, 2);
  await f.tools[1].execute("input", { session_id: 1701, chars: "x", yield_time_ms: 300000 }, undefined, undefined, f.ctx);
  assert.equal(f.calls.at(-1)![3], 30000);
  await f.tools[0].execute("start", { cmd: "not executed" }, undefined, undefined, f.ctx);
  assert.equal(f.calls.at(-1)![3], 10000); assert.equal(reads, 4);
  for (const call of f.calls) assert.equal(call[4], 40000);
 });
 test(`invalid trusted policy refuses before any ${nested ? "nested" : "direct"} manager effects`, async () => {
  for (const value of [undefined, null, "5000", 4999, 300001, NaN, { [Symbol.toPrimitive]() { throw Error("coerced"); } }]) {
   const f = fixture(nested, () => value as number);
   await assert.rejects(f.tools[0].execute("start", { cmd: "not executed" }, undefined, undefined, f.ctx), /must be an integer/);
   for (const chars of ["", "x", "\u0003"]) await assert.rejects(f.tools[1].execute("poll", { session_id: 1701, chars }, undefined, undefined, f.ctx), /must be an integer/);
   assert.equal(f.calls.length, 0); assert.equal(f.released(), 4);
  }
 });
 test(`omitted initial wait/output defaults reach ${nested ? "nested" : "direct"} handler`, async () => {
  const f = fixture(nested);
  const r = await f.tools[0].execute("start", { cmd: "not executed" }, undefined, undefined, f.ctx);
  assert.equal(f.calls[0][3], 10000); assert.equal(f.calls[0][4], 40000); assert.equal(f.released(), 1);
  if (nested) assert.equal(r.content[0].text, JSON.stringify(r.details));
  else assert.match(r.content[0].text, /Output:\nowned fixture$/);
 });
 for (const chars of [undefined, "", "x", " ", "\n", "\u0003", "\u0004"]) test(`omitted stdin defaults distinguish exact empty input (${nested}, ${JSON.stringify(chars)})`, async () => {
  const f = fixture(nested);
  await f.tools[1].execute("poll", { session_id: 1701, ...(chars === undefined ? {} : { chars }) }, undefined, undefined, f.ctx);
  assert.equal(f.calls[0][2], chars ?? ""); assert.equal(f.calls[0][3], !chars ? 5000 : 250); assert.equal(f.calls[0][4], 40000); assert.equal(f.released(), 1);
 });
 for (const [wait, tokens] of [[0, 1], [1, 4096], [30000, 16384], [300000, 10000], [Number.MAX_SAFE_INTEGER, 10000]]) test(`explicit waits clamp independently of output defaults (${nested}, ${wait})`, async () => {
  const f = fixture(nested);
  await f.tools[0].execute("start", { cmd: "not executed", yield_time_ms: wait, max_output_tokens: tokens }, undefined, undefined, f.ctx);
  await f.tools[1].execute("poll", { session_id: 1701, yield_time_ms: wait, max_output_tokens: tokens }, undefined, undefined, f.ctx);
  assert.equal(f.calls[0][3], Math.min(30000, Math.max(process.platform === "win32" ? 10000 : 250, wait)));
  assert.equal(f.calls[1][3], Math.min(300000, Math.max(5000, wait)));
  for (const call of f.calls) assert.equal(call[4], tokens * 4);
  assert.equal(f.released(), 2);
 });
}
