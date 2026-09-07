import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	getAgentDir,
	withFileMutationQueue,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { registerCapabilities } from "./capabilities.ts";
import { showOpenAISettings, type SettingsRow } from "./settings-menu.ts";

export const FAST_ICON = "⚡";
export const FAST_SERVICE_TIER = "priority";

const STATE_ENTRY_TYPE = "openai-compatibility.fast-mode";
const STATE_FILE_NAME = "openai-compatibility.json";
/** Extension status rendered inline instead of consuming a dedicated footer row. */
const INLINE_TPS_STATUS_KEY = "tokens-per-second";
const SUPPORTED_PROVIDERS = new Set(["openai", "openai-codex"]);
const SUPPORTED_APIS = new Set(["openai-responses", "openai-codex-responses"]);

/**
 * Models currently advertising OpenAI's Fast (priority) service tier.
 * Dated snapshots of these aliases are accepted as well.
 */
const FAST_MODEL_PATTERNS = [
	/^gpt-5\.4(?:-\d{4}-\d{2}-\d{2})?$/,
	/^gpt-5\.5(?:-\d{4}-\d{2}-\d{2})?$/,
	/^gpt-5\.6-(?:sol|terra|luna)(?:-\d{4}-\d{2}-\d{2})?$/,
	/^gpt-6-astra(?:-\d{4}-\d{2}-\d{2})?$/,
];

export interface FastModelLike {
	id: string;
	provider: string;
	api: string;
}

export interface FastModeState {
	version: 1;
	enabled: boolean;
}

interface UsageTotals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	latestCacheHitRate?: number;
}

