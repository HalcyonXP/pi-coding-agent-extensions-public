import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { harness, model, token, png } from "./capability-fixture.ts";
import { CapabilityEpoch, isOfficialRoute } from "../capability-policy.ts";

import retired from "../../codex-imagegen/index.ts";


test("exact provider/API/route allowlist rejects proxies, userinfo, encoded paths, custom headers and GPT-like names", () => {
	assert.ok(isOfficialRoute(model));
	assert.ok(isOfficialRoute({ ...model, provider: "openai", api: "openai-responses", baseUrl: "https://api.openai.com/v1/" }));
	for (const changes of [
		{ provider: "proxy" }, { api: "openai-responses" }, { baseUrl: "https://chatgpt.com.evil.test/backend-api" },
		{ baseUrl: "https://me" + "@" + "chatgpt.com/backend-api" }, { baseUrl: "https://chatgpt.com/backend-api?x=1" },
		{ baseUrl: "https://chatgpt.com/x/../backend-api" }, { baseUrl: "https://chatgpt.com/%62ackend-api" },
		{ baseUrl: "http://chatgpt.com/backend-api" }, { headers: { "x-proxy": "true" } },
	]) assert.equal(isOfficialRoute({ ...model, ...changes }), false);
	assert.equal(isOfficialRoute(undefined), false);
});

test("operation leases stay revoked after returning to the previous model", () => {
	const epoch = new CapabilityEpoch();
	const lease = epoch.lease(() => {});
	epoch.revoke();
	assert.equal(lease.signal.aborted, true);
	assert.throws(lease.assertCurrent, /revoked/);
	assert.doesNotThrow(epoch.lease(() => {}).assertCurrent);
});

test("visibility, stale execution and retired loader enforce provider restriction without altering built-ins", async () => {
	const h = harness(tmpdir());
	retired(h.pi);
	await h.emit("session_start");
	assert.equal(h.tools.size, 3);
	assert.deepEqual(h.active(), ["read", "powershell", "imagegen"]);
	h.ctx.model = { ...h.ctx.model!, provider: "other" };
	await h.emit("model_select");
	assert.deepEqual(h.active(), ["read", "powershell"]);
	assert.equal((await h.emit("tool_call", { toolName: "imagegen" })).block, true);
	await assert.rejects(h.tools.get("imagegen")!.execute("blocked", { prompt: "x" }, undefined, undefined, h.ctx), /official OpenAI/);
	assert.equal(h.authCalls(), 0);
	const result = await h.emit("tool_result", { toolName: "imagegen", toolCallId: "blocked", content: [{ type: "image", data: png }], details: {} });
	assert.equal(result.isError, true);
	assert.equal(result.content[0].type, "text");
	h.ctx.model = { ...h.ctx.model!, ...model };
	await h.emit("model_select");
	assert.ok(h.active().includes("imagegen"));
	await h.commands.get("openai-tools").handler("imagegen off", h.ctx);
	await assert.rejects(h.tools.get("imagegen")!.execute("disabled", { prompt: "x" }, undefined, undefined, h.ctx), /disabled/);
});

test("registered transport overrides and non-OAuth credentials fail closed", async () => {
	for (const setting of ["config", "native", "oauth"] as const) {
		const h = harness(tmpdir());
		if (setting === "config") h.setConfig({ streamSimple() {} });
		if (setting === "native") h.setNative({ id: "openai-codex" });
		if (setting === "oauth") h.setOAuth(false);
		await h.emit("session_start");
		await assert.rejects(h.tools.get("imagegen")!.execute("untrusted", { prompt: "x" }, undefined, undefined, h.ctx), /override|OAuth/);
		assert.equal(h.authCalls(), 0);
	}
});

test("revalidates arguments after mutable tool_call hooks", async () => {
	const h = harness(tmpdir()); await h.emit("session_start");
	for (const args of [{ prompt: 4 }, { prompt: "x", destination_path: 5 }, { prompt: "x", unknown: true }]) {
		await assert.rejects(h.tools.get("imagegen")!.execute("invalid", args, undefined, undefined, h.ctx), /Invalid imagegen/);
	}
	assert.equal(h.authCalls(), 0);
});

