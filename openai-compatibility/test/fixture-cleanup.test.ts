// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { removeOwnedFixture, withFixtureCleanup } from "./fixture-cleanup.ts";
const busy = () => Object.assign(new Error("synthetic owned-directory reference"), { code: "EBUSY" });

test("owned fixture cleanup retries only the directory operation after transient EBUSY", async () => {
	let attempts = 0; const pauses: number[] = [];
	await removeOwnedFixture("synthetic-owned-fixture", async path => { assert.equal(path, "synthetic-owned-fixture"); if (++attempts < 4) throw busy(); }, async ms => { pauses.push(ms); });
	assert.equal(attempts, 4); assert.deepEqual(pauses, [50, 100, 150]);
});

test("persistent EBUSY stays failed after ten retries; other cleanup errors are never retried", async () => {
	let attempts = 0; const pauses: number[] = []; const error = busy();
	await assert.rejects(removeOwnedFixture("synthetic-owned-fixture", async () => { attempts++; throw error; }, async ms => { pauses.push(ms); }), e => e === error);
	assert.equal(attempts, 11); assert.equal(pauses.length, 10); assert.equal(pauses.reduce((a, b) => a + b, 0), 2750);
	attempts = 0; const denied = Object.assign(new Error("synthetic denied"), { code: "EPERM" });
	await assert.rejects(removeOwnedFixture("synthetic-owned-fixture", async () => { attempts++; throw denied; }, async () => { assert.fail("Non-EBUSY must not wait"); }), e => e === denied); assert.equal(attempts, 1);
});

test("fixture cleanup preserves both assertion and teardown errors and cannot erase a failed body", async () => {
	const bodyError = new Error("native assertion failed"), cleanupError = busy();
	await assert.rejects(withFixtureCleanup(async () => { throw bodyError; }, async passed => { assert.equal(passed, false); throw cleanupError; }), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [bodyError, cleanupError]); return true;
	});
	await assert.rejects(withFixtureCleanup(async () => { throw bodyError; }, async passed => { assert.equal(passed, false); }), e => e === bodyError);
	await assert.rejects(withFixtureCleanup(async () => {}, async passed => { assert.equal(passed, true); throw cleanupError; }), e => e === cleanupError);
	const fixture = await readFile(new URL("./unified-parent.test.ts", import.meta.url), "utf8");
	assert.match(fixture, /parent\.once\("close"/); assert.match(fixture, /parentClosed&&!alive\(supervisor!\)/);
	assert.match(fixture, /if\(bodyPassed\)await removeOwnedFixture\(directory\)/); assert.match(fixture, /withFixtureCleanup\(async/);
});