interface StatusLineLayout {
	left: string;
	padding: string;
	right: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getFastModeStatePath(): string {
	return join(getAgentDir(), STATE_FILE_NAME);
}

/** Read the agent-wide preference shared by interactive sessions and subagent processes. */
export function readFastModeState(statePath = getFastModeStatePath()): FastModeState | undefined {
	try {
		const value: unknown = JSON.parse(readFileSync(statePath, "utf8"));
		if (!isRecord(value) || value.version !== 1 || typeof value.enabled !== "boolean") {
			return undefined;
		}
		return { version: 1, enabled: value.enabled };
	} catch {
		return undefined;
	}
}

/** Atomically replace the agent-wide preference so other Pi processes never read a partial file. */
export function writeFastModeState(
	enabled: boolean,
	statePath = getFastModeStatePath(),
): void {
	mkdirSync(dirname(statePath), { recursive: true });
	const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
	try {
		writeFileSync(
			temporaryPath,
			`${JSON.stringify({ version: 1, enabled } satisfies FastModeState, null, 2)}\n`,
			{ encoding: "utf8", mode: 0o600 },
		);
		renameSync(temporaryPath, statePath);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

export function isFastModelId(modelId: string): boolean {
	const normalized = modelId.trim().toLowerCase();
	return FAST_MODEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isFastCapableModel(model: FastModelLike | undefined): boolean {
	return (
		model !== undefined &&
		SUPPORTED_PROVIDERS.has(model.provider) &&
		SUPPORTED_APIS.has(model.api) &&
		isFastModelId(model.id)
	);
}

/** Return a copy with Fast mode enabled, or the original payload when it is not applicable. */
export function applyFastServiceTier(payload: unknown, model: FastModelLike | undefined): unknown {
	if (!isFastCapableModel(model) || !isRecord(payload)) return payload;

	const payloadModel = payload.model;
	if (typeof payloadModel === "string" && !isFastModelId(payloadModel)) return payload;
	if (payload.service_tier === FAST_SERVICE_TIER) return payload;

	return { ...payload, service_tier: FAST_SERVICE_TIER };
}

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

export function layoutStatusLine(
	left: string,
	right: string,
	width: number,
	protectedSuffix?: string,
): StatusLineLayout {
	if (width <= 0) return { left: "", padding: "", right: "" };

	if (protectedSuffix) {
		const suffix = ` | ${protectedSuffix}`;
		const combinedLeft = left + suffix;
		const combinedLeftWidth = visibleWidth(combinedLeft);
		const rightWidth = visibleWidth(right);
		const minimumGap = 2;

		if (combinedLeftWidth + minimumGap + rightWidth <= width) {
			return {
				left: combinedLeft,
				padding: " ".repeat(width - combinedLeftWidth - rightWidth),
				right,
			};
		}

		// TPS is the high-priority suffix. Drop the model before dropping TPS.
		if (combinedLeftWidth <= width) {
			return { left: combinedLeft, padding: "", right: "" };
		}

		const suffixWidth = visibleWidth(suffix);
		if (suffixWidth >= width) {
			return {
				left: truncateToWidth(protectedSuffix, width, ""),
				padding: "",
				right: "",
			};
		}

		const leftBudget = width - suffixWidth;
		const fittedLeft = truncateToWidth(left, leftBudget, leftBudget >= 3 ? "..." : "");
		return { left: fittedLeft + suffix, padding: "", right: "" };
	}

	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) {
		return { left: "", padding: "", right: truncateToWidth(right, width, "") };
	}

	const minimumGap = 2;
	const leftBudget = width - rightWidth - minimumGap;
	if (leftBudget <= 0) {
		return {
			left: "",
			padding: " ".repeat(width - rightWidth),
			right,
		};
	}

	const fittedLeft = truncateToWidth(left, leftBudget, leftBudget >= 3 ? "..." : "");
	const paddingWidth = Math.max(1, width - visibleWidth(fittedLeft) - rightWidth);
	return { left: fittedLeft, padding: " ".repeat(paddingWidth), right };
}

function formatCwd(cwd: string): string {
	const home = homedir();
	const resolvedCwd = resolve(cwd);
	const resolvedHome = resolve(home);
	const relativeToHome = relative(resolvedHome, resolvedCwd);
	const insideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." && !relativeToHome.startsWith(`..${sep}`) && !isAbsolute(relativeToHome));

	if (!insideHome) return cwd;
	return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function sanitizeStatusText(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

function collectUsage(ctx: ExtensionContext): UsageTotals {
	const totals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

	for (const entry of ctx.sessionManager.getEntries()) {
		let usage:
			| {
					input: number;
					output: number;
					cacheRead: number;
					cacheWrite: number;
					cost: { total: number };
			  }
			| undefined;

		if (entry.type === "message" && entry.message.role === "assistant") {
			usage = entry.message.usage;
			const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
			totals.latestCacheHitRate = promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
		} else if (entry.type === "message" && entry.message.role === "toolResult") {
			usage = entry.message.usage;
		} else if (entry.type === "branch_summary" || entry.type === "compaction") {
			usage = entry.usage;
		}

		if (!usage) continue;
		totals.input += usage.input;
		totals.output += usage.output;
		totals.cacheRead += usage.cacheRead;
		totals.cacheWrite += usage.cacheWrite;
		totals.cost += usage.cost.total;
	}

	return totals;
}

function buildStatsText(ctx: ExtensionContext): string {
	const totals = collectUsage(ctx);
	const parts: string[] = [];

	if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
	if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
	if (totals.cacheRead) parts.push(`R${formatTokens(totals.cacheRead)}`);
	if (totals.cacheWrite) parts.push(`W${formatTokens(totals.cacheWrite)}`);
	if ((totals.cacheRead || totals.cacheWrite) && totals.latestCacheHitRate !== undefined) {
		parts.push(`CH${totals.latestCacheHitRate.toFixed(1)}%`);
	}

	const subscriptionProvider = ctx.model?.provider === "openai-codex" || ctx.model?.provider === "kimi-coding";
	if (totals.cost || subscriptionProvider) {
		parts.push(`$${totals.cost.toFixed(3)}${subscriptionProvider ? " (sub)" : ""}`);
	}

	const context = ctx.getContextUsage();
	const contextWindow = context?.contextWindow ?? ctx.model?.contextWindow;
	if (contextWindow) {
		const percentage = context?.percent == null ? "?" : context.percent.toFixed(1);
		parts.push(`${percentage}%/${formatTokens(contextWindow)}`);
	} else {
		parts.push("?%/?");
	}

	return parts.join(" ");
}

function buildModelText(ctx: ExtensionContext, fastActive: boolean, includeProvider: boolean): string {
	const model = ctx.model;
	if (!model) return "no-model";

	const parts = [model.id];
	if (model.reasoning) {
		const level = ctx.thinkingLevel ?? "off";
		parts.push(level === "off" ? "thinking off" : level);
	}

	const provider = includeProvider ? `(${model.provider}) ` : "";
	const fast = fastActive ? `${FAST_ICON} ` : "";
	return `${fast}${provider}${parts.join(" • ")}`;
}

function styleRightSide(
	text: string,
	fastActive: boolean,
	theme: ExtensionContext["ui"]["theme"],
): string {
	if (!fastActive || !text.startsWith(FAST_ICON)) return theme.fg("dim", text);
	return theme.fg("warning", FAST_ICON) + theme.fg("dim", text.slice(FAST_ICON.length));
}

function readLegacySessionState(ctx: ExtensionContext): boolean | undefined {
	let restored: boolean | undefined;
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== STATE_ENTRY_TYPE) continue;
		const state = entry.data as Partial<FastModeState> | undefined;
		if (typeof state?.enabled === "boolean") restored = state.enabled;
	}
	return restored;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export default function openAICompatibilityLayer(pi: ExtensionAPI): void {
	// Pi 0.85.1+ owns catalogs, auth, transports and cache compatibility.
	// This extension composes capability policy, Fast mode and the shared footer.
	// D14 verified this bounded Web subset. Registration stays session opt-in
	// and neither requests a service nor changes global/user settings.
	const capabilitySettings = registerCapabilities(pi, withFileMutationQueue, {
		webSearch: { transport: fetch, profile: "verified-v1" },
		openSettings: (ctx, focus) => openSettings(ctx, focus ?? "imagegen"),
		fastCommand: (args, ctx) => fastCommand(args, ctx),
	});

	const statePath = getFastModeStatePath();
	let fastEnabled = readFastModeState(statePath)?.enabled ?? false;
	let footerInstalled = false;
	let footerGeneration = 0;
	let requestFooterRender: (() => void) | undefined;

	pi.registerFlag("fast", {
		description: "Start with persistent OpenAI Fast mode enabled (priority processing)",
		type: "boolean",
		default: false,
	});

	const fastActive = (ctx: ExtensionContext): boolean => fastEnabled && isFastCapableModel(ctx.model);

	const installFooter = (ctx: ExtensionContext): void => {
		if (footerInstalled) {
			requestFooterRender?.();
			return;
		}

		footerInstalled = true;
		const generation = ++footerGeneration;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(requestFooterRender);

			return {
				dispose(): void {
					unsubscribe();
					if (footerGeneration === generation) {
						requestFooterRender = undefined;
						footerInstalled = false;
					}
				},
				invalidate(): void {},
				render(width: number): string[] {
					if (width <= 0) return [];

					let location = formatCwd(ctx.cwd);
					const branch = footerData.getGitBranch();
					if (branch) location += ` (${branch})`;
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) location += ` • ${sessionName}`;

					const active = fastActive(ctx);
					const stats = buildStatsText(ctx);
					const extensionStatuses = footerData.getExtensionStatuses();
					const inlineTps = extensionStatuses.get(INLINE_TPS_STATUS_KEY);
					const sanitizedTps = inlineTps ? sanitizeStatusText(inlineTps) : undefined;
					const inlineWidth = sanitizedTps ? visibleWidth(` | ${sanitizedTps}`) : 0;
					const compactModel = buildModelText(ctx, active, false);
					const providerModel = buildModelText(ctx, active, true);
					const useProvider =
						footerData.getAvailableProviderCount() > 1 &&
						visibleWidth(stats) + inlineWidth + 2 + visibleWidth(providerModel) <= width;
					const modelText = useProvider ? providerModel : compactModel;
					const layout = layoutStatusLine(stats, modelText, width, sanitizedTps);
					const statusLine =
						theme.fg("dim", layout.left + layout.padding) + styleRightSide(layout.right, active, theme);

					const lines = [
						truncateToWidth(theme.fg("dim", location), width, theme.fg("dim", "...")),
						statusLine,
					];

					const remainingStatuses = Array.from(extensionStatuses.entries())
						.filter(([key]) => key !== INLINE_TPS_STATUS_KEY);
					if (remainingStatuses.length > 0) {
						const text = remainingStatuses
							.sort(([left], [right]) => left.localeCompare(right))
							.map(([, value]) => sanitizeStatusText(value))
							.join(" ");
						lines.push(truncateToWidth(text, width, theme.fg("dim", "...")));
					}

					return lines;
				},
			};
		});
	};

	const syncFooter = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		// Keep one shared footer owner even when Fast mode is inactive so compact
		// inline statuses (notably TPS) never consume a dedicated terminal row.
		installFooter(ctx);
	};

