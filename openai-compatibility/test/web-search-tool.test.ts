import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { harness, model, token } from "./capability-fixture.ts";
import { WEB_SEARCH_ENDPOINT, renderSearchEvidence } from "../web-search.ts";
const commands = { search_query: [{ q: "official documentation", domains: ["openai.com"] }] };
const evidence = { output: "Source citeturn0search0 https://openai.com/", results: [{ title: "Official source", url: "https://openai.com/", marker: "turn0search0", future: { preserved: true } }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(transport: typeof fetch = async () => Response.json(evidence)) { return harness(tmpdir(), undefined, { webSearch: { transport } }); }
async function enable(h: ReturnType<typeof harness>) { await h.emit("session_start"); await h.commands.get("openai-tools").handler("web_search on", h.ctx); }
async function execute(h: ReturnType<typeof harness>, id = "search", args: unknown = commands, signal?: AbortSignal) { return h.tools.get("web_search")!.execute(id, args, signal, undefined, h.ctx); }

test("a composition without search configuration cannot enable the tool",  async () => {
	const h = harness(tmpdir());
	try { await h.emit("session_start"); assert.equal(h.tools.has("web_search"), false); await h.commands.get("openai-tools").handler("web_search on", h.ctx); assert.ok(!h.active().includes("web_search")); assert.match(h.notices.at(-1)!, /unavailable.*configured/); assert.equal(h.authCalls(), 0); }
	finally { await h.emit("session_shutdown"); }
});
for (const provider of ["openai", "openai-codex"]) test(`actual Web search tool uses Codex OAuth for ${provider} and preserves complete evidence`, async () => {
	let calls = 0;
	const h = setup(async (url, init) => {
		calls++; assert.equal(url, WEB_SEARCH_ENDPOINT); assert.equal(init?.redirect, "error");
		assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${token}`);
		const request = JSON.parse(String(init?.body)); assert.deepEqual(request.commands, commands);
		assert.equal(request.model, model.id); assert.ok(!("input" in request));
		return Response.json({ ...evidence, encrypted_output: "never replay" });
	});
	if (provider === "openai") h.ctx.model = { ...h.ctx.model!, provider, api: "openai-responses", baseUrl: "https://api.openai.com/v1" };
	try {
		await h.emit("session_start"); assert.ok(!h.active().includes("web_search"));
		await assert.rejects(execute(h, "off"), /disabled/);
		await h.commands.get("openai-tools").handler("web_search on", h.ctx);
		const result = await execute(h); assert.equal(result.content.length, 2);
		assert.ok(JSON.stringify(result).includes(evidence.output)); assert.ok(JSON.stringify(result).includes("Official source"));
		assert.ok(!JSON.stringify(result).includes("never replay")); assert.ok(!JSON.stringify(result).includes(token));
		assert.deepEqual(result.details, renderSearchEvidence(evidence).details);
		assert.equal(await h.emit("tool_result", { toolName: "web_search", toolCallId: "search", ...result }), undefined);
		assert.equal(calls, 1); assert.equal(h.authCalls(), 1);
	} finally { await h.emit("session_shutdown"); }
});

test("shared visibility/execution controls reject unsupported providers and overrides before auth", async () => {
	for (const mode of ["provider", "route", "override"] as const) {
		const h = setup();
		try {
			await enable(h);
			if (mode === "provider") h.ctx.model = { ...h.ctx.model!, provider: "proxy" };
			else if (mode === "route") h.ctx.model = { ...h.ctx.model!, baseUrl: "https://proxy.invalid/" };
			else h.setConfig({ streamSimple() {} });
			await h.emit("model_select"); assert.ok(!h.active().includes("web_search"));
			assert.equal((await h.emit("tool_call", { toolName: "web_search" })).block, true);
			await assert.rejects(execute(h), /official OpenAI|override/); assert.equal(h.authCalls(), 0);
			assert.deepEqual(h.active(), ["read", "powershell"]);
		} finally { await h.emit("session_shutdown"); }
	}
});
test("API credentials do not qualify for Web search and no fallback auth is consulted", async () => {
	const h = setup(); h.setOAuth(false);
	try { await enable(h); await assert.rejects(execute(h), /OAuth|API fallback/); assert.equal(h.authCalls(), 0); }
	finally { await h.emit("session_shutdown"); }
});
test("schema mutations, unsupported fields, private URLs and opaque replay fail before authentication", async () => {
	const h = setup();
	try {
		await enable(h);
		for (const args of [{ ...commands, verified: true }, {}, { open: [{ ref_id: "turn0search0" }] }, { open: [{ ref_id: "file:///secret" }] }, { ...commands, input: "conversation" }, { search_query: [{ q: 5 }] }]) await assert.rejects(execute(h, "bad", args));
		assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("arguments are captured before auth refresh and partial evidence is never streamed", async () => {
	const entered = deferred<void>(), auth = deferred<unknown>(); let received: unknown;
	const h = setup(async (_url, init) => { received = JSON.parse(String(init?.body)).commands; return Response.json(evidence); });
	h.setAuth(() => { entered.resolve(); return auth.promise; });
	try {
		await enable(h); const input = structuredClone(commands); const updates: unknown[] = [];
		const run = h.tools.get("web_search")!.execute("capture", input, undefined, result => { updates.push(result); }, h.ctx);
		await entered.promise; input.search_query[0].q = "mutated"; auth.resolve({ auth: { apiKey: token } }); await run;
		assert.deepEqual(received, commands); assert.deepEqual(updates, []);
	} finally { auth.resolve({ auth: { apiKey: token } }); await h.emit("session_shutdown"); }
});
test("provider revocation settles despite stalled auth, including switch away/back", async () => {
	const entered = deferred<void>(), auth = deferred<unknown>(); let network = 0;
	const h = setup(async () => { network++; return Response.json(evidence); }); h.setAuth(() => { entered.resolve(); return auth.promise; });
	let timer: NodeJS.Timeout | undefined;
	try {
		await enable(h); const rejected = assert.rejects(execute(h), /cancelled|revoked/); await entered.promise;
		h.ctx.model = { ...h.ctx.model!, provider: "other" }; await h.emit("model_select"); h.ctx.model = { ...h.ctx.model!, ...model }; await h.emit("model_select");
		await Promise.race([rejected, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Auth cancellation stalled")), 1000); })]);
		assert.equal(network, 0);
	} finally { clearTimeout(timer); auth.resolve({ auth: { apiKey: token } }); await h.emit("session_shutdown"); }
});
test("finalized late and unknown pre-reload Web search results are quarantined", async () => {
	const h = setup();
	try {
		await enable(h); const result = await execute(h);
		await h.emit("model_select");
		for (const id of ["search", "pre-reload"]) {
			const final = await h.emit("tool_result", { toolName: "web_search", toolCallId: id, ...result });
			assert.equal(final.isError, true); assert.ok(!JSON.stringify(final).includes("turn0search0"));
		}
		await h.emit("session_start"); assert.ok(!h.active().includes("web_search"));
	} finally { await h.emit("session_shutdown"); }
});
test("search IDs are private per instance and rotated on session/model reset, never replayed", async () => {
	const ids: string[] = []; const transport: typeof fetch = async (_url, init) => { const body = JSON.parse(String(init?.body)); ids.push(body.id); assert.ok(!("input" in body)); return Response.json(evidence); };
	const a = setup(transport), b = setup(transport);
	try {
		await enable(a); await enable(b); await execute(a, "one"); await execute(a, "two"); await execute(b, "other");
		await a.emit("model_select"); await execute(a, "three");
		assert.equal(ids[0], ids[1]); assert.notEqual(ids[0], ids[2]); assert.notEqual(ids[0], ids[3]);
	} finally { await a.emit("session_shutdown"); await b.emit("session_shutdown"); }
});
test("busy session admission is bounded; disabling interrupts pending work", async () => {
	const entered = deferred<void>(), auth = deferred<unknown>(); const h = setup(); h.setAuth(() => { entered.resolve(); return auth.promise; });
	try {
		await enable(h); const rejected = assert.rejects(execute(h, "first"), /cancelled/); await entered.promise;
		await assert.rejects(execute(h, "second"), /already in progress/); assert.equal(h.authCalls(), 1);
		await h.commands.get("openai-tools").handler("web_search off", h.ctx); await rejected;
	} finally { auth.resolve({ auth: { apiKey: token } }); await h.emit("session_shutdown"); }
});
test("status distinguishes configuration/auth/provider/runtime without refresh or secret-bearing errors", async () => {
	const h = setup();
	try {
		await enable(h); const status = () => h.commands.get("openai-tools").handler("status", h.ctx);
		await status(); assert.match(h.notices.at(-1)!, /OAuth configured/); assert.match(h.notices.at(-1)!, /Code mode: unavailable/);
		h.setOAuth(false); await status(); assert.match(h.notices.at(-1)!, /missing Codex OAuth/);
		h.ctx.modelRegistry.getRegisteredProviderConfig = () => { throw new Error(token); };
		await status(); assert.match(h.notices.at(-1)!, /unsupported\/untrusted/);
		const denied = await h.emit("tool_call", { toolName: "web_search" });
		assert.equal(denied.block, true); assert.ok(!JSON.stringify(denied).includes(token));
		await assert.rejects(execute(h, "registry-error"), (error: Error) => { assert.ok(!error.message.includes(token)); return true; });
		assert.ok(!JSON.stringify(h.notices).includes(token)); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});

for (const tools of [{ origin: "nested" }, { origin: "nested", hasProtectedResults: () => false }, {}, { origin: "unknown" }]) test("experimental variants require protected native evidence before auth", async () => {
 const h = setup(); Object.assign(h.ctx, { tools });
 try { await enable(h); await assert.rejects(execute(h, "unprotected", { time: [{ utc_offset: "+00:00" }] }), /protected native Code mode scope/); assert.equal(h.authCalls(), 0); }
 finally { await h.emit("session_shutdown"); }
});
test("experimental protected nested path retains raw source evidence and source-only verification", async () => {
 const h = setup(); Object.assign(h.ctx, { tools: { origin: "nested", hasProtectedResults: () => true } });
 try {
  await enable(h); const result = await execute(h, "protected", { finance: [{ ticker: "A", type: "equity", market: "USA" }] });
  assert.deepEqual(result.details, renderSearchEvidence(evidence).details);
  assert.ok(JSON.stringify(result).includes(evidence.output)); assert.equal(h.authCalls(), 1);
 } finally { await h.emit("session_shutdown"); }
});
