// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0

export const MAX_EXEC_WAIT_MS = 30_000;
export const MAX_BACKGROUND_WAIT_MS = 300_000;

function requestedWait(value: number | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	// Never coerce strings/objects or turn an unsafe number into a timer.
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("Unified exec yield_time_ms must be a non-negative safe integer.");
	return value;
}

/** Return waits only. Native readiness, idle, lifetime and cleanup budgets are independent. */
export function initialWaitMs(value?: number, platform: NodeJS.Platform = process.platform): number {
	return Math.min(MAX_EXEC_WAIT_MS, Math.max(platform === "win32" ? 10_000 : 250, requestedWait(value, 10_000)));
}

/** Trusted profile preference, never a tool argument or a larger runtime budget. */
export function backgroundWaitMs(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 5_000 || value > MAX_BACKGROUND_WAIT_MS) {
		throw new Error("Background wait ceiling must be an integer from 5000 to 300000 milliseconds.");
	}
	return value;
}

/** CLI canonical decimal text is distinct from noncoercing JSON preference admission. */
export function parseBackgroundWaitMs(value: string): number {
	if (typeof value !== "string" || !/^[1-9][0-9]{3,5}$/.test(value)) throw new Error("Background wait ceiling must use canonical decimal milliseconds (5000–300000).");
	return backgroundWaitMs(Number(value));
}

export function stdinWaitMs(value: number | undefined, chars: string, backgroundCeiling = MAX_BACKGROUND_WAIT_MS): number {
	const ceiling = backgroundWaitMs(backgroundCeiling), empty = chars.length === 0;
	return Math.min(empty ? ceiling : MAX_EXEC_WAIT_MS,
		Math.max(empty ? 5_000 : 250, requestedWait(value, empty ? 5_000 : 250)));
}
