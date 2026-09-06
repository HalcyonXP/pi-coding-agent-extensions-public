import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import tokensPerSecond from "./index.ts";
import { ReasoningRateProfiles } from "./reasoning-rates.ts";

function createHarness() {
	const handlers = new Map();
	const statuses = [];
	let command;
	const pi = {
		registerCommand(_name, registered) {
			command = registered;
		},
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
	};
	tokensPerSecond(pi);

	const ctx = {
		mode: "tui",
		hasUI: true,
		ui: {
			theme: { fg: (_tone, text) => text },
			setStatus(key, text) {
				statuses.push({ key, text });
			},
			notify() {},
		},
	};
	const emit = async (name, event = {}) => {
		for (const handler of handlers.get(name) ?? []) await handler(event, ctx);
	};
	return { command, ctx, emit, statuses };
}

function assistant(text = "", stopReason = "stop") {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		stopReason,
	};
}

async function waitFor(predicate, timeoutMs = 1_000) {
	const deadline = performance.now() + timeoutMs;
	while (!predicate()) {
		if (performance.now() >= deadline) throw new Error("Timed out waiting for TPS update");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("publishes one compact status, updates it live, and immediately returns to zero", async () => {
	const { command, emit, statuses } = createHarness();
	assert.equal(command.description, "Show, hide, or configure live tokens per second");

	try {
		await emit("session_start");
		assert.deepEqual(statuses.at(-1), {
			key: "tokens-per-second",
			text: "0.0 tok/s",
		});

		await emit("turn_start");
		await emit("message_start", { message: assistant() });
		await emit("message_update", {
			message: assistant("x".repeat(400)),
			assistantMessageEvent: { type: "text_delta", delta: "x".repeat(400) },
		});

		await waitFor(() => statuses.some(({ text }) => /^\d+\.\d tok\/s$/.test(text) && text !== "0.0 tok/s"));
		assert.ok(statuses.every(({ key }) => key === "tokens-per-second"));

		await emit("message_end", { message: assistant("x".repeat(400)) });
		assert.equal(statuses.at(-1).text, "0.0 tok/s");
	} finally {
		await emit("session_shutdown");
	}

	assert.equal(statuses.at(-1).text, undefined);
});

test("uses learned hidden reasoning until open thinking becomes observable", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-tps-inference-"));
	const path = join(directory, "rates.json");
	const previousPath = process.env.PI_TPS_REASONING_RATES_PATH;
	process.env.PI_TPS_REASONING_RATES_PATH = path;
	const profileKey = JSON.stringify(["local", "open-reasoner", "openai-completions", "high"]);
	new ReasoningRateProfiles(path).observe(profileKey, 42);

	const { command, ctx, emit, statuses } = createHarness();
	ctx.model = {
		provider: "local",
		id: "open-reasoner",
		api: "openai-completions",
		reasoning: true,
	};
	ctx.thinkingLevel = "high";

	try {
		await emit("session_start");
		await emit("turn_start");
		await emit("message_start", { message: assistant() });
		assert.equal(statuses.at(-1).text, "42.0 tok/s");

		await command.handler("mode observed", ctx);
		assert.equal(statuses.at(-1).text, "0.0 tok/s");
		await command.handler("mode auto", ctx);
		assert.equal(statuses.at(-1).text, "42.0 tok/s");

		await emit("message_update", {
			message: {
				role: "assistant",
				content: [{ type: "thinking", thinking: "r".repeat(40) }],
				usage: { output: 0 },
				stopReason: "stop",
			},
			assistantMessageEvent: { type: "thinking_delta", delta: "r".repeat(40) },
		});
		await waitFor(() => statuses.some(({ text }) => text !== "42.0 tok/s" && text !== "0.0 tok/s"));
	} finally {
		await emit("session_shutdown");
		if (previousPath === undefined) delete process.env.PI_TPS_REASONING_RATES_PATH;
		else process.env.PI_TPS_REASONING_RATES_PATH = previousPath;
		rmSync(directory, { recursive: true, force: true });
	}
});

test("does not emit TUI status protocol noise in non-TUI modes", async () => {
	const { ctx, emit, statuses } = createHarness();
	ctx.mode = "rpc";
	await emit("session_start");
	await emit("turn_start");
	assert.deepEqual(statuses, []);
	await emit("session_shutdown");
});
