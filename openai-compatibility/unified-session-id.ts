// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import { randomInt } from "node:crypto";

export const MAX_SESSION_ID = 2_147_483_647;
export function isSessionId(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_SESSION_ID;
}

/** CLI text is a separate grammar from the JSON tool's integer argument. */
export function parseSessionId(text: string): number {
	if (typeof text !== "string" || !/^[1-9][0-9]{0,9}$/.test(text)) throw new Error("Unified exec session ID must be a positive decimal integer.");
	const value = Number(text);
	if (!isSessionId(value)) throw new Error("Unified exec session ID is out of range.");
	return value;
}

/** A lookup sequence, never scope authority. No wraparound, recycling or retained-ID set. */
export function createSessionIdAllocator(first: number): () => number {
	if (!isSessionId(first)) throw new Error("Invalid Unified exec session ID allocator.");
	let next = first;
	return Object.freeze(() => {
		if (next > MAX_SESSION_ID) throw new Error("Unified exec session ID space exhausted; no process was started.");
		return next++;
	});
}

// Runtime-only sequence shared across extension reloads/manager replacements in this
// Node realm. Stores no jobs, credentials or authority, and writes no settings/files.
// A restarted process has a fresh random starting point, not durable ID recovery.
const key = Symbol.for("pi.openai-compatibility.unified-session-id-sequence.v1");
const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
if (descriptor && (!("value" in descriptor) || typeof descriptor.value !== "function" || descriptor.configurable || descriptor.writable || descriptor.enumerable)) {
	throw new Error("Unified exec session ID allocator is unavailable.");
}
if (!descriptor) Object.defineProperty(globalThis, key, { value: createSessionIdAllocator(randomInt(1, 1_073_741_824)), configurable: false, writable: false, enumerable: false });
const allocate: () => number = Object.getOwnPropertyDescriptor(globalThis, key)!.value;
export function allocateSessionId(): number {
	const value = allocate();
	if (!isSessionId(value)) throw new Error("Unified exec session ID allocator returned an invalid identifier.");
	return value;
}
