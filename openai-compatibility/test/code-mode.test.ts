import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import {
	CodeMode,
	createCodeModeTools,
	toolGatewayInfo,
} from "../code-mode.ts";
function fixture() {
	const context = new AbortController(),
		signal = new AbortController();
	let opens = 0;
	const ctx = {
		sessionManager: {},
		toolGatewayInfo: {
			version: 1,
			protectedResults: true,
			activeScopes: 0,
			drainingScopes: 0,
			maxScopes: 2,
		},
		tools: {
			origin: "direct",
			contextSignal: context.signal,
			signal: signal.signal,
			openScope() {
				opens++;
				throw Error("A unit fixture must not issue native authority");
			},
			adoptScope() {
				throw Error("No native authority");
			},
		},
	};
	return {
		ctx,
		view: ctx as unknown as ExtensionContext,
		get opens() {
			return opens;
		},
	};
}
test("stock/stale/incompatible metadata fails preflight without auth or runtime work", async () => {
	let checks = 0;
	const code = new CodeMode(
		() => [],
		async () => {
			checks++;
			throw Error("Must not inspect runtime");
		},
	);
	assert.equal(
		(await code.status({} as ExtensionContext)).reason,
		"PRIVATE_HOST_GATEWAY_V1_REQUIRED",
	);
	const stale = Object.defineProperty({}, "toolGatewayInfo", {
		get() {
			throw Error("Stale runner");
		},
	}) as ExtensionContext;
	assert.equal(toolGatewayInfo(stale), undefined);
	const f = fixture();
	f.ctx.toolGatewayInfo.version = 2;
	assert.equal(toolGatewayInfo(f.view), undefined);
	f.ctx.toolGatewayInfo.version = 1;
	f.ctx.toolGatewayInfo.activeScopes = 3;
	assert.equal(toolGatewayInfo(f.view), undefined);
	f.ctx.toolGatewayInfo.activeScopes = 0;
	f.ctx.toolGatewayInfo.protectedResults = false;
	assert.equal(
		(await code.status(f.view)).reason,
		"NATIVE_PROTECTED_PUBLICATION_REQUIRED",
	);
	assert.equal(checks, 0);
	assert.equal(f.opens, 0);
});
test("missing contained artifact fails before any native launch; poll does not invent a cell", async () => {
	const f = fixture(),
		code = new CodeMode(
			() => [],
			async () => ({ available: false, reason: "NATIVE_ARTIFACT_MISSING" }),
		);
	await assert.rejects(
		code.exec(f.view, { code: "text(1)" }),
		/NATIVE_ARTIFACT_MISSING/,
	);
	await assert.rejects(
		code.wait(f.view, { cell_id: "public lookup only" }),
		/unavailable/,
	);
	assert.equal(f.opens, 0);
});
test("policy revocation while passive preflight waits prevents later scope admission", async () => {
	const f = fixture();
	let done: () => void = () => {};
	const gate = new Promise<void>((r) => {
		done = r;
	});
	const code = new CodeMode(
		() => [],
		async () => {
			await gate;
			return { available: true };
		},
	);
	const pending = code.exec(f.view, { code: "text(1)" });
	await code.reset();
	done();
	await assert.rejects(pending, /revoked/);
	assert.equal(f.opens, 0);
});
test("metadata overflow and nested invocation cannot widen or launch a coordinator", async () => {
	const f = fixture(),
		names = Array.from({ length: 33 }, (_, n) => `tool_${n}`),
		code = new CodeMode(
			() => names,
			async () => ({ available: true }),
		);
	await assert.rejects(code.exec(f.view, { code: "text(1)" }), /at most 32/);
	assert.equal(names.length, 33);
	assert.equal(f.opens, 0);
	f.ctx.tools.origin = "nested";
	await assert.rejects(code.exec(f.view, { code: "text(1)" }), /direct native/);
	assert.equal(f.opens, 0);
});
test("production JSON schemas expose no owner, native context, launcher or helper-selection flags", () => {
	const tools = createCodeModeTools(new CodeMode(() => [])),
		exec = tools.find((t) => t.name === "exec")!,
		wait = tools.find((t) => t.name === "wait")!;
	assert.ok(
		Value.Check(exec.parameters, {
			code: "text(1)",
			max_output_tokens: 0,
			yield_time_ms: 0,
		}),
	);
	assert.ok(
		Value.Check(wait.parameters, {
			cell_id: "lookup",
			max_tokens: 0,
			terminate: true,
		}),
	);
	for (const name of [
		"owner",
		"invocation",
		"toolGatewayInfo",
		"runtimeFactory",
		"launch",
		"tools",
		"signal",
	])
		assert.equal(
			Value.Check(exec.parameters, { code: "text(1)", [name]: {} }),
			false,
		);
	assert.equal(
		Value.Check(wait.parameters, { cell_id: "lookup", max_output_tokens: 1 }),
		false,
	);
});
