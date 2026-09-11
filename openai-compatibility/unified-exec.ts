import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { allocateSessionId, isSessionId, MAX_SESSION_ID } from "./unified-session-id.ts";
import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { CapabilityLease } from "./capability-policy.ts";
import { Utf8OutputBuffer } from "./utf8-output.ts";
import { verifiedExecutable } from "./runtime/native/artifact.mjs";
import { completionEvidence } from "./unified-completion.ts";
import { directUnifiedResult } from "./unified-exec-output.ts";
import { resultJSON } from "./runtime/rpc-protocol.mjs";
import { initialWaitMs, stdinWaitMs, backgroundWaitMs, MAX_EXEC_WAIT_MS, MAX_BACKGROUND_WAIT_MS } from "./unified-wait.ts";

const MAX_PROCESSES = 4;
const MAX_RETAINED = 8;
const MAX_INPUT = 64 * 1024;
const MAX_LIFETIME = 10 * 60_000;
const IDLE_TIMEOUT = 5 * 60_000;
const DEFAULT_OUTPUT_TOKENS = 10_000;
export interface Launch { executable: string; args: string[]; supervised?: boolean }

async function shellHelper(): Promise<string> {
	if (process.arch !== "x64") throw new Error("Windows Unified exec requires x64 and the verified prebuilt helper.");
	try { return await verifiedExecutable(); }
	catch { throw new Error("Windows Unified exec requires the verified prebuilt helper. No invocation-time compiler or fallback."); }
}
/** Passive artifact inspection, not process launch, native authority or command readiness. */
export async function nativeShellStatus(): Promise<{ available: boolean; reason?: string }> {
	if (process.platform !== "win32") return { available: true };
	try { await shellHelper(); return { available: true }; }
	catch { return { available: false, reason: "Verified prebuilt Windows x64 helper required; no compiler or fallback." }; }
}
export async function nativeShell(command: string): Promise<Launch> {
	if (process.platform !== "win32") return { executable: "/bin/sh", args: ["-c", command] };
	const pwsh = path.join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe");
	const shell = existsSync(pwsh) ? pwsh : path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	const encoded = Buffer.from(command).toString("base64");
	if (encoded.length > 24_000) throw new Error("Command exceeds the Windows launch budget; use an existing script file for larger commands.");
	return { executable: shell, supervised: true, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-File", fileURLToPath(new URL("./native/windows-job.ps1", import.meta.url)), "-ParentProcessId", String(process.pid), "-VerifiedHelperPath", await shellHelper(), "-CommandBase64", encoded] };
}

export interface NativeJobScope {
	readonly id: string; readonly signal: AbortSignal;
	ownResource(close: () => Promise<void>): () => void;
}
interface JobAccess { scope?: NativeJobScope; context?: AbortSignal }
export interface NativeCompletion extends ExecResult {
	running: false;
	session_id: number;
	output_remaining_bytes: number;
}
export interface NativeJobBinding extends JobAccess {
	resource: NativeJobScope;
	finish?: () => Promise<void>;
	/** Genuine direct-scope publication, never a retained handler update callback. */
	publishCompletion?: (completion: NativeCompletion) => Promise<void>;
}
interface ProcessRecord {
	access?: JobAccess;
	id: number;
	owner: string;
	child: ChildProcessWithoutNullStreams;
	output: Utf8OutputBuffer;
	exitCode: number | null;
	termination?: string;
	closed: boolean;
	ready: boolean;
	supervised: boolean;
	revoked?: boolean;
	revocation: AbortController;
	created: number;
	touched: number;
	done: Promise<void>;
	settled?: Promise<void>;
	completionFailed?: boolean;
	returned?: boolean;
	stop?: Promise<void>;
	stopSettled?: boolean;
}
export interface ExecResult {
	session_id?: number;
	output: string;
	exit_code: number | null;
	running: boolean;
	/** Private supervisor preamble seen; not acknowledgement receipt or user-command success. */
	supervisor_ready?: boolean;
	truncated_bytes: number;
	termination?: string;
}

function cleanOutput(output: string): string {
	return output.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g, "")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

/** Pipe-backed process ownership, not a security sandbox or PTY. No detached session survives a reset. */
export class UnifiedExecManager {
	private processes = new Map<number, ProcessRecord>();
	private sweep: NodeJS.Timeout | undefined;
	private generation = 0;
	private launch: (command: string) => Launch | Promise<Launch>;
	private lifetimeMs: number;
	private idleMs: number;
	constructor(launch: (command: string) => Launch | Promise<Launch> = nativeShell, lifetimeMs = MAX_LIFETIME, idleMs = IDLE_TIMEOUT) {
		this.launch = launch; this.lifetimeMs = lifetimeMs; this.idleMs = idleMs;
		this.startSweeper();
	}
	private startSweeper() {
		if (this.sweep) return;
		this.sweep = setInterval(() => { void this.expire().catch(() => {}); }, Math.min(10_000, this.lifetimeMs, this.idleMs));
		this.sweep.unref();
	}
	private async expire() {
		const now = Date.now();
		for (const record of this.processes.values()) {
			if (!record.closed && (now - record.created >= this.lifetimeMs || now - record.touched >= this.idleMs)) {
				await this.stop(record, "Process lifetime or idle limit reached.");
			}
			// Finished output is bounded by MAX_RETAINED/the output buffer, not by
			// time since a poll while the process may still have been running.
			// Collection, capacity eviction, explicit cancellation and reset remove it.
		}
	}
	async start(owner: string, command: string, cwd: string, yieldMs: number, maxBytes: number, signal?: AbortSignal, binding?: NativeJobBinding): Promise<ExecResult> {
		const generation = this.generation;
		this.startSweeper();
		signal?.throwIfAborted();
		if (!command.trim() || command.length > 128_000) throw new Error("Command is empty or exceeds its size limit.");
		const directory = await realpath(cwd);
		if (!(await stat(directory)).isDirectory()) throw new Error("Unified exec workdir must be an existing directory.");
		const launch = await this.launch(command);
		// Verification is asynchronous. Recheck revocation AND capacity afterwards,
		// before native resource registration or the synchronous spawn/map insertion.
		signal?.throwIfAborted(); binding?.resource.signal.throwIfAborted(); binding?.context?.throwIfAborted();
		if (generation !== this.generation) throw new Error("Unified exec session changed before launch.");
		if ([...this.processes.values()].some((p) => (p.revoked && !p.closed) || p.completionFailed)) throw new Error("Unified exec is blocked: previous process cleanup or completion reporting is incomplete.");
		if ([...this.processes.values()].filter((p) => !p.closed).length >= MAX_PROCESSES) throw new Error("Unified exec concurrent process limit reached.");
		if (this.processes.size >= MAX_RETAINED) {
			const eligible = [...this.processes.values()].filter(record => record.closed && !record.settled && !record.completionFailed);
			eligible.sort((a, b) => a.touched - b.touched); // completed least-recent collection; stable insertion order on ties
			if (eligible[0]) this.processes.delete(eligible[0].id);
			if (this.processes.size >= MAX_RETAINED) throw new Error("Unified exec retained-session limit reached.");
		}
		const id = allocateSessionId(); // reserve before resource registration/spawn; never recycle
		let ownedRecord: ProcessRecord | undefined;
		// Native registration precedes OS launch, not receipt of a public session ID.
		const release = binding?.resource.ownResource(async () => {
			if (!ownedRecord) return;
			ownedRecord.revoked = true;
			const stopping = this.stop(ownedRecord, "Native owning scope ended.");
			ownedRecord.revocation.abort();
			await stopping;
			if (!ownedRecord.closed) throw new Error("Native shell cleanup could not be confirmed.");
		});
		let child: ChildProcessWithoutNullStreams;
		try {
			signal?.throwIfAborted(); binding?.resource.signal.throwIfAborted(); binding?.context?.throwIfAborted();
			child = spawn(launch.executable, launch.args, { cwd: directory, windowsHide: true, detached: process.platform !== "win32", stdio: "pipe" });
		} catch (error) { release?.(); throw error; }
		let done!: () => void, initialDone!: () => void;
		const initial = new Promise<void>(resolve => { initialDone = resolve; });
		const record: ProcessRecord = { id, owner, child, revocation: new AbortController(), access: binding ? {scope:binding.scope,context:binding.context} : undefined, output: new Utf8OutputBuffer(), exitCode: null, closed: false, ready: !launch.supervised, supervised: launch.supervised === true, created: Date.now(), touched: Date.now(), done: new Promise((resolve) => { done = resolve; }) };
		ownedRecord = record;
		this.processes.set(record.id, record);
		let prelude = Buffer.alloc(0), admissionTimer: NodeJS.Timeout | undefined;
		const admissionFailed = () => { record.revoked = true; void this.stop(record, "Native supervisor admission failed.").catch(() => {}); };
		if (launch.supervised) admissionTimer = setTimeout(admissionFailed, 10_000);
		child.stdout.on("data", (chunk: Buffer) => { if (record.ready) record.output.append("stdout", chunk); else admissionFailed(); });
		child.stderr.on("data", (chunk: Buffer) => {
			if (record.ready) { record.output.append("stderr", chunk); return; }
			if (record.revoked || record.stop) return;
			prelude = Buffer.concat([prelude, chunk]);
			if (prelude.length > 4096) { admissionFailed(); return; }
			const end = prelude.indexOf(10);
			if (end < 0) return;
			if (!/^PI_UNIFIED_READY_V1\r?$/.test(prelude.subarray(0,end).toString("ascii")) || generation !== this.generation || binding?.resource.signal.aborted || binding?.context?.aborted) { admissionFailed(); return; }
			clearTimeout(admissionTimer);
			// Only the still-live owning parent can acknowledge after the supervisor
			// holds its parent handle. User stdin cannot supply this startup gate.
			record.ready = true; child.stdin.write(Buffer.from([1]));
			if (end + 1 < prelude.length) record.output.append("stderr", prelude.subarray(end+1));
			prelude = Buffer.alloc(0);
		});
		child.stdout.once("end", () => record.output.end("stdout"));
		child.stderr.once("end", () => record.output.end("stderr"));
		child.stdin.on("error", () => {}); // EPIPE is reported as a closed-input error on writes, never an unhandled event.
		child.on("error", () => { record.termination = "Native shell could not start."; });
		child.once("exit", () => {
			// Windows' supervisor job does this atomically at OS teardown. POSIX descendants stay in our process group.
			if (process.platform !== "win32" && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* empty group */ } }
		});
		child.on("close", (code, exitSignal) => {
			clearTimeout(admissionTimer);
			// Also flush on abnormal pipe teardown; end() is idempotent.
			record.output.end("stdout"); record.output.end("stderr");
			record.closed = true; record.exitCode = code;
			if (exitSignal && !record.termination) record.termination = `Process terminated (${exitSignal}).`;
			release?.(); // physical closure is confirmed; publication has separate native ownership
			record.settled = (async () => {
				await initial; // decide whether an active job was actually returned
				let publicationFailed = false;
				if (record.returned && !binding?.scope && !record.revoked && !binding?.context?.aborted && !binding?.resource.signal.aborted && binding?.publishCompletion) {
					const snapshot = record.output.peek(64 * 1024);
					try {
						await binding.publishCompletion({ session_id: record.id, output: cleanOutput(snapshot.output), exit_code: record.exitCode, running: false, ...(record.supervised ? {supervisor_ready:record.ready} : {}), truncated_bytes: snapshot.truncatedBytes, output_remaining_bytes: snapshot.remainingBytes, termination: record.termination });
					} catch { publicationFailed = true; }
				}
				try { await binding?.finish?.(); }
				catch { record.completionFailed = true; }
				// A revoked, successfully drained context can quarantine a publication.
				// A genuine publisher/cleanup failure is never silently retried or cleared.
				if (publicationFailed && !record.revoked && !binding?.context?.aborted) record.completionFailed = true;
				if (record.completionFailed) record.termination = "Native completion reporting or scope cleanup could not be confirmed.";
			})().catch(() => {
				record.completionFailed = true; record.termination = "Native completion reporting or scope cleanup could not be confirmed.";
			}).finally(() => { record.settled = undefined; });
			done();
		});
		let first: ExecResult;
		try {
			first = await this.collect(record, yieldMs, maxBytes, signal, true);
			record.returned = first.running && Boolean(first.session_id);
		} finally { initialDone(); }
		if (record.closed) { await record.settled; this.assertSettled(record); }
		if (!first.session_id) this.processes.delete(record.id);
		return first;
	}
	private owned(id: unknown, owner: string, access?: JobAccess): ProcessRecord {
		const record = isSessionId(id) ? this.processes.get(id) : undefined;
		if (!record || record.revoked || record.owner !== owner || record.access?.scope !== access?.scope || record.access?.context !== access?.context || record.access?.context?.aborted || access?.scope?.signal.aborted) throw new Error("Unknown, expired, or foreign Unified exec session.");
		return record;
	}
	async write(owner: string, id: number, chars: string, yieldMs: number, maxBytes: number, signal?: AbortSignal, access?: JobAccess): Promise<ExecResult> {
		signal?.throwIfAborted();
		const record = this.owned(id, owner, access);
		if (Buffer.byteLength(chars) > MAX_INPUT) throw new Error("Unified exec input exceeds 64 KiB.");
		if (chars && chars !== "\u0003" && !record.ready) throw new Error("Native supervisor is starting; poll before writing input.");
		if (chars === "\u0003") await this.stop(record, "Cancelled with write_stdin Ctrl-C.");
		else if (chars === "\u0004") { if (!record.closed) record.child.stdin.end(); }
		else if (chars) {
			if (record.closed || record.child.stdin.destroyed || record.child.stdin.writableEnded) throw new Error("Unified exec stdin is closed.");
			// bounded writes; do not wait indefinitely for a program that never reads stdin
			if (record.child.stdin.writableLength + Buffer.byteLength(chars) > MAX_INPUT) throw new Error("Unified exec stdin backpressure limit reached; poll before writing more.");
			record.child.stdin.write(chars);
		}
		return this.collect(record, yieldMs, maxBytes, signal, false, chars.length === 0 ? MAX_BACKGROUND_WAIT_MS : MAX_EXEC_WAIT_MS);
	}
	private assertSettled(record: ProcessRecord) {
		if (record.completionFailed) throw new Error("Unified exec completion reporting or native cleanup is unconfirmed; preserve Jobs state.");
	}
	private async collect(record: ProcessRecord, yieldMs: number, maxBytes: number, signal?: AbortSignal, initial = false, maxWaitMs = MAX_EXEC_WAIT_MS): Promise<ExecResult> {
		record.touched = Date.now();
		const signals = [signal, record.revocation.signal, record.access?.context, record.access?.scope?.signal].filter((value): value is AbortSignal => value !== undefined);
		signal = signals.length ? AbortSignal.any(signals) : undefined;
		let wake!: () => void;
		const cancelled = new Promise<void>(resolve => { wake = resolve; });
		// Wake the return wait immediately, then await the existing bounded stop attempt.
		// An unconfirmed kill never resolves record.done or frees native admission.
		const abort = () => { void this.stop(record, "Tool call cancelled.").catch(() => {}); wake(); };
		signal?.addEventListener("abort", abort, { once: true });
		if (signal?.aborted) abort();
		let timer: NodeJS.Timeout | undefined;
		try {
			await Promise.race([record.done, cancelled, new Promise<void>((resolve) => { timer = setTimeout(resolve, Math.max(0, Math.min(yieldMs, maxWaitMs))); })]);
			if (signal?.aborted) { await this.stop(record, "Tool call cancelled."); signal.throwIfAborted(); }
			if (!initial && record.closed) { await record.settled; this.assertSettled(record); }
			const value = (output: string, dropped: number, remaining: number): ExecResult => ({ session_id: !record.closed || remaining > 0 ? record.id : undefined, output: cleanOutput(output), exit_code: record.exitCode, running: !record.closed, ...(record.supervised ? { supervisor_ready: record.ready } : {}), truncated_bytes: dropped, termination: record.termination });
			// Decide on a non-consuming snapshot before touching output or loss counters.
			// Only genuine cell-owned records use the nested serialization ceiling.
			const take = record.access?.scope ? nestedReadLimit(maxBytes, limit => {
				const chunk = record.output.peek(limit);
				return value(chunk.output, chunk.truncatedBytes, chunk.remainingBytes);
			}) : maxBytes;
			const chunk = record.output.read(take);
			const result = value(chunk.output, chunk.truncatedBytes, record.output.byteLength);
			if (!result.session_id && !initial) this.processes.delete(record.id);
			return result;
		} finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
	}
	private stop(record: ProcessRecord, reason: string): Promise<void> {
		if (record.closed) return Promise.resolve(); // genuine close supersedes a cached failed attempt
		if (record.stop) return record.stop;
		record.termination = reason;
		record.stopSettled = false;
		record.stop = (async () => {
			if (record.closed) return;
			const pid = record.child.pid;
			if (pid && process.platform !== "win32") { try { process.kill(-pid, "SIGKILL"); } catch { /* already exited */ } }
			// Windows: terminate the held supervisor handle, not a taskkill/PID
			// lookup that could target a reused PID after exit but before pipe drain.
			// Its non-inherited KILL_ON_JOB_CLOSE handle owns normal descendants.
			if (!record.closed) record.child.kill("SIGKILL");
			// Do not leave a pending collector after a failed OS kill. Tool results clearly report termination.
			let timer: NodeJS.Timeout | undefined;
			try { await Promise.race([record.done, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2000); })]); }
			finally { clearTimeout(timer); }
			if (!record.closed) record.termination = "OS process termination was not confirmed; further launches are blocked after reset.";
		})().catch(error => { record.revoked = true; record.termination = "Native shell cleanup could not be confirmed."; throw error; }).finally(() => { record.stopSettled = true; });
		return record.stop;
	}
	async reset(): Promise<void> {
		this.generation++;
		const records = [...this.processes.values()];
		for (const record of records) record.revoked = true;
		await Promise.all(records.map((record) => {
			const stopping = this.stop(record, "OpenAI session/provider changed or capability disabled.");
			record.revocation.abort();
			return stopping;
		}));
		await Promise.all(records.map(record => record.settled));
		for (const record of records) if (record.closed && !record.completionFailed) this.processes.delete(record.id);
		if (records.some((record) => !record.closed || record.completionFailed)) throw new Error("Unified exec could not confirm native process/reporting cleanup; further launches are blocked.");
	}
	inspect(owner: string) {
		return [...this.processes.values()].filter((record) => record.owner === owner && (!record.revoked || !record.closed || record.completionFailed))
			.map((record) => ({ session_id: record.id, cleanup_pending: Boolean(record.completionFailed || record.settled || (!record.closed && (record.revoked || record.stop))), ownership: record.access?.scope ? "cell" : "conversation", pid: record.child.pid, running: !record.closed, buffered_bytes: record.output.byteLength, age_seconds: Math.floor((Date.now() - record.created) / 1000) }));
	}
	async cancel(owner: string, id: unknown): Promise<void> {
		// Explicit user control may cancel a same-conversation cell job; model-facing
		// write_stdin still requires the exact scope. Permit an explicit cleanup retry.
		const record = isSessionId(id) ? this.processes.get(id) : undefined;
		if (!record || record.owner !== owner) throw new Error("Unknown, expired, or foreign Unified exec session.");
		if (!record.closed && record.stopSettled) record.stop = undefined;
		await this.stop(record, "Cancelled by user.");
		if (!record.closed) throw new Error("OS process termination was not confirmed.");
		await record.settled; this.assertSettled(record);
		this.processes.delete(record.id);
	}
	async close(): Promise<void> { clearInterval(this.sweep); this.sweep = undefined; await this.reset(); }
}