test("revocation during auth prevents network calls, including switch away and back", async () => {
	const h = harness(tmpdir()); await h.emit("session_start");
	let resolveAuth!: (value: unknown) => void;
	const auth = new Promise((resolve) => { resolveAuth = resolve; });
	let entered!: () => void;
	const started = new Promise<void>((resolve) => { entered = resolve; });
	h.setAuth(() => { entered(); return auth; });
	const run = h.tools.get("imagegen")!.execute("race", { prompt: "x" }, undefined, undefined, h.ctx);
	const rejected = assert.rejects(run, /revoked|cancelled/);
	let timer: NodeJS.Timeout | undefined;
	try {
		await started;
		await h.emit("model_select");
		await Promise.race([rejected, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Provider revocation waited for authentication")), 1000); })]);
	} finally {
		clearTimeout(timer); resolveAuth({ auth: { apiKey: token } }); await rejected; await h.emit("session_shutdown");
	}
});

test("generation retains immutable image, workspace copy and direct result; late results withheld", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi image integration "));
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async (url, init) => {
		calls++;
		assert.equal(url, "https://chatgpt.com/backend-api/codex/images/generations");
		assert.equal(init?.redirect, "error");
		return new Response(JSON.stringify({ data: [{ b64_json: png }], size: "1x1" }), { status: 200 });
	};
	try {
		const h = harness(cwd); await h.emit("session_start");
		const result = await h.tools.get("imagegen")!.execute("success", { prompt: "x", destination_path: "images/new.png" }, undefined, undefined, h.ctx);
		assert.equal(result.content[0].type, "image");
		assert.equal((await readFile(path.join(cwd, "images/new.png"))).toString("base64"), png);
		assert.equal((await readFile(path.join(cwd, ".pi/Agent/Work/generated_images/test-session/success.png"))).toString("base64"), png);
		await h.emit("model_select"); // switch away/back is represented by the epoch even if current route matches again
		const finalized = await h.emit("tool_result", { toolName: "imagegen", toolCallId: "success", ...result });
		assert.equal(finalized.isError, true);
		assert.ok(!JSON.stringify(finalized).includes(png));
		assert.equal(calls, 1);
	} finally { globalThis.fetch = originalFetch; await rm(cwd, { recursive: true, force: true }); }
});


test("Unified exec is opt-in, rejects PTY, and loses sessions on provider changes", async () => {
	const h = harness(tmpdir()); await h.emit("session_start");
	assert.ok(!h.active().includes("exec_command"));
	await assert.rejects(h.tools.get("exec_command")!.execute("disabled", { cmd: "echo no" }, undefined, undefined, h.ctx), /disabled/);
	await h.commands.get("openai-tools").handler("unified_exec on", h.ctx);
	assert.ok(h.active().includes("exec_command")); assert.ok(h.active().includes("write_stdin"));
	await assert.rejects(h.tools.get("exec_command")!.execute("pty", { cmd: "echo no", tty: true }, undefined, undefined, h.ctx), /Invalid/);
	const command = process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
	const result = await h.tools.get("exec_command")!.execute("running", { cmd: command, yield_time_ms: 100 }, undefined, undefined, h.ctx);
	const session = (result.details as { session_id?: string }).session_id;
	assert.ok(session);
	await h.emit("model_select");
	await assert.rejects(h.tools.get("write_stdin")!.execute("stale", { session_id: session }, undefined, undefined, h.ctx), /expired/);
	assert.equal(h.authCalls(), 0, "local execution never needs a subscription credential");
	await h.emit("session_shutdown");
});

test("unknown/pre-reload results fail closed even on an official route", async () => {
	const h = harness(tmpdir()); await h.emit("session_start");
	const result = await h.emit("tool_result", { toolName: "imagegen", toolCallId: "pre-reload", content: [{ type: "image", data: png }], details: {} });
	assert.equal(result.isError, true);
	assert.ok(!JSON.stringify(result).includes(png));
	await h.commands.get("openai-tools").handler("unified_exec on", h.ctx);
	await h.emit("session_start");
	assert.ok(!h.active().includes("exec_command"), "new sessions reset opt-in preferences");
	await h.emit("session_shutdown");
});

test("provider revocation inside a queued destination write preserves the original but blocks the copy", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi queued image "));
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () => new Response(JSON.stringify({ data: [{ b64_json: png }] }));
	let enter!: () => void; let release!: () => void;
	const entered = new Promise<void>((resolve) => { enter = resolve; });
	const waiting = new Promise<void>((resolve) => { release = resolve; });
	const h = harness(cwd, async (file, operation) => {
		if (path.basename(file) === "late.png") { enter(); await waiting; }
		return operation();
	});
	try {
		await h.emit("session_start");
		const run = h.tools.get("imagegen")!.execute("queued", { prompt: "x", destination_path: "late.png" }, undefined, undefined, h.ctx);
		await entered;
		await h.emit("model_select");
		release();
		await assert.rejects(run, /revoked/);
		await assert.rejects(readFile(path.join(cwd, "late.png")), /ENOENT/);
		assert.equal((await readFile(path.join(cwd, ".pi/Agent/Work/generated_images/test-session/queued.png"))).toString("base64"), png);
	} finally { release(); globalThis.fetch = originalFetch; await h.emit("session_shutdown"); await rm(cwd, { recursive: true, force: true }); }
});

test("actual image tool withholds malformed metadata and never exposes remote diagnostic headers", async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi image response review "));
	const originalFetch = globalThis.fetch;
	const h = harness(cwd);
	try {
		await h.emit("session_start");
		for (const field of ["size", "quality", "background"]) {
			globalThis.fetch = async () => Response.json({ data: [{ b64_json: png }], [field]: token });
			const updates: unknown[] = [];
			await assert.rejects(h.tools.get("imagegen")!.execute(`bad-${field}`, { prompt: "fixture" }, undefined, (update) => { updates.push(update); }, h.ctx), (error: Error) => {
				assert.ok(!JSON.stringify(error).includes(token)); assert.ok(!error.message.includes(token)); return true;
			});
			assert.ok(!JSON.stringify(updates).includes(token));
			await assert.rejects(readFile(path.join(cwd, `.pi/Agent/Work/generated_images/test-session/bad-${field}.png`)), /ENOENT/);
		}
		globalThis.fetch = async () => Response.json({ data: [{ b64_json: png }], size: "1x1", quality: "high", background: "opaque" }, { headers: { "x-request-id": token, "x-codex-imagegen-request-id": "acct-test" } });
		const result = await h.tools.get("imagegen")!.execute("valid-metadata", { prompt: "fixture", destination_path: "safe.png" }, undefined, undefined, h.ctx);
		assert.equal(result.content[0].type, "image");
		assert.ok(JSON.stringify(result).includes("Size: 1x1."));
		assert.ok(!JSON.stringify(result).includes(token)); assert.ok(!JSON.stringify(result).includes("acct-test"));
		assert.equal((await readFile(path.join(cwd, "safe.png"))).toString("base64"), png);
		await assert.rejects(h.tools.get("imagegen")!.execute("nonoverwrite", { prompt: "fixture", destination_path: "safe.png" }, undefined, undefined, h.ctx), /already exists/);
	} finally { globalThis.fetch = originalFetch; await h.emit("session_shutdown"); await rm(cwd, { recursive: true, force: true }); }
});
