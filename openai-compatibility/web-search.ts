import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { CapabilityLease } from "./capability-policy.ts";
import { readBoundedJson, withAbort } from "./http.ts";
import { webHistoryInput } from "./web-history.ts";
import { sealWebResult, WEB_TEXT_PREFIX, WEB_SOURCES_PREFIX } from "./runtime/web-result.mjs";

export const WEB_SEARCH_ENDPOINT = "https://chatgpt.com/backend-api/codex/alpha/search";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_EVIDENCE_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 16 * 1024;
const boundedList = <T extends Parameters<typeof Type.Array>[0]>(item: T) => Type.Optional(Type.Array(item, { minItems: 1, maxItems: 4 }));
const text = (maxLength: number) => Type.String({ minLength: 1, maxLength });

const searchQuery = Type.Object({
	q: text(2000),
	recency: Type.Optional(Type.Integer({ minimum: 0, maximum: 3650 })),
	domains: Type.Optional(Type.Array(text(253), { minItems: 1, maxItems: 10 })),
}, { additionalProperties: false });
const date = () => Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$", minLength: 10, maxLength: 10 });
/** Pinned SearchCommands DTO names; these are bounded, source-only experimental variants.
 * Click/opaque references still require an owned continuation contract. Image queries and
 * URL screenshots do not imply image download/forwarding: existing text/opaque reply caps apply.
 */
export const WEB_SEARCH_OPERATIONS = Object.freeze(["search_query", "image_query", "open", "find", "screenshot", "finance", "weather", "sports", "time"] as const);
export const WebSearchCommands = Type.Object({
	search_query: boundedList(searchQuery),
	image_query: boundedList(searchQuery),
	open: boundedList(Type.Object({ ref_id: text(4096), lineno: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })) }, { additionalProperties: false })),
	find: boundedList(Type.Object({ ref_id: text(4096), pattern: text(1000) }, { additionalProperties: false })),
	screenshot: boundedList(Type.Object({ ref_id: text(4096), pageno: Type.Integer({ minimum: 0, maximum: 1_000_000 }) }, { additionalProperties: false })),
	finance: boundedList(Type.Object({
		ticker: text(64),
		type: Type.Union([Type.Literal("equity"), Type.Literal("fund"), Type.Literal("crypto"), Type.Literal("index")]),
		market: Type.Optional(Type.String({ maxLength: 3, pattern: "^(?:[A-Z]{3})?$" })),
	}, { additionalProperties: false })),
	weather: boundedList(Type.Object({
		location: text(512), start: Type.Optional(date()),
		duration: Type.Optional(Type.Integer({ minimum: 1, maximum: 366 })),
	}, { additionalProperties: false })),
	sports: boundedList(Type.Object({
		tool: Type.Optional(Type.Literal("sports")),
		fn: Type.Union([Type.Literal("schedule"), Type.Literal("standings")]),
		league: Type.Union([Type.Literal("nba"), Type.Literal("wnba"), Type.Literal("nfl"), Type.Literal("nhl"), Type.Literal("mlb"), Type.Literal("epl"), Type.Literal("ncaamb"), Type.Literal("ncaawb"), Type.Literal("ipl")]),
		team: Type.Optional(text(32)), opponent: Type.Optional(text(32)),
		date_from: Type.Optional(date()), date_to: Type.Optional(date()),
		num_games: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })), locale: Type.Optional(text(64)),
	}, { additionalProperties: false })),
	time: boundedList(Type.Object({ utc_offset: Type.String({ minLength: 6, maxLength: 6, pattern: "^[+-](?:[01][0-9]|2[0-3]):[0-5][0-9]$" }) }, { additionalProperties: false })),
	response_length: Type.Optional(Type.Union([Type.Literal("short"), Type.Literal("medium"), Type.Literal("long")])),
}, { additionalProperties: false });
export type SearchCommands = Static<typeof WebSearchCommands>;
type ErrorKind = "arguments" | "busy" | "auth" | "quota" | "unsupported" | "transport" | "response" | "cancelled";
export class WebSearchError extends Error {
	readonly kind: ErrorKind;
	constructor(kind: ErrorKind, message: string) { super(message); this.name = "WebSearchError"; this.kind = kind; }
}

function publicHostname(host: string): boolean {
	return host.length <= 253 && host.includes(".") && !isIP(host) && !host.includes(":")
		&& !/(?:^|\.)(?:localhost|local|internal|lan|home|onion|invalid|test)$/.test(host)
		&& host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}
