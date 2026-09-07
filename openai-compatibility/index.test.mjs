import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the lockfile SDK by default; an explicit test-only path can inspect another
// installation. Production never imports private provider files or this fixture alias.
const sdkDirectory = process.env.PI_TEST_PACKAGE_DIR
	?? fileURLToPath(new URL("./node_modules/@earendil-works/pi-coding-agent/", import.meta.url));
assert.equal(JSON.parse(readFileSync(join(sdkDirectory, "package.json"), "utf8")).version, "0.85.1");
const { ModelRegistry, ModelRuntime, discoverAndLoadExtensions } = await import(
	pathToFileURL(join(sdkDirectory, "dist/index.js")).href
);
const extensionPath = fileURLToPath(new URL("./index.ts", import.meta.url));
const astra = { id: "gpt-6-astra", provider: "openai-codex", api: "openai-codex-responses", reasoning: true };

async function createHarness(t) {
	const directory = mkdtempSync(join(tmpdir(), "pi-openai-upstream-"));
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = directory;
	t.after(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	});
	const noNetwork = t.mock.method(globalThis, "fetch", async () => {
		throw new Error("Network access is forbidden in OpenAI compatibility tests");
	});
	t.after(() => assert.equal(noNetwork.mock.callCount(), 0, "Tests must stop before network dispatch"));

	const statePath = join(directory, "openai-compatibility.json");
	const models = await ModelRuntime.create({
		authPath: join(directory, "auth.json"),
		modelsPath: null,
		modelsStorePath: join(directory, "models-store.json"),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});

	async function load() {
		const loaded = await discoverAndLoadExtensions([extensionPath], directory, directory);
		assert.deepEqual(loaded.errors, []);
		assert.equal(loaded.extensions.length, 1);
		const extension = loaded.extensions[0];
		const entries = [];
		const notifications = [];
		const footers = [];
		const registry = new ModelRegistry(models);
		let active = ["read", "powershell"];
		loaded.runtime.getActiveTools = () => [...active];
		loaded.runtime.setActiveTools = (names) => { active = [...names]; };
		loaded.runtime.getAllTools = () => [
			{ name: "read", parameters: {} }, { name: "powershell", parameters: {} },
			...[...extension.tools.values()].map((tool) => tool.definition),
		];
		const registrations = [];
		loaded.runtime.registerProvider = (...args) => { registrations.push(args); registry.registerProvider(...args); };
		loaded.runtime.registerNativeProvider = (provider) => { registrations.push(provider); registry.registerProvider(provider); };
		loaded.runtime.appendEntry = (customType, data) => entries.push({ type: "custom", customType, data });
		const theme = { fg: (_tone, text) => text };
		const footerData = {
			onBranchChange: () => () => {},
			getGitBranch: () => "main",
			getExtensionStatuses: () => new Map([["tokens-per-second", "46.7 tok/s"]]),
			getAvailableProviderCount: () => 2,
		};
		const ctx = {
			cwd: directory,
			mode: "rpc",
			hasUI: false,
			model: models.getModel("openai-codex", astra.id),
			modelRegistry: registry,
			thinkingLevel: "high",
			getContextUsage: () => ({ contextWindow: 272_000, percent: 10 }),
			sessionManager: {
				getSessionId: () => "native-sdk-fixture",
				getEntries: () => entries,
				getBranch: () => entries,
				getSessionName: () => "upstream regression",
			},
			ui: {
				theme,
				notify: (message, type) => notifications.push({ message, type }),
				setFooter: (factory) => footers.push(factory({ requestRender() {} }, theme, footerData)),
			},
		};
		async function emit(name, event = {}) {
			let result;
			for (const handler of extension.handlers.get(name) ?? []) result = await handler(event, ctx) ?? result;
			return result;
		}
		const request = async (payload) => (await emit("before_provider_request", { payload })) ?? payload;
		t.after(async () => {
			await emit("session_shutdown");
			for (const footer of footers) footer.dispose();
			loaded.runtime.invalidate();
		});
		return { ...loaded, extension, ctx, emit, request, entries, notifications, footers, registry, registrations, active: () => [...active] };
	}

	return { ...(await load()), load, models, statePath, noNetwork };
}

