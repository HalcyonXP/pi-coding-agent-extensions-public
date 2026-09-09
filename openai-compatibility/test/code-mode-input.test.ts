// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, Context, ToolResultMessage } from "@earendil-works/pi-ai";
import { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
import { convertResponsesTools, convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { stream as codexStream } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { CODE_GRAMMAR, CODE_CONSTRAINED_SAMPLING, prepareCodeArguments, supportsNativeCodeInput } from "../code-mode-input.ts";
import { CodeMode, createCodeModeTools } from "../code-mode.ts";
import { execInput } from "../runtime/cell-input.mjs";

const tools = createCodeModeTools(new CodeMode(() => []));
const exec = tools[0];
const ordinary = { name: "ordinary", description: "Synthetic ordinary tool", parameters: Type.Object({ path: Type.String() }) };
const model = {
	id: "synthetic-native-contract", name: "Synthetic native contract", provider: "openai-codex", api: "openai-codex-responses",
	baseUrl: "https://chatgpt.com/backend-api", input: ["text"], reasoning: false,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4000,
	compat: { supportsOpenAIGrammarTools: true },
} satisfies Model<"openai-codex-responses">;
const context = (value: unknown) => ({ model: value }) as ExtensionContext;
const source = '// @exec: {"yield_time_ms":0,"max_output_tokens":64}\r\ntext("quote: \\\"; slash: \\\\; 雪 🌊");\n';

test("native custom declaration carries grammar, not JSON/output schema; wait and ordinary tools stay functions", () => {
	const definitions = convertResponsesTools([...tools, ordinary], { strict: null, supportsOpenAIGrammarTools: true });
	assert.deepEqual(definitions[0], { type: "custom", name: "exec", description: exec.description, format: { type: "grammar", syntax: "lark", definition: CODE_GRAMMAR } });
	for (const tool of definitions.slice(1)) assert.equal(tool.type, "function");
	assert.equal(JSON.stringify(definitions).includes("output_schema"), false);
	assert.deepEqual([...createGrammarToolInputProperties(tools, true)], [["exec", "code"]]);
	assert.deepEqual(Object.keys(Reflect.get(exec.parameters, "properties")), ["code"]);
	assert.equal(Value.Check(exec.parameters, source), false, "Raw wire text is mapped by native Pi, not passed unvalidated to execute");
	assert.deepEqual(exec.prepareArguments?.({ code: source }), { code: source });
});

test("grammar metadata is private to each factory and cannot mutate the shared template", () => {
	const first = createCodeModeTools(new CodeMode(() => []))[0].constrainedSampling;
	assert.ok(first && first.type === "grammar"); first.variants.openai_lark = "changed fixture";
	const second = createCodeModeTools(new CodeMode(() => []))[0].constrainedSampling;
	assert.ok(second && second.type === "grammar"); assert.equal(second.variants.openai_lark, CODE_GRAMMAR);
	assert.equal(Object.isFrozen(CODE_CONSTRAINED_SAMPLING), true);
	assert.equal(Object.isFrozen(CODE_CONSTRAINED_SAMPLING.variants), true);
});

test("raw source and bounded pragma survive native preparation without mutation or option flattening", () => {
	const original = Object.freeze({ code: source });
	assert.deepEqual(prepareCodeArguments(original), original);
	assert.equal(prepareCodeArguments(original).code, source);
	assert.deepEqual(execInput(source), { code: source.slice(source.indexOf("\n") + 1), yieldMs: 0, tokens: 64 });
	assert.deepEqual(execInput("text(1)"), { code: "text(1)", yieldMs: 10000, tokens: 10000 });
	assert.deepEqual(execInput("text(1)", { yield_time_ms: 1, max_output_tokens: 0 }), { code: "text(1)", yieldMs: 1, tokens: 0 }, "Internal runtime API is distinct from the model/RPC contract");
});

for (const [name, input] of Object.entries({
	"legacy top-level yield": { code: "text(1)", yield_time_ms: 0 },
	"legacy top-level output": { code: "text(1)", max_output_tokens: 1 },
	"explicit undefined extra": { code: "text(1)", yield_time_ms: undefined },
	"forged authority": { code: "text(1)", tools: {} },
	"raw internal string": "text(1)", "array": ["text(1)"], "missing": {}, "null": null,
	"numeric source": { code: 3 }, "empty source": { code: "" }, "blank source": { code: " \r\n" },
	"UTF-8 overflow": { code: "雪".repeat(22000) },
	"prototype": Object.assign(Object.create({ hidden: true }), { code: "text(1)" }),
	"symbol": { code: "text(1)", [Symbol("authority")]: true },
	"pragma-only": { code: '// @exec: {"yield_time_ms":1}' },
	"unknown pragma": { code: '// @exec: {"sandbox":true}\ntext(1)' },
	"fractional yield": { code: '// @exec: {"yield_time_ms":0.5}\ntext(1)' },
	"negative yield": { code: '// @exec: {"yield_time_ms":-1}\ntext(1)' },
	"enlarged yield": { code: '// @exec: {"yield_time_ms":30001}\ntext(1)' },
	"enlarged output": { code: '// @exec: {"max_output_tokens":16385}\ntext(1)' },
	"null output": { code: '// @exec: {"max_output_tokens":null}\ntext(1)' },
	"malformed pragma": { code: "// @exec: {\ntext(1)" },
})) test(`native Code preparation refuses ${name} before runtime admission`, () => {
	assert.throws(() => prepareCodeArguments(input));
});

test("preparation never invokes source accessors; ordinary malformed JS still reaches the restricted compiler", () => {
	let reads = 0;
	assert.throws(() => prepareCodeArguments({ get code() { reads++; return "text(1)"; } }));
	assert.equal(reads, 0);
	assert.deepEqual(prepareCodeArguments({ code: "const = 1" }), { code: "const = 1" });
	assert.equal(prepareCodeArguments(Object.assign(Object.create(null), { code: "text(1)" })).code, "text(1)");
});

for (const [name, unsupported] of Object.entries({
	absent: undefined, missing: { api: "openai-codex-responses" },
	false: { api: "openai-codex-responses", compat: { supportsOpenAIGrammarTools: false } },
	untrustedFlag: { api: "openai-codex-responses", compat: { supportsOpenAIGrammarTools: "true" } },
	otherApi: { api: "openai-completions", compat: { supportsOpenAIGrammarTools: true } },
})) test(`unsupported native grammar capability (${name}) fails before inspecting runtime`, async () => {
	let checks = 0;
	const code = new CodeMode(() => [], async () => { checks++; throw Error("No runtime work"); });
	const ctx = { ...context(unsupported), toolGatewayInfo: { version: 1, protectedResults: true, activeScopes: 0, drainingScopes: 0, maxScopes: 2 } } as unknown as ExtensionContext;
	assert.equal(supportsNativeCodeInput(ctx), false);
	assert.equal((await code.status(ctx)).reason, "NATIVE_CODE_GRAMMAR_REQUIRED");
	assert.equal(checks, 0);
});

test("both native Responses APIs support custom input without changing the selected model", () => {
	assert.equal(supportsNativeCodeInput(context(model)), true);
	assert.equal(supportsNativeCodeInput(context({ ...model, api: "openai-responses" })), true);
});

test("actual native Codex SSE parser and replay preserve raw input, correlation and custom outputs", async () => {
	const item = { type: "custom_tool_call", id: "ctc_native_contract", call_id: "call_native_contract", name: "exec", input: source, status: "completed" };
	const events = [
		{ type: "response.output_item.added", output_index: 0, item: { ...item, input: "", status: "in_progress" } },
		...Array.from({ length: source.length }, (_, n) => ({ type: "response.custom_tool_call_input.delta", output_index: 0, delta: source[n] })),
		{ type: "response.custom_tool_call_input.done", output_index: 0, input: source },
		{ type: "response.output_item.done", output_index: 0, item },
		{ type: "response.completed", response: { id: "resp_native_contract", status: "completed", output: [item] } },
	];
	const token = `synthetic.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-native" } })).toString("base64url")}.synthetic`;
	const ctx: Context = { messages: [{ role: "user", content: "Synthetic Code request", timestamp: 0 }], tools: [...tools, ordinary] };
	let requests = 0, payload: any;
	const stream = codexStream(model, ctx, { apiKey: token, transport: "sse", maxRetries: 0, cacheRetention: "none", onPayload(body) { payload = structuredClone(body); }, fetch: async (url, init) => {
		requests++;
		assert.equal(String(url), "https://chatgpt.com/backend-api/codex/responses");
		assert.equal(init?.method, "POST");
		const bytes = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(""));
		let offset = 0;
		return new Response(new ReadableStream({ pull(controller) { if (offset === bytes.length) { controller.close(); return; } controller.enqueue(bytes.slice(offset, offset += Math.min(13, bytes.length - offset))); } }), { headers: { "content-type": "text/event-stream" } });
	} });
	const deltas = [];
	for await (const event of stream) if (event.type === "toolcall_delta") deltas.push(event.delta);
	const message = await stream.result();
	assert.equal(message.stopReason, "toolUse", message.errorMessage);
	assert.equal(requests, 1);
	assert.equal(payload.tools[0].type, "custom");
	assert.equal(payload.tools[1].type, "function");
	const call = message.content.find(part => part.type === "toolCall")!;
	assert.deepEqual(call.arguments, { code: source });
	assert.equal(call.id, "call_native_contract|ctc_native_contract");
	assert.ok(deltas.length > 1);
	assert.deepEqual(JSON.parse(deltas.join("")), { code: source });
	const result: ToolResultMessage = { role: "toolResult", toolCallId: call.id, toolName: "exec", content: [{ type: "text", text: "synthetic unchanged native result" }], isError: false, timestamp: 1 };
	const history = { ...ctx, messages: [...ctx.messages, message, result] };
	const before = JSON.stringify(history);
	const replay = convertResponsesMessages(model, history, new Set(["openai-codex"]), { grammarToolInputProperties: createGrammarToolInputProperties(tools, true) });
	assert.deepEqual(replay.find(value => value.type === "custom_tool_call"), { type: "custom_tool_call", id: item.id, call_id: item.call_id, name: "exec", input: source });
	assert.deepEqual(replay.find(value => value.type === "custom_tool_call_output"), { type: "custom_tool_call_output", call_id: item.call_id, output: "synthetic unchanged native result" });
	assert.equal(JSON.stringify(history), before);
});
