// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unifiedPreferenceStore } from "../unified-preferences.ts";
import { capabilityPreferenceStore } from "../capability-preferences.ts";
import { backgroundWaitMs, parseBackgroundWaitMs, stdinWaitMs } from "../unified-wait.ts";
import { UnifiedExecManager } from "../unified-exec.ts";
import { CodeMode } from "../code-mode.ts";
import { harness } from "./capability-fixture.ts";
import { OpenAISettingsPanel } from "../settings-menu.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function directory(t: TestContext) {
	const dir = mkdtempSync(join(tmpdir(), "pi-unified-preferences-"));
	// Older supported Node versions/types do not expose a confirmed test outcome.
	// In that case retain the owned fixture rather than deleting failure evidence.
	t.after(() => { if (Reflect.get(t, "passed") === true) rmSync(dir, { recursive: true }); });
	return dir;
}
const file = (dir: string) => join(dir, "openai-compatibility-unified.json");
const signal = () => new AbortController().signal;
function fixture(dir: string) {
	return harness(dir, undefined, { preferences: capabilityPreferenceStore(dir), unifiedPreferences: unifiedPreferenceStore(dir) });
}

test("trusted ceiling and CLI decimal have distinct noncoercing admission", () => {
	for (const value of [5000, 5001, 30000, 60000, 299999, 300000]) {
		assert.equal(backgroundWaitMs(value), value); assert.equal(parseBackgroundWaitMs(String(value)), value);
		assert.equal(stdinWaitMs(Number.MAX_SAFE_INTEGER, "", value), value);
		assert.equal(stdinWaitMs(undefined, "", value), 5000);
		for (const chars of ["x", " ", "\n", "\u0003", "\u0004"]) assert.equal(stdinWaitMs(300000, chars, value), 30000);
	}
	const hostile = { [Symbol.toPrimitive]() { throw Error("must not coerce"); } };
	for (const value of [undefined, null, false, "5000", hostile, 0, -1, 4999, 5000.5, 300001, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => backgroundWaitMs(value), /must be an integer/);
	for (const text of ["", "05000", "5e3", "5000.0", "+5000", " 5000", "5000 ", "5000\n", "0x1388", "5000ms", "300001", "4999"]) assert.throws(() => parseBackgroundWaitMs(text));
});
test("fresh default is passive; explicit preferences survive stores without changing Fast or capability bytes", t => {
	const dir = directory(t), store = unifiedPreferenceStore(dir);
	assert.equal(store.read(), 300000); assert.deepEqual(readdirSync(dir), []);
	const fast = join(dir, "openai-compatibility.json"), capabilities = join(dir, "openai-compatibility-capabilities.json");
	writeFileSync(fast, '{"version":1,"enabled":true}\n'); capabilityPreferenceStore(dir).write("unified_exec", true);
	const before = [readFileSync(fast), readFileSync(capabilities)];
	for (const value of [5000, 55001, 300000]) { store.write(value); assert.equal(unifiedPreferenceStore(dir).read(), value); }
	assert.deepEqual(JSON.parse(readFileSync(file(dir), "utf8")), { version: 1, maxBackgroundWaitMs: 300000 });
	assert.deepEqual([readFileSync(fast), readFileSync(capabilities)], before);
	assert.equal(readdirSync(dir).filter(n => n.endsWith(".tmp")).length, 0);
	assert.equal(unifiedPreferenceStore(join(dir, "other-profile")).read(), 300000);
});
test("invalid records and unknown versions remain byte-identical after read/write refusal", t => {
	const dir = directory(t), store = unifiedPreferenceStore(dir);
	for (const bytes of [Buffer.from("{"), Buffer.from("null"), Buffer.from("[]"), Buffer.from([255]), Buffer.alloc(4097, 32),
		...[{ version: 2, maxBackgroundWaitMs: 5000 }, { version: 1 }, { version: 1, maxBackgroundWaitMs: "5000" },
			{ version: 1, maxBackgroundWaitMs: 5000, jobs: [] }, { version: 1, maxBackgroundWaitMs: 300001 }, { version: 1, maxBackgroundWaitMs: 0 }].map(row => Buffer.from(JSON.stringify(row)))]) {
		writeFileSync(file(dir), bytes);
		assert.throws(() => store.read(), /unreadable or invalid/); assert.throws(() => store.write(5000), /unreadable or invalid/);
		assert.deepEqual(readFileSync(file(dir)), bytes);
	}
});
test("invalid writes cannot create files; directory targets are not overwritten", t => {
	const dir = directory(t), store = unifiedPreferenceStore(dir);
	for (const value of [undefined, null, "5000", 4999, 300001]) assert.throws(() => store.write(value as number));
	assert.deepEqual(readdirSync(dir), []); mkdirSync(file(dir));
	assert.throws(() => store.read(), /unreadable or invalid/); assert.throws(() => store.write(5000), /unreadable or invalid/);
	assert.deepEqual(readdirSync(dir), ["openai-compatibility-unified.json"]);
});
test("command and settings share one saved ceiling without enabling tools or resetting jobs", async t => {
	const dir = directory(t), h = fixture(dir);
	try {
		await h.emit("session_start"); const active = h.active(), revision = h.settings.contextVersion(); let resets = 0;
		const realReset = UnifiedExecManager.prototype.reset;
		t.mock.method(UnifiedExecManager.prototype, "reset", async function(this: UnifiedExecManager) { resets++; return realReset.call(this); });
		await h.commands.get("openai-tools").handler("background-wait 55001", h.ctx);
		let row = (await h.settings.read(h.ctx)).find(r => r.id === "background_wait")!;
		assert.equal(row.value, "55001"); assert.ok(row.values!.includes("55001")); assert.equal(unifiedPreferenceStore(dir).read(), 55001);
		await h.settings.change("background_wait", "60000", h.ctx, signal());
		row = (await h.settings.read(h.ctx)).find(r => r.id === "background_wait")!;
		assert.equal(row.value, "60000"); assert.match(row.description, /future empty-input polls/);
		assert.equal(unifiedPreferenceStore(dir).read(), 60000); assert.equal(h.settings.contextVersion(), revision);
		assert.deepEqual(h.active(), active); assert.equal(resets, 0); assert.equal(h.authCalls(), 0); assert.deepEqual(h.settings.jobs(h.ctx).read(), []);
		assert.deepEqual([...h.commands.keys()], ["openai-tools"]);
		assert.ok(h.commands.get("openai-tools").getArgumentCompletions("background-wait").some((r: {value: string}) => r.value === "background-wait status"));
	} finally { await h.emit("session_shutdown"); }
	const restarted = fixture(dir);
	try { await restarted.emit("session_start"); assert.equal((await restarted.settings.read(restarted.ctx)).find(r => r.id === "background_wait")!.value, "60000"); assert.equal(restarted.authCalls(), 0); }
	finally { await restarted.emit("session_shutdown"); }
});
test("status and invalid commands are passive; failed save or aborted settings do not change the effective ceiling", async t => {
	const dir = directory(t), h = fixture(dir);
	try {
		await h.emit("session_start");
		for (const args of ["background-wait", "background-wait status", "background-wait 0", "background-wait 030000", "background-wait 30000 extra", "background-wait status extra"]) await h.commands.get("openai-tools").handler(args, h.ctx);
		assert.deepEqual(readdirSync(dir), []);
		const aborted = new AbortController(); aborted.abort();
		await assert.rejects(h.settings.change("background_wait", "5000", h.ctx, aborted.signal), {name: "AbortError"});
		writeFileSync(file(dir), "preserve malformed preferences");
		await assert.rejects(h.settings.change("background_wait", "5000", h.ctx, signal()), /unreadable or invalid/);
		await h.commands.get("openai-tools").handler("background-wait 5000", h.ctx);
		assert.match(h.notices.at(-1)!, /Current settings were not changed/);
		assert.equal((await h.settings.read(h.ctx)).find(r => r.id === "background_wait")!.value, "300000");
		assert.equal(readFileSync(file(dir), "utf8"), "preserve malformed preferences"); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("invalid restored policy prevents Unified activation but preserves other choices and Jobs access", async t => {
	const dir = directory(t); capabilityPreferenceStore(dir).write("unified_exec", true); writeFileSync(file(dir), "invalid policy");
	const h = fixture(dir);
	try {
		await h.emit("session_start"); assert.ok(h.active().includes("imagegen")); assert.ok(h.active().includes("read")); assert.ok(!h.active().includes("exec_command"));
		const rows = await h.settings.read(h.ctx);
		assert.equal(rows.find(r => r.id === "unified_exec")!.value, "unavailable"); assert.equal(rows.find(r => r.id === "background_wait")!.values, undefined);
		assert.deepEqual(h.settings.jobs(h.ctx).read(), []);
		await h.commands.get("openai-tools").handler("unified_exec on", h.ctx); assert.match(h.notices.at(-1)!, /Saved Unified wait preferences are invalid/);
		assert.equal(capabilityPreferenceStore(dir).read().unified_exec, true); assert.equal(readFileSync(file(dir), "utf8"), "invalid policy"); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("native settings keyboard changes use the saved ceiling without closing the menu", async t => {
	const dir = directory(t), h = fixture(dir); let panel: OpenAISettingsPanel | undefined, closed = 0;
	try {
		await h.emit("session_start");
		panel = new OpenAISettingsPanel(await h.settings.read(h.ctx), {
			read: () => h.settings.read(h.ctx), isCurrent: () => true, onBoundary: h.settings.onBoundary,
			async change(id, value, signal) { await h.settings.change(id, value, h.ctx, signal); return "Ceiling saved; running waits unchanged."; },
		}, { fg: (_tone: string, text: string) => text } as ExtensionContext["ui"]["theme"], () => {}, () => { closed++; }, "background_wait");
		assert.match(panel.render(80).join("\n"), /→ Background wait ceiling\s+300000/);
		panel.handleInput("\r");
		const end = performance.now() + 10000;
		while (panel.render(80).join("\n").includes("applying…") && performance.now() < end) await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal(unifiedPreferenceStore(dir).read(), 5000); assert.equal(closed, 0);
		assert.match(panel.render(80).join("\n"), /→ Background wait ceiling\s+5000/);
		await h.emit("model_select"); assert.equal(closed, 1); assert.equal(h.authCalls(), 0);
	} finally { panel?.dispose(); await h.emit("session_shutdown"); }
});
test("changing wait preference during startup does not revoke unrelated capability restoration", async t => {
	const dir = directory(t); capabilityPreferenceStore(dir).write("code_mode", true);
	const h = fixture(dir); let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(r => { enter = r; }), blocked = new Promise<void>(r => { release = r; });
	t.mock.method(CodeMode.prototype, "status", async () => { enter(); await blocked; return { available: false, reason: "NATIVE_ARTIFACT_MISSING" }; });
	try {
		const starting = h.emit("session_start"); await entered;
		await h.commands.get("openai-tools").handler("background-wait 60000", h.ctx); release(); await starting;
		assert.ok(h.active().includes("imagegen")); assert.ok(h.active().includes("read")); assert.equal(unifiedPreferenceStore(dir).read(), 60000);
	} finally { release?.(); await h.emit("session_shutdown"); }
});
test("settings boundary during refresh prevents a late ceiling write", async t => {
	const dir = directory(t), h = fixture(dir); let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(r => { enter = r; }), blocked = new Promise<void>(r => { release = r; });
	try {
		await h.emit("session_start");
		t.mock.method(CodeMode.prototype, "status", async () => { enter(); await blocked; return { available: false, reason: "NATIVE_ARTIFACT_MISSING" }; });
		const changing = assert.rejects(h.settings.change("background_wait", "5000", h.ctx, signal()), /changed/i);
		await entered; await h.emit("session_before_switch"); release(); await changing;
		assert.deepEqual(readdirSync(dir), []);
	} finally { release?.(); await h.emit("session_shutdown"); }
});
