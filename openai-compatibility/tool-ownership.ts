import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

/** Pi 0.85 getAllTools returns the winning definition's original schema reference.
 * This detects accidental collisions/replacement, not malicious installed JavaScript.
 * Inspect only after runtime binding; registration-time APIs are not initialized.
 */
export class ToolOwnership {
	private readonly registered = new Set<string>();
	private readonly pi: ExtensionAPI;
	private readonly definitions: ReadonlyMap<string, ToolDefinition>;
	constructor(pi: ExtensionAPI, definitions: ReadonlyMap<string, ToolDefinition>) {
		this.pi = pi; this.definitions = definitions;
	}
	private metadata() {
		try {
			const tools = this.pi.getAllTools();
			if (!Array.isArray(tools)) throw new Error();
			return tools;
		} catch { throw new Error("OpenAI capability unavailable: tool ownership metadata is unavailable."); }
	}
	/** Never overwrite an existing configured tool. A paired capability installs together. */
	install(): void {
		for (const group of [["imagegen"], ["exec_command", "write_stdin"], ["web_search"], ["exec", "wait"]]) {
			const names = group.filter(name => this.definitions.has(name));
			if (!names.length) continue;
			const metadata = this.metadata();
			if (names.some(name => metadata.some(tool => tool.name === name &&
				(!this.registered.has(name) || tool.parameters !== this.definitions.get(name)!.parameters)))) continue;
			for (const name of names) {
				if (this.registered.has(name)) continue;
				try { this.pi.registerTool(this.definitions.get(name)!); this.registered.add(name); }
				catch { throw new Error("OpenAI capability unavailable: tool registration failed."); }
			}
		}
	}
	assert(name: string): void {
		const group = ["exec_command", "write_stdin"].includes(name) ? ["exec_command", "write_stdin"] : ["exec", "wait"].includes(name) ? ["exec", "wait"] : [name];
		const metadata = this.metadata();
		for (const member of group) {
			const matches = metadata.filter(tool => tool.name === member);
			if (!this.registered.has(member) || matches.length !== 1 || matches[0].parameters !== this.definitions.get(member)?.parameters) {
				throw new Error("OpenAI capability unavailable: reserved tool name is conflicting, excluded, or replaced.");
			}
		}
	}
	owns(name: string): boolean { try { this.assert(name); return true; } catch { return false; } }
}
