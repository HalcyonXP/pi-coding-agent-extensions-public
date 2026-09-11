// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import { closeSync, fstatSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { backgroundWaitMs, MAX_BACKGROUND_WAIT_MS } from "./unified-wait.ts";

export interface UnifiedPreferenceStore {
	read(): number;
	write(maxBackgroundWaitMs: number): void;
}
const failure = () => new Error("Unified wait preferences are unreadable or invalid; preserve the profile file. Unified execution is unavailable until repaired and reloaded.");
const MAX_BYTES = 4096;

/** Separate versioned preference: never rewrites Fast/capability choices or persists jobs.
 * Atomic replacement is not a cross-process transaction or hostile-filesystem sandbox.
 */
export function unifiedPreferenceStore(agentDir: string): UnifiedPreferenceStore {
	const target = join(agentDir, "openai-compatibility-unified.json");
	function read(): number {
		let fd: number | undefined;
		try {
			try { if (!lstatSync(target).isFile()) throw failure(); }
			catch (error) { if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return MAX_BACKGROUND_WAIT_MS; throw error; }
			fd = openSync(target, "r");
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.size > MAX_BYTES) throw failure();
			const bytes = Buffer.alloc(MAX_BYTES + 1); let length = 0;
			while (length < bytes.length) { const count = readSync(fd, bytes, length, bytes.length - length, null); if (!count) break; length += count; }
			if (length > MAX_BYTES) throw failure();
			const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw failure();
			const row = value as Record<string, unknown>;
			if (Object.keys(row).length !== 2 || row.version !== 1 || !Object.hasOwn(row, "maxBackgroundWaitMs")) throw failure();
			return backgroundWaitMs(row.maxBackgroundWaitMs);
		} catch { throw failure(); }
		finally { if (fd !== undefined) closeSync(fd); }
	}
	return {
		read,
		write(value) {
			const maxBackgroundWaitMs = backgroundWaitMs(value);
			read(); // Do not replace malformed or unknown-version state, even for an explicit change.
			const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
			let created = false;
			try {
				mkdirSync(agentDir, { recursive: true });
				writeFileSync(temporary, `${JSON.stringify({ version: 1, maxBackgroundWaitMs }, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" }); created = true;
				renameSync(temporary, target);
			} catch { throw new Error("Could not save Unified wait preference; the current ceiling was not changed. Preserve the profile file."); }
			finally { if (created) rmSync(temporary, { force: true }); }
		},
	};
}
