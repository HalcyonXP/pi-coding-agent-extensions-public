import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Context, Model, ToolResultMessage } from "@earendil-works/pi-ai";
import { convertResponsesMessages } from "@earendil-works/pi-ai/api/openai-responses-shared";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createUnifiedExecTools, type ExecResult, type UnifiedExecManager } from "../unified-exec.ts";
import { directUnifiedResult } from "../unified-exec-output.ts";

const sample = (extra: Partial<ExecResult> = {}): ExecResult => ({ output: '  "literal" \\ 雪 🌊\r\n{"literal":"not a summary"}\n', exit_code: 0, running: false, truncated_bytes: 0, ...extra });
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const context = () => ({ cwd: process.cwd(), sessionManager: { getSessionId: () => "synthetic-unified" } }) as unknown as ExtensionContext;
const lease = () => ({ signal: new AbortController().signal, assertCurrent() {}, release() {} });

test("direct Unified output is literal text, preserves all structured data and adds measured metadata without mutating history", () => {
 const value = sample(), saved = structuredClone(value), result = directUnifiedResult(value, 1250);
 assert.equal(result.content[0].text, 'Wall time: 1.2500 seconds\nProcess exited with code 0\nOutput:\n' + value.output);
 assert.deepEqual(result.details, { ...saved, unified_result: { version: 1, wall_time_ms: 1250 } });
 assert.notEqual(result.details, value); assert.deepEqual(value, saved); assert.equal(result.isError, false);
 assert.throws(() => JSON.parse(result.content[0].text)); assert.doesNotMatch(result.content[0].text, /truncated_bytes|unified_result|wall_time_ms|"details"/);
});

