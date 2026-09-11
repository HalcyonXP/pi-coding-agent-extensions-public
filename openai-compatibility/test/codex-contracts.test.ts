import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { CodeMode, createCodeModeTools } from "../code-mode.ts";
import { createUnifiedExecTools, type UnifiedExecManager } from "../unified-exec.ts";
import { VerifiedSearchCommands, validateVerifiedSearch } from "../verified-search.ts";
import { parseCodexContractFacts } from "./codex-contract-fixture.ts";

const bytes = readFileSync(new URL("./fixtures/codex-contracts.json", import.meta.url));
const facts = parseCodexContractFacts(bytes);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const noExecution = new Proxy({} as UnifiedExecManager, { get() { throw Error("Contract inspection must not execute a tool"); } });
const tools = createUnifiedExecTools(noExecution, () => { throw Error("No lease, auth or native work in schema inspection"); });
const codeTools = createCodeModeTools(new CodeMode(() => []));
const fields = (schema: { properties?: object }) => Object.keys(schema.properties ?? {}).sort();
const range = (schema: object) => [Reflect.get(schema, "minimum"), Reflect.get(schema, "maximum")];

test("Codex contract facts pin source and distinguish inspection from execution/parity", () => {
	assert.equal(facts.sourceFiles.reduce((n: number, file: { bytes: number }) => n + file.bytes, 0), 516581);
	assert.equal(facts.unified.strict, false);
	assert.equal(facts.unified.additionalProperties, false);
	assert.deepEqual(facts.unified.codeResultRequired, ["wall_time_seconds", "output"]);
	assert.deepEqual(facts.image.required, ["prompt"]);
	assert.equal(facts.image.model, "gpt-image-2");
	for (const field of ["size", "quality", "background"]) assert.equal(facts.image[field], "auto");
});

const corruptions: Record<string, (value: any) => void> = {
	"different upstream": value => { value.target.repository = "elsewhere/codex"; },
	"moving revision": value => { value.target.commit = "main"; },
	"wrong evidence basis": value => { value.basis = "upstream-executed"; },
	"blanket parity": value => { value.claimedParity = true; },
	"unknown root metadata": value => { value.authority = true; },
	"duplicate source": value => { value.sourceFiles[1] = value.sourceFiles[0]; },
	"source path traversal": value => { value.sourceFiles[0].path = "../source.rs"; },
	"invalid source digest": value => { value.sourceFiles[0].sha256 = "not-pinned"; },
	"invalid source length": value => { value.sourceFiles[0].bytes = -1; },
	"unreferenced source": value => { value.code.references.push("not-acquired.rs"); },
	"output schema confused with direct API": value => { value.unified.outputSchemaSerializedToResponses = true; },
	"direct and nested outputs conflated": value => { value.unified.codeOutput = value.unified.directOutput; },
	"Pi wrapper claimed upstream": value => { value.unified.codeResultWrappedInPiResult = true; },
	"unverified runtime called audited": value => { value.code.runtimeImplementationAudited = true; },
	"notify ordering assumed": value => { value.code.notifyOrderingAudited = true; },
	"hosted builtin mistaken for exported function": value => { value.web.hosted.functionParametersExposedByClient = true; },
	"live Web claimed": value => { value.web.hostedServiceBehaviorVerified = true; },
	"live image claimed": value => { value.image.binaryAndHostedServiceBehaviorVerified = true; },
};
for (const [name, mutate] of Object.entries(corruptions)) test(`contract fixture refuses ${name}`, () => {
	const changed = structuredClone(facts); mutate(changed);
	assert.throws(() => parseCodexContractFacts(encode(changed)));
});

test("contract fixture refuses malformed encoding and oversized input", () => {
	for (const invalid of [Buffer.from([0xff]), Buffer.from("{"), Buffer.alloc(65537, 32)]) assert.throws(() => parseCodexContractFacts(invalid));
});

test("actual Pi shell schema snapshot keeps the current explicitly bounded adaptation", () => {
	assert.deepEqual(fields(tools[0].parameters), [...facts.pi.unifiedExecFields].sort());
	assert.deepEqual(fields(tools[1].parameters), [...facts.pi.unifiedWriteFields].sort());
	assert.equal(tools[1].parameters.properties.session_id.type, facts.pi.sessionIdType);
	assert.equal(tools[0].parameters.properties.tty.const, facts.pi.tty);
	assert.deepEqual(facts.pi.yieldRangeMs, [0, 30000]); // Historical admission, not today's clamped request range.
	for (const tool of tools) assert.deepEqual(range(tool.parameters.properties.yield_time_ms), [0, Number.MAX_SAFE_INTEGER]);
	assert.deepEqual(range(tools[0].parameters.properties.max_output_tokens), facts.pi.outputTokenRange);
});

