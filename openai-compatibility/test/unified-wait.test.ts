// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initialWaitMs, stdinWaitMs } from "../unified-wait.ts";
import { createUnifiedExecTools, UnifiedExecManager } from "../unified-exec.ts";
import { Utf8OutputBuffer } from "../utf8-output.ts";

test("requested waits implement platform/input-specific floors and ceilings, not lifetime changes", () => {
 for (const value of [0, 249, 250, 4999, 5000, 9999, 10000, 30000, 30001, 300000, 300001, Number.MAX_SAFE_INTEGER]) {
  assert.equal(initialWaitMs(value, "win32"), Math.min(30000, Math.max(10000, value)));
  assert.equal(initialWaitMs(value, "linux"), Math.min(30000, Math.max(250, value)));
  assert.equal(stdinWaitMs(value, ""), Math.min(300000, Math.max(5000, value)));
  for (const chars of ["x", " ", "\n", "\u0003", "\u0004"]) assert.equal(stdinWaitMs(value, chars), Math.min(30000, Math.max(250, value)));
 }
 assert.equal(initialWaitMs(undefined, "win32"), 10000); assert.equal(initialWaitMs(undefined, "linux"), 10000);
 assert.equal(stdinWaitMs(undefined, ""), 5000); assert.equal(stdinWaitMs(undefined, "x"), 250);
});

test("invalid requested waits refuse before manager work or native scope admission, without coercion", async () => {
 let work = 0, opened = 0, released = 0;
 const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "wait-fixture" }, tools: { origin: "direct", contextSignal: new AbortController().signal, openScope() { opened++; throw Error("must not open"); } } } as unknown as ExtensionContext;
 const pair = createUnifiedExecTools({ start() { work++; }, write() { work++; } } as unknown as UnifiedExecManager,
  () => ({ signal: new AbortController().signal, assertCurrent() {}, release() { released++; } }));
 const hostile = { [Symbol.toPrimitive]() { throw Error("coercion attempted"); } };
 for (const value of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, null, "1000", hostile]) {
  assert.throws(() => initialWaitMs(value as number), /non-negative safe integer/);
  assert.throws(() => stdinWaitMs(value as number, ""), /non-negative safe integer/);
  assert.equal(Value.Check(pair[0].parameters, { cmd: "not executed", yield_time_ms: value }), false);
  assert.equal(Value.Check(pair[1].parameters, { session_id: "not owned", yield_time_ms: value }), false);
  await assert.rejects(pair[0].execute("start", { cmd: "not executed", yield_time_ms: value as number }, undefined, undefined, ctx), /non-negative safe integer/);
  await assert.rejects(pair[1].execute("write", { session_id: "not owned", yield_time_ms: value as number }, undefined, undefined, ctx), /non-negative safe integer/);
 }
 assert.equal(work, 0); assert.equal(opened, 0); assert.equal(released, 16);
 for (const tool of pair) assert.equal(Value.Check(tool.parameters, { ...(tool.name === "exec_command" ? {cmd: "not executed"} : {session_id: "not owned"}), yield_time_ms: Number.MAX_SAFE_INTEGER }), true);
});