test("running startup remains unconfirmed; readiness never implies command success", () => {
 const r = directUnifiedResult(sample({ session_id: 1701, running: true, exit_code: null, supervisor_ready: false, output: "" }), 0);
 assert.equal(r.content[0].text, 'Wall time: 0.0000 seconds\nProcess running with session ID 1701\nSupervisor preamble: not confirmed\nOutput:\n');
 assert.doesNotMatch(r.content[0].text, /exited|success|completed/);
});
test("an exited retained ID denotes remaining output, not a running process or new authority", () => {
 const r = directUnifiedResult(sample({ session_id: 1702, exit_code: 7, supervisor_ready: true }), 214);
 assert.match(r.content[0].text, /^Wall time: 0\.2140 seconds\nProcess exited with code 7\nMore output available with session ID 1702\nSupervisor preamble: received\nOutput:/);
 assert.doesNotMatch(r.content[0].text, /Process running|success/); assert.equal(r.isError, false);
});
test("unknown exit, failed startup and loss remain prominent even with no returned output", () => {
 const r = directUnifiedResult(sample({ output: "", exit_code: null, supervisor_ready: false, termination: "Native shell could not start.", truncated_bytes: 47 }), 10);
 assert.equal(r.content[0].text, 'Wall time: 0.0100 seconds\nProcess stopped; exit code unavailable\nSupervisor preamble: not confirmed\nTermination: Native shell could not start.\nOutput omitted: 47 bytes · not recoverable by polling or expansion\nOutput:\n');
});
test("an unconfirmed OS termination still reports the physically running process", () => {
 const r = directUnifiedResult(sample({ session_id: 1703, running: true, exit_code: null, termination: "OS process termination was not confirmed; further launches are blocked after reset." }), 2000);
 assert.match(r.content[0].text, /Process running with session ID 1703/); assert.match(r.content[0].text, /Termination: OS process termination was not confirmed/);
 assert.doesNotMatch(r.content[0].text, /Process stopped|Process exited/);
});
test("full 64 KiB returned text is not shortened or heuristically interpreted by the formatter", () => {
 const output = 'x'.repeat(65536), r = directUnifiedResult(sample({ output }), 1);
 assert.equal(r.content[0].text.split('Output:\n')[1], output); assert.equal(r.details.output, output);
 assert.doesNotMatch(r.content[0].text, /omitted/);
});
test("ordinary optional undefined fields stay harmless on copied direct details; null prototypes are accepted", () => {
 const value = Object.assign(Object.create(null), sample(), { session_id: undefined, termination: undefined, supervisor_ready: undefined });
 assert.deepEqual(plain(directUnifiedResult(value, 1).details), { ...sample(), unified_result: { version: 1, wall_time_ms: 1 } });
 assert.ok(Object.hasOwn(value, 'termination')); assert.equal(Object.getPrototypeOf(value), null);
});
for (const ms of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid measured time ${ms} is refused, not clamped`, () => assert.throws(() => directUnifiedResult(sample(), ms), /timing required/));
for (const [name, alter] of Object.entries({
 'missing required field': (v: any) => { delete v.output; },
 'fractional loss': (v: any) => { v.truncated_bytes = 0.5; },
 'negative loss': (v: any) => { v.truncated_bytes = -1; },
 'unbounded loss': (v: any) => { v.truncated_bytes = Infinity; },
 'fractional exit': (v: any) => { v.exit_code = 0.1; },
 'missing running ID': (v: any) => { v.running = true; v.exit_code = null; },
 'contradictory running exit': (v: any) => { v.running = true; v.session_id = 1706; v.exit_code = 7; },
 'legacy string ID': (v: any) => { v.session_id = '123'; },
 'ID header injection': (v: any) => { v.session_id = 'fake\nProcess exited'; },
 'unknown readiness': (v: any) => { v.supervisor_ready = null; },
 'termination header injection': (v: any) => { v.termination = 'fake\nOutput:'; },
 'oversized data': (v: any) => { v.output = 'x'.repeat(1024 * 1024 + 1); },
 'nontext data': (v: any) => { v.output = ['invented']; },
 'extra field': (v: any) => { v.extra = true; },
 'runtime supplied timing': (v: any) => { v.unified_result = { version: 1, wall_time_ms: 0 }; },
 'protected completion shape': (v: any) => { v.output_remaining_bytes = 2; },
 'symbol': (v: any) => { v[Symbol('extra')] = true; },
 'inherited object': (v: any) => { Object.setPrototypeOf(v, { output: 'inherited' }); },
})) test(name + ' cannot masquerade as a direct Unified result', () => { const value = sample(); alter(value); assert.throws(() => directUnifiedResult(value, 0)); });
test("formatter refuses required and optional accessors without invoking them", () => {
 for (const key of ['output', 'session_id', 'termination']) { let reads = 0; const value = sample(); Object.defineProperty(value, key, { get() { reads++; return 'untrusted'; } }); assert.throws(() => directUnifiedResult(value, 1)); assert.equal(reads, 0); }
});

test("factory measures each awaited direct manager call; native failures, arguments and leases stay native", async t => {
 const calls: unknown[][] = [], values = [sample({ session_id: 1701, running: true, exit_code: null }), sample()]; let releases = 0;
 const manager = { async start(...args: unknown[]) { calls.push(args); return values[0]; }, async write(...args: unknown[]) { calls.push(args); return values[1]; } } as unknown as UnifiedExecManager;
 const times = [1000, 1149.6, 2000, 2000.1, 3000], clock = t.mock.method(performance, 'now', () => { assert.ok(times.length); return times.shift()!; });
 const tools = createUnifiedExecTools(manager, () => ({ ...lease(), release() { releases++; } }));
 const a = await tools[0].execute('synthetic-start', { cmd: 'not executed', yield_time_ms: 1, max_output_tokens: 12 }, undefined, undefined, context());
 const b = await tools[1].execute('synthetic-write', { session_id: 1701, chars: 'input', yield_time_ms: 2, max_output_tokens: 13 }, undefined, undefined, context());
 assert.deepEqual(Reflect.get(a.details, 'unified_result'), { version: 1, wall_time_ms: 150 }); assert.deepEqual(Reflect.get(b.details, 'unified_result'), { version: 1, wall_time_ms: 0 });
 assert.deepEqual(calls.map(c => c.slice(1, 5)), [['not executed', process.cwd(), process.platform === 'win32' ? 10000 : 250, 48], [1701, 'input', 250, 52]]); assert.equal(releases, 2); assert.equal(clock.mock.callCount(), 4);
 const error = Error('SYNTHETIC_NATIVE_FAILURE'); t.mock.method(manager, 'write', async () => { throw error; });
 await assert.rejects(tools[1].execute('bad', { session_id: 1705 }, undefined, undefined, context()), e => e === error); assert.equal(clock.mock.callCount(), 5); assert.equal(releases, 3);
});
test("genuine-invocation-shaped nested scope keeps JSON/details and does not measure or publish direct output", async t => {
 const value = sample({ session_id: undefined, supervisor_ready: undefined, termination: undefined }), calls: unknown[][] = [];
 const manager = { async start(...args: unknown[]) { calls.push(args); return value; }, async write(...args: unknown[]) { calls.push(args); return value; } } as unknown as UnifiedExecManager;
 const scope = { id: 'synthetic-owning-scope', signal: new AbortController().signal, ownResource() { return () => {}; } };
 const ctx = { ...context(), tools: { origin: 'nested', scope, contextSignal: new AbortController().signal, openScope() { throw Error('Must not open a direct scope'); } } } as unknown as ExtensionContext;
 const tools = createUnifiedExecTools(manager, lease), clock = t.mock.method(performance, 'now', () => { throw Error('Nested timing changed'); });
 const a = await tools[0].execute('start', { cmd: 'not executed' }, undefined, undefined, ctx), b = await tools[1].execute('poll', { session_id: 1704 }, undefined, undefined, ctx);
 for (const r of [a, b]) { assert.equal(r.content[0].text, JSON.stringify(value)); assert.equal(r.details, value); assert.equal(r.isError, false); assert.equal(Object.hasOwn(r.details, 'unified_result'), false); }
 assert.equal(Reflect.get(calls[0][6] as object, 'scope'), scope); assert.equal(Reflect.get(calls[1][6] as object, 'scope'), scope); assert.equal(clock.mock.callCount(), 0);
});
test("invalid or revoked native ownership refuses before manager or timing; guest data cannot choose direct formatting", async t => {
 const tools = createUnifiedExecTools({ async start() { throw Error('Must not execute'); }, async write() { throw Error('Must not execute'); } } as unknown as UnifiedExecManager, lease);
 const clock = t.mock.method(performance, 'now', () => { throw Error('Must not measure'); });
 const aborted = new AbortController(); aborted.abort(Error('synthetic context revoked'));
 for (const toolsContext of [{ origin: 'nested', contextSignal: new AbortController().signal }, { origin: 'invented', contextSignal: new AbortController().signal }, { origin: 'direct', contextSignal: aborted.signal }]) {
  const ctx = { ...context(), tools: toolsContext } as unknown as ExtensionContext;
  await assert.rejects(tools[0].execute('start', { cmd: 'not executed' }, undefined, undefined, ctx), /scope|metadata|revoked/);
  await assert.rejects(tools[1].execute('poll', { session_id: 1706 }, undefined, undefined, ctx), /scope|metadata|revoked/);
 }
 assert.equal(clock.mock.callCount(), 0);
});
for (const api of ['openai-responses', 'openai-codex-responses'] as const) for (const name of ['exec_command', 'write_stdin'] as const) test(api + ' replays native ' + name + ' text without details or history mutation', () => {
 const model = { id: 'synthetic-unified-output', name: 'Synthetic output', api, provider: api === 'openai-responses' ? 'openai' : 'openai-codex', baseUrl: 'https://example.invalid', input: ['text'], reasoning: false, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4000 } satisfies Model<typeof api>;
 const id = 'call_unified|fc_unified', assistant: AssistantMessage = { role: 'assistant', content: [{ type: 'toolCall', id, name, arguments: name === 'exec_command' ? { cmd: 'not executed' } : { session_id: 1706 } }], api, provider: model.provider, model: model.id, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: 1 };
 const result = { ...directUnifiedResult(sample(), 1234), role: 'toolResult' as const, toolCallId: id, toolName: name, timestamp: 2 } satisfies ToolResultMessage;
 const ctx: Context = { messages: [assistant, result] }, saved = JSON.stringify(ctx), replay = convertResponsesMessages(model, ctx, new Set([model.provider]));
 const output = replay.find(item => item.type === 'function_call_output'); assert.ok(output); assert.equal(Reflect.get(output, 'output'), result.content[0].text); assert.doesNotMatch(JSON.stringify(output), /unified_result|wall_time_ms|"details"/); assert.equal(JSON.stringify(ctx), saved);
});
