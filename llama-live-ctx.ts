import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

const DBG = join(homedir(), ".pi", "agent", "llama-ctx-debug.log");
function dbg(msg: string): void {
	try {
		appendFileSync(DBG, `${new Date().toISOString()} ${msg}\n`);
	} catch {
		// Ignore debug logging failures.
	}
}

/**
 * llama-live-ctx
 *
 * Fixes hardcoded per-model values for the "llama-server" provider in
 * ~/.pi/agent/models.json by querying the live llama.cpp server:
 *
 *   GET <baseUrl>/models  ->
 *     data[0].meta.n_ctx                     (allocated context)
 *     models[0].capabilities ~ "multimodal"  (mmproj / vision loaded)
 *
 * The factory performs one short live-state probe per process before the first
 * provider registration, then caches that result across /new runtime rebuilds.
 * A refused/offline endpoint fails immediately; stale checks run in the
 * background so session creation is never held up by a local server.
 *
 * - contextWindow / maxTokens are capped at the context the server actually
 *   allocated (n_ctx).
 * - input modalities are set to what the server actually accepts:
 *   ["text","image"] only when the server was started with --mmproj.
 * - If the server is offline at startup, the configured values are used
 *   unchanged.
 *
 * A best-effort refreshModels keeps the catalog in sync with later refreshes
 * (it never regresses previously known live values).
 *
 * No footer status line is shown: the agent's effective window and input
 * modalities are carried by the registered model itself, so the agent always
 * sees what it can actually use. One-time notifications fire when a
 * configured value has to be lowered. Re-check on demand with /llama-ctx.
 */

const PROVIDER_ID = "llama-server";
const FETCH_TIMEOUT_MS = 6000;
const FETCH_ATTEMPTS = 3;
const FETCH_RETRY_DELAY_MS = 500;
const STARTUP_FETCH_TIMEOUT_MS = 750;
const STALE_AFTER_MS = 30_000;

const NON_RETRYABLE_NETWORK_CODES = new Set([
	"ECONNREFUSED",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"EAI_NONAME",
	"ERR_INVALID_URL",
]);

type ConfiguredModel = ProviderModelConfig;

interface ProviderConfig {
	baseUrl: string;
	models: ConfiguredModel[];
	compat: Record<string, unknown>;
}

interface LiveState {
	/** Context the server allocated (n_ctx), or null when unknown. */
	nCtx: number | null;
	/** Whether the server accepts images (mmproj loaded), or null when unknown. */
	multimodal: boolean | null;
}

interface ModelsPayload {
	data?: Array<{ meta?: { n_ctx?: unknown } }>;
	models?: Array<{ capabilities?: string[] }>;
}

interface FetchLiveStateOptions {
	attempts?: number;
	timeoutMs?: number;
	retryDelayMs?: number;
}

interface SharedLiveState {
	live: LiveState;
	lastCheck: number;
	inFlight?: Promise<LiveState>;
}

// Pi caches an extension's imported factory while rebuilding sessions in the
// same cwd. Module-level state therefore survives /new, unlike factory locals.
const sharedStates = new Map<string, SharedLiveState>();

function getSharedState(baseUrl: string): SharedLiveState {
	const key = baseUrl.replace(/\/+$/, "");
	let state = sharedStates.get(key);
	if (!state) {
		state = {
			live: { nCtx: null, multimodal: null },
			lastCheck: 0,
		};
		sharedStates.set(key, state);
	}
	return state;
}

function isOfflineMode(): boolean {
	const value = process.env.PI_OFFLINE?.trim().toLowerCase();
	return value === "1" || value === "true" || value === "yes";
}

function loadConfiguredProvider(): ProviderConfig {
	const file = join(homedir(), ".pi", "agent", "models.json");
	try {
		const json = JSON.parse(readFileSync(file, "utf8")) as {
			providers?: Record<
				string,
				{ baseUrl?: string; models?: ConfiguredModel[]; compat?: Record<string, unknown> }
			>;
		};
		const provider = json.providers?.[PROVIDER_ID];
		return {
			baseUrl: provider?.baseUrl ?? "http://127.0.0.1:8080/v1",
			models: Array.isArray(provider?.models) ? provider.models : [],
			compat: provider?.compat ?? {},
		};
	} catch {
		return { baseUrl: "http://127.0.0.1:8080/v1", models: [], compat: {} };
	}
}

