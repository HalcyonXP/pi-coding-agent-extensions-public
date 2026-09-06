import type {
	ContextUsage,
	ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

export const CONTEXT_USAGE_MESSAGE_TYPE = "context-usage-injection";

export interface RuntimeContextUsageMessage {
	role: "custom";
	customType: typeof CONTEXT_USAGE_MESSAGE_TYPE;
	content: string;
	display: false;
	timestamp: number;
}

export interface NormalizedContextUsage {
	tokens: number;
	contextWindow: number;
	percent: number;
	remaining: number;
}

/** Reject unavailable or nonsensical telemetry rather than showing stale data. */
export function normalizeContextUsage(
	usage: ContextUsage | undefined,
): NormalizedContextUsage | undefined {
	if (
		!usage ||
		usage.tokens === null ||
		!Number.isFinite(usage.tokens) ||
		usage.tokens < 0 ||
		!Number.isFinite(usage.contextWindow) ||
		usage.contextWindow <= 0
	) {
		return undefined;
	}

	const tokens = Math.round(usage.tokens);
	const contextWindow = Math.round(usage.contextWindow);
	if (contextWindow <= 0) return undefined;

	return {
		tokens,
		contextWindow,
		percent: (tokens / contextWindow) * 100,
		remaining: Math.max(0, contextWindow - tokens),
	};
}

function formatTokens(tokens: number): string {
	return tokens.toLocaleString("en-US");
}

export function buildContextUsageText(usage: NormalizedContextUsage): string {
	const headroom =
		usage.remaining > 0
			? `~${formatTokens(usage.remaining)} tokens of nominal context-window headroom remain.`
			: "No nominal context-window headroom remains.";

	return (
		`<runtime_context_usage source="pi-runtime">` +
		`Current active context estimate: ~${formatTokens(usage.tokens)} / ` +
		`${formatTokens(usage.contextWindow)} tokens ` +
		`(${usage.percent.toFixed(1)}% used). ${headroom} ` +
		`This is harness telemetry, not a user request. Use it for context-management ` +
		`planning without sacrificing correctness or completeness.` +
		`</runtime_context_usage>`
	);
}

export function buildContextUsageMessage(
	usage: NormalizedContextUsage,
	timestamp: number = Date.now(),
): RuntimeContextUsageMessage {
	return {
		role: "custom",
		customType: CONTEXT_USAGE_MESSAGE_TYPE,
		content: buildContextUsageText(usage),
		display: false,
		timestamp,
	};
}

export function isContextUsageMessage(message: unknown): boolean {
	if (typeof message !== "object" || message === null) return false;
	const candidate = message as { role?: unknown; customType?: unknown };
	return (
		candidate.role === "custom" &&
		candidate.customType === CONTEXT_USAGE_MESSAGE_TYPE
	);
}

/** Remove an older projection so repeated/chained context hooks remain idempotent. */
export function removeContextUsageMessages<T>(messages: readonly T[]): T[] {
	return messages.filter((message) => !isContextUsageMessage(message));
}

export default function contextUsageInjection(pi: ExtensionAPI): void {
	// Unlike before_agent_start, context fires before every LLM call in an agent
	// run, including calls made after tool results have enlarged the context.
	pi.on("context", (event, ctx) => {
		const messages = removeContextUsageMessages(event.messages);
		const usage = normalizeContextUsage(ctx.getContextUsage());

		// Pi deliberately reports unknown immediately after compaction until a new
		// model response establishes a trustworthy usage baseline. Never retain an
		// older number in that interval.
		if (!usage) {
			return messages.length === event.messages.length ? undefined : { messages };
		}

		return {
			messages: [...messages, buildContextUsageMessage(usage)],
		};
	});
}
