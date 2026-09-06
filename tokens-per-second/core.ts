export const DEFAULT_ROLLING_WINDOW_MS = 500;
export const CHARS_PER_ESTIMATED_TOKEN = 4;

export type ThroughputPhase =
	| "idle"
	| "waiting"
	| "streaming"
	| "complete"
	| "error"
	| "aborted";

export type ThroughputSource = "idle" | "observed" | "provider";
export type DisplaySource = ThroughputSource | "inferred";

export interface UsageLike {
	output?: number;
	reasoning?: number;
}

export interface TextBlockLike {
	type: "text";
	text?: string;
}

export interface ThinkingBlockLike {
	type: "thinking";
	thinking?: string;
}

export interface ToolCallBlockLike {
	type: "toolCall";
	name?: string;
	arguments?: unknown;
	/** Optional provider scratch data while a tool call is streaming. */
	partialJson?: string;
}

export interface AssistantMessageLike {
	role?: string;
	content?: Array<TextBlockLike | ThinkingBlockLike | ToolCallBlockLike | { type: string }>;
	usage?: UsageLike;
	stopReason?: string;
}

export interface AssistantStreamEventLike {
	type: string;
	delta?: string;
}

export interface ThroughputSnapshot {
	phase: ThroughputPhase;
	/** Always zero outside an actively measurable stream. */
	tokensPerSecond: number;
	estimatedTokens: number;
	source: ThroughputSource;
	hasObservableOutput: boolean;
	hasObservedThinking: boolean;
}

export interface DisplayMeasurement {
	rate: number;
	source: DisplaySource;
}

export interface CompletionTelemetry {
	reasoningTokens?: number;
	reasoningDurationMs?: number;
	estimatedThinkingTokens: number;
	observedThinking: boolean;
}

export interface ThroughputTrackerOptions {
	rollingWindowMs?: number;
}

interface RateSample {
	at: number;
	tokens: number;
}

interface CharacterCounts {
	answer: number;
	thinking: number;
}

const MIN_RATE_DURATION_MS = 25;
const MAX_RATE_SAMPLES = 128;

