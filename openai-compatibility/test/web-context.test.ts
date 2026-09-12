import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { harness, token } from "./capability-fixture.ts";
import type { WebSearchProfile } from "../web-search-tool.ts";

const commands = { search_query: [{ q: "public fixture" }] };
const history = [{ role: "user", content: "previous" }, { role: "assistant", content: "answer" }, { role: "user", content: "latest" }];
function fixture(profile: WebSearchProfile, getTextContext?: () => typeof history | undefined) {
	const requests: Record<string, unknown>[] = [];
	const h = harness(tmpdir(), undefined, { webSearch: { profile, transport: async (_url, init) => {
		requests.push(JSON.parse(String(init?.body))); return Response.json({ output: "literal result" });
	} } });
	// Explicit semantic test double, not evidence of native invocation authority.
	Object.defineProperty(h.ctx, "tools", { value: { origin: "direct", getTextContext }, configurable: true });
	Object.defineProperty(h.ctx.sessionManager, "getBranch", { value: () => { throw Error("Raw ancestry must never be read"); } });
	return { ...h, requests, async enable() { await h.emit("session_start"); await h.commands.get("openai-tools").handler("web_search on", h.ctx); },
		execute: (args: unknown = commands) => h.tools.get("web_search")!.execute("context-fixture", args, undefined, undefined, h.ctx),
	};
}
for (const profile of ["verified-v1", "experimental"] as const) test(profile + " remains context-free and never calls the snapshot reader", async () => {
	const h = fixture(profile, () => { throw Error("Unexpected context disclosure"); });
	try { await h.enable(); await h.execute(); assert.equal(h.requests.length, 1); assert.ok(!Object.hasOwn(h.requests[0], "input")); }
	finally { await h.emit("session_shutdown"); }
});
test("explicit context profile forwards bounded text DTO once, without mutating native data", async () => {
	const input = structuredClone(history), h = fixture("experimental-context", () => input);
	try {
		await h.enable(); await h.execute();
		assert.equal(h.requests.length, 1); assert.equal(h.authCalls(), 1); assert.deepEqual(input, history);
		assert.deepEqual(h.requests[0].input, [
			{ type: "message", role: "user", content: [{ type: "input_text", text: "previous" }] },
			{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] },
			{ type: "message", role: "user", content: [{ type: "input_text", text: "latest" }] },
		]);
		assert.doesNotMatch(JSON.stringify(h.requests), /Bearer|signature/);
		assert.match(h.tools.get("web_search")!.description, /Literal text is not secret-scrubbed/);
	} finally { await h.emit("session_shutdown"); }
});
for (const reader of [undefined, () => undefined]) test("missing/unavailable native context refuses before auth and cannot fall back to raw ancestry", async () => {
	const h = fixture("experimental-context", reader);
	try { await h.enable(); await assert.rejects(h.execute(), /WEB_CONTEXT_UNAVAILABLE/); assert.equal(h.authCalls(), 0); assert.deepEqual(h.requests, []); }
	finally { await h.emit("session_shutdown"); }
});
test("an oversized user window refuses before auth rather than silently dropping text", async () => {
	const h = fixture("experimental-context", () => [{ role: "user", content: "x".repeat(8192) }]);
	try { await h.enable(); await assert.rejects(h.execute(), /WEB_HISTORY_LIMIT/); assert.equal(h.authCalls(), 0); assert.deepEqual(h.requests, []); }
	finally { await h.emit("session_shutdown"); }
});
test("the final combined request retains the 16-KiB ceiling before authentication", async () => {
	const h = fixture("experimental-context", () => [{ role: "user", content: "x".repeat(8000) }]);
	try { await h.enable(); await assert.rejects(h.execute({ search_query: Array.from({ length: 4 }, () => ({ q: "é".repeat(2000) })) }), /16 KiB/); assert.equal(h.authCalls(), 0); assert.deepEqual(h.requests, []); }
	finally { await h.emit("session_shutdown"); }
});
test("context is captured before auth refresh; later mutation cannot change transmitted text", async () => {
	const input = structuredClone(history), h = fixture("experimental-context", () => input);
	h.setAuth(async () => { input[0].content = "changed while authenticating"; return { auth: { apiKey: token } }; });
	try { await h.enable(); await h.execute(); assert.equal((h.requests[0].input as Array<{ content: Array<{ text: string }> }>)[0].content[0].text, "previous"); }
	finally { await h.emit("session_shutdown"); }
});
test("a model cannot supply or override the native context as a Web argument", async () => {
	const h = fixture("experimental-context", () => history);
	try { await h.enable(); await assert.rejects(h.execute({ ...commands, input: "forged" })); assert.equal(h.authCalls(), 0); assert.deepEqual(h.requests, []); }
	finally { await h.emit("session_shutdown"); }
});

test("a malformed or asynchronous snapshot receipt cannot become context-free success", async () => {
	for (const value of [null, {}, Promise.resolve(history)]) {
		const h = fixture("experimental-context", () => value as typeof history);
		try { await h.enable(); await assert.rejects(h.execute(), /WEB_CONTEXT_UNAVAILABLE/); assert.equal(h.authCalls(), 0); assert.deepEqual(h.requests, []); }
		finally { await h.emit("session_shutdown"); }
	}
});