/** Mirrors pi's mergeCompat: shallow merge plus object merge for known nested keys. */
function mergeCompat(base: unknown, override: unknown): ProviderModelConfig["compat"] {
	const asRecord = (value: unknown): Record<string, unknown> | undefined =>
		typeof value === "object" && value !== null
			? (value as Record<string, unknown>)
			: undefined;
	const baseRecord = asRecord(base);
	const overrideRecord = asRecord(override);
	if (!overrideRecord) return (baseRecord ?? {}) as ProviderModelConfig["compat"];
	if (!baseRecord) return { ...overrideRecord } as ProviderModelConfig["compat"];
	const merged: Record<string, unknown> = { ...baseRecord, ...overrideRecord };
	for (const key of ["openRouterRouting", "vercelGatewayRouting", "chatTemplateKwargs", "chatTemplateArgs"]) {
		const b = baseRecord[key];
		const o = overrideRecord[key];
		if (
			(typeof b === "object" && b !== null) ||
			(typeof o === "object" && o !== null)
		) {
			merged[key] = { ...((b ?? {}) as object), ...((o ?? {}) as object) };
		}
	}
	return merged as ProviderModelConfig["compat"];
}

function findErrorCode(error: unknown, seen = new Set<unknown>()): string | undefined {
	if (typeof error !== "object" || error === null || seen.has(error)) return undefined;
	seen.add(error);
	const value = error as { code?: unknown; cause?: unknown; errors?: unknown };
	if (typeof value.code === "string") return value.code;
	const causeCode = findErrorCode(value.cause, seen);
	if (causeCode) return causeCode;
	if (Array.isArray(value.errors)) {
		for (const nested of value.errors) {
			const nestedCode = findErrorCode(nested, seen);
			if (nestedCode) return nestedCode;
		}
	}
	return undefined;
}

async function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
	if (signal.aborted || ms <= 0) return;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(done, ms);
		function done(): void {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

/**
 * Returns the live state reported by the server; nulls when unknown.
 * Transient failures are retried because a generating llama.cpp server can
 * starve its HTTP thread. Definitive offline errors are never retried.
 */
async function fetchLiveState(
	baseUrl: string,
	signal: AbortSignal,
	options: FetchLiveStateOptions = {},
): Promise<LiveState> {
	const offline: LiveState = { nCtx: null, multimodal: null };
	const url = `${baseUrl.replace(/\/+$/, "")}/models`;
	const attempts = options.attempts ?? FETCH_ATTEMPTS;
	const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
	const retryDelayMs = options.retryDelayMs ?? FETCH_RETRY_DELAY_MS;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (signal.aborted) return offline;
		try {
			const timeout = AbortSignal.timeout(timeoutMs);
			const combined =
				typeof AbortSignal.any === "function"
					? AbortSignal.any([signal, timeout])
					: signal;
			const res = await fetch(url, { signal: combined });
			if (!res.ok) {
				dbg(`fetchLiveState: attempt ${attempt} HTTP ${res.status}`);
				return offline;
			}
			const payload: ModelsPayload = await res.json();
			const nCtx = payload.data?.[0]?.meta?.n_ctx;
			const capabilities = payload.models?.[0]?.capabilities ?? [];
			dbg(
				`fetchLiveState: attempt ${attempt} ok n_ctx=${String(nCtx)} caps=${JSON.stringify(capabilities)}`,
			);
			return {
				nCtx:
					typeof nCtx === "number" && Number.isFinite(nCtx) && nCtx > 0
						? Math.floor(nCtx)
						: null,
				multimodal: capabilities.includes("multimodal"),
			};
		} catch (err) {
			const code = findErrorCode(err);
			dbg(
				`fetchLiveState: attempt ${attempt} failed${code ? ` (${code})` : ""}: ${
					err instanceof Error ? err.name + ": " + err.message : String(err)
				}`,
			);
			if (code && NON_RETRYABLE_NETWORK_CODES.has(code)) return offline;
			if (attempt < attempts && !signal.aborted) {
				await abortableDelay(retryDelayMs, signal);
			}
		}
	}
	return offline;
}

