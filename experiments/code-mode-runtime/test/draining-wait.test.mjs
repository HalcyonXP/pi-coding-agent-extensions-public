import assert from "node:assert/strict";
import test from "node:test";
import { getEventListeners } from "node:events";
import { CodeCells } from "../../../openai-compatibility/runtime/cells.mjs";

// Deterministic manager-state seam, not native branding or OS containment evidence.
const settle = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
function fixture(failed = false) {
  const owner = {}, context = new AbortController(), calls = new AbortController(), scopes = [];
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const invocation = { origin: "direct", contextSignal: context.signal, signal: calls.signal, adoptScope() {}, openScope() {
    const controller = new AbortController(); let state = "active", closing, closeCalls = 0;
    const scope = { id: `drain-${scopes.length}`, signal: controller.signal, get state() { return state; }, get closeCalls() { return closeCalls; }, ownResource() { return () => {}; }, close() {
      closeCalls++;
      if (closing) return closing;
      state = "draining"; controller.abort();
      closing = (async () => { if (failed) throw Error("unconfirmed fixture closure"); await barrier; state = "closed"; })();
      return closing;
    } };
    scopes.push(scope); return scope;
  } };
  const manager = new CodeCells({ owner, contextSignal: context.signal, runtimeFactory: options => ({
    async run() { await Promise.resolve(); options.output("discard on cancellation"); return { version: 1, status: "ok" }; }, async close() {},
  }) });
  return { manager, context, calls, scopes, release,
    exec: (fresh = false) => manager.exec({ owner, invocation: fresh ? { ...invocation, signal: new AbortController().signal } : invocation, code: "text(1)", tools: [], yield_time_ms: 0 }),
    wait: (id, ms = 30_000, fresh = false) => manager.wait({ owner, invocation: fresh ? { ...invocation, signal: new AbortController().signal } : invocation, cell_id: id, yield_time_ms: ms }),
  };
}

for (const failed of [false, true]) for (const cancellation of ["call abort", "context revoke", "manager close"]) {
  test(`${cancellation} wakes a collector with ${failed ? "rejected" : "pending"} native closure`, async t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const f = fixture(failed); let waiting, closing, returned = false;
    try {
      const initial = await f.exec(); await settle();
      assert.equal(f.scopes[0].state, "draining");
      waiting = f.wait(initial.cell_id).then(value => { returned = true; return value; });
      await settle(); assert.equal(returned, false);
      if (cancellation === "call abort") f.calls.abort();
      else if (cancellation === "context revoke") f.context.abort();
      else closing = f.manager.close();
      await settle();
      assert.equal(returned, true, "cancellation must wake the collector without advancing its 30-second timer");
      const result = await waiting;
      assert.deepEqual(result, { cell_id: initial.cell_id, status: "draining", output: [] });
      assert.equal(getEventListeners(f.calls.signal, "abort").length, 0, "collector abort listener must be removed");
      assert.equal(f.scopes[0].state, "draining");
      assert.equal(f.scopes[0].closeCalls, 1, "notification must not replay native closure");
      if (cancellation === "call abort") {
        await assert.rejects(f.exec(), /CELL_UNAVAILABLE/);
        // Fresh calls still find the draining cell; two retained cells exhaust admission.
        assert.equal((await f.wait(initial.cell_id, 0, true)).status, "draining");
        await f.exec(true); await settle();
        await assert.rejects(f.exec(true), /INVALID_REQUEST/);
        assert.equal(f.scopes.length, 2);
      }
      let closed = false;
      closing ??= f.manager.close(); closing.then(() => { closed = true; });
      await settle(); if (!failed) assert.equal(closed, false, "pending native closure still owns shutdown");
    } finally {
      // Always settle the owned fixture, even on the expected pre-fix failure.
      f.release(); t.mock.timers.tick(30_000); await settle();
      await waiting; await (closing ?? f.manager.close());
    }
  });
}

test("a noncancelled collector still waits for confirmed native closure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); let waiting, returned = false;
  try {
    const initial = await f.exec(); await settle();
    waiting = f.wait(initial.cell_id).then(value => { returned = true; return value; });
    await settle(); assert.equal(returned, false);
    assert.equal(f.scopes[0].state, "draining");
    f.release(); await settle(); assert.equal(returned, true);
    const result = await waiting;
    assert.equal(result.status, "completed"); assert.deepEqual(result.output, ["discard on cancellation"]);
    assert.deepEqual(result.result, { version: 1, status: "ok" });
    assert.equal(f.scopes[0].state, "closed"); assert.equal(f.scopes[0].closeCalls, 1);
    await assert.rejects(f.wait(initial.cell_id, 0), /CELL_UNAVAILABLE/);
  } finally { f.release(); await settle(); await waiting; await f.manager.close(); }
});

test("cancelled cell is collectible as terminated only after genuine fixture closure", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture(); let waiting, returned = false;
  try {
    const initial = await f.exec(); await settle();
    waiting = f.wait(initial.cell_id).then(value => { returned = true; return value; });
    f.calls.abort(); await settle(); assert.equal(returned, true);
    assert.equal((await waiting).status, "draining");
    assert.equal((await f.wait(initial.cell_id, 0, true)).status, "draining");
    f.release(); await settle(); assert.equal(f.scopes[0].state, "closed");
    assert.deepEqual(await f.wait(initial.cell_id, 0, true), { cell_id: initial.cell_id, status: "terminated", output: [] });
    assert.equal(f.scopes[0].closeCalls, 1);
    await assert.rejects(f.wait(initial.cell_id, 0, true), /CELL_UNAVAILABLE/);
  } finally { f.release(); t.mock.timers.tick(30_000); await settle(); await waiting; await f.manager.close(); }
});
