import assert from "node:assert/strict";
import test from "node:test";
import { UnifiedExecManager, createUnifiedExecTools, type NativeJobBinding } from "../unified-exec.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { RPC_LIMITS, resultJSON } from "../runtime/rpc-protocol.mjs";
import { Utf8OutputBuffer } from "../utf8-output.ts";

const scope = () => ({ id: "synthetic-budget-scope", signal: new AbortController().signal, ownResource() { return () => {}; } });
const lease = () => ({ signal: new AbortController().signal, assertCurrent() {}, release() {} });
const serialBytes = (result: unknown) => Buffer.byteLength(JSON.stringify({ result, isError: false }));
for (const [name, unit, count, maxTokens] of [
 ["large ASCII", "x", 40000, 10000],
 ["default-sized escaped text", "\\\"\n\t", 4096, 4096],
 ["UTF-8", "🌊雪\\\"\n", 4000, 16384],
] as const) test(`nested ${name} is collected intact through bounded native wrappers`, async () => {
 const output = unit.repeat(count);
 const jobs = new UnifiedExecManager(code => ({ executable: process.execPath, args: ["-e", code] }));
 const owned = scope(), context = new AbortController();
 const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "synthetic-budget" }, tools: { origin: "nested", scope: owned, contextSignal: context.signal } } as unknown as ExtensionContext;
 const tools = createUnifiedExecTools(jobs, lease);
 try {
  let result = await tools[0].execute("initial", { cmd: `process.stdout.write(Buffer.from(${JSON.stringify(Buffer.from(unit).toString("base64"))},'base64').toString().repeat(${count}))`, yield_time_ms: 3000, max_output_tokens: maxTokens }, undefined, undefined, ctx);
  let combined = "", calls = 0, id: number | undefined;
  do {
   assert.ok(++calls <= 12); assert.ok(serialBytes(result) <= RPC_LIMITS.resultBytes, `Serialized result ${serialBytes(result)} exceeds ${RPC_LIMITS.resultBytes}`); resultJSON({ result, isError: false });
   const details = result.details;
   assert.equal(result.content[0].text, JSON.stringify(details)); assert.equal(result.isError, false);
   assert.equal(details.truncated_bytes, 0); assert.ok(!details.output.includes("�"));
   combined += details.output; id = details.session_id;
   if (id) result = await tools[1].execute("collect", { session_id: id, yield_time_ms: 3000, max_output_tokens: maxTokens }, undefined, undefined, ctx);
  } while (id);
  assert.equal(combined, output); assert.deepEqual(jobs.inspect("synthetic-budget:" + process.cwd()), []);
 } finally { await jobs.close(); }
});
test("direct collection retains its raw output ceiling, independent of nested serialization", async () => {
 const jobs = new UnifiedExecManager(code => ({ executable: process.execPath, args: ["-e", code] }));
 try { const result = await jobs.start("direct", "process.stdout.write('x'.repeat(65536))", process.cwd(), 3000, 65536); assert.equal(result.output.length, 65536); assert.equal(result.session_id, undefined); }
 finally { await jobs.close(); }
});

// Deliberate manager-state fixture, not a substitute for native scope authority.
async function retainedFixture(body: (jobs: UnifiedExecManager, id: number, state: { output: Utf8OutputBuffer; termination?: string }, access: NativeJobBinding) => Promise<void>) {
 const jobs = new UnifiedExecManager(code => ({ executable: process.execPath, args: ["-e", code] })), owned = scope();
 const access: NativeJobBinding = { scope: owned, resource: owned, context: new AbortController().signal };
 try {
  const first = await jobs.start("owner", "process.stdout.write('retained fixture')", process.cwd(), 0, 4, undefined, access); assert.ok(first.session_id);
  const state = (Reflect.get(jobs, "processes") as Map<number, { output: Utf8OutputBuffer; termination?: string; done: Promise<void>; settled?: Promise<void> }>).get(first.session_id)!;
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([state.done, new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Owned child did not close")), 3000); })]); } finally { clearTimeout(timer); }
  await state.settled;
  state.output = new Utf8OutputBuffer(16384); state.output.append("stdout", Buffer.from('"'.repeat(20000))); state.output.end("stdout");
  await body(jobs, first.session_id, state, access);
 } finally { await jobs.close(); }
}
test("failed preview preserves unread bytes and loss; successful slices report loss once", async () => {
 await retainedFixture(async (jobs, id, state, access) => {
  const before = state.output.peek(65536); assert.equal(before.truncatedBytes, 3616);
  state.termination = "m".repeat(65536);
  await assert.rejects(jobs.write("owner", id, "", 0, 65536, undefined, access), /TOOL_RESULT_LIMIT/);
  assert.deepEqual(state.output.peek(65536), before);
  state.termination = undefined;
  let output = "", calls = 0;
  do {
   const value = await jobs.write("owner", id, "", 0, 65536, undefined, access);
   resultJSON({ result: { content: [{ type: "text", text: JSON.stringify(value) }], details: value, isError: false }, isError: false });
   assert.equal(value.truncated_bytes, calls++ ? 0 : 3616); output += value.output;
   if (!value.session_id) break;
   assert.equal(value.session_id, id); assert.ok(calls < 5);
  } while (true);
  assert.equal(output, before.output); assert.deepEqual(jobs.inspect("owner"), []);
 });
});
test("a retained budget slice cannot be adopted by another context, scope or owner", async () => {
 await retainedFixture(async (jobs, id, state, access) => {
  const before = state.output.peek(65536);
  for (const other of [{ ...access, scope: scope() }, { ...access, context: new AbortController().signal }, {}]) await assert.rejects(jobs.write("owner", id, "", 0, 65536, undefined, other), /Unknown, expired, or foreign/);
  await assert.rejects(jobs.write("foreign", id, "", 0, 65536, undefined, access), /Unknown, expired, or foreign/);
  assert.deepEqual(state.output.peek(65536), before);
 });
});
test("budget fitting uses existing sanitized output, not the earlier synthetic NUL shape", async () => {
 await retainedFixture(async (jobs, id, state, access) => {
  state.output = new Utf8OutputBuffer(); state.output.append("stdout", Buffer.from("\0".repeat(20000) + "clean")); state.output.end("stdout");
  const value = await jobs.write("owner", id, "", 0, 65536, undefined, access);
  assert.equal(value.output, "clean"); assert.equal(value.session_id, undefined); assert.equal(value.truncated_bytes, 0);
 });
});
