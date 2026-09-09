import assert from "node:assert/strict";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerCapabilities, type CapabilityOptions } from "../capabilities.ts";
import type { MutationQueue } from "../imagegen/tool.ts";

export const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
export const model = { id: "gpt-6-astra", provider: "openai-codex", api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api", compat: { supportsOpenAIGrammarTools: true } };
export const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-test" } })).toString("base64url")}.signature`;

export function harness(cwd: string, mutationQueue: MutationQueue = async (_path, operation) => operation(), options: CapabilityOptions = {}) {
	const handlers = new Map<string, Array<(event: any, ctx: ExtensionContext) => any>>();
	const tools = new Map<string, ToolDefinition>();
	const commands = new Map<string, any>();
	let active = ["read", "powershell"];
	let authCalls = 0;
	let authOverride: any;
	let registeredConfig: any;
	let registeredNative: any;
	let oauth = true; let sessionId = "test-session"; const notices: string[] = [];
	const ctx = {
		cwd, model: { ...model }, hasUI: false, ui: { notify(message: string) { notices.push(message); } },
		sessionManager: { getSessionId: () => sessionId, getBranch: () => [] },
		modelRegistry: {
			getRegisteredProviderConfig: () => registeredConfig,
			getRegisteredNativeProvider: () => registeredNative,
			find: () => model,
			isUsingOAuth: () => oauth,
			getProviderAuth: async (id: string) => { assert.equal(id, "openai-codex"); authCalls++; return authOverride ? authOverride() : { auth: { apiKey: token } }; },
		},
	} as unknown as ExtensionContext;
	const pi = {
		on: (name: string, handler: any) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
		registerTool: (tool: ToolDefinition) => { assert.ok(!tools.has(tool.name), "duplicate tool"); tools.set(tool.name, tool); active.push(tool.name); },
		registerCommand: (name: string, command: any) => commands.set(name, command),
		getAllTools: () => [...tools.values()],
		getActiveTools: () => [...active], setActiveTools: (names: string[]) => { active = [...names]; },
	} as unknown as ExtensionAPI;
	const settings = registerCapabilities(pi, mutationQueue, options);
	return {
		ctx, pi, tools, commands, notices, settings, setSessionId: (id: string) => { sessionId = id; }, active: () => active, authCalls: () => authCalls,
		setConfig: (value: any) => { registeredConfig = value; }, setNative: (value: any) => { registeredNative = value; },
		setAuth: (fn: any) => { authOverride = fn; }, setOAuth: (value: boolean) => { oauth = value; },
		emit: async (name: string, event = {}) => { let result; for (const handler of handlers.get(name) ?? []) result = await handler(event, ctx) ?? result; return result; },
	};
}