test("uses native OpenAI catalogs without registering or replacing any provider", async (t) => {
	const { models, runtime, emit, extension, registrations } = await createHarness(t);
	const before = structuredClone(models.getModels());
	const providers = models.getProviders();
	assert.ok(extension.commands.has("fast"));
	assert.ok(extension.flags.has("fast"));
	await emit("session_start");
	await emit("model_select");

	assert.deepEqual(registrations, []);
	assert.deepEqual(runtime.pendingProviderRegistrations, []);
	assert.deepEqual(runtime.pendingNativeProviderRegistrations, []);
	assert.deepEqual(models.getModels(), before);
	for (const provider of providers) assert.equal(models.getProvider(provider.id), provider);
	for (const [provider, api] of [["openai", "openai-responses"], ["openai-codex", "openai-codex-responses"]]) {
		const model = models.getModel(provider, "gpt-6-astra");
		assert.ok(model, `${provider} must supply Astra natively`);
		assert.equal(model.api, api);
		assert.equal(model.thinkingLevelMap.max, "max");
		// Native Codex maps minimal to low; the retired backport incorrectly used null.
		assert.equal(model.thinkingLevelMap.minimal, provider === "openai-codex" ? "low" : null);
		for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			assert.ok(models.getModel(provider, id), `Keep ${provider}/${id}`);
		}
	}
});

test("does not rewrite cache fields or other upstream payload options", async (t) => {
	const { models, ctx, request, extension } = await createHarness(t);
	for (const provider of ["openai", "openai-codex"]) {
		ctx.model = models.getModel(provider, "gpt-6-astra");
		for (const cacheFields of [
			{ prompt_cache_options: Object.freeze({ ttl: "30m", future_option: true }) },
			{ prompt_cache_options: Object.freeze({ mode: "explicit" }) },
			// Deliberately synthetic: even legacy fields are now upstream's responsibility.
			{ prompt_cache_retention: "24h" },
		]) {
			await extension.commands.get("fast").handler("off", ctx);
			const payload = Object.freeze({ model: ctx.model.id, service_tier: "auto", ...cacheFields });
			assert.equal(await request(payload), payload);
			await extension.commands.get("fast").handler("on", ctx);
			assert.deepEqual(await request(payload), { ...payload, service_tier: "priority" });
		}
	}
});