const outputLimit = Type.Optional(Type.Integer({ minimum: 1, maximum: 16_384, description: "Defaults to 10000 approximate tokens (four UTF-8 bytes per token), at most 64 KiB per response. Nested calls may return smaller UTF-8 slices to fit the complete serialized result; collect unread output using the same session_id." }));
const yieldTime = (bounds: string) => Type.Optional(Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER, description: `Requested return wait in milliseconds; clamped before execution. ${bounds} Earlier completion can return sooner. Zero requests the floor, not an immediate poll. This does not extend process lifetime, idle, readiness or cleanup limits.` }));
const ExecParams = Type.Object({
	cmd: Type.String({ minLength: 1, maxLength: 128_000, description: "Native PowerShell command on Windows; /bin/sh on POSIX. Runs with your existing OS permissions, not in a sandbox." }),
	workdir: Type.Optional(Type.String({ minLength: 1, description: "Working directory, relative to the current workspace or absolute. Defaults to workspace." })),
	yield_time_ms: yieldTime("Defaults to 10000 ms; Windows floor 10000 ms, other platforms 250 ms; maximum 30000 ms."),
	max_output_tokens: outputLimit,
	tty: Type.Optional(Type.Literal(false, { description: "Only pipe-backed execution is available; PTY/ConPTY is not implemented." })),
}, { additionalProperties: false });
const WriteParams = Type.Object({
	session_id: Type.Integer({ minimum: 1, maximum: MAX_SESSION_ID, description: "Numeric lookup ID returned by exec_command/write_stdin; not a PID or native authority. Do not convert strings, reuse expired IDs or relaunch a command to collect output." }),
	chars: Type.Optional(Type.String({ maxLength: MAX_INPUT, description: "Input text; empty polls. Exactly Ctrl-C (U+0003) kills the process tree; exactly Ctrl-D (U+0004) closes stdin. Not terminal emulation." })),
	yield_time_ms: yieldTime("Empty/omitted chars: default/floor 5000 ms, profile-configured maximum up to 300000 ms. Nonempty input, including control characters: default/floor 250 ms, maximum 30000 ms."),
	max_output_tokens: outputLimit,
}, { additionalProperties: false });