	const refreshSharedState = (ctx: ExtensionContext): void => {
		const sharedState = readFastModeState(statePath);
		if (!sharedState || sharedState.enabled === fastEnabled) return;
		fastEnabled = sharedState.enabled;
		syncFooter(ctx);
	};

	const restoreState = (ctx: ExtensionContext): void => {
		const sharedState = readFastModeState(statePath);
		if (sharedState) {
			fastEnabled = sharedState.enabled;
			return;
		}

		// Migrate the latest branch-local state used by older versions. The CLI
		// flag is only a fallback when neither shared nor legacy state exists.
		const legacyState = readLegacySessionState(ctx);
		fastEnabled = legacyState ?? (pi.getFlag("fast") === true);
		if (legacyState === undefined && !fastEnabled) return;

		try {
			writeFastModeState(fastEnabled, statePath);
		} catch (error) {
			ctx.ui.notify(`Unable to migrate Fast-mode preference: ${formatError(error)}`, "error");
		}
	};

	type Notify = (message: string, type?: "info" | "warning" | "error") => void;
	const persistState = (enabled: boolean, ctx: ExtensionContext, notify: Notify): boolean => {
		try {
			writeFastModeState(enabled, statePath);
		} catch (error) {
			notify(`Unable to save Fast-mode preference: ${formatError(error)}`, "error");
			return false;
		}

		// Keep recording state in the session for compatibility with older
		// extension versions, but the agent-wide file is now canonical.
		try {
			pi.appendEntry<FastModeState>(STATE_ENTRY_TYPE, { version: 1, enabled });
		} catch (error) {
			notify(
				`Fast-mode preference was saved globally, but not recorded in this session: ${formatError(error)}`,
				"warning",
			);
		}
		return true;
	};

