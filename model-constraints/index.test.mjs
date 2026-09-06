import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import modelConstraints, {
	appendConstraintBlock,
	buildConstraintBlock,
	formatCurrentDate,
	formatInputModalities,
	loadKnowledgeCutoffs,
	modelKey,
	resolveKnowledgeCutoff,
} from "./index.ts";

const visionModel = {
	provider: "openai-codex",
	id: "gpt-5.6-sol",
	input: ["text", "image"],
	contextWindow: 272000,
};

test("formats keys and input modalities", () => {
	assert.equal(modelKey(visionModel), "openai-codex/gpt-5.6-sol");
	assert.equal(formatInputModalities(["text"]), "text only");
	assert.equal(formatInputModalities(["text", "image"]), "text and images only");
	assert.equal(formatInputModalities(["image", "text"]), "text and images only");
	assert.equal(
		formatInputModalities(["text", "image", "audio"]),
		"text, images, and audio only",
	);
	assert.equal(formatInputModalities([]), "no input modalities configured");
});

test("builds the exact constraint block with a date and visible missing-cutoff value", () => {
	const currentDate = new Date(2026, 1, 16, 23, 59, 58);
	assert.equal(formatCurrentDate(currentDate), "February 16, 2026");
	assert.equal(
		buildConstraintBlock(visionModel, "February 16, 2026", currentDate),
		[
			"# Your Architectural Constraints:",
			"",
			"* **Input**: text and images only",
			"* **Output**: text only; no native audio or video",
			"* **Context window**: 272000 tokens",
			"* **Knowledge cutoff**: February 16, 2026",
			"* **Current date**: February 16, 2026",
		].join("\n"),
	);
	assert.match(
		buildConstraintBlock(
			{ ...visionModel, id: "unknown" },
			undefined,
			currentDate,
		),
		/\* \*\*Knowledge cutoff\*\*: not configured for openai-codex\/unknown\n\* \*\*Current date\*\*: February 16, 2026$/,
	);
});

test("appends the constraint block to the system prompt", () => {
	const block = buildConstraintBlock(
		visionModel,
		"February 16, 2026",
		new Date(2026, 1, 16),
	);
	assert.equal(appendConstraintBlock("base", block), `base\n\n${block}`);
});

test("loads and validates an exact-key cutoff registry", () => {
	const bundledCutoffs = loadKnowledgeCutoffs();
	assert.equal(
		resolveKnowledgeCutoff(bundledCutoffs, "llama-server/Qwen3.8 27B"),
		"September 30, 2025",
	);

	const directory = mkdtempSync(join(tmpdir(), "model-constraints-"));
	try {
		const validPath = join(directory, "valid.json");
		writeFileSync(validPath, '{"provider/model":"A date"}', "utf8");
		const cutoffs = loadKnowledgeCutoffs(validPath);
		assert.equal(resolveKnowledgeCutoff(cutoffs, "provider/model"), "A date");
		assert.equal(resolveKnowledgeCutoff(cutoffs, "other/model"), undefined);

		const malformedPath = join(directory, "malformed.json");
		writeFileSync(malformedPath, "{", "utf8");
		assert.throws(() => loadKnowledgeCutoffs(malformedPath), /invalid JSON/);

		const invalidPath = join(directory, "invalid.json");
		writeFileSync(invalidPath, '{"no-provider-separator":"A date"}', "utf8");
		assert.throws(() => loadKnowledgeCutoffs(invalidPath), /expected an exact provider\/model-id key/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the registered hook follows the current model on every run", async () => {
	let beforeAgentStart;
	let diagnostic;
	modelConstraints({
		on(event, handler) {
			if (event === "before_agent_start") beforeAgentStart = handler;
		},
		registerCommand(name, options) {
			if (name === "model-constraints") diagnostic = options;
		},
	});
	assert.equal(typeof beforeAgentStart, "function");
	assert.equal(typeof diagnostic?.handler, "function");

	const notices = [];
	const context = {
		model: visionModel,
		ui: { notify: (message, type) => notices.push({ message, type }) },
	};
	const first = await beforeAgentStart({ systemPrompt: "base" }, context);
	assert.match(first.systemPrompt, /^base\n\n# Your Architectural Constraints:/);
	assert.match(first.systemPrompt, /Context window\*\*: 272000 tokens/);
	assert.match(first.systemPrompt, /Knowledge cutoff\*\*: February 16, 2026/);
	assert.match(first.systemPrompt, /Current date\*\*: [A-Z][a-z]+ \d{1,2}, \d{4}$/);
	assert.equal(notices.length, 0);

	context.model = {
		provider: "llama-server",
		id: "Qwen3.8 27B",
		input: ["text", "image"],
		contextWindow: 262144,
	};
	const second = await beforeAgentStart({ systemPrompt: "base" }, context);
	assert.match(second.systemPrompt, /Context window\*\*: 262144 tokens/);
	assert.match(second.systemPrompt, /Knowledge cutoff\*\*: September 30, 2025/);
	assert.equal(notices.length, 0);

	context.model = {
		provider: "test-provider",
		id: "text-model",
		input: ["text"],
		contextWindow: 4096,
	};
	const third = await beforeAgentStart({ systemPrompt: "base" }, context);
	assert.match(third.systemPrompt, /Input\*\*: text only/);
	assert.match(third.systemPrompt, /Context window\*\*: 4096 tokens/);
	assert.match(
		third.systemPrompt,
		/Knowledge cutoff\*\*: not configured for test-provider\/text-model/,
	);
	assert.equal(notices.length, 1);
	assert.equal(notices[0].type, "warning");

	await beforeAgentStart({ systemPrompt: "base" }, context);
	assert.equal(notices.length, 1, "the missing-cutoff warning is one-time");
});