function assertPublicUrl(value: string): void {
	let url: URL;
	try { url = new URL(value); } catch { throw new WebSearchError("arguments", "Open/find/screenshot currently require an absolute public HTTP(S) URL; opaque reference continuation is not verified."); }
	if (!/^https?:\/\//i.test(value) || !["https:", "http:"].includes(url.protocol) || url.username || url.password
		|| url.hash || url.port || /[\s\\]/.test(value) || !publicHostname(url.hostname)) {
		throw new WebSearchError("arguments", "Open/find/screenshot URL rejected: public HTTP(S), no credentials, fragments, custom ports, IP literals, or local hosts.");
	}
}

function assertDate(value: string | undefined): void {
	if (value === undefined) return;
	const [year, month, day] = value.split("-").map(Number);
	const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new WebSearchError("arguments", "Web lookup dates must be real Gregorian YYYY-MM-DD dates, years 0001–9999.");
}

export function validateSearchCommands(value: unknown): SearchCommands {
	if (!Value.Check(WebSearchCommands, value)) throw new WebSearchError("arguments", "Invalid Web search commands or unsupported fields.");
	const commands = structuredClone(value);
	const count = WEB_SEARCH_OPERATIONS.reduce((total, name) => total + (commands[name]?.length ?? 0), 0);
	if (count < 1 || count > 4) throw new WebSearchError("arguments", "Web search requires one to four total supported operations, across all command families.");
	for (const query of [...(commands.search_query ?? []), ...(commands.image_query ?? [])]) {
		if (!query.q.trim()) throw new WebSearchError("arguments", "Search queries must not be blank.");
		for (const domain of query.domains ?? []) if (!publicHostname(domain)) throw new WebSearchError("arguments", "Domain filters must be public lowercase hostnames, not URLs, wildcards or local addresses.");
	}
	for (const item of [...(commands.open ?? []), ...(commands.find ?? []), ...(commands.screenshot ?? [])]) assertPublicUrl(item.ref_id);
	for (const item of commands.find ?? []) if (!item.pattern.trim()) throw new WebSearchError("arguments", "Find patterns must not be blank.");
	for (const item of commands.finance ?? []) {
		if (!item.ticker.trim() || (item.market === "" && item.type !== "crypto")) throw new WebSearchError("arguments", "Finance requires a nonblank ticker; an empty market is reserved for crypto.");
	}
	for (const item of commands.weather ?? []) {
		if (!item.location.trim()) throw new WebSearchError("arguments", "Weather locations must not be blank.");
		assertDate(item.start);
	}
	for (const item of commands.sports ?? []) {
		for (const value of [item.team, item.opponent, item.locale]) if (value !== undefined && !value.trim()) throw new WebSearchError("arguments", "Sports filters must not be blank.");
		assertDate(item.date_from); assertDate(item.date_to);
		if (item.date_from !== undefined && item.date_to !== undefined && item.date_from > item.date_to) throw new WebSearchError("arguments", "Sports date_from must not follow date_to.");
	}
	return commands;
}

export interface SearchEvidence {
	output: string;
	/** Kept opaque and intact, including future result variants. No invented citation interpretation. */
	results?: unknown[];
}
export function parseSearchEvidence(value: unknown): SearchEvidence {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new WebSearchError("response", "Web search returned an invalid response object.");
	const data = value as Record<string, unknown>;
	if (typeof data.output !== "string" || !data.output.trim() || Buffer.byteLength(data.output) > MAX_TEXT_BYTES) {
		throw new WebSearchError("response", "Web search returned missing or oversized text; citation evidence was not truncated.");
	}
	if (data.results !== undefined && data.results !== null && (!Array.isArray(data.results) || data.results.length > 100
		|| Buffer.byteLength(JSON.stringify(data.results)) > MAX_EVIDENCE_BYTES)) {
		throw new WebSearchError("response", "Web search returned invalid or oversized source evidence; no partial evidence was released.");
	}
	// encrypted_output is deliberately not persisted, exposed, or replayed. Its continuation contract is unverified.
	return { output: data.output, ...(Array.isArray(data.results) ? { results: data.results } : {}) };
}

export function renderSearchEvidence(evidence: SearchEvidence, verification: "source-contract-only" | "subscription-smoke-verified-subset" = "source-contract-only") {
	return sealWebResult([
		{ type: "text", text: WEB_TEXT_PREFIX + evidence.output },
		...(evidence.results ? [{ type: "text" as const, text: WEB_SOURCES_PREFIX + JSON.stringify(evidence.results) }] : []),
	], verification, evidence.results !== undefined);
}

/** Low-level adapter: requires an explicit transport and a shared provider/OAuth lease.
 * web-search-tool.ts supplies the tool/auth boundary. Normal registration uses verified-v1;
 * the broader experimental command surface is source-derived, not live-service verified.
 * A session is private to this instance; do not share one across conversations.
 */
