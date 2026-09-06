import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	formatRate,
	selectDisplayMeasurement,
	ThroughputTracker,
	type DisplayMeasurement,
} from "./core.ts";
import { ReasoningRateProfiles } from "./reasoning-rates.ts";

/** Consumed inline by the shared custom footer in openai-compatibility. */
export const TPS_STATUS_KEY = "tokens-per-second";
export const TPS_REFRESH_INTERVAL_MS = 100;

const MIN_REASONING_SAMPLE_DURATION_MS = 250;

type InferenceMode = "auto" | "observed";

function supportsStatus(ctx: ExtensionContext): boolean {
	return ctx.hasUI && ctx.mode === "tui";
}

function reasoningProfileKey(ctx: ExtensionContext): string | undefined {
	const model = ctx.model;
	if (!model?.reasoning || ctx.thinkingLevel === "off") return undefined;
	return JSON.stringify([
		model.provider,
		model.id,
		model.api,
		ctx.thinkingLevel ?? "default",
	]);
}

export default function tokensPerSecondExtension(pi: ExtensionAPI): void {
	const tracker = new ThroughputTracker();
	const reasoningProfiles = new ReasoningRateProfiles();
	let currentContext: ExtensionContext | undefined;
	let visible = true;
	let inferenceMode: InferenceMode = "auto";
	let activeProfileKey: string | undefined;
	let activeLearnedRate: number | undefined;
	let lastPublishedSignature: string | undefined;
	let lastPublishAt = Number.NEGATIVE_INFINITY;
	let ticker: ReturnType<typeof setInterval> | undefined;

	const prepareReasoningProfile = (ctx: ExtensionContext): void => {
		activeProfileKey = reasoningProfileKey(ctx);
		activeLearnedRate = reasoningProfiles.get(activeProfileKey)?.rate;
	};

	const currentMeasurement = (now: number): DisplayMeasurement => {
		return selectDisplayMeasurement(
			tracker.snapshot(now),
			activeLearnedRate,
			inferenceMode === "auto" && activeProfileKey !== undefined,
		);
	};

	const currentText = (now: number): string => `${formatRate(currentMeasurement(now).rate)} tok/s`;

	const publish = (now = performance.now(), force = false): void => {
		const ctx = currentContext;
		if (!visible || !ctx || !supportsStatus(ctx)) return;

		const measurement = currentMeasurement(now);
		const text = `${formatRate(measurement.rate)} tok/s`;
		const signature = `${measurement.source}:${text}`;
		lastPublishAt = now;
		if (!force && signature === lastPublishedSignature) return;

		lastPublishedSignature = signature;
		const tone = measurement.rate < 0.05
			? "dim"
			: measurement.source === "inferred"
				? "warning"
				: "accent";
		ctx.ui.setStatus(TPS_STATUS_KEY, ctx.ui.theme.fg(tone, text));
	};

	const publishIfDue = (now = performance.now()): void => {
		if (now - lastPublishAt >= TPS_REFRESH_INTERVAL_MS) publish(now);
	};

	const stopTicker = (): void => {
		if (ticker === undefined) return;
		clearInterval(ticker);
		ticker = undefined;
	};

	const startTicker = (): void => {
		if (ticker !== undefined || !visible || !currentContext || !supportsStatus(currentContext)) return;
		ticker = setInterval(() => publish(), TPS_REFRESH_INTERVAL_MS);
		(ticker as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
	};

	const clearStatus = (ctx = currentContext): void => {
		stopTicker();
		if (ctx && supportsStatus(ctx)) ctx.ui.setStatus(TPS_STATUS_KEY, undefined);
		lastPublishedSignature = undefined;
		lastPublishAt = Number.NEGATIVE_INFINITY;
	};

	const resetToIdle = (ctx: ExtensionContext): void => {
		currentContext = ctx;
		tracker.reset();
		activeProfileKey = undefined;
		activeLearnedRate = undefined;
		prepareReasoningProfile(ctx);
		stopTicker();
		publish(performance.now(), true);
	};

	const learnReasoningRate = (
		ctx: ExtensionContext,
		telemetry: ReturnType<ThroughputTracker["finish"]>,
	): void => {
		if (
			activeProfileKey === undefined ||
			telemetry.reasoningTokens === undefined ||
			telemetry.reasoningDurationMs === undefined ||
			telemetry.reasoningDurationMs < MIN_REASONING_SAMPLE_DURATION_MS
		) {
			return;
		}

		const sampleRate = telemetry.reasoningTokens / (telemetry.reasoningDurationMs / 1_000);
		try {
			activeLearnedRate = reasoningProfiles.observe(activeProfileKey, sampleRate)?.rate ?? activeLearnedRate;
		} catch (error) {
			if (ctx.hasUI) {
				ctx.ui.notify(
					`Unable to save TPS reasoning profile: ${error instanceof Error ? error.message : String(error)}`,
					"warning",
				);
			}
		}
	};

	pi.on("session_start", (_event, ctx) => {
		lastPublishedSignature = undefined;
		resetToIdle(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		lastPublishedSignature = undefined;
		resetToIdle(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		currentContext = ctx;
		prepareReasoningProfile(ctx);
		publish(performance.now(), true);
	});

	pi.on("thinking_level_select", (_event, ctx) => {
		currentContext = ctx;
		prepareReasoningProfile(ctx);
		publish(performance.now(), true);
	});

	pi.on("turn_start", (_event, ctx) => {
		currentContext = ctx;
		tracker.beginTurn(performance.now());
		prepareReasoningProfile(ctx);
		stopTicker();
		publish(performance.now(), true);
	});

	pi.on("message_start", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		currentContext = ctx;
		prepareReasoningProfile(ctx);
		tracker.beginStream(event.message, performance.now());
		publish(performance.now(), true);
		startTicker();
	});

	pi.on("message_update", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		currentContext = ctx;
		const now = performance.now();
		tracker.observe(event.assistantMessageEvent, event.message, now);
		publishIfDue(now);
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		currentContext = ctx;
		const now = performance.now();
		const telemetry = tracker.finish(event.message, now);
		if (event.message.stopReason !== "error" && event.message.stopReason !== "aborted") {
			learnReasoningRate(ctx, telemetry);
		}
		stopTicker();
		// Completed responses are idle by definition; do not retain a final average.
		publish(now, true);
	});

	pi.on("turn_end", (_event, ctx) => {
		currentContext = ctx;
		const now = performance.now();
		const phase = tracker.snapshot(now).phase;
		if (phase === "waiting" || phase === "streaming") tracker.endWithoutResponse(now);
		stopTicker();
		publish(now, true);
	});

	pi.on("agent_settled", (_event, ctx) => {
		currentContext = ctx;
		const now = performance.now();
		const phase = tracker.snapshot(now).phase;
		if (phase === "waiting" || phase === "streaming") tracker.endWithoutResponse(now);
		stopTicker();
		publish(now, true);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		clearStatus(ctx);
		tracker.reset();
		currentContext = undefined;
	});

	const setVisibility = (nextVisible: boolean, ctx: ExtensionContext): void => {
		currentContext = ctx;
		visible = nextVisible;
		if (!visible) {
			clearStatus(ctx);
			return;
		}

		publish(performance.now(), true);
		if (tracker.snapshot(performance.now()).phase === "streaming") startTicker();
	};

	const notify = (
		ctx: ExtensionCommandContext,
		message: string,
		type: "info" | "warning",
	): void => {
		if (ctx.hasUI) ctx.ui.notify(message, type);
	};

	pi.registerCommand("tps", {
		description: "Show, hide, or configure live tokens per second",
		getArgumentCompletions: (prefix) => {
			const values = [
				"on",
				"off",
				"toggle",
				"status",
				"mode auto",
				"mode observed",
				"reset-learning",
			];
			const normalized = prefix.trim().toLowerCase();
			const matches = values
				.filter((value) => value.startsWith(normalized))
				.map((value) => ({ value, label: value }));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const command = args.trim().toLowerCase() || "status";
			switch (command) {
				case "on":
				case "show":
					setVisibility(true, ctx);
					notify(ctx, "Tokens-per-second display: ON", "info");
					return;
				case "off":
				case "hide":
					setVisibility(false, ctx);
					notify(ctx, "Tokens-per-second display: OFF", "info");
					return;
				case "toggle":
					setVisibility(!visible, ctx);
					notify(ctx, `Tokens-per-second display: ${visible ? "ON" : "OFF"}`, "info");
					return;
				case "mode auto":
					inferenceMode = "auto";
					publish(performance.now(), true);
					notify(ctx, "TPS mode: AUTO (learned hidden reasoning + observed deltas)", "info");
					return;
				case "mode observed":
					inferenceMode = "observed";
					publish(performance.now(), true);
					notify(ctx, "TPS mode: OBSERVED (hidden reasoning inference disabled)", "info");
					return;
				case "reset-learning": {
					const key = reasoningProfileKey(ctx);
					let removed = false;
					try {
						removed = reasoningProfiles.remove(key);
					} catch (error) {
						notify(
							ctx,
							`Unable to reset TPS learning: ${error instanceof Error ? error.message : String(error)}`,
							"warning",
						);
						return;
					}
					if (key === activeProfileKey) activeLearnedRate = undefined;
					publish(performance.now(), true);
					notify(ctx, removed ? "TPS reasoning profile reset" : "No TPS reasoning profile for this model", "info");
					return;
				}
				case "status": {
					const measurement = currentMeasurement(performance.now());
					const learned = activeLearnedRate === undefined
						? "untrained"
						: `${formatRate(activeLearnedRate)} learned tok/s`;
					notify(
						ctx,
						`TPS ${visible ? "ON" : "OFF"}: ${currentText(performance.now())} · ${measurement.source} · ${inferenceMode} · ${learned}`,
						"info",
					);
					return;
				}
				default:
					notify(
						ctx,
						"Usage: /tps [on|off|toggle|status|mode auto|mode observed|reset-learning]",
						"warning",
					);
			}
		},
	});
}
