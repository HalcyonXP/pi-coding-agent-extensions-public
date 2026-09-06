import assert from "node:assert/strict";
import test from "node:test";

import contextUsageInjection, {
	CONTEXT_USAGE_MESSAGE_TYPE,
	buildContextUsageMessage,
	buildContextUsageText,
	isContextUsageMessage,
	normalizeContextUsage,
	removeContextUsageMessages,
} from "./index.ts";

test("normalizes valid Pi context telemetry", () => {
	assert.deepEqual(
		normalizeContextUsage({
			tokens: 128000,
			contextWindow: 272000,
			percent: 999, // The extension derives a consistent percentage itself.
		}),
		{
			tokens: 128000,
			contextWindow: 272000,
			percent: 128000 / 272000 * 100,
			remaining: 144000,
		},
	);
});

test("rejects unavailable or invalid telemetry", () => {
	assert.equal(normalizeContextUsage(undefined), undefined);
	assert.equal(
		normalizeContextUsage({ tokens: null, contextWindow: 272000, percent: null }),
		undefined,
	);
	assert.equal(
		normalizeContextUsage({ tokens: -1, contextWindow: 272000, percent: -1 }),
		undefined,
	);
	assert.equal(
		normalizeContextUsage({ tokens: 10, contextWindow: 0, percent: null }),
		undefined,
	);
});

test("builds concise, explicitly non-user runtime telemetry", () => {
	const usage = normalizeContextUsage({
		tokens: 128000,
		contextWindow: 272000,
		percent: 47.1,
	});
	assert.ok(usage);
	assert.equal(
		buildContextUsageText(usage),
		'<runtime_context_usage source="pi-runtime">' +
			"Current active context estimate: ~128,000 / 272,000 tokens (47.1% used). " +
			"~144,000 tokens of nominal context-window headroom remain. " +
			"This is harness telemetry, not a user request. Use it for context-management " +
			"planning without sacrificing correctness or completeness." +
			"</runtime_context_usage>",
	);

	const message = buildContextUsageMessage(usage, 1234);
	assert.deepEqual(message, {
		role: "custom",
		customType: CONTEXT_USAGE_MESSAGE_TYPE,
		content: buildContextUsageText(usage),
		display: false,
		timestamp: 1234,
	});
});

test("reports exhaustion without showing negative headroom", () => {
	const usage = normalizeContextUsage({
		tokens: 300000,
		contextWindow: 272000,
		percent: 110,
	});
	assert.ok(usage);
	assert.equal(usage.remaining, 0);
	assert.match(buildContextUsageText(usage), /110\.3% used/);
	assert.match(buildContextUsageText(usage), /No nominal context-window headroom remains/);
	assert.doesNotMatch(buildContextUsageText(usage), /-28,000/);
});

test("identifies and removes only this extension's projections", () => {
	const messages = [
		{ role: "user", content: "task", timestamp: 1 },
		{
			role: "custom",
			customType: CONTEXT_USAGE_MESSAGE_TYPE,
			content: "stale",
			display: false,
			timestamp: 2,
		},
		{
			role: "custom",
			customType: "another-extension",
			content: "keep",
			display: false,
			timestamp: 3,
		},
	];
	const filtered = removeContextUsageMessages(messages);
	assert.equal(filtered.length, 2);
	assert.equal(filtered[0], messages[0]);
	assert.equal(filtered[1], messages[2]);
	assert.equal(messages.length, 3, "input messages must not be mutated");
	assert.equal(isContextUsageMessage(messages[1]), true);
	assert.equal(isContextUsageMessage(messages[2]), false);
});

test("the context hook refreshes telemetry before every model call", async () => {
	let contextHandler;
	contextUsageInjection({
		on(event, handler) {
			if (event === "context") contextHandler = handler;
		},
	});
	assert.equal(typeof contextHandler, "function");

	let usage = { tokens: 10000, contextWindow: 100000, percent: 10 };
	const ctx = { getContextUsage: () => usage };
	const baseMessages = [{ role: "user", content: "do work", timestamp: 1 }];

	const first = await contextHandler({ messages: baseMessages }, ctx);
	assert.equal(first.messages.length, 2);
	assert.match(first.messages.at(-1).content, /~10,000 \/ 100,000 tokens \(10\.0% used\)/);
	assert.equal(first.messages.at(-1).display, false);

	// Simulate a tool result enlarging the active prompt before the next LLM call.
	usage = { tokens: 42500, contextWindow: 100000, percent: 42.5 };
	const secondInput = [
		...baseMessages,
		{ role: "toolResult", content: [{ type: "text", text: "large result" }] },
		first.messages.at(-1), // Defensive idempotence if another hook retained it.
	];
	const second = await contextHandler({ messages: secondInput }, ctx);
	const projections = second.messages.filter(isContextUsageMessage);
	assert.equal(projections.length, 1);
	assert.match(projections[0].content, /~42,500 \/ 100,000 tokens \(42\.5% used\)/);
	assert.equal(second.messages.at(-1), projections[0]);
});

test("the hook removes stale telemetry while Pi usage is temporarily unknown", async () => {
	let contextHandler;
	contextUsageInjection({
		on(event, handler) {
			if (event === "context") contextHandler = handler;
		},
	});

	const stale = {
		role: "custom",
		customType: CONTEXT_USAGE_MESSAGE_TYPE,
		content: "old value",
		display: false,
		timestamp: 1,
	};
	const result = await contextHandler(
		{ messages: [{ role: "user", content: "continue", timestamp: 2 }, stale] },
		{
			getContextUsage: () => ({
				tokens: null,
				contextWindow: 272000,
				percent: null,
			}),
		},
	);
	assert.equal(result.messages.length, 1);
	assert.equal(result.messages[0].role, "user");
});