test("numeric target IDs, fractional waits and unsupported controls are not silently admitted by Pi", () => {
	assert.ok(Value.Check(tools[1].parameters, { session_id: "synthetic-owned-lookup", chars: "" }));
	assert.equal(Value.Check(tools[1].parameters, { session_id: 42 }), false);
	for (const extra of [{ tty: true }, { shell: "other-shell" }, { login: true }, { environment_id: "other" }, { sandbox_permissions: "require_escalated" }, { additional_permissions: {} }, { prefix_rule: ["synthetic"] }, { timeout_ms: 10000 }, { yield_time_ms: 1.5 }, { max_output_tokens: 0 }]) {
		assert.equal(Value.Check(tools[0].parameters, { cmd: "synthetic-not-executed", ...extra }), false);
	}
});

test("initial wait, empty poll wait and process lifetime are separate target facts", () => {
	assert.deepEqual(facts.unified.initialYield, { defaultMs: 10000, windowsMinimumMs: 10000, otherMinimumMs: 250, maximumMs: 30000 });
	assert.deepEqual(facts.unified.stdinYield, { parsedDefaultMs: 250, nonemptyMinimumMs: 250, nonemptyMaximumMs: 30000, emptyMinimumMs: 5000, emptyMaximumDefaultMs: 300000, emptyMaximumConfigurable: true });
	assert.deepEqual(facts.unified.oneShot.removes, ["tty", "yield_time_ms"]);
	assert.equal(facts.unified.oneShot.writeStdinRegistered, false);
	assert.equal(facts.unified.oneShot.timeoutDefaultMs, 10000);
});

test("omitted Unified defaults deliberately supersede the historical Pi defaults without changing the fixture", async () => {
	const calls: unknown[][] = [];
	const sample = { output: "SYNTHETIC_CONTRACT", exit_code: 0, running: false, truncated_bytes: 0 };
	const manager = { async start(...args: unknown[]) { calls.push(args); return sample; }, async write(...args: unknown[]) { calls.push(args); return sample; } } as unknown as UnifiedExecManager;
	const pair = createUnifiedExecTools(manager, () => ({ signal: new AbortController().signal, assertCurrent() {}, release() {} }));
	const ctx = { cwd: process.cwd(), sessionManager: { getSessionId: () => "synthetic-contract" } } as unknown as ExtensionContext;
	const start = await pair[0].execute("synthetic-start", { cmd: "not-executed" }, undefined, undefined, ctx);
	await pair[1].execute("synthetic-poll", { session_id: "synthetic-owned-lookup" }, undefined, undefined, ctx);
	assert.equal(calls.length, 2);
	assert.equal(facts.pi.yieldDefaultMs, 1000); assert.equal(facts.pi.outputDefaultTokens, 4096);
	assert.equal(calls[0][3], facts.unified.initialYield.defaultMs);
	assert.equal(calls[1][3], facts.unified.stdinYield.emptyMinimumMs);
	for (const call of calls) assert.equal(call[4], 10000 * 4);
	const { unified_result, ...details } = start.details as typeof sample & { unified_result: { version: number; wall_time_ms: number } };
	assert.deepEqual(details, sample);
	assert.equal(unified_result.version, 1); assert.ok(Number.isSafeInteger(unified_result.wall_time_ms) && unified_result.wall_time_ms >= 0);
	assert.match(start.content[0].text!, /^Wall time: [\d.]+ seconds\nProcess exited with code 0\nOutput:\nSYNTHETIC_CONTRACT$/);
	assert.notEqual(start.content[0].text, JSON.stringify(sample));
});

test("native custom Code input deliberately supersedes the retained PR18 JSON baseline", () => {
	const exec = codeTools.find(tool => tool.name === "exec")!, wait = codeTools.find(tool => tool.name === "wait")!;
	// The audited fixture remains a historical source snapshot, not rewritten history.
	assert.deepEqual([...facts.pi.codeExecFields].sort(), ["code", "max_output_tokens", "yield_time_ms"]);
	assert.deepEqual(fields(exec.parameters), ["code"]);
	assert.equal(exec.constrainedSampling && exec.constrainedSampling.type, "grammar");
	assert.deepEqual(fields(wait.parameters), [...facts.pi.codeWaitFields].sort());
	assert.ok(Value.Check(exec.parameters, { code: "text('synthetic')" }));
	assert.equal(Value.Check(exec.parameters, "text('synthetic')"), false);
	assert.deepEqual(facts.code.pragmaProperties, ["yield_time_ms", "max_output_tokens"]);
	assert.equal(typeof exec.renderResult, "function");
});

test("normal Pi Web profile remains a declared subset, not a hosted or full standalone schema", () => {
	assert.deepEqual(fields(VerifiedSearchCommands), [...facts.pi.verifiedWebFields].sort());
	assert.ok(facts.web.standalone.properties.includes("click"));
	assert.ok(facts.web.standalone.properties.includes("image_query"));
	assert.equal(facts.web.standalone.namespace, "web");
	assert.equal(facts.web.standalone.name, "run");
	assert.deepEqual(validateVerifiedSearch({ search_query: [{ q: "synthetic query" }] }), { search_query: [{ q: "synthetic query" }], response_length: "short" });
	for (const value of [{ click: [{ ref_id: "synthetic", id: 1 }] }, { find: [{ ref_id: "https://example.com/", pattern: "synthetic" }] }, { search_query: [{ q: "one" }, { q: "two" }] }]) assert.throws(() => validateVerifiedSearch(value));
});