	const modelLabel = (ctx: ExtensionContext): string =>
		ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";

	const reportStatus = (ctx: ExtensionContext, notify: Notify = (message, type) => ctx.ui.notify(message, type)): void => {
		if (!fastEnabled) {
			notify("Fast mode: OFF", "info");
		} else if (fastActive(ctx)) {
			notify(`Fast mode: ON ${FAST_ICON} (${modelLabel(ctx)})`, "info");
		} else {
			notify(`Fast mode preference: ON, inactive for ${modelLabel(ctx)}`, "warning");
		}
	};

	const setFastMode = (enabled: boolean, ctx: ExtensionContext, notify: Notify = (message, type) => ctx.ui.notify(message, type)): boolean => {
		const alreadyPersisted = readFastModeState(statePath)?.enabled === enabled;
		if (fastEnabled === enabled && alreadyPersisted) {
			syncFooter(ctx);
			reportStatus(ctx, notify);
			return true;
		}

		if (!persistState(enabled, ctx, notify)) return false;
		fastEnabled = enabled;
		syncFooter(ctx);

		if (enabled && !fastActive(ctx)) {
			notify(
				`Fast mode preference: ON — inactive for ${modelLabel(ctx)}; it will activate automatically for a supported OpenAI model.`,
				"warning",
			);
			return true;
		}

		notify(
			enabled
				? `Fast mode: ON ${FAST_ICON} — priority processing may increase usage or cost.`
				: "Fast mode: OFF — standard processing restored.",
			"info",
		);
		return true;
	};

