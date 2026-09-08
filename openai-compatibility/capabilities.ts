import { createUnifiedExecTools, UnifiedExecManager, unifiedOwner, nativeShellStatus } from "./unified-exec.ts";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Value } from "typebox/value";
import { assertOfficialContext, CapabilityEpoch, type CapabilityLease } from "./capability-policy.ts";
import { createImagegenTool, type MutationQueue } from "./imagegen/tool.ts";
import { WebSearchAdapter } from "./web-search.ts";
import { createWebSearchTool, type WebSearchProfile } from "./web-search-tool.ts";
import { subscriptionStatus } from "./subscription.ts";
import { ToolOwnership } from "./tool-ownership.ts";
import { CodeMode, createCodeModeTools, toolGatewayInfo } from "./code-mode.ts";
import type { SettingsRow, JobsController } from "./settings-menu.ts";
import { CAPABILITY_NAMES, DEFAULT_CAPABILITIES, type CapabilityName, type CapabilityPreferences, type CapabilityPreferenceStore } from "./capability-preferences.ts";

/** Trusted composition only, never a model parameter. The normal entry point
 * selects the D14 Web protocol subset and profile-local preference storage;
 * neither stored choices nor protocol selection supplies execution authority.
 */
export interface CapabilityOptions {
	webSearch?: { transport: typeof fetch; timeoutMs?: number; profile?: WebSearchProfile };
	openSettings?: (ctx: ExtensionContext, focus?: string) => Promise<void>;
	fastCommand?: (args: string, ctx: ExtensionContext) => Promise<void>;
	/** Trusted profile-local storage, not a model/tool parameter. Omitted in isolated compositions. */
	preferences?: CapabilityPreferenceStore;
}
class CapabilityPreferenceError extends Error {}
export interface CapabilitySettings {
	read(ctx: ExtensionContext): Promise<SettingsRow[]>;
	change(id: string, value: string, ctx: ExtensionContext, signal: AbortSignal): Promise<void>;
	jobs(ctx: ExtensionContext): JobsController;
	contextVersion(): number;
	onBoundary(close: () => void): () => void;
}

