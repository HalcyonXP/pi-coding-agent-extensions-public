import assert from "node:assert/strict";
import test from "node:test";

import {
	countObservableCharacters,
	formatRate,
	selectDisplayMeasurement,
	ThroughputTracker,
} from "./core.ts";

function assistant({
	text = "",
	thinking = "",
	output = 0,
	reasoning,
	stopReason = "stop",
} = {}) {
	const content = [];
	if (thinking) content.push({ type: "thinking", thinking });
	if (text) content.push({ type: "text", text });
	return { role: "assistant", content, usage: { output, reasoning }, stopReason };
}

test("counts observable text, thinking, and tool-call output", () => {
	const message = {
		role: "assistant",
		content: [
			{ type: "text", text: "hello" },
			{ type: "thinking", thinking: "plan" },
			{ type: "toolCall", name: "read", arguments: { path: "a" } },
		],
	};
	assert.equal(
		countObservableCharacters(message),
		5 + 4 + 4 + JSON.stringify({ path: "a" }).length,
	);
	assert.equal(countObservableCharacters({ role: "user", content: [] }), 0);
});

test("always reports zero outside an active measurable stream", () => {
	const tracker = new ThroughputTracker();
	assert.deepEqual(tracker.snapshot(0), {
		phase: "idle",
		tokensPerSecond: 0,
		estimatedTokens: 0,
		source: "idle",
		hasObservableOutput: false,
		hasObservedThinking: false,
	});

	tracker.beginTurn(10);
	assert.equal(tracker.snapshot(20).tokensPerSecond, 0);
	tracker.beginStream(assistant(), 30);
	assert.equal(tracker.snapshot(40).tokensPerSecond, 0);
});

test("calculates live estimated throughput from streamed deltas", () => {
	const tracker = new ThroughputTracker({ rollingWindowMs: 3_000 });
	tracker.beginTurn(0);
	tracker.beginStream(assistant(), 500);
	tracker.observe(
		{ type: "text_delta", delta: "x".repeat(40) },
		assistant({ text: "x".repeat(40) }),
		1_000,
	);

	const live = tracker.snapshot(2_000);
	assert.equal(live.phase, "streaming");
	assert.equal(live.source, "observed");
	assert.equal(live.estimatedTokens, 10);
	assert.equal(live.hasObservableOutput, true);
	assert.ok(Math.abs(live.tokensPerSecond - 10 / 1.5) < 1e-9);
});

test("the default 500ms window responds quickly and reaches zero on a stall", () => {
	const tracker = new ThroughputTracker();
	tracker.beginTurn(0);
	tracker.beginStream(assistant(), 0);
	tracker.observe(
		{ type: "text_delta", delta: "x".repeat(40) },
		assistant({ text: "x".repeat(40) }),
		100,
	);

	assert.equal(tracker.snapshot(200).tokensPerSecond, 50);
	assert.ok(tracker.snapshot(599).tokensPerSecond > 0);
	assert.equal(tracker.snapshot(600).tokensPerSecond, 0);

	tracker.observe(
		{ type: "text_delta", delta: "x".repeat(40) },
		assistant({ text: "x".repeat(80) }),
		650,
	);
	assert.equal(tracker.snapshot(700).tokensPerSecond, 20);
});

test("reconciles delta counts with cumulative partial messages", () => {
	const tracker = new ThroughputTracker();
	tracker.beginTurn(0);
	tracker.beginStream(assistant(), 0);
	tracker.observe(
		{ type: "text_delta", delta: "abcd" },
		assistant({ text: "abcdefgh" }),
		100,
	);

	const snapshot = tracker.snapshot(200);
	assert.equal(snapshot.estimatedTokens, 2);
	assert.equal(snapshot.tokensPerSecond, 10);
});

test("prefers incremental provider output counters when available", () => {
	const tracker = new ThroughputTracker();
	tracker.beginTurn(0);
	tracker.beginStream(assistant(), 0);
	tracker.observe(
		{ type: "text_delta", delta: "abcd" },
		assistant({ text: "abcd", output: 20 }),
		100,
	);

	const snapshot = tracker.snapshot(200);
	assert.equal(snapshot.source, "provider");
	assert.equal(snapshot.tokensPerSecond, 100);
	assert.equal(snapshot.estimatedTokens, 1);
});

