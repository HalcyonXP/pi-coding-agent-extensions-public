// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source-only test utilities. Never used to unlock/recycle a profile or runtime job.
import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

/** Caller must own a newly created fixture and confirm process teardown first.
 * Windows can retain a directory reference briefly after process termination.
 * Only EBUSY is retried; no lock is cleared, and exhaustion remains a failure.
 */
export async function removeOwnedFixture(directory: string, remove = (path: string) => rm(path, { recursive: true, force: true }), pause = (ms: number) => delay(ms)): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		try { await remove(directory); return; }
		catch (error) {
			if ((error as NodeJS.ErrnoException | null)?.code !== "EBUSY" || attempt === 10) throw error;
		}
		await pause(50 * (attempt + 1));
	}
}
/** A finally error must not hide an earlier ownership assertion failure. */
export async function withFixtureCleanup(body: () => Promise<void>, cleanup: (bodyPassed: boolean) => Promise<void>): Promise<void> {
	const failures: unknown[] = [];
	try { await body(); } catch (error) { failures.push(error); }
	try { await cleanup(failures.length === 0); } catch (error) { failures.push(error); }
	if (failures.length === 1) throw failures[0];
	if (failures.length) throw new AggregateError(failures, "Fixture assertion and cleanup both failed; preserve evidence.");
}