async function updateSharedState(
	shared: SharedLiveState,
	baseUrl: string,
	signal: AbortSignal,
	options?: FetchLiveStateOptions,
): Promise<LiveState> {
	if (shared.inFlight) return shared.inFlight;

	const task = (async () => {
		const fetched = await fetchLiveState(baseUrl, signal, options);
		if (fetched.nCtx !== null) shared.live = { ...shared.live, nCtx: fetched.nCtx };
		if (fetched.multimodal !== null) {
			shared.live = { ...shared.live, multimodal: fetched.multimodal };
		}
		shared.lastCheck = Date.now();
		return fetched;
	})();
	shared.inFlight = task;
	try {
		return await task;
	} finally {
		if (shared.inFlight === task) shared.inFlight = undefined;
	}
}

/**
 * Builds the model list to register: configured values, with context capped
 * at the live server context, modalities aligned with the live server, and
 * the provider-level compat merged in (extension-provided models replace the
 * models.json catalog, so the model must carry its own compat).
 */
function buildModels(cfg: ProviderConfig, live: LiveState): ConfiguredModel[] {
	return cfg.models.map((m) => {
		const patched: ConfiguredModel = {
			...m,
			compat: mergeCompat(cfg.compat, m.compat),
		};
		if (live.nCtx !== null) {
			patched.contextWindow = Math.min(m.contextWindow ?? live.nCtx, live.nCtx);
			patched.maxTokens = Math.min(m.maxTokens ?? live.nCtx, live.nCtx);
			// Make the picker entry self-documenting of the live server state.
			const baseName = m.name ?? m.id;
			const visionPart =
				live.multimodal === true
					? ", vision"
					: live.multimodal === false
						? ", text-only"
						: "";
			patched.name = `${baseName} (${Math.round(live.nCtx / 1000)}K ctx${visionPart})`;
		}
		if (live.multimodal === true) {
			patched.input = ["text", "image"];
		} else if (live.multimodal === false) {
			patched.input = ["text"];
		}
		return patched;
	});
}