	const openSettings = async (ctx: ExtensionContext, focus: string): Promise<void> => {
		const version = capabilitySettings.contextVersion();
		const isCurrent = () => capabilitySettings.contextVersion() === version;
		const read = async (): Promise<SettingsRow[]> => {
			const rows = await capabilitySettings.read(ctx);
			if (!isCurrent()) throw new Error("Settings context changed. Reopen the menu.");
			refreshSharedState(ctx);
			return [{ id: "fast", label: "Fast mode", value: fastEnabled ? "on" : "off", values: ["off", "on"],
				description: `Saved for this Pi profile. Priority processing may increase usage or cost. ${isFastCapableModel(ctx.model) ? fastActive(ctx) ? "Active on this model." : "Off; this model supports Fast." : `Inactive for ${modelLabel(ctx)}; the saved preference is kept.`}` }, ...rows];
		};
		await showOpenAISettings(ctx, {
			read, isCurrent, onBoundary: capabilitySettings.onBoundary, jobs: capabilitySettings.jobs(ctx),
			async change(id, value, signal) {
				signal.throwIfAborted();
				if (!isCurrent()) throw new Error("Settings context changed. Reopen the menu.");
				if (id === "jobs") { if (value !== "refresh") throw new Error("Invalid jobs action."); return "Jobs snapshot refreshed; no job was launched."; }
				if (id === "fast") {
					if (!["on", "off"].includes(value)) throw new Error("Invalid Fast preference.");
					const messages: string[] = [];
					if (!setFastMode(value === "on", ctx, message => { messages.push(message); })) throw new Error("Could not save Fast preference. Check the displayed value before retrying.");
					return messages.join(" ");
				}
				await capabilitySettings.change(id, value, ctx, signal);
				return `${id === "unified_exec" ? "Unified exec" : id === "code_mode" ? "Code mode" : id === "web_search" ? "Web search" : "Image generation"}: ${value} for this session.`;
			},
		}, focus);
	};

	const fastCommand = async (args: string, ctx: ExtensionContext): Promise<void> => {
			refreshSharedState(ctx);
			const action = args.trim().toLowerCase();

			if (!action && ctx.hasUI && ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
				await openSettings(ctx, "fast");
				return;
			}

			switch (action || "status") {
				case "on":
				case "enable":
				case "enabled":
				case "true":
					setFastMode(true, ctx);
					break;
				case "off":
				case "disable":
				case "disabled":
				case "false":
					setFastMode(false, ctx);
					break;
				case "toggle":
					setFastMode(!fastEnabled, ctx);
					break;
				case "status":
					reportStatus(ctx);
					break;
				default:
					ctx.ui.notify("Usage: /openai-tools fast [on|off|toggle|status]", "warning");
			}
	};

	pi.on("before_provider_request", (event, ctx) => {
		refreshSharedState(ctx);
		if (!fastActive(ctx)) return;
		const payload = applyFastServiceTier(event.payload, ctx.model);
		if (payload !== event.payload) return payload;
	});

	pi.on("session_start", (_event, ctx) => {
		restoreState(ctx);
		syncFooter(ctx);
	});

	pi.on("session_tree", (_event, ctx) => {
		restoreState(ctx);
		syncFooter(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		refreshSharedState(ctx);
		syncFooter(ctx);
	});
	pi.on("thinking_level_select", (_event, ctx) => requestFooterRender?.());
	pi.on("session_info_changed", (_event, ctx) => requestFooterRender?.());

	pi.on("session_shutdown", () => {
		footerInstalled = false;
		footerGeneration++;
		requestFooterRender = undefined;
	});
}
