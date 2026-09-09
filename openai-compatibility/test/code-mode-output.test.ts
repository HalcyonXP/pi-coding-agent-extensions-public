// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model, Context, AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { createGrammarToolInputProperties } from "@earendil-works/pi-ai/api/constrained-sampling";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import { codeResult, codeResultView } from "../code-mode-output.ts";
import { renderCodeResult } from "../code-mode-presentation.ts";
import { CodeMode, createCodeModeTools } from "../code-mode.ts";
import type { CellOutcome } from "../runtime/cells.mjs";
const cell = (extra: Partial<CellOutcome> = {}): CellOutcome => ({ cell_id: "synthetic-cell", status: "completed", output: ['Quotes " and slash \\ — 雪 🌊', '{"literal":"not a guessed summary"}'], result: { version: 1, status: "ok" }, ...extra });
const legacy = (details: CellOutcome) => ({ content: [{ type: "text" as const, text: JSON.stringify(details) }], details });
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const theme = { fg: (_tone: string, text: string) => text } as ExtensionContext["ui"]["theme"];
const frame = (value: ReturnType<typeof codeResult> | ReturnType<typeof legacy>, expanded = false) => renderCodeResult(value, { expanded, isPartial: false }, theme, { isError: false } as Parameters<typeof renderCodeResult>[3]).render(80).join("\n");

