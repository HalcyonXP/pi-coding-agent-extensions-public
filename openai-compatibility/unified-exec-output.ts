import type { ExecResult } from "./unified-exec.ts";
import { isSessionId } from "./unified-session-id.ts";

/** Presentation metadata, not process age, retained-job authority or token telemetry. */
export interface UnifiedResultMetadata { version: 1; wall_time_ms: number }
export type UnifiedResultDetails = ExecResult & { unified_result: UnifiedResultMetadata };

const required = ["output", "exit_code", "running", "truncated_bytes"];
const optional = ["session_id", "supervisor_ready", "termination"];
const nonnegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Copy the manager's bounded scalar data without reading accessors or accepting metadata from it. */
function outcome(value: unknown): ExecResult {
	if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Unfamiliar Unified exec result");
	const keys = Reflect.ownKeys(value);
	if (keys.length > required.length + optional.length || keys.some(key => typeof key !== "string" || ![...required, ...optional].includes(key))) throw new Error("Unfamiliar Unified exec result fields");
	const data: Record<string, unknown> = {};
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if (!("value" in descriptor)) throw new Error("Unfamiliar Unified exec result property");
		data[key as string] = descriptor.value;
	}
	if (required.some(key => !Object.hasOwn(data, key)) || typeof data.output !== "string" || data.output.length > 1024 * 1024 || typeof data.running !== "boolean" || !nonnegativeInteger(data.truncated_bytes) || !(data.exit_code === null || (typeof data.exit_code === "number" && Number.isSafeInteger(data.exit_code)))) throw new Error("Unfamiliar Unified exec outcome");
	if (data.session_id !== undefined && !isSessionId(data.session_id)) throw new Error("Unfamiliar Unified exec session identifier");
	if (data.running && data.session_id === undefined) throw new Error("Running Unified exec result requires a session identifier");
	if (data.running && data.exit_code !== null) throw new Error("Unfamiliar running Unified exec exit status");
	if (data.supervisor_ready !== undefined && typeof data.supervisor_ready !== "boolean") throw new Error("Unfamiliar Unified exec readiness");
	if (data.termination !== undefined && (typeof data.termination !== "string" || !/^[^\u0000-\u001f\u007f]{1,1024}$/.test(data.termination))) throw new Error("Unfamiliar Unified exec termination");
	return data as unknown as ExecResult;
}

/** Direct handler result only. Nested JSON/results and protected completion evidence use their existing paths. */
export function directUnifiedResult(value: unknown, wallTimeMs: number) {
	const data = outcome(value);
	if (!nonnegativeInteger(wallTimeMs)) throw new Error("Unified exec result timing required");
	const details: UnifiedResultDetails = { ...data, unified_result: { version: 1, wall_time_ms: wallTimeMs } };
	const lines = [`Wall time: ${(wallTimeMs / 1000).toFixed(4)} seconds`];
	if (data.running) lines.push(`Process running with session ID ${data.session_id}`);
	else {
		lines.push(data.exit_code === null ? "Process stopped; exit code unavailable" : `Process exited with code ${data.exit_code}`);
		if (data.session_id !== undefined) lines.push(`More output available with session ID ${data.session_id}`);
	}
	if (data.supervisor_ready !== undefined) lines.push(`Supervisor preamble: ${data.supervisor_ready ? "received" : "not confirmed"}`);
	if (data.termination !== undefined) lines.push(`Termination: ${data.termination}`);
	if (data.truncated_bytes > 0) lines.push(`Output omitted: ${data.truncated_bytes} bytes · not recoverable by polling or expansion`);
	lines.push("Output:", data.output);
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details, isError: false };
}
