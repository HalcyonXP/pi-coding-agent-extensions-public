import { SubscriptionAuthError } from "./http.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CapabilityLease } from "./capability-policy.ts";
import { extractChatGptAccountId } from "./imagegen/core.ts";

/** Only the refreshed Codex OAuth credential; never consult the direct API provider. */
export async function resolveSubscriptionAuth(ctx: ExtensionContext, lease: CapabilityLease): Promise<{ token: string; accountId: string }> {
	lease.assertCurrent();
	const subscriptionModel = ctx.modelRegistry.find("openai-codex", "gpt-6-astra");
	if (!subscriptionModel || !ctx.modelRegistry.isUsingOAuth(subscriptionModel)) {
		throw new SubscriptionAuthError("Codex subscription OAuth is required. Use /login for OpenAI (ChatGPT Plus/Pro).");
	}
	let result;
	try { result = await ctx.modelRegistry.getProviderAuth("openai-codex"); }
	catch { throw new SubscriptionAuthError("Codex subscription authentication failed. Check /login; no API fallback was attempted."); }
	lease.assertCurrent();
	const auth = result?.auth;
	if (!auth?.apiKey) throw new SubscriptionAuthError("Codex subscription authentication is unavailable. Use /login.");
	if (auth.baseUrl && !["https://chatgpt.com/backend-api", "https://chatgpt.com/backend-api/", "https://chatgpt.com/backend-api/codex"].includes(auth.baseUrl)) {
		throw new SubscriptionAuthError("Codex subscription authentication supplied an untrusted route.");
	}
	// Do not forward arbitrary auth headers/env into the service request.
	return { token: auth.apiKey, accountId: extractChatGptAccountId(auth.apiKey) };
}

/** Configuration-only status: never refresh credentials, probe entitlement or expose registry errors. */
export function subscriptionStatus(ctx: ExtensionContext): string {
	try {
		const model = ctx.modelRegistry.find("openai-codex", "gpt-6-astra");
		return model && ctx.modelRegistry.isUsingOAuth(model)
			? "Codex OAuth configured; refresh and entitlement checked only at execution"
			: "missing Codex OAuth; use /login (API credentials do not qualify)";
	} catch { return "Codex OAuth status unavailable; no authentication request attempted"; }
}