export default async function llamaLiveCtx(pi: ExtensionAPI): Promise<void> {
	const cfg = loadConfiguredProvider();

	// Nothing to manage: provider missing or no configured models to patch.
	if (cfg.models.length === 0) {
		return;
	}

	const shared = getSharedState(cfg.baseUrl);

	// Preserve first-read accuracy without making startup vulnerable to the full
	// retry budget. This runs only once per process; /new reuses the result.
	if (shared.lastCheck === 0 && !isOfflineMode()) {
		const factorySignal = AbortSignal.timeout(STARTUP_FETCH_TIMEOUT_MS);
		try {
			await updateSharedState(shared, cfg.baseUrl, factorySignal, {
				attempts: 1,
				timeoutMs: STARTUP_FETCH_TIMEOUT_MS,
				retryDelayMs: 0,
			});
		} catch {
			shared.lastCheck = Date.now();
		}
	}
	const notified = { ctx: new Set<string>(), vision: new Set<string>() };

	dbg(
		`extension ready: live=${JSON.stringify(shared.live)} ` +
			`models=${buildModels(cfg, shared.live)
				.map((m) => `${m.id}:${m.contextWindow}:${JSON.stringify(m.input)}`)
				.join(",")}`,
	);

	pi.registerProvider(PROVIDER_ID, {
		// Static, already-patched catalog: in place from the first read.
		models: buildModels(cfg, shared.live),
		// Cache-only initialization must never contact the server. Network-enabled
		// refreshes retain retries for a busy llama.cpp process and share one probe.
		async refreshModels(context): Promise<ConfiguredModel[]> {
			if (!context.allowNetwork || isOfflineMode()) {
				return buildModels(cfg, shared.live);
			}
			const fetched = await updateSharedState(shared, cfg.baseUrl, context.signal);
			dbg(
				`refreshModels: fetched=${JSON.stringify(fetched)} live=${JSON.stringify(shared.live)}`,
			);
			return buildModels(cfg, shared.live);
		},
	});

	const refresh = async (signal?: AbortSignal): Promise<LiveState> => {
		if (isOfflineMode()) return { nCtx: null, multimodal: null };
		const effectiveSignal = signal ?? AbortSignal.timeout(10_000);
		return updateSharedState(shared, cfg.baseUrl, effectiveSignal);
	};

	const fmt = (n: number): string => n.toLocaleString("en-US");

	const report = (ctx: ExtensionContext, source: string): void => {
		const model = ctx.model;
		if (!model || model.provider !== PROVIDER_ID) return;

		const live = shared.live;
		const configuredDef = cfg.models.find((m) => m.id === model.id);
		const configuredWindow = configuredDef?.contextWindow ?? model.contextWindow;
		if (
			!notified.ctx.has(model.id) &&
			live.nCtx !== null &&
			typeof configuredWindow === "number" &&
			configuredWindow > model.contextWindow
		) {
			notified.ctx.add(model.id);
			ctx.ui.notify(
				`llama-server reports a live context of ${fmt(live.nCtx)} tokens; ` +
					`"${model.name ?? model.id}" window adjusted from ${fmt(configuredWindow)} ` +
					`down to ${fmt(model.contextWindow)} (${source}).`,
				"info",
			);
		}

		if (
			!notified.vision.has(model.id) &&
			live.multimodal === false &&
			(configuredDef?.input ?? []).includes("image")
		) {
			notified.vision.add(model.id);
			ctx.ui.notify(
				`llama-server is not running with --mmproj, so image input is unavailable; ` +
					`"${model.name ?? model.id}" is text-only right now (${source}).`,
				"warning",
			);
		}
	};

	const refreshInBackgroundIfStale = (ctx: ExtensionContext): void => {
		if (
			ctx.model?.provider !== PROVIDER_ID ||
			isOfflineMode() ||
			Date.now() - shared.lastCheck <= STALE_AFTER_MS
		) {
			return;
		}
		// Do not retain or use ctx after this synchronous check: /new may invalidate
		// it while the probe is running.
		void refresh().catch((error) => {
			dbg(`background refresh failed: ${error instanceof Error ? error.message : String(error)}`);
		});
	};

	pi.on("session_start", (_event, ctx) => {
		report(ctx, "session start");
		refreshInBackgroundIfStale(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		report(ctx, "model select");
		refreshInBackgroundIfStale(ctx);
	});

	pi.registerCommand("llama-ctx", {
		description: "Re-check the live llama.cpp context size and vision state",
		handler: async (_args, ctx) => {
			let fetched: LiveState = { nCtx: null, multimodal: null };
			try {
				fetched = await refresh();
			} catch {
				// Fall through; report shows the last known state.
			}
			report(ctx, "manual check");
			const model = ctx.model;
			const onThisServer = model !== undefined && model.provider === PROVIDER_ID;
			const windowPart =
				onThisServer && model !== undefined ? `, model window ${fmt(model.contextWindow)}` : "";
			const cachedWindow = shared.live.nCtx;
			ctx.ui.notify(
				fetched.nCtx === null
					? `llama-server unreachable at ${cfg.baseUrl}; using ${
							cachedWindow === null
								? "configured values"
								: `last known live values (${fmt(cachedWindow)} token context)`
						}.`
					: `Live: ${fmt(fetched.nCtx)} token context, ${
						fetched.multimodal === true ? "vision enabled" : "no vision (no --mmproj)"
					}${windowPart}.`,
				"info",
			);
		},
	});
}
