// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { capabilityPreferenceStore, CAPABILITY_NAMES, DEFAULT_CAPABILITIES } from "../capability-preferences.ts";
import { CodeMode } from "../code-mode.ts";
import { harness } from "./capability-fixture.ts";
function directory(t: any) { const dir = mkdtempSync(join(tmpdir(), "pi-capability-preferences-")); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }
const file = (dir: string) => join(dir, "openai-compatibility-capabilities.json");
const allOn = { imagegen: true, web_search: true, unified_exec: true, code_mode: true };
const gateway = { version: 1, protectedResults: true, activeScopes: 0, drainingScopes: 0, maxScopes: 2 };
function fixture(dir: string) {
	const h = harness(dir, undefined, { preferences: capabilityPreferenceStore(dir), webSearch: { transport: async () => { throw Error("No service request allowed"); }, profile: "verified-v1" } });
	(h.ctx as any).toolGatewayInfo = gateway;
	return h;
}

test("missing profile preferences keep fresh defaults without writing, and reads return independent copies", t => {
	const dir = directory(t), store = capabilityPreferenceStore(dir);
	assert.deepEqual(store.read(), DEFAULT_CAPABILITIES); store.read().imagegen = false;
	assert.deepEqual(store.read(), DEFAULT_CAPABILITIES); assert.deepEqual(readdirSync(dir), []);
});
test("each explicit boolean survives a new store and does not erase the other choices or Fast file", t => {
	const dir = directory(t), fast = join(dir, "openai-compatibility.json"); writeFileSync(fast, '{"version":1,"enabled":true}\n'); const bytes = readFileSync(fast);
	for (const name of CAPABILITY_NAMES) capabilityPreferenceStore(dir).write(name, name !== "imagegen");
	assert.deepEqual(capabilityPreferenceStore(dir).read(), { imagegen: false, web_search: true, unified_exec: true, code_mode: true });
	assert.deepEqual(readFileSync(fast), bytes); assert.equal(readdirSync(dir).filter(name => name.endsWith(".tmp")).length, 0);
	assert.deepEqual(Object.keys(JSON.parse(readFileSync(file(dir), "utf8"))).sort(), ["capabilities", "version"]);
});
test("preferences never leak into a different profile", t => {
	const dir = directory(t), a = capabilityPreferenceStore(join(dir, "a")), b = capabilityPreferenceStore(join(dir, "b"));
	a.write("unified_exec", true); assert.equal(b.read().unified_exec, false); assert.equal(a.read().unified_exec, true);
});
test("malformed, incomplete, oversized, unknown-version and invalid UTF-8 records fail closed and remain unchanged", t => {
	const dir = directory(t), store = capabilityPreferenceStore(dir);
	for (const bytes of [Buffer.from("{"), Buffer.from("null"), Buffer.from(JSON.stringify({ version: 2, capabilities: allOn })), Buffer.from(JSON.stringify({ version: 1, capabilities: { imagegen: true } })), Buffer.from(JSON.stringify({ version: 1, capabilities: { ...allOn, code_mode: "on" } })), Buffer.from(JSON.stringify({ version: 1, capabilities: allOn, jobs: [] })), Buffer.from(JSON.stringify({ version: 1, capabilities: { ...allOn, jobs: true } })), Buffer.alloc(4097, 32), Buffer.from([0xff])]) {
		writeFileSync(file(dir), bytes); assert.throws(() => store.read(), /unreadable or invalid/); assert.throws(() => store.write("imagegen", false), /unreadable or invalid/); assert.deepEqual(readFileSync(file(dir)), bytes);
	}
});
test("directory targets and untyped invalid write arguments are refused without removing state", t => {
	const dir = directory(t), store = capabilityPreferenceStore(dir); mkdirSync(file(dir));
	assert.throws(() => store.read(), /unreadable or invalid/); assert.throws(() => store.write("code_mode", true), /unreadable or invalid/);
	assert.throws(() => store.write("jobs" as any, true), /unreadable or invalid/); assert.throws(() => store.write("code_mode", "on" as any), /unreadable or invalid/); assert.deepEqual(readdirSync(dir), ["openai-compatibility-capabilities.json"]);
});
test("all selectable choices restore after a new session with passive preflight and no auth or jobs", async t => {
	const dir = directory(t); t.mock.method(CodeMode.prototype, "status", async () => ({ available: true, native: gateway as any }));
	const first = fixture(dir);
	try { await first.emit("session_start"); for (const name of CAPABILITY_NAMES) await first.settings.change(name, name === "imagegen" ? "off" : "on", first.ctx, new AbortController().signal); }
	finally { await first.emit("session_shutdown"); }
	const second = fixture(dir);
	try {
		await second.emit("session_start"); assert.deepEqual(second.active().sort(), ["read", "powershell", "web_search", "exec_command", "write_stdin", "exec", "wait"].sort());
		assert.deepEqual(second.settings.jobs(second.ctx).read(), []); assert.equal(first.authCalls() + second.authCalls(), 0);
		assert.match((await second.settings.read(second.ctx)).find(row => row.id === "code_mode")!.description, /Saved for this Pi profile: on/);
	} finally { await second.emit("session_shutdown"); }
});
test("unavailable runtime retains saved-on choice but cannot activate it", async t => {
	const dir = directory(t); capabilityPreferenceStore(dir).write("code_mode", true);
	t.mock.method(CodeMode.prototype, "status", async () => ({ available: false, reason: "NATIVE_ARTIFACT_MISSING" }));
	const h = fixture(dir); try {
		await h.emit("session_start"); assert.ok(!h.active().includes("exec")); const row = (await h.settings.read(h.ctx)).find(row => row.id === "code_mode")!;
		assert.equal(row.value, "unavailable"); assert.equal(row.values, undefined); assert.match(row.description, /Saved for this Pi profile: on/); assert.equal(capabilityPreferenceStore(dir).read().code_mode, true); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("missing native grammar capability retains saved Code choice but refuses activation and direct bypass", async t => {
	const dir = directory(t), store = capabilityPreferenceStore(dir); store.write("code_mode", true);
	const before = readFileSync(file(dir)), h = fixture(dir);
	(h.ctx as any).model = { ...h.ctx.model, compat: { supportsOpenAIGrammarTools: false } };
	try {
		await h.emit("session_start"); assert.ok(!h.active().includes("exec")); assert.ok(!h.active().includes("wait")); assert.ok(h.active().includes("read"));
		const row = (await h.settings.read(h.ctx)).find(row => row.id === "code_mode")!; assert.equal(row.value, "unavailable"); assert.equal(row.values, undefined); assert.match(row.description, /grammar-tool support/); assert.match(row.description, /Saved for this Pi profile: on/);
		await h.commands.get("openai-tools").handler("code_mode on", h.ctx); assert.match(h.notices.at(-1)!, /NATIVE_CODE_GRAMMAR_REQUIRED/);
		await assert.rejects(h.tools.get("exec")!.execute("synthetic-grammar-bypass", { code: "text(1)" }, undefined, undefined, h.ctx), /NATIVE_CODE_GRAMMAR_REQUIRED/);
		assert.deepEqual(readFileSync(file(dir)), before); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("model boundary removes active Code on grammar downgrade without replacing ordinary tools or saved choices", async t => {
	const dir = directory(t), store = capabilityPreferenceStore(dir); store.write("code_mode", true);
	t.mock.method(CodeMode.prototype, "status", async () => ({ available: true, native: gateway as any }));
	const h = fixture(dir); try {
		await h.emit("session_start"); assert.ok(h.active().includes("exec"));
		(h.ctx as any).model = { ...h.ctx.model, compat: { supportsOpenAIGrammarTools: false } }; await h.emit("model_select");
		assert.ok(!h.active().includes("exec")); assert.ok(!h.active().includes("wait")); assert.ok(h.active().includes("read")); assert.ok(h.active().includes("powershell")); assert.equal(store.read().code_mode, true); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("unsupported route and missing transport retain saved choices without activation or auth", async t => {
	const dir = directory(t), store = capabilityPreferenceStore(dir); store.write("web_search", true);
	const h = harness(dir, undefined, { preferences: store });
	try {
		(h.ctx as any).model = { ...h.ctx.model, provider: "unsupported" }; await h.emit("session_start"); assert.deepEqual(h.active(), ["read", "powershell"]);
		assert.match((await h.settings.read(h.ctx)).find(row => row.id === "web_search")!.description, /Saved for this Pi profile: on/); assert.equal(store.read().web_search, true); assert.equal(h.authCalls(), 0);
	} finally { await h.emit("session_shutdown"); }
});
test("replaced tool namespace cannot be restored from saved preferences", async t => {
	const dir = directory(t); capabilityPreferenceStore(dir).write("unified_exec", true); const h = fixture(dir);
	try { await h.emit("session_start"); h.tools.delete("exec_command"); await h.emit("session_start"); assert.ok(!h.active().includes("exec_command")); assert.ok(!h.active().includes("write_stdin")); assert.equal(capabilityPreferenceStore(dir).read().unified_exec, true); }
	finally { await h.emit("session_shutdown"); }
});
test("failed save leaves the current effective and saved selection untouched", async t => {
	const dir = directory(t), h = fixture(dir); try {
		await h.emit("session_start"); writeFileSync(file(dir), "malformed preserved state");
		await assert.rejects(h.settings.change("imagegen", "off", h.ctx, new AbortController().signal), /Could not save/); assert.ok(h.active().includes("imagegen")); assert.equal((await h.settings.read(h.ctx)).find(row => row.id === "imagegen")!.value, "on"); assert.equal(readFileSync(file(dir), "utf8"), "malformed preserved state");
	} finally { await h.emit("session_shutdown"); }
});
test("invalid saved state disables even the default image choice without writing or authenticating", async t => {
	const dir = directory(t); writeFileSync(file(dir), "malformed preserved state"); const h = fixture(dir);
	try { await h.emit("session_start"); assert.deepEqual(h.active(), ["read", "powershell"]); assert.match(h.notices.at(-1)!, /All capability choices are off/); assert.equal(h.authCalls(), 0); assert.equal(readFileSync(file(dir), "utf8"), "malformed preserved state"); }
	finally { await h.emit("session_shutdown"); }
});
test("a boundary during startup preflight cannot restore old authority or change saved choices", async t => {
	const dir = directory(t); capabilityPreferenceStore(dir).write("code_mode", true); const h = fixture(dir); let enter!: () => void, release!: () => void;
	const entered = new Promise<void>(r => { enter = r; }), blocked = new Promise<void>(r => { release = r; });
	t.mock.method(CodeMode.prototype, "status", async () => { enter(); await blocked; return { available: true, native: gateway as any }; });
	try { const restoring = h.emit("session_start"); await entered; await h.emit("session_before_switch"); release(); await restoring; assert.ok(!h.active().includes("exec")); assert.equal(capabilityPreferenceStore(dir).read().code_mode, true); }
	finally { release(); await h.emit("session_shutdown"); }
});
test("closing a pending preference change cannot persist it", async t => {
	const dir = directory(t), h = fixture(dir); let count = 0, enter!: () => void, release!: () => void;
	const entered = new Promise<void>(r => { enter = r; }), blocked = new Promise<void>(r => { release = r; });
	t.mock.method(CodeMode.prototype, "status", async () => { if (++count === 2) { enter(); await blocked; } return { available: true, native: gateway as any }; });
	try { await h.emit("session_start"); const abort = new AbortController(), change = h.settings.change("code_mode", "on", h.ctx, abort.signal); await entered; abort.abort(); release(); await assert.rejects(change, /aborted/); assert.equal(capabilityPreferenceStore(dir).read().code_mode, false); assert.ok(!h.active().includes("exec")); }
	finally { release(); await h.emit("session_shutdown"); }
});
