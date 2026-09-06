import assert from "node:assert/strict";
import test from "node:test";
import { buildImageRequest, callCodexImages } from "../imagegen/core.ts";
import { readBoundedJson } from "../http.ts";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const auth = { token: "synthetic-review-token", accountId: "synthetic-review-account" };
const base = { ...buildImageRequest("offline fixture", []), turnId: "review", getAuth: async () => auth };
async function settlesCancelled(promise: Promise<unknown>) {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			assert.rejects(promise, (error: Error) => { assert.match(error.message, /cancelled|timed out/); assert.doesNotMatch(error.message + JSON.stringify(error), /synthetic-review/); return true; }),
			new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Cancellation did not settle within 1s")), 1000); }),
		]);
	} finally { clearTimeout(timer); }
}

test("pre-aborted image request does not start auth or expose an abort reason", async () => {
	let calls = 0;
	await settlesCancelled(callCodexImages({ ...base, signal: AbortSignal.abort(new Error(auth.token)), getAuth: async () => { calls++; return auth; } }));
	assert.equal(calls, 0);
});

test("image cancellation settles before uncooperative authentication finishes", async () => {
	const entered = deferred<void>(), pending = deferred<typeof auth>(), controller = new AbortController(); let calls = 0;
	const run = callCodexImages({ ...base, signal: controller.signal, getAuth: () => { entered.resolve(); return pending.promise; }, fetchImpl: async () => { calls++; return Response.json({}); } });
	try { await entered.promise; controller.abort(new Error(auth.token)); await settlesCancelled(run); assert.equal(calls, 0); }
	finally { pending.resolve(auth); await run.catch(() => {}); }
	assert.equal(calls, 0, "late auth cannot initiate a request");
});

test("image deadline includes stalled authentication", async () => {
	const pending = deferred<typeof auth>();
	const run = callCodexImages({ ...base, timeoutMs: 25, getAuth: () => pending.promise });
	try { await settlesCancelled(run); }
	finally { pending.resolve(auth); await run.catch(() => {}); }
});

test("cancelled image transport disposes a late response without consuming its body", async () => {
	const entered = deferred<void>(), pending = deferred<Response>(), disposed = deferred<void>(), controller = new AbortController();
	const run = callCodexImages({ ...base, signal: controller.signal, fetchImpl: () => { entered.resolve(); return pending.promise; } });
	try { await entered.promise; controller.abort(new Error(auth.token)); await settlesCancelled(run); }
	finally {
		pending.resolve(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"data":[]}')); c.close(); }, cancel() { disposed.resolve(); } })));
		await run.catch(() => {});
	}
	let timer: NodeJS.Timeout | undefined;
	try { await Promise.race([disposed.promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Late response was not disposed")), 1000); })]); }
	finally { clearTimeout(timer); }
});

for (const status of [200, 401, 429, 503]) test(`image body cancellation is bounded for HTTP ${status}`, async () => {
	const entered = deferred<void>(), controller = new AbortController(); let body!: ReadableStreamDefaultController<Uint8Array>; let cancelled = false;
	const run = callCodexImages({ ...base, signal: controller.signal, fetchImpl: async () => new Response(new ReadableStream<Uint8Array>({
		start(c) { body = c; }, pull() { entered.resolve(); }, cancel() { cancelled = true; },
	}, { highWaterMark: 0 }), { status }) });
	try { await entered.promise; controller.abort(new Error(auth.accountId)); await settlesCancelled(run); assert.equal(cancelled, true); }
	finally { body.error(new Error("fixture cleanup")); await run.catch(() => {}); }
});

test("bounded reader never waits for an uncooperative cancel callback", async () => {
	const started = deferred<void>(), released = deferred<void>(), controller = new AbortController();
	let body!: ReadableStreamDefaultController;
	const response = new Response(new ReadableStream({ start(c) { body = c; }, pull() { started.resolve(); }, cancel() { return released.promise; } }));
	const read = readBoundedJson(response, 100, controller.signal);
	try { await started.promise; controller.abort(); await settlesCancelled(read); }
	finally { body.error(new Error("fixture cleanup")); released.resolve(); await response.body?.cancel().catch(() => {}); await read.catch(() => {}); }
});

test("image authorization is rechecked after response acquisition before parsing or delivery", async () => {
	let eligible = true, disposed = false;
	await assert.rejects(callCodexImages({ ...base, assertCurrent: () => { if (!eligible) throw new Error(auth.token); }, fetchImpl: async () => {
		eligible = false;
		return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"data":[]}')); c.close(); }, cancel() { disposed = true; } }));
	} }), (error: Error) => { assert.doesNotMatch(error.message + JSON.stringify(error), /synthetic-review/); return true; });
	assert.equal(disposed, true);
});

test("image cancellation interrupts retry backoff without another authentication attempt", async () => {
	const controller = new AbortController(); let calls = 0;
	const run = callCodexImages({ ...base, maxAttempts: 4, signal: controller.signal, fetchImpl: async () => {
		calls++; const response = Response.json({}, { status: 503 });
		setTimeout(() => controller.abort(new Error(auth.token)), 10); return response;
	} });
	await settlesCancelled(run); assert.equal(calls, 1);
});

test("image deadline also bounds uncooperative transport and success/error body waits", async () => {
	for (const phase of ["transport", 200, 503] as const) {
		const late = deferred<Response>(); let body: ReadableStreamDefaultController | undefined;
		const run = callCodexImages({ ...base, timeoutMs: 25, fetchImpl: () => phase === "transport" ? late.promise : Promise.resolve(new Response(new ReadableStream({ start(c) { body = c; } }, { highWaterMark: 0 }), { status: phase })) });
		try { await settlesCancelled(run); }
		finally { late.resolve(Response.json({})); body?.error(new Error("fixture cleanup")); await run.catch(() => {}); }
	}
});

test("invalid image deadlines fail before authentication", async () => {
	let called = false;
	for (const timeoutMs of [0, -1, 0.5, Infinity, NaN, 300001]) {
		await assert.rejects(callCodexImages({ ...base, timeoutMs, getAuth: async () => { called = true; return auth; } }), /Invalid image request deadline/);
	}
	assert.equal(called, false);
});
