import type {
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { CodeCells, type CellOutcome } from "./runtime/cells.mjs";
import { snapshotToolMetadata } from "./runtime/tool-metadata.mjs";
import {
	cellRuntimeStatus,
	type CellRuntimeStatus,
} from "./runtime/availability.mjs";
import { validToolName, RPC_LIMITS } from "./runtime/rpc-protocol.mjs";
import { renderCodeResult } from "./code-mode-presentation.ts";
import { codeResult } from "./code-mode-output.ts";
import { CODE_CONSTRAINED_SAMPLING, prepareCodeArguments, supportsNativeCodeInput } from "./code-mode-input.ts";

/** Passive private-host ABI information, never a substitute invocation capability. */
export interface ToolGatewayInfo {
	version: 1;
	protectedResults: boolean;
	activeScopes: number;
	drainingScopes: number;
	maxScopes: 2;
}
export function toolGatewayInfo(
	ctx: ExtensionContext,
): ToolGatewayInfo | undefined {
	try {
		const info = (
			ctx as ExtensionContext & { toolGatewayInfo?: ToolGatewayInfo }
		).toolGatewayInfo;
		return info?.version === 1 &&
			typeof info.protectedResults === "boolean" &&
			info.maxScopes === 2 &&
			Number.isSafeInteger(info.activeScopes) &&
			info.activeScopes >= 0 &&
			Number.isSafeInteger(info.drainingScopes) &&
			info.drainingScopes >= 0 &&
			info.activeScopes + info.drainingScopes <= 2
			? info
			: undefined;
	} catch {
		return undefined;
	}
}
interface Invocation {
	origin: "direct" | "nested";
	contextSignal: AbortSignal;
	signal: AbortSignal;
	openScope: unknown;
	adoptScope: unknown;
}
function invocation(ctx: ExtensionContext): Invocation {
	const value = (ctx as ExtensionContext & { tools?: Invocation }).tools;
	if (
		!value ||
		value.origin !== "direct" ||
		!(value.contextSignal instanceof AbortSignal) ||
		!(value.signal instanceof AbortSignal) ||
		value.contextSignal.aborted ||
		value.signal.aborted ||
		typeof value.openScope !== "function" ||
		typeof value.adoptScope !== "function"
	)
		throw Error("Code mode requires a current direct native invocation.");
	return value;
}
interface Entry {
	owner: object;
	contextSignal: AbortSignal;
	controller: AbortController;
	cells: CodeCells;
}
export interface CodeModeStatus extends CellRuntimeStatus {
	native?: ToolGatewayInfo;
}
export class CodeMode {
	private entry?: Entry;
	private generation = 0;
	// The status seam is trusted test composition only; it cannot choose a runtime
	// factory, launcher or less-contained implementation. Production uses defaults.
	private readonly names: () => string[];
	private readonly runtimeStatus: () => Promise<CellRuntimeStatus>;
	private readonly definitions: () => unknown;
	constructor(
		names: () => string[],
		runtimeStatus: () => Promise<CellRuntimeStatus> = cellRuntimeStatus,
		definitions: () => unknown = () => [],
	) {
		this.names = names;
		this.runtimeStatus = runtimeStatus;
		this.definitions = definitions;
	}
	async status(ctx: ExtensionContext): Promise<CodeModeStatus> {
		const native = toolGatewayInfo(ctx);
		if (!native)
			return { available: false, reason: "PRIVATE_HOST_GATEWAY_V1_REQUIRED" };
		if (!native.protectedResults)
			return {
				available: false,
				reason: "NATIVE_PROTECTED_PUBLICATION_REQUIRED",
				native,
			};
		if (!supportsNativeCodeInput(ctx))
			return { available: false, reason: "NATIVE_CODE_GRAMMAR_REQUIRED", native };
		return { ...(await this.runtimeStatus()), native };
	}
	async reset(): Promise<void> {
		this.generation++;
		const old = this.entry;
		this.entry = undefined;
		if (old) {
			old.controller.abort();
			await old.cells.close();
		}
		// Native draining admission, not this extension field, owns failed cleanup.
	}
	private context(ctx: ExtensionContext, call: Invocation): Entry {
		const owner = ctx.sessionManager;
		if (
			this.entry &&
			(this.entry.owner !== owner ||
				this.entry.contextSignal !== call.contextSignal)
		)
			void this.reset();
		if (!this.entry) {
			const controller = new AbortController();
			this.entry = {
				owner,
				contextSignal: call.contextSignal,
				controller,
				cells: new CodeCells({
					owner,
					contextSignal: call.contextSignal,
					signal: controller.signal,
				}),
			};
		}
		return this.entry;
	}
	async exec(
		ctx: ExtensionContext,
		params: {
			code: string;
			yield_time_ms?: number;
			max_output_tokens?: number;
		},
		signal?: AbortSignal,
	): Promise<CellOutcome> {
		const generation = this.generation,
			call = invocation(ctx);
		signal?.throwIfAborted();
		const status = await this.status(ctx);
		signal?.throwIfAborted();
		if (generation !== this.generation)
			throw Error("Code mode operation revoked.");
		if (!status.available)
			throw Error(
				`Code mode unavailable: ${status.reason}. No unrestricted fallback.`,
			);
		const names = [...new Set(this.names().filter(validToolName))];
		if (names.length > RPC_LIMITS.tools)
			throw Error(
				"Code mode supports at most 32 eligible active tools; ordinary tools were not changed.",
			);
		const toolMetadata = snapshotToolMetadata(names, this.definitions());
		const entry = this.context(ctx, call);
		signal?.throwIfAborted();
		return entry.cells.exec({
			...params,
			owner: entry.owner,
			invocation: call,
			tools: names,
			toolMetadata,
		});
	}
	async wait(
		ctx: ExtensionContext,
		params: {
			cell_id: string;
			yield_time_ms?: number;
			max_tokens?: number;
			terminate?: boolean;
		},
		signal?: AbortSignal,
	): Promise<CellOutcome> {
		const call = invocation(ctx);
		signal?.throwIfAborted();
		const entry = this.entry;
		if (
			!entry ||
			entry.owner !== ctx.sessionManager ||
			entry.contextSignal !== call.contextSignal
		)
			throw Error("Code mode cell is unavailable in this native context.");
		// Poll/termination do not need a newly available artifact or free admission.
		return entry.cells.wait({
			...params,
			owner: entry.owner,
			invocation: call,
		});
	}
}
const yieldTime = Type.Optional(Type.Integer({ minimum: 0, maximum: 30000 }));
const tokens = Type.Optional(Type.Integer({ minimum: 0, maximum: 16384 }));
const Exec = Type.Object(
	{
		code: Type.String({
			minLength: 1,
			maxLength: 65536,
			description:
				"Restricted QuickJS async function-body source, not an unrestricted Node REPL. For human-facing results, use text() with concise labelled lines of selected facts. Use JSON.stringify only when structured JSON is requested or needed for further processing; do not dump full delegated result objects by default.",
		}),
	},
	{ additionalProperties: false },
);
const Wait = Type.Object(
	{
		cell_id: Type.String({ minLength: 1, maxLength: 64 }),
		yield_time_ms: yieldTime,
		max_tokens: tokens,
		terminate: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export function createCodeModeTools(code: CodeMode): ToolDefinition[] {
	return [
		{
			name: "exec",
			label: "Code mode",
			description:
				"Run one bounded restricted JavaScript cell. Send raw JavaScript, not JSON or a Markdown code fence. Optional first-line // @exec: {\"yield_time_ms\":1000,\"max_output_tokens\":10000}; omit the line to use 10000ms/10000 tokens. Only these pragma fields are accepted; safe integers, yield 0..30000ms, output 0..16384 approximate tokens. These are return/output limits, not process lifetime or retention. Fresh QuickJS isolate; no Node/import/filesystem/auth globals. ALL_TOOLS provides frozen {name,description} metadata for eligible active tools, matching TOOL_NAMES and tools.NAME. This is discovery data, not permission; metadata inspection does not invoke tools. await tools.NAME(args) delegates through genuine native controls and returns {result,isError}. text() emits primitive text. Prefer concise human-readable final summaries (label, actual output, exit/error and requested aggregate counts), not nested JSON dumps, initial snapshots or repeated IDs. Accumulate output locally; never omit failures, warnings or output-loss facts just to shorten a summary. Use JSON.stringify only for requested/needed machine-readable output. image(ref)/evidence(ref) use native references, store/load retain bounded same-context JSON, yield_control() yields. Delegated shell keeps full OS permissions. Direct results contain script status, this call's wall time and literal coordinator text, not a JSON envelope; wall time is not child-process runtime. A running cell_id is distinct from a shell session_id; use wait on that cell, never relaunch to poll. Mandatory finalized image/source evidence cannot be suppressed by guest output limits. For Unified exec, inspect r.isError and r.result.details (output, exit_code, running, session_id), not r.output; poll tools.write_stdin within the same owning cell. Cell completion closes its returned jobs/normal descendants, including background GUI processes. This is not a built-in desktop-control API. Failure diagnostics report bounded guest phase and delegation observations, never exception text or proof that OS effects did/did not occur. Do not blindly replay a failed action.",
			parameters: Exec,
			constrainedSampling: structuredClone(CODE_CONSTRAINED_SAMPLING),
			prepareArguments: prepareCodeArguments,
			renderResult: renderCodeResult,
			async execute(_id, params, signal, _update, ctx) {
				const input = prepareCodeArguments(params);
				const started = performance.now();
				const value = await code.exec(ctx, input, signal);
				return codeResult(value, Math.round(performance.now() - started));
			},
		} satisfies ToolDefinition<typeof Exec>,
		{
			name: "wait",
			label: "Wait for Code mode",
			description:
				"Poll or terminate the same owned Code mode cell. Returns script status, this call's wall time and literal coordinator text; time is not total cell age or child-process runtime. Does not re-execute source or adopt a foreign context. max_tokens limits guest text only; protected native evidence is separate. Draining means cleanup is not yet confirmed, not successful completion. A terminated cell cannot retain returned shell jobs.",
			parameters: Wait,
			renderResult: renderCodeResult,
			async execute(_id, params, signal, _update, ctx) {
				const started = performance.now();
				const value = await code.wait(ctx, params, signal);
				return codeResult(value, Math.round(performance.now() - started));
			},
		} satisfies ToolDefinition<typeof Wait>,
	];
}
