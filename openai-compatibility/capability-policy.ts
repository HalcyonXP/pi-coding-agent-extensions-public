import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const OFFICIAL_ROUTES = {
	openai: { api: "openai-responses", baseUrl: "https://api.openai.com/v1" },
	"openai-codex": { api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" },
} as const;
export interface ModelRoute { id: string; provider: string; api: string; baseUrl: string; headers?: Record<string, unknown> }

/** Compare the literal route too: URL normalization must not bless encoded paths or userinfo. */
export function isOfficialRoute(model: ModelRoute | undefined): boolean {
	if (!model || !Object.hasOwn(OFFICIAL_ROUTES, model.provider)) return false;
	const route = OFFICIAL_ROUTES[model.provider as keyof typeof OFFICIAL_ROUTES];
	return model.api === route.api && [route.baseUrl, `${route.baseUrl}/`].includes(model.baseUrl)
		&& (!model.headers || Object.keys(model.headers).length === 0);
}

export function assertOfficialContext(ctx: ExtensionContext): void {
	if (!isOfficialRoute(ctx.model)) throw new Error("OpenAI capability unavailable: select an official OpenAI provider and endpoint.");
	const registry = ctx.modelRegistry;
	for (const id of new Set([ctx.model!.provider, "openai-codex"])) {
		// Legacy provider overrides can replace transport/auth independently of a model's visible URL.
		let config, native;
		try { config = registry.getRegisteredProviderConfig(id); native = registry.getRegisteredNativeProvider(id); }
		catch { throw new Error("OpenAI capability unavailable: provider override inspection failed."); }
		if (config) throw new Error("OpenAI capability unavailable: custom provider overrides are not trusted.");
		if (native) throw new Error("OpenAI capability unavailable: native provider overrides are not trusted.");
	}
}

/** Revocable operation leases: a change invalidates old calls even if the user switches back. */
export class CapabilityEpoch {
	private generation = 0;
	private operations = new Set<AbortController>();
	revoke(): void {
		this.generation++;
		for (const operation of this.operations) operation.abort(new Error("OpenAI operation cancelled: session or provider changed."));
		this.operations.clear();
	}
	lease(check: () => void, signal?: AbortSignal) {
		check();
		const generation = this.generation;
		const controller = new AbortController();
		this.operations.add(controller);
		const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
		return {
			signal: combined,
			assertCurrent: () => {
				if (generation !== this.generation) throw new Error("OpenAI operation revoked; result withheld.");
				combined.throwIfAborted();
				check();
			},
			release: () => { this.operations.delete(controller); },
		};
	}
}

export type CapabilityLease = ReturnType<CapabilityEpoch["lease"]>;