export class WebSearchAdapter {
	private transport: typeof fetch;
	private timeoutMs: number;
	private sessionId: string = randomUUID();
	private active?: AbortController;
	constructor(transport: typeof fetch, timeoutMs = 30_000) {
		if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("Invalid Web search deadline.");
		this.transport = transport; this.timeoutMs = timeoutMs;
	}
	reset(): void {
		this.active?.abort();
		this.active = undefined;
		this.sessionId = randomUUID();
	}
	async search(options: {
		commands: unknown;
		model: string;
		lease: CapabilityLease;
		getAuth: () => Promise<{ token: string; accountId: string }>;
		/** Trusted native snapshot only; never a model argument or raw session reader. */
		history?: readonly { role: string; content?: unknown }[];
	}): Promise<SearchEvidence> {
		options.lease.assertCurrent();
		const commands = validateSearchCommands(options.commands);
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(options.model)) throw new WebSearchError("arguments", "Invalid Web search model identifier.");
		const input = options.history === undefined ? undefined : webHistoryInput(options.history);
		const body = JSON.stringify({ id: this.sessionId, model: options.model, commands, settings: { search_context_size: "low" }, max_output_tokens: 4096,
			...(input?.length ? { input } : {}),
		});
		if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new WebSearchError("arguments", "Web search request exceeds 16 KiB.");
		if (this.active) throw new WebSearchError("busy", "A Web search is already in progress for this session.");
		const operation = new AbortController(); this.active = operation;
		const timer = setTimeout(() => operation.abort(), this.timeoutMs);
		const signal = AbortSignal.any([options.lease.signal, operation.signal]);
		let response: Response | undefined;
		try {
			let auth: { token: string; accountId: string };
			try { auth = await withAbort(Promise.resolve().then(() => { signal.throwIfAborted(); options.lease.assertCurrent(); return options.getAuth(); }), signal); }
			catch { throw new WebSearchError("auth", "Codex subscription OAuth authentication failed; no API fallback was attempted."); }
			options.lease.assertCurrent(); signal.throwIfAborted();
			if (!auth.token || !auth.accountId) throw new WebSearchError("auth", "Codex subscription OAuth credentials are missing.");
			response = await withAbort<Response>(Promise.resolve().then(async () => {
				signal.throwIfAborted(); options.lease.assertCurrent();
				const response = await this.transport(WEB_SEARCH_ENDPOINT, {
					method: "POST", redirect: "error", signal,
					headers: { Authorization: `Bearer ${auth.token}`, "ChatGPT-Account-Id": auth.accountId, "Content-Type": "application/json", Accept: "application/json", originator: "codex_cli_rs", "User-Agent": "pi-openai-compatibility/0.2.0" },
					body,
				});
				if (signal.aborted) { void response.body?.cancel().catch(() => {}); signal.throwIfAborted(); }
				return response;
			}), signal);
			options.lease.assertCurrent(); signal.throwIfAborted();
			if (!response.ok) {
				// No response-body echo, retry loop, alternate endpoint, or fallback authentication.
				void response.body?.cancel().catch(() => {});
				if ([401, 403].includes(response.status)) throw new WebSearchError("auth", "Codex subscription Web search authorization or entitlement failed; check /login.");
				if (response.status === 429) throw new WebSearchError("quota", "Codex subscription Web search quota reached; request was not retried.");
				if ([404, 405, 410, 501].includes(response.status)) throw new WebSearchError("unsupported", "Codex subscription Web search is unavailable for this service contract.");
				throw new WebSearchError("transport", `Codex Web search failed (HTTP ${response.status}); remote error text withheld.`);
			}
			const evidence = parseSearchEvidence(await readBoundedJson(response, MAX_RESPONSE_BYTES, signal));
			options.lease.assertCurrent(); signal.throwIfAborted();
			const visible = evidence.output + JSON.stringify(evidence.results ?? []);
			if (visible.includes(auth.token) || visible.includes(auth.accountId)) throw new WebSearchError("response", "Web search response withheld because it echoed authentication material.");
			return evidence;
		} catch (error) {
			if (signal.aborted) throw new WebSearchError("cancelled", "Web search cancelled, revoked, or timed out; result withheld. Remote work may already have occurred.");
			if (error instanceof WebSearchError) throw error;
			throw new WebSearchError("transport", "Web search transport/response failed; no retry or API fallback was attempted.");
		} finally {
			clearTimeout(timer);
			void response?.body?.cancel().catch(() => {});
			if (this.active === operation) this.active = undefined;
		}
	}
}
