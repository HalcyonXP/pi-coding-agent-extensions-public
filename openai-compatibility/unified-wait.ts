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

export function stdinWaitMs(value: number | undefined, chars: string): number {
	const empty = chars.length === 0;
	return Math.min(empty ? MAX_BACKGROUND_WAIT_MS : MAX_EXEC_WAIT_MS,
		Math.max(empty ? 5_000 : 250, requestedWait(value, empty ? 5_000 : 250)));
}