// Controlled manager records are not native branding or OS-termination evidence.
function fixture() {
 const jobs = new UnifiedExecManager();
 clearInterval(Reflect.get(jobs, "sweep"));
 const context = new AbortController(), scope = new AbortController(), caller = new AbortController(), resource = new AbortController();
 const access = { context: context.signal, scope: { id: "owned-wait", signal: scope.signal, ownResource() { return () => {}; } } };
 const output = new Utf8OutputBuffer(); output.append("stdout", Buffer.from("retained until collected"));
 let finish!: () => void;
 const record = { id: "owned-wait", owner: "owner", access, revocation: resource, output, exitCode: null, closed: false, ready: true, supervised: false, created: 0, touched: 0, done: new Promise<void>(resolve => { finish = resolve; }), child: { stdin: { writableLength: 0, write() {} } } };
 const records = Reflect.get(jobs, "processes") as Map<string, typeof record>; records.set(record.id, record);
 return { jobs, record, context, scope, caller, resource, access, finish, records };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test("manager empty collection actually outlives 30 seconds and finishes at its 300-second ceiling", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
 try {
  let completed = false;
  const pending = f.jobs.write("owner", f.record.id, "", Number.MAX_SAFE_INTEGER, 100, undefined, f.access).then(r => { completed = true; return r; });
  t.mock.timers.tick(30000); await flush(); assert.equal(completed, false);
  t.mock.timers.tick(269999); await flush(); assert.equal(completed, false);
  t.mock.timers.tick(1); const result = await pending;
  assert.equal(result.running, true); assert.equal(result.session_id, f.record.id); assert.equal(result.output, "retained until collected");
 } finally { f.records.clear(); await f.jobs.close(); }
});

test("nonempty manager collection keeps the 30-second ceiling", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
 try {
  let completed = false;
  const pending = f.jobs.write("owner", f.record.id, "x", 300000, 100, undefined, f.access).then(r => { completed = true; return r; });
  t.mock.timers.tick(29999); await flush(); assert.equal(completed, false);
  t.mock.timers.tick(1); assert.equal((await pending).running, true);
 } finally { f.records.clear(); await f.jobs.close(); }
});

for (const source of ["caller", "context", "scope", "resource"] as const) test(`long collection wakes on ${source} cancellation without claiming native closure`, async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
 let release!: () => void, attempts = 0;
 const stopping = new Promise<void>(resolve => { release = resolve; });
 t.mock.method(f.jobs as unknown as {stop: () => Promise<void>}, "stop", () => { attempts++; return stopping; });
 try {
  let rejected = false;
  const pending = f.jobs.write("owner", f.record.id, "", 300000, 100, f.caller.signal, f.access).catch(error => { rejected = true; throw error; });
  const checked = assert.rejects(pending, /synthetic cancellation/);
  f[source].abort(Error("synthetic cancellation")); await flush();
  assert.equal(rejected, false, "the existing stop attempt must settle first");
  release(); await flush(); assert.equal(rejected, true, "no advancement of the return timer is needed"); await checked;
  assert.equal(f.record.closed, false); assert.equal(f.records.size, 1); assert.equal(f.record.output.peek(100).output, "retained until collected");
  // stop() itself owns once-only kill caching; this fixture checks collector notification only.
  assert.equal(attempts, 2);
 } finally { release(); f.records.clear(); await f.jobs.close(); }
});

test("confirmed fixture closure ends a long collection early and consumes the terminal ID", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
 try {
  const pending = f.jobs.write("owner", f.record.id, "", 300000, 100, undefined, f.access);
  f.record.closed = true; f.finish(); const value = await pending;
  assert.equal(value.running, false); assert.equal(value.session_id, undefined); assert.equal(f.records.size, 0);
 } finally { f.records.clear(); await f.jobs.close(); }
});

test("manager reset wakes an unconfirmed background collection without dropping its record", async t => {
 t.mock.timers.enable({ apis: ["setTimeout"] }); const f = fixture();
 t.mock.method(f.jobs as unknown as {stop: () => Promise<void>}, "stop", async () => {});
 try {
  let awakened = false;
  const pending = assert.rejects(f.jobs.write("owner", f.record.id, "", 300000, 100, undefined, f.access), {name: "AbortError"}).then(() => { awakened = true; });
  await assert.rejects(f.jobs.reset(), /could not confirm/); await flush();
  assert.equal(awakened, true); await pending; assert.equal(f.records.size, 1); assert.equal(f.record.closed, false);
  assert.equal(f.record.output.peek(100).output, "retained until collected");
 } finally { f.records.clear(); await f.jobs.close(); }
});