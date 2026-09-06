import { createUnifiedExecTools, UnifiedExecManager, unifiedOwner } from "./unified-exec.ts";
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

/** Trusted composition only, never a model parameter. The normal entry point
 * explicitly selects the D14 verified subset; no profile activates tools by itself.
 */
export interface CapabilityOptions {
	webSearch?: { transport: typeof fetch; timeoutMs?: number; profile?: WebSearchProfile };
}

export function registerCapabilities(pi: ExtensionAPI, mutationQueue: MutationQueue, options: CapabilityOptions = {}): void {
	const epoch = new CapabilityEpoch();
	const processes = new UnifiedExecManager();
	const codeMode = new CodeMode(() => pi.getActiveTools());
	const search = options.webSearch ? new WebSearchAdapter(options.webSearch.transport, options.webSearch.timeoutMs) : undefined;
	let current: ExtensionContext | undefined;
	let preferenceEpoch = 0;
	let turnId = randomUUID();
	const enabled = new Set(["imagegen"]);
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
	pi.on("session_start", (_event, ctx) => {
		// Stock/older hosts keep ordinary exec/wait names untouched. The marker is
		// compatibility metadata only; execution still requires genuine authority.
		if (toolGatewayInfo(ctx)) for (const tool of createCodeModeTools(codeMode)) if (!definitions.has(tool.name)) add(tool);
		// All extension factories are loaded and Pi's metadata API is now bound.
		// Reserve our names fail-closed, but never replace another handler.
		try { ownership.install(); } catch { /* status and execution report fixed ownership errors */ }
		pending.clear(); enabled.clear(); enabled.add("imagegen"); return reset(ctx);
	});
	pi.on("model_select", (_event, ctx) => reset(ctx));
	pi.on("session_before_switch", () => reset());
	pi.on("session_before_fork", () => reset());
	pi.on("session_before_tree", () => reset());
	pi.on("session_tree", (_event, ctx) => reset(ctx));
	pi.on("session_shutdown", async () => { await reset(); await processes.close(); pending.clear(); current = undefined; });
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
	pi.registerCommand("openai-jobs", {
		description: "Inspect this session's Unified exec jobs, or cancel <session_id>",
		async handler(args, ctx) {
			const [action, id, extra] = args.trim().split(/\s+/);
			if (action === "cancel" && id && !extra) {
				try { await processes.cancel(unifiedOwner(ctx), id); ctx.ui.notify("Unified exec job cancelled.", "info"); }
				catch (error) { ctx.ui.notify((error as Error).message, "warning"); }
			} else if (!action || action === "status") {
				ctx.ui.notify(JSON.stringify(processes.inspect(unifiedOwner(ctx)), null, 2), "info");
			} else ctx.ui.notify("Usage: /openai-jobs [status | cancel <session_id>]", "warning");
		},
	});
	pi.registerCommand("openai-tools", {
		description: "OpenAI capabilities: status, or imagegen/unified_exec/web_search/code_mode on/off (session only; unavailable capabilities cannot be enabled)",
		async handler(args, ctx) {
			const [name, action, extra] = args.trim().split(/\s+/);
			if (name && name !== "status") {
				if (!["imagegen", "unified_exec", "web_search", "code_mode"].includes(name) || !["on", "off"].includes(action) || extra) {
					ctx.ui.notify("Usage: /openai-tools status | imagegen|unified_exec|web_search|code_mode on|off", "warning"); return;
				}
				if (name === "web_search" && !search) {
					ctx.ui.notify("Web search unavailable: this composition has no configured search transport/profile.", "warning"); return;
				}
				if (name === "code_mode" && action === "on") {
					const requestedEpoch = preferenceEpoch;
					const status = await codeMode.status(ctx);
					if (requestedEpoch !== preferenceEpoch) { ctx.ui.notify("Code mode preference change revoked by a newer policy/session boundary.", "warning"); return; }
					if (!status.available) { ctx.ui.notify(`Code mode unavailable: ${status.reason}. No compiler or unrestricted fallback.`, "warning"); return; }
					if (!["exec", "wait"].every(tool => ownership.owns(tool))) { ctx.ui.notify("Code mode unavailable: exec/wait namespace is conflicting, excluded or replaced.", "warning"); return; }
				}
				for (const tool of name === "unified_exec" ? ["exec_command", "write_stdin"] : name === "code_mode" ? ["exec", "wait"] : [name]) {
					if (action === "on") enabled.add(tool); else enabled.delete(tool);
				}
				await reset(ctx);
			}
			let trusted = true;
			try { assertOfficialContext(ctx); } catch { trusted = false; }
			const reason = trusted ? "official OpenAI route" : "unsupported/untrusted provider or endpoint";
			const auth = trusted ? subscriptionStatus(ctx) : "not inspected for an unsupported provider";
			const searchStatus = !search ? "unavailable; no configured search transport/profile"
				: pi.getActiveTools().includes("web_search")
					? options.webSearch?.profile === "verified-v1" ? "enabled; verified search/public-URL-open subset, direct or native protected scope; current entitlement checked at execution" : "enabled for isolated validation; source-contract-only, no opaque replay"
					: "off (session only); /openai-tools web_search on";
			const codeStatus = await codeMode.status(ctx);
			const codeDescription = !codeStatus.available ? `unavailable; ${codeStatus.reason}`
				: `${pi.getActiveTools().includes("exec") ? "enabled" : "off; /openai-tools code_mode on"}; Windows x64 native preflight ready (launch rechecked); native scopes ${codeStatus.native!.activeScopes} active, ${codeStatus.native!.drainingScopes} draining / 2${codeStatus.native!.drainingScopes ? "; new native admission blocked until confirmed cleanup" : ""}`;
			const conflicts = [...definitions.keys()].filter(name => !ownership.owns(name));
			ctx.ui.notify(`OpenAI capabilities (${reason})\nTool ownership: ${conflicts.length ? `unavailable/conflicting/excluded: ${conflicts.join(", ")}` : "verified (Pi 0.85 schema identity)"}\nSubscription: ${auth}\nImage generation: ${pi.getActiveTools().includes("imagegen") ? "enabled; Codex OAuth required at execution" : "unavailable/disabled"}\nWeb search: ${searchStatus}\nCode mode: ${codeDescription}\nUnified exec: ${pi.getActiveTools().includes("exec_command") ? "enabled (full OS permissions, pipes only)" : "off; /openai-tools unified_exec on"}\nNo API fallback. Historical conversation images are not removed by this policy.`, "info");
		},
	});
}
