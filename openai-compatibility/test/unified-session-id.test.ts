import assert from "node:assert/strict";
import test from "node:test";
import { allocateSessionId, createSessionIdAllocator, isSessionId, MAX_SESSION_ID, parseSessionId } from "../unified-session-id.ts";
import { UnifiedExecManager, createUnifiedExecTools } from "../unified-exec.ts";
import { Value } from "typebox/value";
import { withFixtureCleanup } from "./fixture-cleanup.ts";

test("positive i32 lookup IDs are neither PIDs nor coerced strings", () => {
	for (const value of [1, 1701, MAX_SESSION_ID]) assert.equal(isSessionId(value), true);
	let coerced = 0; const hostile = { [Symbol.toPrimitive]() { coerced++; return 1701; } };
	for (const value of [0, -0, -1, 1.5, MAX_SESSION_ID + 1, NaN, Infinity, "1701", null, undefined, [], hostile, 1n]) {
		assert.equal(isSessionId(value), false);
		assert.throws(() => createSessionIdAllocator(value as number));
	}
	assert.equal(coerced, 0);
});
test("allocator burns IDs monotonically and refuses exhaustion without wrap/reuse", () => {
	const allocate = createSessionIdAllocator(MAX_SESSION_ID - 1);
	assert.equal(allocate(), MAX_SESSION_ID - 1); assert.equal(allocate(), MAX_SESSION_ID);
	for (let n = 0; n < 3; n++) assert.throws(allocate, /space exhausted/);
});
test("CLI canonical decimal grammar is distinct from integer JSON input", () => {
	assert.equal(parseSessionId("1701"), 1701); assert.equal(parseSessionId(String(MAX_SESSION_ID)), MAX_SESSION_ID);
	let calls = 0;
	for (const value of ["0", "-1", "+1", "01", "1.0", "1e3", " 1", "1\n", "2147483648", "old-uuid", { toString() { calls++; return "1"; } }]) assert.throws(() => parseSessionId(value as string));
	assert.equal(calls, 0);
});
test("module re-evaluation shares sequence only, not job state or authority", async () => {
	const first = allocateSessionId();
	const reload = await import(new URL("../unified-session-id.ts?synthetic-reload", import.meta.url).href);
	const second = reload.allocateSessionId(); assert.ok(isSessionId(second)); assert.ok(second > first);
	assert.ok(allocateSessionId() > second);
});
test("live schema admits numeric IDs and refuses UUIDs, fractions and overflow", () => {
	const tools = createUnifiedExecTools({} as UnifiedExecManager, () => { throw Error("No lease should be acquired"); });
	for (const session_id of [1, MAX_SESSION_ID]) assert.equal(Value.Check(tools[1].parameters, { session_id }), true);
	for (const session_id of ["1", "legacy-uuid", 0, -1, 0.5, MAX_SESSION_ID + 1]) assert.equal(Value.Check(tools[1].parameters, { session_id }), false);
});
test("manager reset/replacement cannot reuse a numeric ID or accept stale/coerced/foreign IDs", async () => {
	const create = () => new UnifiedExecManager(() => ({ executable: process.execPath, args: ["-e", "setTimeout(()=>{},30000)"] }));
	const a = create(), b = create();
	await withFixtureCleanup(async () => {
		const first = await a.start("owner", "synthetic", process.cwd(), 0, 64); assert.ok(isSessionId(first.session_id));
		const id = first.session_id;
		let coercions = 0;
		for (const invalid of [String(id), { valueOf() { coercions++; return id; } }, id + 0.5]) await assert.rejects(a.write("owner", invalid as number, "MUST_NOT_WRITE", 0, 64), /foreign Unified exec session/);
		assert.equal(coercions, 0);
		await assert.rejects(a.write("foreign", id, "MUST_NOT_WRITE", 0, 64), /foreign Unified exec session/);
		await assert.rejects(b.write("owner", id, "MUST_NOT_WRITE", 0, 64), /foreign Unified exec session/);
		await a.reset();
		const second = await a.start("owner", "synthetic", process.cwd(), 0, 64); assert.ok(isSessionId(second.session_id)); assert.ok(second.session_id > id);
		await assert.rejects(a.write("owner", id, "MUST_NOT_WRITE", 0, 64), /foreign Unified exec session/);
		await assert.rejects(a.cancel("owner", String(second.session_id)), /foreign Unified exec session/);
		await a.cancel("owner", second.session_id); assert.deepEqual(a.inspect("owner"), []);
	}, async () => { const closed = await Promise.allSettled([a.close(), b.close()]); const errors = closed.filter(r => r.status === "rejected"); if (errors.length) throw new AggregateError(errors.map(r => (r as PromiseRejectedResult).reason), "Owned fixture cleanup failed"); });
});
