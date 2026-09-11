import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createUnifiedExecTools, type UnifiedExecManager } from "../unified-exec.ts";

// Nonexecuting manager seams test defaults at the original handler boundary.
function fixture(nested = false) {
 const calls: unknown[][] = [], controller = new AbortController(); let released = 0;
 const manager = { async start(...args: unknown[]) { calls.push(args); return { output: "owned fixture", exit_code: 0, running: false, truncated_bytes: 0 }; }, async write(...args: unknown[]) { calls.push(args); return { output: "owned fixture", exit_code: 0, running: false, truncated_bytes: 0 }; } } as unknown as UnifiedExecManager;
 const tools = createUnifiedExecTools(manager, () => ({ signal: controller.signal, assertCurrent() {}, release() { released++; } }));
 const scope = { id: "synthetic-defaults", signal: controller.signal, ownResource() { return () => {}; } };
 const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "synthetic-defaults" }, ...(nested ? { tools: { origin: "nested", scope, contextSignal: controller.signal } } : {}) } as unknown as ExtensionContext;
 return { tools, ctx, calls, released: () => released };
}
for (const nested of [false, true]) {
 test(`omitted initial wait/output defaults reach ${nested ? "nested" : "direct"} handler`, async () => {
  const f = fixture(nested);
  const r = await f.tools[0].execute("start", { cmd: "not executed" }, undefined, undefined, f.ctx);
  assert.equal(f.calls[0][3], 10000); assert.equal(f.calls[0][4], 40000); assert.equal(f.released(), 1);
  if (nested) assert.equal(r.content[0].text, JSON.stringify(r.details));
  else assert.match(r.content[0].text, /Output:\nowned fixture$/);
 });
 for (const chars of [undefined, "", "x", " ", "\n", "\u0003", "\u0004"]) test(`omitted stdin defaults distinguish exact empty input (${nested}, ${JSON.stringify(chars)})`, async () => {
  const f = fixture(nested);
  await f.tools[1].execute("poll", { session_id: "owned-id", ...(chars === undefined ? {} : { chars }) }, undefined, undefined, f.ctx);
  assert.equal(f.calls[0][2], chars ?? ""); assert.equal(f.calls[0][3], !chars ? 5000 : 250); assert.equal(f.calls[0][4], 40000); assert.equal(f.released(), 1);
 });
 for (const [wait, tokens] of [[0, 1], [1, 4096], [30000, 16384], [300000, 10000], [Number.MAX_SAFE_INTEGER, 10000]]) test(`explicit waits clamp independently of output defaults (${nested}, ${wait})`, async () => {
  const f = fixture(nested);
  await f.tools[0].execute("start", { cmd: "not executed", yield_time_ms: wait, max_output_tokens: tokens }, undefined, undefined, f.ctx);
  await f.tools[1].execute("poll", { session_id: "owned-id", yield_time_ms: wait, max_output_tokens: tokens }, undefined, undefined, f.ctx);
  assert.equal(f.calls[0][3], Math.min(30000, Math.max(process.platform === "win32" ? 10000 : 250, wait)));
  assert.equal(f.calls[1][3], Math.min(300000, Math.max(5000, wait)));
  for (const call of f.calls) assert.equal(call[4], tokens * 4);
  assert.equal(f.released(), 2);
 });
}