export function registerCapabilities(pi: ExtensionAPI, mutationQueue: MutationQueue, options: CapabilityOptions = {}): CapabilitySettings {
	const epoch = new CapabilityEpoch();
	const processes = new UnifiedExecManager();
	const codeMode = new CodeMode(() => pi.getActiveTools());
	const search = options.webSearch ? new WebSearchAdapter(options.webSearch.transport, options.webSearch.timeoutMs) : undefined;
	let current: ExtensionContext | undefined;
	let preferenceEpoch = 0;
	let menuEpoch = 0;
	const menuBoundaries = new Set<() => void>();
	let turnId = randomUUID();
	const enabled = new Set(["imagegen"]);
	let preferences: CapabilityPreferences = { ...DEFAULT_CAPABILITIES };
	let preferenceError: string | undefined;
	const groups: Record<CapabilityName, string[]> = { imagegen: ["imagegen"], web_search: ["web_search"], unified_exec: ["exec_command", "write_stdin"], code_mode: ["exec", "wait"] };
	const definitions = new Map<string, ToolDefinition>();
	const pending = new Map<string, CapabilityLease>();
	const ownership = new ToolOwnership(pi, definitions);

	function assertAllowed(name: string, ctx: ExtensionContext) {
		assertOfficialContext(ctx);
		assertOfficialContext(current ?? ctx);
		if (current && (current.cwd !== ctx.cwd || current.sessionManager.getSessionId() !== ctx.sessionManager.getSessionId()
			|| current.model?.provider !== ctx.model?.provider || current.model?.id !== ctx.model?.id)) {
			throw new Error("OpenAI invocation belongs to a stale model or session.");
		}
		ownership.assert(name);
		if (!enabled.has(name) || !pi.getActiveTools().includes(name)) throw new Error(`${name} is disabled for this session.`);
	}
	function leaseFor(name: string, ctx: ExtensionContext, signal?: AbortSignal): CapabilityLease {
		return epoch.lease(() => assertAllowed(name, ctx), signal);
	}
	function add(tool: ToolDefinition) {
		// Public factory constants may be shared by another installation. Own a private schema.
		const parameters = structuredClone(tool.parameters);
		definitions.set(tool.name, {
			...tool, parameters,
			async execute(id, params, signal, update, ctx) {
				// Pi permits tool_call hooks to mutate arguments without revalidation. Revalidate at the actual boundary.
				if (!Value.Check(parameters, params)) throw new Error(`Invalid ${tool.name} arguments.`);
				const lease = leaseFor(tool.name, ctx, signal);
				if (pending.size >= 128 || pending.has(id)) { lease.release(); throw new Error("Duplicate or too many unfinalized OpenAI calls."); }
				pending.set(id, lease);
				try {
					const result = await tool.execute(id, params, lease.signal, update ? (result) => { lease.assertCurrent(); update(result); } : undefined, ctx);
					lease.assertCurrent();
					return result;
				} finally { lease.release(); }
			},
		});
	}
	add(createImagegenTool((ctx, signal) => leaseFor("imagegen", ctx, signal), () => turnId, mutationQueue));
	for (const tool of createUnifiedExecTools(processes, leaseFor)) add(tool);
	if (search) add(createWebSearchTool(search, (ctx, signal) => leaseFor("web_search", ctx, signal), options.webSearch?.profile));

	function sync(ctx: ExtensionContext) {
		current = ctx;
		let trusted = true;
		try { assertOfficialContext(ctx); } catch { trusted = false; }
		const active = pi.getActiveTools().filter((name) => !definitions.has(name));
		if (trusted) active.push(...[...enabled].filter((name) => definitions.has(name) && ownership.owns(name)));
		pi.setActiveTools([...new Set(active)]);
	}
	function reset(ctx?: ExtensionContext) {
		preferenceEpoch++;
		epoch.revoke();
		search?.reset();
		const cells = codeMode.reset();
		// Keep revoked leases until tool_result so a switch away AND back cannot release a stale result.
		if (ctx) sync(ctx);
		return Promise.all([cells, processes.reset()]).then(() => {});
	}
	function boundaryReset(ctx?: ExtensionContext) {
		menuEpoch++;
		const closing = reset(ctx);
		for (const close of [...menuBoundaries]) { try { close(); } catch { /* UI must not prevent native cleanup. */ } }
		return closing;
	}
	pi.on("session_start", async (_event, ctx) => {
		// Stock/older hosts keep ordinary exec/wait names untouched. The marker is
		// compatibility metadata only; execution still requires genuine authority.
		if (toolGatewayInfo(ctx)) for (const tool of createCodeModeTools(codeMode)) if (!definitions.has(tool.name)) add(tool);
		// All extension factories are loaded and Pi's metadata API is now bound.
		// Reserve our names fail-closed, but never replace another handler.
		try { ownership.install(); } catch { /* status and execution report fixed ownership errors */ }
		pending.clear(); enabled.clear();
		const closing = boundaryReset(ctx), revision = preferenceEpoch;
		preferenceError = undefined;
		try { preferences = options.preferences?.read() ?? { ...DEFAULT_CAPABILITIES }; }
		catch {
			preferences = { imagegen: false, web_search: false, unified_exec: false, code_mode: false };
			preferenceError = "Saved capability preferences could not be read. All capability choices are off; preserve the profile file.";
			ctx.ui.notify(preferenceError, "warning");
		}
		// Restore choices, never authority or jobs. Passive inspection cannot launch,
		// authenticate or relax native admission. A newer boundary wins this race.
		const [shell, code] = await Promise.all([
			preferences.unified_exec ? nativeShellStatus() : undefined,
			preferences.code_mode ? codeMode.status(ctx) : undefined,
			closing,
		]);
		if (revision !== preferenceEpoch) return;
		for (const name of CAPABILITY_NAMES) {
			if (!preferences[name] || (name === "web_search" && !search) || (name === "unified_exec" && !shell?.available) || (name === "code_mode" && !code?.available)) continue;
			for (const tool of groups[name]) enabled.add(tool);
		}
		sync(ctx);
	});
	pi.on("model_select", (_event, ctx) => boundaryReset(ctx));
	pi.on("session_before_switch", () => boundaryReset());
	pi.on("session_before_fork", () => boundaryReset());
	pi.on("session_before_tree", () => boundaryReset());
	pi.on("session_tree", (_event, ctx) => boundaryReset(ctx));
	pi.on("session_shutdown", async () => { await boundaryReset(); await processes.close(); pending.clear(); current = undefined; });
	pi.on("turn_start", () => { turnId = randomUUID(); });
	pi.on("tool_call", (event, ctx) => {
		if (!definitions.has(event.toolName)) return;
		try { assertAllowed(event.toolName, ctx); }
		catch (error) { return { block: true, reason: (error as Error).message }; }
	});
	pi.on("tool_result", (event, ctx) => {
		if (!definitions.has(event.toolName)) return;
		const lease = pending.get(event.toolCallId);
		pending.delete(event.toolCallId);
		try {
			assertAllowed(event.toolName, ctx);
			if (!lease) throw new Error("Unknown or pre-reload OpenAI result.");
			lease.assertCurrent();
		}
		catch {
			return { content: [{ type: "text", text: "OpenAI result withheld: capability or session authorization changed." }], details: {}, isError: true };
		}
	});
	function jobs(ctx: ExtensionContext): JobsController {
		const version = menuEpoch, owner = unifiedOwner(ctx);
		const assertCurrent = () => { if (version !== menuEpoch || (current && unifiedOwner(current) !== owner)) throw new Error("Jobs context changed. Reopen OpenAI settings."); };
		return {
			read() { assertCurrent(); return processes.inspect(owner); },
			async cancel(id, signal) { signal.throwIfAborted(); assertCurrent(); await processes.cancel(owner, id); },
		};
	}
	async function changePreference(input: string, action: string, ctx: ExtensionContext, signal?: AbortSignal): Promise<void> {
		if (!Object.hasOwn(groups, input) || !["on", "off"].includes(action)) throw new CapabilityPreferenceError("Unknown capability setting.");
		const name = input as CapabilityName;
		signal?.throwIfAborted();
		if (name === "web_search" && !search) throw new CapabilityPreferenceError("Web search unavailable: this composition has no configured search transport/profile.");
		if (name === "unified_exec" && action === "on") {
			const requestedEpoch = preferenceEpoch, status = await nativeShellStatus();
			if (requestedEpoch !== preferenceEpoch) throw new CapabilityPreferenceError("Unified exec preference change revoked by a newer policy/session boundary.");
			signal?.throwIfAborted();
			if (!status.available) throw new CapabilityPreferenceError(`Unified exec unavailable: ${status.reason}`);
		}
		if (name === "code_mode" && action === "on") {
			const requestedEpoch = preferenceEpoch;
			const status = await codeMode.status(ctx);
			if (requestedEpoch !== preferenceEpoch) throw new CapabilityPreferenceError("Code mode preference change revoked by a newer policy/session boundary.");
			signal?.throwIfAborted();
			if (!status.available) throw new CapabilityPreferenceError(`Code mode unavailable: ${status.reason}. No compiler or unrestricted fallback.`);
			if (!["exec", "wait"].every(tool => ownership.owns(tool))) throw new CapabilityPreferenceError("Code mode unavailable: exec/wait namespace is conflicting, excluded or replaced.");
		}
		signal?.throwIfAborted();
		if (action === "on" && !groups[name].every(tool => ownership.owns(tool))) throw new CapabilityPreferenceError("Capability unavailable: tool namespace is conflicting, excluded or replaced; saved preference was not changed.");
		try { options.preferences?.write(name, action === "on"); }
		catch { throw new CapabilityPreferenceError("Could not save capability preference; the current selection was not changed. Preserve the profile file."); }
		preferences[name] = action === "on";
		preferenceError = undefined;
		for (const tool of groups[name]) { if (action === "on") enabled.add(tool); else enabled.delete(tool); }
		await reset(ctx);
	}
	async function readSettings(ctx: ExtensionContext): Promise<SettingsRow[]> {
		const revision = preferenceEpoch;
		const [code, shell] = await Promise.all([codeMode.status(ctx), nativeShellStatus()]);
		if (revision !== preferenceEpoch) throw new Error("Configuration changed. Reopen settings.");
		let trusted = true; try { assertOfficialContext(ctx); } catch { trusted = false; }
		const codeReasons: Record<string, string> = {
			PRIVATE_HOST_GATEWAY_V1_REQUIRED: "Use the compatible patched Pi host.", NATIVE_PROTECTED_PUBLICATION_REQUIRED: "Native protected results are required.",
			WINDOWS_X64_REQUIRED: "Requires Windows x64.", NODE_24_OR_25_REQUIRED: "Requires Node 24 or 25.",
			NATIVE_ARTIFACT_MISSING: "Verified prebuilt helper is missing.", NATIVE_ARTIFACT_INVALID_OR_UNREADABLE: "Prebuilt helper verification failed.",
		};
		const labels: Record<string, string> = { imagegen: "Image generation", web_search: "Web search", unified_exec: "Unified exec", code_mode: "Code mode" };
		const descriptions: Record<string, string> = {
			imagegen: "Generate/edit images; preserve canonical originals. Codex OAuth and service access checked at execution.",
			web_search: "Bounded search or public-URL open. Codex OAuth and service access checked at execution.",
			unified_exec: "Full-OS pipes, not a shell sandbox or PTY. Patched-host direct completions enter native history and the next safe model request, not a new idle turn. Poll for input/remaining output. Two shared native scopes; jobs are not saved.",
			code_mode: "Bounded JavaScript coordinating native tools. Delegated shell commands retain full OS permissions. Cells/jobs are not restored.",
		};
		const active = pi.getActiveTools();
		const rows: SettingsRow[] = CAPABILITY_NAMES.map(id => {
			const names = groups[id];
			const reason = !trusted ? "Select an official native OpenAI route." : id === "web_search" && !search ? "No search transport configured."
				: !names.every(name => ownership.owns(name)) ? "Tool names are excluded, conflicting or replaced."
				: id === "unified_exec" && !shell.available ? shell.reason
				: id === "code_mode" && !code.available ? codeReasons[code.reason ?? ""] ?? "Native runtime is unavailable." : undefined;
			const saved = `${options.preferences ? "Saved for this Pi profile" : "Session preference"}: ${preferences[id] ? "on" : "off"}.`;
			return { id, label: labels[id], value: reason ? "unavailable" : preferences[id] ? "on" : "off",
				description: `${preferenceError ?? saved} ${reason ? `${reason} Inactive; no tool is enabled by this row.` : `${descriptions[id]} ${names.every(name => active.includes(name)) ? "Active in this session." : "Inactive in this session."}`}`, values: reason ? undefined : ["off", "on"] };
		});
		const auth = trusted ? subscriptionStatus(ctx) : "Not inspected on an unsupported route.";
		const ownedJobs = jobs(ctx).read();
		rows.push(
			{ id: "jobs", label: "Jobs", value: `${ownedJobs.filter(job => job.running).length} running / ${ownedJobs.length} retained`, values: ["refresh"], description: "Open this session's Unified exec job snapshot; refresh or explicitly cancel an owned job. Cancellation cannot undo completed effects." },
			{ id: "route", label: "Conversation route", value: trusted ? "official OpenAI" : "unsupported", description: `${ctx.model?.provider ?? "No provider"}/${ctx.model?.id ?? "no model"}. Models/providers remain owned by Pi; change them with Pi's model selector.` },
			{ id: "subscription", label: "Codex subscription", value: !trusted ? "not inspected" : auth.startsWith("Codex OAuth configured") ? "configured" : auth.startsWith("missing") ? "login required" : "unavailable", description: `${auth}. Opening settings never refreshes credentials or probes service access.` },
			{ id: "runtime", label: "Code runtime", value: !code.available ? "unavailable" : code.native?.drainingScopes ? "draining" : code.native?.activeScopes === 2 ? "busy" : "ready", description: code.available ? `Verified Windows preflight; launch is checked again. Native scopes: ${code.native?.activeScopes ?? 0} active, ${code.native?.drainingScopes ?? 0} draining / 2. Draining blocks new admission; no fallback.` : codeReasons[code.reason ?? ""] ?? "Compatible native host and verified prebuilt helper required; no runtime download or compiler." },
		);
		return rows;
	}
	pi.registerCommand("openai-tools", {
		description: "OpenAI settings, Fast, capability switches and owned jobs",
		getArgumentCompletions(prefix) {
			const values = ["status", "fast", "fast on", "fast off", "fast toggle", "fast status", "jobs", "jobs status", "jobs cancel ", ...Object.keys(groups).flatMap(name => [`${name} on`, `${name} off`])];
			const matches = values.filter(value => value.startsWith(prefix.trim().toLowerCase())).map(value => ({ value, label: value }));
			return matches.length ? matches : null;
		},
		async handler(args, ctx) {
			if (!args.trim() && ctx.hasUI && ctx.mode === "tui" && typeof ctx.ui.custom === "function" && options.openSettings) { await options.openSettings(ctx); return; }
			const [name, action, extra, trailing] = args.trim().split(/\s+/);
			if (name === "fast" && options.fastCommand) { await options.fastCommand(args.trim().slice(4).trim(), ctx); return; }
			if (name === "jobs") {
				if (!action && ctx.hasUI && ctx.mode === "tui" && typeof ctx.ui.custom === "function" && options.openSettings) { await options.openSettings(ctx, "jobs"); return; }
				try {
					const control = jobs(ctx);
					if (action === "cancel" && extra && !trailing) { await control.cancel(extra, new AbortController().signal); ctx.ui.notify("Unified exec job cancelled.", "info"); }
					else if ((!action || action === "status") && !extra) ctx.ui.notify(JSON.stringify(control.read(), null, 2), "info");
					else ctx.ui.notify("Usage: /openai-tools jobs [status | cancel <session_id>]", "warning");
				} catch (error) { ctx.ui.notify((error as Error).message, "warning"); }
				return;
			}
			if (name && name !== "status") {
				if (!["imagegen", "unified_exec", "web_search", "code_mode"].includes(name) || !["on", "off"].includes(action) || extra) {
					ctx.ui.notify("Usage: /openai-tools [status | fast on|off|toggle|status | jobs status|cancel <session_id> | imagegen|unified_exec|web_search|code_mode on|off]", "warning"); return;
				}
				try { await changePreference(name, action, ctx); }
				catch (error) { if (!(error instanceof CapabilityPreferenceError)) throw error; ctx.ui.notify(error.message, "warning"); return; }
			}
			let trusted = true;
			try { assertOfficialContext(ctx); } catch { trusted = false; }
			const reason = trusted ? "official OpenAI route" : "unsupported/untrusted provider or endpoint";
			const auth = trusted ? subscriptionStatus(ctx) : "not inspected for an unsupported provider";
			const searchStatus = !search ? "unavailable; no configured search transport/profile"
				: pi.getActiveTools().includes("web_search")
					? options.webSearch?.profile === "verified-v1" ? "enabled; verified search/public-URL-open subset, direct or native protected scope; current entitlement checked at execution" : "enabled for isolated validation; source-contract-only, no opaque replay"
					: "off; /openai-tools web_search on";
			const [codeStatus, shellStatus] = await Promise.all([codeMode.status(ctx), nativeShellStatus()]);
			const codeDescription = !codeStatus.available ? `unavailable; ${codeStatus.reason}`
				: `${pi.getActiveTools().includes("exec") ? "enabled" : "off; /openai-tools code_mode on"}; Windows x64 native preflight ready (launch rechecked); native scopes ${codeStatus.native!.activeScopes} active, ${codeStatus.native!.drainingScopes} draining / 2${codeStatus.native!.drainingScopes ? "; new native admission blocked until confirmed cleanup" : ""}`;
			const conflicts = [...definitions.keys()].filter(name => !ownership.owns(name));
			ctx.ui.notify(`OpenAI capabilities (${reason})\nTool ownership: ${conflicts.length ? `unavailable/conflicting/excluded: ${conflicts.join(", ")}` : "verified (Pi 0.85 schema identity)"}\nSubscription: ${auth}\nImage generation: ${pi.getActiveTools().includes("imagegen") ? "enabled; Codex OAuth required at execution" : "unavailable/disabled"}\nWeb search: ${searchStatus}\nCode mode: ${codeDescription}\nUnified exec: ${!shellStatus.available ? `unavailable; ${shellStatus.reason}` : pi.getActiveTools().includes("exec_command") ? "enabled (full OS permissions, pipes only)" : "off; /openai-tools unified_exec on"}\n${preferenceError ?? `${options.preferences ? "Saved profile preferences" : "Session preferences"}: ${CAPABILITY_NAMES.map(name => `${name}=${preferences[name] ? "on" : "off"}`).join(", ")}.`}\nDirect jobs share two native scopes with Code mode; draining blocks admission. Patched-host direct completions enter native history and the next safe model request; no automatic idle turn or incremental output stream. Poll for remaining output; completed results have capacity-based retention. Jobs/cells are not restored.\nNo API fallback. Historical conversation images are not removed by this policy.`, "info");
		},
	});
	return {
		read: readSettings, jobs,
		async change(id, value, ctx, signal) {
			const revision = menuEpoch, rows = await readSettings(ctx);
			signal.throwIfAborted();
			if (revision !== menuEpoch) throw new Error("Settings context changed. Reopen the menu.");
			if (!rows.find(row => row.id === id)?.values?.includes(value)) throw new Error("This capability is unavailable or read-only.");
			await changePreference(id, value, ctx, signal);
		},
		contextVersion: () => menuEpoch,
		onBoundary(close) { menuBoundaries.add(close); return () => { menuBoundaries.delete(close); }; },
	};
}