test("preserves Fast support for Astra, dated aliases, and earlier models without affecting unsupported requests", async (t) => {
	const { ctx, extension, request } = await createHarness(t);
	await extension.commands.get("fast").handler("on", ctx);
	for (const [provider, api] of [["openai", "openai-responses"], ["openai-codex", "openai-codex-responses"]]) {
		for (const id of ["gpt-6-astra", "gpt-6-astra-2026-09-03", "gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			ctx.model = { id, provider, api };
			const payload = Object.freeze({ model: id, input: [] });
			const fastPayload = await request(payload);
			assert.deepEqual(fastPayload, { ...payload, service_tier: "priority" });
			assert.equal(await request(fastPayload), fastPayload);
		}
	}
	for (const model of [
		undefined,
		{ ...astra, provider: "proxy" },
		{ ...astra, api: "openai-completions" },
		{ ...astra, id: "gpt-6-astra-preview" },
		{ ...astra, id: "vendor/gpt-6-astra" },
		{ ...astra, id: "gpt-4o" },
	]) {
		ctx.model = model;
		const payload = { model: "gpt-6-astra" };
		assert.equal(await request(payload), payload);
	}
	ctx.model = astra;
	for (const payload of [null, [], "not an object", { model: "gpt-4o" }]) {
		assert.equal(await request(payload), payload);
	}
});

test("keeps the agent-wide Fast preference shared across extension instances", async (t) => {
	const first = await createHarness(t);
	await first.extension.commands.get("fast").handler("on", first.ctx);
	assert.deepEqual(JSON.parse(readFileSync(first.statePath, "utf8")), { version: 1, enabled: true });
	const second = await first.load();
	await second.emit("session_start");
	assert.equal((await second.request({ model: astra.id })).service_tier, "priority");
	await second.extension.commands.get("fast").handler("off", second.ctx);
	const payload = { model: astra.id };
	assert.equal(await first.request(payload), payload);
	assert.deepEqual(JSON.parse(readFileSync(first.statePath, "utf8")), { version: 1, enabled: false });
});

test("retains legacy session migration and the CLI flag fallback", async (t) => {
	const first = await createHarness(t);
	first.runtime.flagValues.set("fast", true);
	first.entries.push({ type: "custom", customType: "openai-compatibility.fast-mode", data: { version: 1, enabled: false } });
	await first.emit("session_start");
	assert.deepEqual(JSON.parse(readFileSync(first.statePath, "utf8")), { version: 1, enabled: false });
	// The shared preference takes priority over older session entries and --fast.
	writeFileSync(first.statePath, JSON.stringify({ version: 1, enabled: true }));
	await first.emit("session_tree");
	assert.equal((await first.request({ model: astra.id })).service_tier, "priority");

	rmSync(first.statePath);
	const second = await first.load();
	second.runtime.flagValues.set("fast", true);
	await second.emit("session_start");
	assert.deepEqual(JSON.parse(readFileSync(first.statePath, "utf8")), { version: 1, enabled: true });
});

test("keeps the shared TUI footer and inline TPS with Fast on or off", async (t) => {
	const { ctx, emit, extension, footers } = await createHarness(t);
	await emit("session_start");
	assert.equal(footers.length, 0, "No footer in RPC mode");
	ctx.hasUI = true;
	ctx.mode = "tui";
	await emit("session_start");
	assert.equal(footers.length, 1);
	const footer = footers[0];
	const offLines = footer.render(160);
	assert.equal(offLines.length, 2);
	assert.match(offLines[1], /\| 46\.7 tok\/s/);
	assert.doesNotMatch(offLines[1], /⚡/);
	await extension.commands.get("fast").handler("on", ctx);
	assert.equal(footers.length, 1, "Retain one footer owner");
	assert.match(footer.render(160)[1], /⚡.*gpt-6-astra • high/);
	assert.match(footer.render(40)[1], /46\.7 tok\/s/);
	assert.deepEqual(footer.render(0), []);
});

test("uses upstream cache handling for GPT-5.6 and Astra with no local transport patch", async (t) => {
	const { models, ctx, request, extension, noNetwork } = await createHarness(t);
	const provider = models.getProvider("openai");
	const context = { messages: [{ role: "user", content: "Offline payload check", timestamp: 0 }] };
	for (const id of ["gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"]) {
		const model = models.getModel("openai", id);
		assert.ok(model);
		ctx.model = model;
		for (const cacheRetention of ["none", "short", "long"]) {
			for (const fast of [false, true]) {
				await extension.commands.get("fast").handler(fast ? "on" : "off", ctx);
				let nativePayload;
				let captured;
				const stream = provider.stream(model, context, {
					apiKey: "offline-payload-check-only",
					fetch: noNetwork,
					cacheRetention,
					sessionId: "offline-session",
					onPayload: async (payload) => {
						nativePayload = payload;
						captured = await request(payload);
						// Match upstream's payload-capture pattern: terminate before HTTP dispatch.
						throw new Error("Payload captured before dispatch");
					},
				});
				await stream.result();
				assert.ok(captured, `${id}/${cacheRetention}/${fast}: payload must reach the hook`);
				// Assert outside onPayload: provider streams turn callback errors into error messages.
				if (fast) assert.deepEqual(captured, { ...nativePayload, service_tier: "priority" });
				else assert.equal(captured, nativePayload);
				const modern = id !== "gpt-5.4";
				const expectedCacheOptions = !modern || cacheRetention === "short"
					? undefined
					: cacheRetention === "none" ? { mode: "explicit" } : { ttl: "30m" };
				assert.deepEqual(captured.prompt_cache_options, expectedCacheOptions);
				assert.equal(captured.prompt_cache_retention, !modern && cacheRetention === "long" ? "24h" : undefined);
				assert.equal(captured.prompt_cache_key, cacheRetention === "none" ? undefined : "offline-session");
			}
		}
	}
});

test("cohesive entry keeps direct capabilities, session opt-ins and provider-switch revocation on native Pi", async (t) => {
	const h = await createHarness(t);
	const auth = t.mock.method(h.registry, "getProviderAuth", async () => { throw new Error("No auth in registration/policy fixtures"); });
	await h.emit("session_start");
	assert.deepEqual([...h.extension.tools.keys()].sort(), ["exec_command", "imagegen", "web_search", "write_stdin"]);
	assert.deepEqual(h.active(), ["read", "powershell", "imagegen"]);
	await h.extension.commands.get("openai-tools").handler("web_search on", h.ctx);
	await h.extension.commands.get("openai-tools").handler("unified_exec on", h.ctx);
	assert.deepEqual(new Set(h.active()), new Set(["read", "powershell", "imagegen", "web_search", "exec_command", "write_stdin"]));
	assert.equal(h.extension.tools.has("exec"), false);
	assert.equal(h.extension.tools.has("wait"), false);
	await h.extension.commands.get("openai-tools").handler("status", h.ctx);
	assert.match(h.notifications.at(-1).message, /verified search\/public-URL-open subset, direct or native protected scope/);
	h.ctx.model = { ...h.ctx.model, provider: "proxy" };
	await h.emit("model_select");
	assert.deepEqual(h.active(), ["read", "powershell"]);
	assert.equal((await h.emit("tool_call", { toolName: "imagegen" })).block, true);
	await assert.rejects(h.extension.tools.get("imagegen").definition.execute("stale", { prompt: "synthetic" }, undefined, undefined, h.ctx), /official OpenAI/);
	h.ctx.model = h.models.getModel("openai", astra.id);
	await h.emit("model_select");
	assert.ok(h.active().includes("imagegen"));
	await h.emit("session_start");
	assert.deepEqual(h.active(), ["read", "powershell", "imagegen"]);
	assert.equal(auth.mock.callCount(), 0);
});

test("genuine registry overrides cannot inherit the retired backport trust exemption", async (t) => {
	const h = await createHarness(t);
	const auth = t.mock.method(h.registry, "getProviderAuth", async () => { throw new Error("Override must fail before auth"); });
	await h.emit("session_start");
	for (const conversationProvider of ["openai", "openai-codex"]) {
		for (const overrideProvider of new Set([conversationProvider, "openai-codex"])) {
			for (const kind of ["native", "legacy"]) {
				h.ctx.model = h.models.getModel(conversationProvider, astra.id);
				const native = h.models.getProvider(overrideProvider);
				if (kind === "native") h.registry.registerProvider({ ...native, isAvailable: async () => false });
				else h.registry.registerProvider(overrideProvider, { baseUrl: h.models.getModel(overrideProvider, astra.id).baseUrl });
				try {
					// Routes and model names still look official. Transport identity is independent.
					await h.emit("model_select");
					assert.deepEqual(h.active(), ["read", "powershell"]);
					const blocked = await h.emit("tool_call", { toolName: "imagegen" });
					assert.equal(blocked.block, true);
					assert.match(blocked.reason, /override/);
					await assert.rejects(h.extension.tools.get("imagegen").definition.execute("override", { prompt: "synthetic" }, undefined, undefined, h.ctx), /override/);
				} finally {
					h.registry.unregisterProvider(overrideProvider);
				}
				await h.emit("model_select");
				assert.ok(h.active().includes("imagegen"));
			}
		}
	}
	assert.equal(auth.mock.callCount(), 0);
	assert.deepEqual(h.registrations, [], "Only the test, never this extension, registers a provider");
});

test("unrelated conversational overrides remain registered and do not disable official capabilities", async (t) => {
	const h = await createHarness(t);
	h.registry.registerProvider("unrelated-fixture", {
		api: "openai-completions", baseUrl: "https://fixture.invalid/v1",
		models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128 }],
	});
	const override = h.registry.getRegisteredProviderConfig("unrelated-fixture");
	assert.ok(override);
	await h.emit("session_start");
	await h.emit("model_select");
	assert.equal(h.registry.getRegisteredProviderConfig("unrelated-fixture"), override);
	assert.ok(h.models.getModel("unrelated-fixture", "fixture"));
	assert.deepEqual(h.active(), ["read", "powershell", "imagegen"]);
});