export function unifiedOwner(ctx: ExtensionContext): string { return `${ctx.sessionManager.getSessionId()}:${ctx.cwd}`; }
interface NativeInvocation {
	origin: "direct" | "nested"; contextSignal: AbortSignal; scope?: NativeJobScope;
	parentToolCallId: string;
	openScope(options: {onResult: () => Promise<void>}): NativeJobScope & {close(): Promise<void>;publishEvidence(evidence: ReturnType<typeof completionEvidence>): Promise<void>};
}
function nativeAccess(ctx: ExtensionContext): JobAccess {
	const invocation = (ctx as ExtensionContext & {tools?: NativeInvocation}).tools;
	if (invocation === undefined) return {}; // stock Pi's direct conversation tools
	if (!(invocation.contextSignal instanceof AbortSignal) || !["direct", "nested"].includes(invocation.origin)) throw new Error("Native shell ownership metadata is unavailable.");
	invocation.contextSignal.throwIfAborted();
	if (invocation.origin === "nested" && (!invocation.scope || typeof invocation.scope.ownResource !== "function")) throw new Error("Nested Unified exec requires a native durable owning scope.");
	return {scope:invocation.origin === "nested" ? invocation.scope : undefined,context:invocation.contextSignal};
}
async function nativeBinding(ctx: ExtensionContext, getLease: (signal: AbortSignal) => CapabilityLease): Promise<NativeJobBinding | undefined> {
	const access = nativeAccess(ctx);
	const invocation = (ctx as ExtensionContext & {tools?: NativeInvocation}).tools;
	if (!invocation) return;
	if (access.scope) return {...access,resource:access.scope};
	const info = (ctx as ExtensionContext & {toolGatewayInfo?: {version: number;protectedResults: boolean}}).toolGatewayInfo;
	if (typeof invocation.openScope !== "function" || info?.version !== 1 || !info.protectedResults || typeof invocation.parentToolCallId !== "string" || !invocation.parentToolCallId || invocation.parentToolCallId.length > 1024) throw new Error("Native shell ownership and protected completion metadata are unavailable.");
	// Unlike the initiating handler signal, this lease lives with the native context.
	const publication = getLease(invocation.contextSignal), toolCallId = invocation.parentToolCallId;
	let scope: ReturnType<NativeInvocation["openScope"]>;
	try { scope = invocation.openScope({onResult: async () => { throw new Error("Direct shell scope cannot publish delegated descendants."); }}); }
	catch (error) { publication.release(); throw error; }
	if (typeof scope.publishEvidence !== "function") {
		try { await scope.close(); } finally { publication.release(); }
		throw new Error("Native protected completion publication is unavailable.");
	}
	let finishing: Promise<void> | undefined;
	return {...access,resource:scope,
		async publishCompletion(value) { publication.assertCurrent(); await scope.publishEvidence(completionEvidence(toolCallId, value)); publication.assertCurrent(); },
		finish() { return finishing ??= (async () => { try { await scope.close(); } finally { publication.release(); } })(); },
	};
}
function nestedResult(value: ExecResult) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value) }], details: value, isError: false };
}
/** Bound the complete unchanged nested wrapper, not merely its raw output string.
 * No await occurs between preview and consumption. Remainders retain the original ID.
 * Sanitization/terminal-ID omission need not be monotone: return a verified fitting
 * candidate, not a claim of maximal utilization. Hooks and aggregate RPC limits
 * remain authoritative afterwards; arbitrary finalized results are never rewritten.
 */