function finiteNonNegative(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeJsonLength(value: unknown): number {
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

function countCharactersByKind(message: AssistantMessageLike): CharacterCounts {
	const counts: CharacterCounts = { answer: 0, thinking: 0 };
	if (message.role !== "assistant" || !Array.isArray(message.content)) return counts;

	for (const block of message.content) {
		switch (block.type) {
			case "text": {
				const text = (block as TextBlockLike).text;
				counts.answer += typeof text === "string" ? text.length : 0;
				break;
			}
			case "thinking": {
				const thinking = (block as ThinkingBlockLike).thinking;
				counts.thinking += typeof thinking === "string" ? thinking.length : 0;
				break;
			}
			case "toolCall": {
				const toolCall = block as ToolCallBlockLike;
				counts.answer += toolCall.name?.length ?? 0;
				counts.answer += typeof toolCall.partialJson === "string"
					? toolCall.partialJson.length
					: safeJsonLength(toolCall.arguments);
				break;
			}
		}
	}
	return counts;
}

/** Count output characters Pi can observe without provider tokenizer access. */
export function countObservableCharacters(message: AssistantMessageLike): number {
	const counts = countCharactersByKind(message);
	return counts.answer + counts.thinking;
}

/**
 * Choose the footer source. Provider counters and observable deltas always
 * supersede hidden-reasoning inference as soon as they become available.
 */
export function selectDisplayMeasurement(
	snapshot: ThroughputSnapshot,
	inferredReasoningRate?: number,
	allowInference = true,
): DisplayMeasurement {
	if (snapshot.phase !== "streaming") return { rate: 0, source: "idle" };
	if (snapshot.source === "provider") {
		return { rate: snapshot.tokensPerSecond, source: "provider" };
	}
	if (snapshot.hasObservableOutput) {
		return { rate: snapshot.tokensPerSecond, source: "observed" };
	}
	if (
		allowInference &&
		typeof inferredReasoningRate === "number" &&
		Number.isFinite(inferredReasoningRate) &&
		inferredReasoningRate > 0
	) {
		return { rate: inferredReasoningRate, source: "inferred" };
	}
	return { rate: 0, source: "observed" };
}

/**
 * A deliberately short-window, client-observed throughput estimator.
 * Timestamps are explicit so behavior is deterministic in tests.
 */
export class ThroughputTracker {
	private readonly rollingWindowMs: number;
	private phase: ThroughputPhase = "idle";
	private answerCharacters = 0;
	private thinkingCharacters = 0;
	private observedThinking = false;
	private streamStartedAt?: number;
	private firstAnswerAt?: number;
	private observableSamples: RateSample[] = [];
	private latestUsageTokens = 0;
	private hasIncrementalUsage = false;
	private usageSamples: RateSample[] = [];

	constructor(options: ThroughputTrackerOptions = {}) {
		const configuredWindow = options.rollingWindowMs ?? DEFAULT_ROLLING_WINDOW_MS;
		this.rollingWindowMs = Number.isFinite(configuredWindow) && configuredWindow > 0
			? configuredWindow
			: DEFAULT_ROLLING_WINDOW_MS;
	}

	reset(): void {
		this.phase = "idle";
		this.answerCharacters = 0;
		this.thinkingCharacters = 0;
		this.observedThinking = false;
		this.streamStartedAt = undefined;
		this.firstAnswerAt = undefined;
		this.observableSamples = [];
		this.latestUsageTokens = 0;
		this.hasIncrementalUsage = false;
		this.usageSamples = [];
	}

	beginTurn(_now: number): void {
		this.reset();
		this.phase = "waiting";
	}

	beginStream(message: AssistantMessageLike, now: number): void {
		if (this.phase !== "waiting" && this.phase !== "streaming") this.beginTurn(now);
		this.phase = "streaming";
		const counts = countCharactersByKind(message);
		this.answerCharacters = counts.answer;
		this.thinkingCharacters = counts.thinking;
		this.observedThinking = counts.thinking > 0;
		this.streamStartedAt = now;
		this.firstAnswerAt = counts.answer > 0 ? now : undefined;
		this.observableSamples = [];
		this.recordObservableSample(now);

		const output = message.usage?.output;
		this.latestUsageTokens = finiteNonNegative(output) ? output : 0;
		this.hasIncrementalUsage = false;
		this.usageSamples = [{ at: now, tokens: this.latestUsageTokens }];
	}

	observe(event: AssistantStreamEventLike, message: AssistantMessageLike, now: number): void {
		if (this.phase !== "streaming") this.beginStream(message, now);

		const previousAnswer = this.answerCharacters;
		const previousThinking = this.thinkingCharacters;
		if (typeof event.delta === "string") {
			switch (event.type) {
				case "thinking_delta":
					this.thinkingCharacters += event.delta.length;
					if (event.delta.length > 0) this.observedThinking = true;
					break;
				case "text_delta":
				case "toolcall_delta":
					this.answerCharacters += event.delta.length;
					break;
			}
		}

		// Partial messages are cumulative. Reconciliation prevents undercounting
		// when a provider supplies initial content or an extension misses a delta.
		const cumulative = countCharactersByKind(message);
		this.answerCharacters = Math.max(this.answerCharacters, cumulative.answer);
		this.thinkingCharacters = Math.max(this.thinkingCharacters, cumulative.thinking);
		if (this.thinkingCharacters > previousThinking) this.observedThinking = true;
		if (this.answerCharacters > previousAnswer && this.firstAnswerAt === undefined) {
			this.firstAnswerAt = now;
		}

		const previousTotal = previousAnswer + previousThinking;
		if (this.totalCharacters() > previousTotal && previousTotal === 0) {
			// Preserve the count immediately before the first output burst.
			this.observableSamples.push({ at: now, tokens: 0 });
		}
		this.recordObservableSample(now);
		this.observeUsage(message, now);
	}

	finish(message: AssistantMessageLike, now: number): CompletionTelemetry {
		const finalCounts = countCharactersByKind(message);
		this.answerCharacters = Math.max(this.answerCharacters, finalCounts.answer);
		this.thinkingCharacters = Math.max(this.thinkingCharacters, finalCounts.thinking);
		if (this.thinkingCharacters > 0) this.observedThinking = true;
		if (this.firstAnswerAt === undefined && this.answerCharacters > 0) this.firstAnswerAt = now;

		const reasoning = message.usage?.reasoning;
		const telemetry: CompletionTelemetry = {
			reasoningTokens: finiteNonNegative(reasoning) && reasoning > 0 ? reasoning : undefined,
			reasoningDurationMs: this.streamStartedAt === undefined
				? undefined
				: Math.max(0, (this.firstAnswerAt ?? now) - this.streamStartedAt),
			estimatedThinkingTokens: Math.ceil(this.thinkingCharacters / CHARS_PER_ESTIMATED_TOKEN),
			observedThinking: this.observedThinking,
		};

		switch (message.stopReason) {
			case "error":
				this.phase = "error";
				break;
			case "aborted":
				this.phase = "aborted";
				break;
			default:
				this.phase = "complete";
		}
		this.observableSamples = [];
		this.usageSamples = [];
		return telemetry;
	}

	endWithoutResponse(_now: number): void {
		if (this.phase !== "waiting" && this.phase !== "streaming") return;
		this.phase = "error";
		this.observableSamples = [];
		this.usageSamples = [];
	}

	snapshot(now: number): ThroughputSnapshot {
		const estimatedTokens = Math.ceil(this.estimatedObservableTokens());
		const shared = {
			phase: this.phase,
			estimatedTokens,
			hasObservableOutput: this.totalCharacters() > 0,
			hasObservedThinking: this.observedThinking,
		};
		if (this.phase !== "streaming") {
			return { ...shared, tokensPerSecond: 0, source: "idle" };
		}

		this.recordObservableSample(now);
		if (this.hasIncrementalUsage) {
			this.recordUsageSample(now);
			return {
				...shared,
				tokensPerSecond: this.calculateRate(this.usageSamples, this.latestUsageTokens, now),
				source: "provider",
			};
		}
		return {
			...shared,
			tokensPerSecond: this.calculateRate(
				this.observableSamples,
				this.estimatedObservableTokens(),
				now,
			),
			source: "observed",
		};
	}

	private totalCharacters(): number {
		return this.answerCharacters + this.thinkingCharacters;
	}

	private estimatedObservableTokens(): number {
		return this.totalCharacters() / CHARS_PER_ESTIMATED_TOKEN;
	}

	private observeUsage(message: AssistantMessageLike, now: number): void {
		const output = message.usage?.output;
		if (!finiteNonNegative(output) || output <= this.latestUsageTokens) return;
		this.usageSamples.push({ at: now, tokens: this.latestUsageTokens });
		this.latestUsageTokens = output;
		this.hasIncrementalUsage = true;
		this.recordUsageSample(now);
	}

	private recordObservableSample(now: number): void {
		this.recordSample(this.observableSamples, now, this.estimatedObservableTokens());
	}

	private recordUsageSample(now: number): void {
		this.recordSample(this.usageSamples, now, this.latestUsageTokens);
	}

	private recordSample(samples: RateSample[], now: number, tokens: number): void {
		const last = samples.at(-1);
		if (!last || last.at !== now || last.tokens !== tokens) samples.push({ at: now, tokens });

		const cutoff = now - this.rollingWindowMs;
		// Keep one sample at or before the cutoff as a nearby baseline.
		while (samples.length > 2 && samples[1]!.at <= cutoff) samples.shift();
		if (samples.length > MAX_RATE_SAMPLES) {
			samples.splice(1, samples.length - MAX_RATE_SAMPLES);
		}
	}

	private calculateRate(samples: RateSample[], currentTokens: number, now: number): number {
		if (samples.length === 0 || currentTokens <= 0) return 0;
		const baseline = samples[0]!;
		const durationMs = now - baseline.at;
		if (durationMs < MIN_RATE_DURATION_MS) return 0;
		return Math.max(0, currentTokens - baseline.tokens) / (durationMs / 1_000);
	}
}

/** Stable one-decimal formatting, including the idle value. */
export function formatRate(rate: number): string {
	if (!Number.isFinite(rate) || rate < 0) return "0.0";
	return rate.toFixed(1);
}