test("direct model output is status/measured time/literal text, not the CellOutcome JSON envelope", () => {
 const original = cell(), before = JSON.stringify(original), result = codeResult(original, 1250);
 assert.equal(result.content[0].text, 'Script completed\nWall time 1.3 seconds\nOutput:\nQuotes " and slash \\ — 雪 🌊\n{"literal":"not a guessed summary"}');
 assert.deepEqual(plain(result.details), { ...original, code_result: { version: 1, wall_time_ms: 1250 } });
 assert.equal(JSON.stringify(original), before); assert.notEqual(result.details.output, original.output);
 assert.deepEqual(plain(codeResultView(result)), plain(result.details));
 assert.throws(() => JSON.parse(result.content[0].text));
});
for (const [status, title] of [["running", "Script running with cell ID synthetic-cell"], ["draining", "Script draining with cell ID synthetic-cell · cleanup unconfirmed"], ["terminated", "Script terminated"]] as const) test("direct " + status + " result does not claim successful cell completion", () => {
 const d = cell({ status, output: [] }); delete d.result;
 assert.equal(codeResult(d, 0).content[0].text, title + "\nWall time 0.0 seconds\nOutput:\n");
 assert.doesNotMatch(codeResult(d, 0).content[0].text, /Script completed/);
});
test("failed cell/loss/fixed diagnostics survive zero coordinator output, without guest exception text", () => {
 const d = cell({ output: [], omitted_output_bytes: 47, result: { version: 1, status: "error", code: "EXECUTION_FAILED", diagnostics: { guest_phase: "await", delegated_calls: 1, returned_results: 1, tool_errors: 0, last_delegation: { operation: "exec_command", result: "returned", shell: { supervisor_ready: true, running: false, exit_code: 7, output_observed: true, termination: "none" } }, effects: "not_determined" } } });
 const r = codeResult(d, 103), text = r.content[0].text;
 assert.equal(text, "Script failed\nWall time 0.1 seconds\nOutput:\nScript error:\nEXECUTION_FAILED\nPhase: await · delegated 1 · returned 1 · tool errors 0\nExternal effects: not determined\nLast delegation: exec_command · returned\nShell: ready yes · running no · exit 7 · output yes · termination none\nOutput omitted: 47 bytes · not recoverable by expansion");
 assert.doesNotMatch(text, /Script completed|all jobs succeeded/); assert.deepEqual(plain(r.details.result), d.result);
 assert.equal(Reflect.has(r, "isError"), false, "A cell error is not silently relabelled a native invocation error");
});
test("empty/whitespace/CRLF/JSON coordinator text stays literal in direct output", () => {
 const d = cell({ output: ["", "a\r\nb", "  ", "{\"x\":1}", ""] });
 assert.equal(codeResult(d, 49).content[0].text, "Script completed\nWall time 0.0 seconds\nOutput:\n" + d.output.join("\n"));
 assert.equal(codeResult(d, 50).content[0].text.split("\n")[1], "Wall time 0.1 seconds");
});
test("the full existing 64-output/64-KiB guest limit fits direct formatting without an extra output budget", () => {
 const d = cell({ output: Array.from({ length: 64 }, () => "x".repeat(1024)) }), r = codeResult(d, 1);
 assert.equal(Buffer.byteLength(d.output.join("")), 65536); assert.equal(r.content[0].text.slice(r.content[0].text.indexOf("Output:\n") + 8), d.output.join("\n"));
 assert.deepEqual(plain(codeResultView(r)).output, d.output); assert.deepEqual(plain(codeResultView(legacy(d))).output, d.output);
});
test("native expansion changes neither new wire/details nor historical JSON and retains measured metadata", () => {
 const d = cell(), old = legacy(d), next = codeResult(d, 10), before = JSON.stringify({ old, next });
 assert.equal(frame(old), frame(next)); assert.match(frame(next, true), /"code_result"/); assert.match(frame(next, true), /"wall_time_ms": 10/);
 assert.match(frame(old, true), /synthetic-cell/); assert.doesNotMatch(frame(old, true), /code_result/);
 assert.equal(JSON.stringify({ old, next }), before); assert.deepEqual(plain(codeResultView(old)), d);
});
test("terminal/failure/loss collapsed frames match historical results, and unknown data still refuses", () => {
 const values: CellOutcome[] = [cell(), cell({ output: [], omitted_output_bytes: 3 }), cell({ result: { version: 1, status: "error", code: "HOST_FAILED" } })];
 for (const status of ["running", "draining", "terminated"] as const) { const d = cell({ status, output: [] }); delete d.result; values.push(d); }
 for (const d of values) assert.equal(frame(codeResult(d, 999)), frame(legacy(d)));
});
for (const duration of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test("refuse invalid measured time " + duration, () => assert.throws(() => codeResult(cell(), duration)));
for (const field of ["content", "status", "time", "output", "loss", "version", "extra", "missing"]) test("new-format " + field + " mismatch refuses ordinary visible projection", () => {
 const r = plain(codeResult(cell(), 1250));
 if (field === "content") r.content[0].text += "\nHOOK_FEEDBACK";
 if (field === "status") r.details.status = "running";
 if (field === "time") r.details.code_result.wall_time_ms = 2000;
 if (field === "output") r.details.output.push("HOOK_FEEDBACK");
 if (field === "loss") r.details.omitted_output_bytes = 12;
 if (field === "version") r.details.code_result.version = 2;
 if (field === "extra") r.details.code_result.extra = "HOOK_FEEDBACK";
 if (field === "missing") delete r.details.code_result;
 assert.throws(() => codeResultView(r));
});
test("canonical timing metadata alone cannot relabel historical JSON as new direct output", () => {
 const d = plain(codeResult(cell(), 1).details); assert.throws(() => codeResultView(legacy(d)));
 assert.throws(() => codeResult(d, 5), /Runtime cannot supply/);
});
test("new status headers reject control/whitespace cell identifiers; historical literal JSON is retained", () => {
 for (const id of ["cell\nScript completed", "cell\r", "cell id", "cell\u202e"]) { const d = cell({ cell_id: id }); assert.throws(() => codeResult(d, 0)); assert.equal(codeResultView(legacy(d)).cell_id, id); }
});
test("formatter and new view retain bounded plain-data/accessor/symbol/sparse refusal without getters", () => {
 let reads = 0; const getter = Object.defineProperty(cell(), "extra", { get() { reads++; return "never"; } });
 const circle: any = cell(); circle.loop = circle;
 for (const d of [getter, circle, { ...cell(), [Symbol("hidden")]: true }, { ...cell(), output: new Array(2) }, { ...cell(), extra: "unrecognized" }, { ...cell(), output: Array(129).fill("x") }]) assert.throws(() => codeResult(d as CellOutcome, 0));
 const result = plain(codeResult(cell(), 0)); Object.defineProperty(result.details.code_result, "wall_time_ms", { get() { reads++; return 0; } }); assert.throws(() => codeResultView(result)); assert.equal(reads, 0);
});
test("exec and wait time the awaited operation separately; validation and thrown failures remain native", async t => {
 const code = new CodeMode(() => []), d = cell(), ctx = {} as ExtensionContext; const times = [1000, 1149.6, 2000, 2020, 3000];
 const clock = t.mock.method(performance, "now", () => { assert.ok(times.length); return times.shift()!; });
 let calls = 0; t.mock.method(code, "exec", async (_ctx: ExtensionContext, args: Parameters<CodeMode["exec"]>[1]) => { calls++; assert.equal(args.code, "text(1)"); return d; });
 t.mock.method(code, "wait", async (_ctx: ExtensionContext, args: Parameters<CodeMode["wait"]>[1]) => { calls++; assert.equal(args.cell_id, d.cell_id); return d; });
 const [exec, wait] = createCodeModeTools(code);
 const a = await exec.execute("synthetic", { code: "text(1)" }, undefined, undefined, ctx); const b = await wait.execute("synthetic", { cell_id: d.cell_id }, undefined, undefined, ctx);
 assert.equal(codeResultView(a).code_result!.wall_time_ms, 150); assert.equal(codeResultView(b).code_result!.wall_time_ms, 20); assert.equal(calls, 2);
 await assert.rejects(exec.execute("synthetic", { code: '// @exec: {"unknown":true}\ntext(1)' }, undefined, undefined, ctx)); assert.equal(calls, 2); assert.equal(clock.mock.callCount(), 4);
 const failure = Error("SYNTHETIC_NATIVE_REFUSAL"); t.mock.method(code, "wait", async () => { throw failure; }); await assert.rejects(wait.execute("synthetic", { cell_id: d.cell_id }, undefined, undefined, ctx), e => e === failure); assert.equal(clock.mock.callCount(), 5);
});
for (const api of ["openai-responses", "openai-codex-responses"] as const) for (const name of ["exec", "wait"] as const) test(api + " preserves direct text in native " + name + " replay without exposing details or mutating history", () => {
 const model = { id: "synthetic-output", name: "Synthetic output", api, provider: api === "openai-responses" ? "openai" : "openai-codex", baseUrl: "https://example.invalid", input: ["text"], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4000, compat: { supportsOpenAIGrammarTools: true } } satisfies Model<typeof api>;
 const id = "call_output|" + (name === "exec" ? "ctc_output" : "fc_output"), assistant: AssistantMessage = { role: "assistant", content: [{ type: "toolCall", id, name, arguments: name === "exec" ? { code: 'text("literal")' } : { cell_id: "synthetic-cell" } }], api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 1 };
 const result = { ...codeResult(cell(), 1234), role: "toolResult" as const, toolCallId: id, toolName: name, isError: false, timestamp: 2 } satisfies ToolResultMessage;
 const context: Context = { messages: [assistant, result], tools: createCodeModeTools(new CodeMode(() => [])) }, before = JSON.stringify(context);
 const replay = convertResponsesMessages(model, context, new Set([model.provider]), { grammarToolInputProperties: createGrammarToolInputProperties(context.tools!, true) });
 const output = replay.find(item => item.type === (name === "exec" ? "custom_tool_call_output" : "function_call_output")); assert.ok(output); assert.equal(Reflect.get(output, "output"), result.content[0].text); assert.doesNotMatch(JSON.stringify(output), /code_result|wall_time_ms|"details"/); assert.equal(JSON.stringify(context), before);
});