function nestedReadLimit(maxBytes: number, preview: (limit: number) => ExecResult): number {
	const fits = (limit: number) => {
		const value = preview(limit);
		try { resultJSON({ result: nestedResult(value), isError: false }); return true; }
		catch (error) {
			// This error is from our trusted serializer, never a guest exception.
			if (!(error instanceof Error) || error.message !== "TOOL_RESULT_LIMIT") throw error;
			return false;
		}
	};
	if (fits(maxBytes)) return maxBytes; // peek validates the input and UTF-8 boundary
	if (!fits(4)) throw new Error("TOOL_RESULT_LIMIT"); // refuse before consumption
	let best = 4, low = 5, high = Math.min(64 * 1024, Math.floor(maxBytes)) - 1;
	while (low <= high) {
		const mid = Math.floor((low + high) / 2);
		if (fits(mid)) { best = mid; low = mid + 1; }
		else high = mid - 1;
	}
	return best;
}
export function createUnifiedExecTools(manager: UnifiedExecManager, getLease: (name: "exec_command" | "write_stdin", ctx: ExtensionContext, signal?: AbortSignal) => CapabilityLease,
	getBackgroundWaitMs: () => number = () => MAX_BACKGROUND_WAIT_MS) {
	return [{
		name: "exec_command", label: "Unified exec", description: "Start a native local command, collect bounded output, and keep a same-context session for polling/stdin. Full OS permissions; no sandbox or PTY. The patched host shares TWO active/draining native scopes across direct jobs and Code mode, separately from the four-process manager limit. A third direct start can be refused without cancelling earlier jobs. running:true with supervisor_ready:false means startup is unconfirmed, not command success. On the compatible patched host, returned direct jobs publish a bounded completion snapshot through the native protected history/UI and next safe model request; this does not interrupt a request or start an idle turn. Poll write_stdin for readiness/input/remaining output. Completed results are retained until collected, capacity-evicted, cancelled or reset, not a one-minute poll deadline. Direct results contain process status, measured time for this awaited operation (not process age), and literal returned output; structured fields remain in native details. An exited process can retain a session ID for unread output, not because it is still running. Nested results retain their JSON/details wrapper and jobs still belong to their original cell. Never relaunch just to wait. Jobs are not restored after reload/context changes; native context and process lifetime/idle limits still apply. Does not replace Pi's PowerShell tool.",
		parameters: ExecParams,
		async execute(_id, params, signal, _update, ctx) {
			const lease = getLease("exec_command", ctx, signal);
			let binding: NativeJobBinding | undefined;
			try {
				const waitMs = initialWaitMs(params.yield_time_ms);
				backgroundWaitMs(getBackgroundWaitMs()); // Refuse invalid trusted policy before starting any work.
				binding = await nativeBinding(ctx, contextSignal => getLease("exec_command", ctx, contextSignal));
				const started = binding?.scope ? undefined : performance.now();
				const value = await manager.start(unifiedOwner(ctx), params.cmd, path.resolve(ctx.cwd, params.workdir ?? "."), waitMs, (params.max_output_tokens ?? DEFAULT_OUTPUT_TOKENS) * 4, lease.signal, binding);
				const wallTimeMs = started === undefined ? undefined : Math.round(performance.now() - started);
				lease.assertCurrent(); return wallTimeMs === undefined ? nestedResult(value) : directUnifiedResult(value, wallTimeMs);
			} catch (error) { await binding?.finish?.(); throw error; }
			finally { lease.release(); }
		},
	} satisfies ToolDefinition<typeof ExecParams>, {
		name: "write_stdin", label: "Unified exec input", description: "Poll or write to a Unified exec session owned by this conversation and, for native cell jobs, the original cell scope. A nested call cannot adopt another cell's ID or a direct job. Empty chars polls, Ctrl-C cancels the tree, Ctrl-D closes input. On the matching updated native host, unchanged empty-running cell polls are local work hidden from the TUI and ordinary audit context; direct calls, input, output/loss, errors and terminal results remain visible. Print meaningful changes rather than each unchanged poll. No extra model request is made per local poll; explicitly printed output still becomes model input. Direct calls return status, per-call wall time and literal returned output, with structured fields in native details; nested calls retain their JSON/details wrapper. Requested waits are clamped: empty polls 5000 ms to the profile ceiling (default/hard maximum 300000 ms), nonempty input 250–30000 ms. Profile changes affect future calls, not an already pending wait. Completion can return sooner. Zero requests the applicable floor; return wait is not process age or lifetime. IDs expire on provider/session changes or reload.",
		// Native-only declaration; never exposed as a model/guest permission parameter.
		localPolling: "empty-stdin",
		parameters: WriteParams,
		async execute(_id, params, signal, _update, ctx) {
			const lease = getLease("write_stdin", ctx, signal);
			try {
				const access = nativeAccess(ctx);
				const started = access.scope ? undefined : performance.now();
				const chars = params.chars ?? "";
				const ceiling = backgroundWaitMs(getBackgroundWaitMs());
				const waitMs = stdinWaitMs(params.yield_time_ms, chars, ceiling);
				const value = await manager.write(unifiedOwner(ctx), params.session_id, chars, waitMs, (params.max_output_tokens ?? DEFAULT_OUTPUT_TOKENS) * 4, lease.signal, access);
				const wallTimeMs = started === undefined ? undefined : Math.round(performance.now() - started);
				lease.assertCurrent(); return wallTimeMs === undefined ? nestedResult(value) : directUnifiedResult(value, wallTimeMs);
			} finally { lease.release(); }
		},
	} satisfies ToolDefinition<typeof WriteParams> & { localPolling: "empty-stdin" }] as const;
}
