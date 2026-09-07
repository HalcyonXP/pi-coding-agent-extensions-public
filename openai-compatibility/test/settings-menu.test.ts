// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsList, visibleWidth } from "@earendil-works/pi-tui";
import { OpenAISettingsPanel, settingsText, type SettingsRow, type SettingsController } from "../settings-menu.ts";
import { CodeMode } from "../code-mode.ts";
import { harness } from "./capability-fixture.ts";
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(change?: SettingsController["change"], read?: SettingsController["read"]) {
	const rows: SettingsRow[] = [
		{ id: "fast", label: "Fast mode", value: "off", values: ["off", "on"], description: "Saved for this profile; priority processing can increase cost." },
		{ id: "code", label: "Code mode", value: "off", values: ["off", "on"], description: "Session only. Delegated shell commands retain full OS permissions." },
		{ id: "locked", label: "Image generation", value: "unavailable", description: "Excluded by the native host. Not editable." },
	];
	let closes = 0, renders = 0, changes = 0, current = true;
	const listeners = new Set<() => void>();
	const controller: SettingsController = { read: read ?? (async () => structuredClone(rows)),
		async change(id, value, signal) { changes++; if (change) return change(id, value, signal); rows.find(row => row.id === id)!.value = value; return "Saved; changes apply immediately."; },
		isCurrent: () => current, onBoundary(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
	const panel = new OpenAISettingsPanel(structuredClone(rows), controller, { fg: (_tone: string, text: string) => text } as ExtensionContext["ui"]["theme"], () => { renders++; }, () => { closes++; });
	return { panel, rows, view: (width = 80) => panel.render(width).join("\n"), closes: () => closes, changes: () => changes, renders: () => renders, listeners,
		boundary() { current = false; for (const fn of [...listeners]) fn(); } };
}
test("uses Pi's actual SettingsList, aligned values and focused descriptions, not action prompts", () => {
	const f = fixture();try {
		assert.ok(f.panel.children.some(child => child instanceof SettingsList));
		assert.match(f.view(), /→ Fast mode\s+off/);assert.match(f.view(), /Saved for this profile/);assert.match(f.view(), /Type to search/);assert.match(f.view(), /Esc to close/);assert.doesNotMatch(f.view(), /Esc to cancel/);
		f.panel.handleInput("\x1b[B");assert.match(f.view(), /→ Code mode\s+off/);assert.match(f.view(), /full OS permissions/);
	}finally{f.panel.dispose();}
});
test("Enter and Space apply changes without closing; Escape closes without undoing applied values", async () => {
	const f = fixture();f.panel.handleInput("\r");assert.match(f.view(), /applying/);await tick();assert.equal(f.rows[0].value,"on");assert.equal(f.closes(),0);assert.match(f.view(), /→ Fast mode\s+on/);
	f.panel.handleInput(" ");await tick();assert.equal(f.rows[0].value,"off");f.panel.handleInput("\x1b");assert.equal(f.closes(),1);assert.equal(f.rows[0].value,"off");assert.equal(f.listeners.size,0);
});
test("native search and cursor remain after asynchronous updates", async () => {
	const f=fixture();try {for(const c of "Code")f.panel.handleInput(c);assert.match(f.view(), /→ Code mode/);assert.doesNotMatch(f.view(), /Fast mode\s+off/);f.panel.handleInput("\r");await tick();assert.match(f.view(), /→ Code mode\s+on/);assert.doesNotMatch(f.view(), /Fast mode\s+off/);}finally{f.panel.dispose();}
});
test("unavailable rows explain exclusions and cannot be activated", async () => {
	const f=fixture();try {for(const c of "Image")f.panel.handleInput(c);assert.match(f.view(), /unavailable/);assert.match(f.view(), /Excluded by the native host/);f.panel.handleInput("\r");await tick();assert.equal(f.changes(),0);}finally{f.panel.dispose();}
});
test("busy changes cannot double-toggle and do not show unconfirmed success", async () => {
	let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});const f=fixture(async()=>{await wait;return "Applied";});try {f.panel.handleInput("\r");f.panel.handleInput("\r");assert.equal(f.changes(),1);assert.match(f.view(), /applying/);release();await tick();assert.equal(f.changes(),1);assert.match(f.view(), /Fast mode\s+off/);}finally{release();f.panel.dispose();}
});
test("failed writes show an error and restore authoritative values", async () => {
	const f=fixture(async()=>{throw Error("write failed");});try {f.panel.handleInput("\r");await tick();assert.match(f.view(), /Change failed: write failed/);assert.match(f.view(), /Fast mode\s+off/);assert.equal(f.closes(),0);}finally{f.panel.dispose();}
});
test("failed refresh marks values unknown and freezes controls, never an actionable stale view", async () => {
	const f=fixture(undefined,async()=>{throw Error("no state");});try {f.panel.handleInput("\r");await tick();assert.match(f.view(), /unknown/);assert.match(f.view(), /Unable to refresh/);f.panel.handleInput("\r");await tick();assert.equal(f.changes(),1);}finally{f.panel.dispose();}
});
test("closing aborts pending work and prevents late UI updates", async () => {
	let release!:()=>void;const wait=new Promise<void>(r=>{release=r;});let applied=false;const f=fixture(async(_id,_v,signal)=>{await wait;signal.throwIfAborted();applied=true;return "Applied";});
	f.panel.handleInput("\r");f.panel.handleInput("\x1b");const renders=f.renders();release();await tick();assert.equal(applied,false);assert.equal(f.renders(),renders);assert.equal(f.closes(),1);assert.equal(f.listeners.size,0);
});
test("context boundaries close and dispose the menu, including pending changes", async () => {
	const f=fixture();f.boundary();f.panel.handleInput("\r");await tick();assert.equal(f.closes(),1);assert.equal(f.changes(),0);assert.equal(f.listeners.size,0);
});
test("native mouse selection activates a row through container coordinate mapping", async () => {
	const f=fixture();try {const lines=f.panel.render(80);const y=lines.findIndex(line=>line.includes("Fast mode")&&line.includes("off"));assert.ok(y>=0);
		f.panel.handleMouse({type:"click",button:"left",x:5,y,width:80,height:lines.length,shift:false,alt:false,ctrl:false} as any);await tick();assert.equal(f.rows[0].value,"on");
	}finally{f.panel.dispose();}
});
test("rendered native layout stays within narrow and wide terminal widths",()=>{
	const f=fixture();try {for(const width of [1,16,32,60,100])for(const line of f.panel.render(width))assert.ok(visibleWidth(line)<=width,`${width}: ${line}`);assert.deepEqual(f.panel.render(0),[]);}finally{f.panel.dispose();}
});
test("configuration text cannot inject terminal or bidirectional controls",()=>{
	assert.doesNotMatch(settingsText("\x1b[31mname\n\x07\u061c\u200e\u200f\u202ehidden\u2066"),/[\x00-\x1f\u061c\u200e\u200f\u202e\u2066]/);assert.equal(settingsText("x".repeat(1000)).length,300);
});
test("capability settings are passive, distinguish unavailable reasons, and retain ordinary tools",async()=>{
	const h=harness(tmpdir());try{await h.emit("session_start");const rows=await h.settings.read(h.ctx);assert.equal(rows.find(r=>r.id==="imagegen")!.value,"on");assert.equal(rows.find(r=>r.id==="web_search")!.value,"unavailable");assert.match(rows.find(r=>r.id==="web_search")!.description,/No search transport/);assert.equal(rows.find(r=>r.id==="runtime")!.value,"unavailable");assert.equal(h.authCalls(),0);
		await h.settings.change("unified_exec","on",h.ctx,new AbortController().signal);assert.ok(h.active().includes("exec_command"));assert.ok(h.active().includes("read"));assert.equal(h.authCalls(),0);
	}finally{await h.emit("session_shutdown");}
});
test("excluded or replaced tools are read-only and cannot be enabled from settings",async()=>{
	const h=harness(tmpdir());try{await h.emit("session_start");h.tools.delete("imagegen");h.pi.setActiveTools(h.active().filter(n=>n!=="imagegen"));const row=(await h.settings.read(h.ctx)).find(r=>r.id==="imagegen")!;assert.equal(row.value,"unavailable");assert.equal(row.values,undefined);assert.match(row.description,/excluded, conflicting or replaced/);await assert.rejects(h.settings.change("imagegen","on",h.ctx,new AbortController().signal),/unavailable/);assert.ok(!h.active().includes("imagegen"));}finally{await h.emit("session_shutdown");}
});
test("unsupported routes are explained without probing subscription authentication",async()=>{
	const h=harness(tmpdir());try{await h.emit("session_start");h.ctx.model={...h.ctx.model!,provider:"other"};await h.emit("model_select");const rows=await h.settings.read(h.ctx);assert.equal(rows.find(r=>r.id==="subscription")!.value,"not inspected");assert.equal(rows.find(r=>r.id==="imagegen")!.values,undefined);assert.equal(h.authCalls(),0);}finally{await h.emit("session_shutdown");}
});
test("delayed native preflight cannot enable Code mode after menu close",async(t)=>{
	const h=harness(tmpdir());(h.ctx as any).toolGatewayInfo={version:1,protectedResults:true,activeScopes:0,drainingScopes:0,maxScopes:2};let resolve!:()=>void,entered!:()=>void;let calls=0;
	const preflight=new Promise<void>(r=>{entered=r;});
	t.mock.method(CodeMode.prototype,"status",async()=>{if(++calls===2)await new Promise<void>(r=>{resolve=r;entered();});return {available:true,native:(h.ctx as any).toolGatewayInfo};});
	try{await h.emit("session_start");const abort=new AbortController();const changing=h.settings.change("code_mode","on",h.ctx,abort.signal);await preflight;abort.abort();resolve();await assert.rejects(changing,/aborted/);assert.ok(!h.active().includes("exec"));}finally{await h.emit("session_shutdown");}
});
test("native draining status is not mislabeled ready",async(t)=>{
	const h=harness(tmpdir());t.mock.method(CodeMode.prototype,"status",async()=>({available:true,native:{version:1,protectedResults:true,activeScopes:0,drainingScopes:1,maxScopes:2}}));try{await h.emit("session_start");assert.equal((await h.settings.read(h.ctx)).find(r=>r.id==="runtime")!.value,"draining");}finally{await h.emit("session_shutdown");}
});
test("context boundary listeners do not fire for own preference changes and cannot prevent teardown",async()=>{
	const h=harness(tmpdir());try{await h.emit("session_start");let closed=0;const version=h.settings.contextVersion();const unsubscribe=h.settings.onBoundary(()=>{closed++;throw Error("test UI failure");});await h.settings.change("imagegen","off",h.ctx,new AbortController().signal);assert.equal(h.settings.contextVersion(),version);assert.equal(closed,0);await h.emit("model_select");assert.equal(closed,1);assert.notEqual(h.settings.contextVersion(),version);unsubscribe();}finally{await h.emit("session_shutdown");}
});

test("narrow terminal fallback cannot change invisible settings",async()=>{
 const f=fixture();try{assert.match(f.view(16),/Widen terminal/);f.panel.handleInput("\r");await tick();assert.equal(f.changes(),0);f.view(80);f.panel.handleInput("\r");await tick();assert.equal(f.rows[0].value,"on");}finally{f.panel.dispose();}
});