test("detects open thinking and returns reasoning timing telemetry", () => {
	const tracker = new ThroughputTracker();
	tracker.beginTurn(0);
	tracker.beginStream(assistant(), 0);
	tracker.observe(
		{ type: "thinking_delta", delta: "r".repeat(40) },
		assistant({ thinking: "r".repeat(40) }),
		100,
	);
	assert.equal(tracker.snapshot(200).hasObservedThinking, true);

	tracker.observe(
		{ type: "text_delta", delta: "answer" },
		assistant({ thinking: "r".repeat(40), text: "answer" }),
		500,
	);
	const telemetry = tracker.finish(
		assistant({ thinking: "r".repeat(40), text: "answer", reasoning: 12 }),
		800,
	);
	assert.deepEqual(telemetry, {
		reasoningTokens: 12,
		reasoningDurationMs: 500,
		estimatedThinkingTokens: 10,
		observedThinking: true,
	});
});

test("measures a hidden reasoning interval from stream start to first answer", () => {
	const tracker = new ThroughputTracker();
	tracker.beginTurn(0);
	tracker.beginStream(assistant(), 100);
	tracker.observe(
		{ type: "text_delta", delta: "answer" },
		assistant({ text: "answer" }),
		1_100,
	);
	const telemetry = tracker.finish(assistant({ text: "answer", reasoning: 80 }), 1_500);
	assert.deepEqual(telemetry, {
		reasoningTokens: 80,
		reasoningDurationMs: 1_000,
		estimatedThinkingTokens: 0,
		observedThinking: false,
	});
});

test("automatically switches inference off when real stream data appears", () => {
	const hidden = {
		phase: "streaming",
		tokensPerSecond: 0,
		estimatedTokens: 0,
		source: "observed",
		hasObservableOutput: false,
		hasObservedThinking: false,
	};
	assert.deepEqual(selectDisplayMeasurement(hidden, 42), { rate: 42, source: "inferred" });
	assert.deepEqual(selectDisplayMeasurement(hidden, 42, false), { rate: 0, source: "observed" });

	const openThinking = {
		...hidden,
		tokensPerSecond: 17,
		estimatedTokens: 4,
		hasObservableOutput: true,
		hasObservedThinking: true,
	};
	assert.deepEqual(selectDisplayMeasurement(openThinking, 42), { rate: 17, source: "observed" });

	const provider = { ...hidden, tokensPerSecond: 25, source: "provider" };
	assert.deepEqual(selectDisplayMeasurement(provider, 42), { rate: 25, source: "provider" });
});

test("completion, abort, and error immediately return to zero", () => {
	for (const stopReason of ["stop", "aborted", "error"]) {
		const tracker = new ThroughputTracker();
		tracker.beginTurn(0);
		tracker.beginStream(assistant(), 0);
		tracker.observe(
			{ type: "text_delta", delta: "x".repeat(40) },
			assistant({ text: "x".repeat(40) }),
			100,
		);
		tracker.finish(assistant({ text: "x".repeat(40), stopReason }), 200);

		const snapshot = tracker.snapshot(200);
		assert.equal(snapshot.phase, stopReason === "stop" ? "complete" : stopReason);
		assert.equal(snapshot.tokensPerSecond, 0);
		assert.equal(snapshot.source, "idle");
	}
});

test("a turn ending without an assistant response returns to zero", () => {
	const tracker = new ThroughputTracker();
	tracker.beginTurn(0);
	tracker.endWithoutResponse(100);
	assert.equal(tracker.snapshot(100).phase, "error");
	assert.equal(tracker.snapshot(100).tokensPerSecond, 0);
});

test("formats all rates with one decimal and invalid rates as zero", () => {
	assert.equal(formatRate(0), "0.0");
	assert.equal(formatRate(9.94), "9.9");
	assert.equal(formatRate(123.4), "123.4");
	assert.equal(formatRate(Number.NaN), "0.0");
	assert.equal(formatRate(-1), "0.0");
});