const settledSettings = new WeakMap();
async function captureSettings(h) {
 h.ctx.mode = "tui"; h.ctx.hasUI = true;
 let capture; const opened = new Promise(resolve => { capture = resolve; });
 h.ctx.ui.select = () => { throw Error("Retired action picker must not be used"); };
 h.ctx.ui.custom = async factory => new Promise(resolve => {
  let component, settle;
  const settled = new Promise(done => { settle = done; });
  component = factory({ requestRender() { if (component && !component.render(80).join("\n").includes("applying…")) settle(); } }, h.ctx.ui.theme, {}, () => { component.dispose?.(); resolve(); });
  settledSettings.set(component, settled);
  capture(component);
 });
 return opened;
}
const uiTick = () => new Promise(resolve => setImmediate(resolve));

test("normal installed entry exposes a shared settings menu and persists Fast without notification spam", async t => {
 const h = await createHarness(t); await h.emit("session_start");
 const opened = captureSettings(h), finished = h.extension.commands.get("fast").handler("", h.ctx), panel = await opened;
 assert.match(panel.render(80).join("\n"), /→ Fast mode\s+off/);
 assert.match(panel.render(80).join("\n"), /Image generation/);
 panel.handleInput("\r"); await settledSettings.get(panel);
 assert.equal(JSON.parse(readFileSync(h.statePath,"utf8")).enabled,true);
 assert.match(panel.render(80).join("\n"), /Fast mode\s+on/);
 assert.equal(h.notifications.length,0);
 panel.handleInput("\x1b"); await finished;
 assert.equal((await h.request({model:astra.id})).service_tier,"priority");
});

