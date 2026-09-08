// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const CAPABILITY_NAMES = ["imagegen", "web_search", "unified_exec", "code_mode"] as const;
export type CapabilityName = typeof CAPABILITY_NAMES[number];
export type CapabilityPreferences = Record<CapabilityName, boolean>;
export const DEFAULT_CAPABILITIES: Readonly<CapabilityPreferences> = Object.freeze({ imagegen: true, web_search: false, unified_exec: false, code_mode: false });
export interface CapabilityPreferenceStore {
	read(): CapabilityPreferences;
	write(name: CapabilityName, enabled: boolean): void;
}
const MAX_BYTES = 4096;
const failure = () => new Error("Capability preferences are unreadable or invalid; preserve the profile file. No saved capability was restored.");
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function decode(bytes: Buffer): CapabilityPreferences {
	const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	if (!record(value) || Object.keys(value).length !== 2 || value.version !== 1 || !record(value.capabilities)
		|| Object.keys(value.capabilities).length !== CAPABILITY_NAMES.length
		|| !CAPABILITY_NAMES.every(name => typeof (value.capabilities as Record<string, unknown>)[name] === "boolean")) throw failure();
	return { ...value.capabilities } as CapabilityPreferences;
}

/** Profile-local booleans only. Does not migrate profiles, auth, jobs or Fast's existing file.
 * Atomic replacement is not a cross-process transaction or hostile-filesystem sandbox.
 */
export function capabilityPreferenceStore(agentDir: string): CapabilityPreferenceStore {
	const target = join(agentDir, "openai-compatibility-capabilities.json");
	function read(): CapabilityPreferences {
		let fd: number | undefined;
		try {
			try { if (!lstatSync(target).isFile()) throw failure(); }
			catch (error) { if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return { ...DEFAULT_CAPABILITIES }; throw error; }
			fd = openSync(target, "r");
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size > MAX_BYTES) throw failure();
			const bytes = Buffer.alloc(MAX_BYTES + 1); let length = 0;
			while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
			if (length > MAX_BYTES) throw failure();
			return decode(bytes.subarray(0, length));
		} catch { throw failure(); }
		finally { if (fd !== undefined) closeSync(fd); }
	}
	return {
		read,
		write(name, enabled) {
			if (!CAPABILITY_NAMES.includes(name) || typeof enabled !== "boolean") throw failure();
			// Merge the one explicit choice with the latest valid file; never silently
			// overwrite malformed/unknown state or erase another saved capability.
			const capabilities = { ...read(), [name]: enabled };
			const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
			let created = false;
			try {
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(temporary, `${JSON.stringify({ version: 1, capabilities }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); created = true;
				renameSync(temporary, target);
			} catch { throw new Error("Could not save capability preference; the current selection was not changed. Preserve the profile file."); }
			finally { if (created) rmSync(temporary, { force: true }); }
		},
	};
}