test("openai-tools focuses its capability rows and retains RPC/status fallback", async t => {
 const h=await createHarness(t);await h.emit("session_start");
 await h.extension.commands.get("openai-tools").handler("",h.ctx);assert.match(h.notifications.at(-1).message,/OpenAI capabilities/);
 const opened=captureSettings(h),finished=h.extension.commands.get("openai-tools").handler("",h.ctx),panel=await opened;
 assert.match(panel.render(80).join("\n"),/→ Image generation\s+on/);panel.handleInput("\r");await settledSettings.get(panel);assert.ok(!h.active().includes("imagegen"));
 panel.handleInput("\x1b");await finished;
 h.ctx.ui.custom=()=>{throw Error("Explicit status must not open a modal");};await h.extension.commands.get("fast").handler("status",h.ctx);await h.extension.commands.get("openai-tools").handler("status",h.ctx);
 assert.match(h.notifications.at(-1).message,/OpenAI capabilities/);
});

test("model boundary closes the real entry's settings without applying stale input", async t => {
 const h=await createHarness(t);await h.emit("session_start");const opened=captureSettings(h),finished=h.extension.commands.get("fast").handler("",h.ctx),panel=await opened;
 await h.emit("model_select");await finished;panel.handleInput("\r");await uiTick();assert.equal((await h.request({model:astra.id})).service_tier,undefined);
});

test("Fast menu reports failed persistence inline and never displays false success", async t => {
 const h=await createHarness(t);await h.emit("session_start");mkdirSync(h.statePath);
 const opened=captureSettings(h),finished=h.extension.commands.get("fast").handler("",h.ctx),panel=await opened;
 panel.handleInput("\r");await settledSettings.get(panel);const view=panel.render(80).join("\n");assert.match(view,/Change failed/);assert.match(view,/Fast mode\s+off/);assert.equal(h.notifications.length,0);
 panel.handleInput("\x1b");await finished;assert.equal((await h.request({model:astra.id})).service_tier,undefined);
});
