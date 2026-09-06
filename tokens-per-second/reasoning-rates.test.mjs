import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ReasoningRateProfiles } from "./reasoning-rates.ts";

test("persists bounded per-model EWMA reasoning-rate profiles", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-tps-rates-"));
	const path = join(directory, "rates.json");
	try {
		const profiles = new ReasoningRateProfiles(path);
		assert.equal(profiles.get("model"), undefined);

		assert.equal(profiles.observe("model", 40).rate, 40);
		const updated = profiles.observe("model", 80);
		assert.equal(updated.rate, 50);
		assert.equal(updated.samples, 2);

		const restored = new ReasoningRateProfiles(path).get("model");
		assert.equal(restored.rate, 50);
		assert.equal(restored.samples, 2);
		assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 1);

		assert.equal(profiles.remove("model"), true);
		assert.equal(profiles.get("model"), undefined);
		assert.equal(profiles.remove("model"), false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("rejects invalid or implausible samples", () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-tps-rates-"));
	try {
		const profiles = new ReasoningRateProfiles(join(directory, "rates.json"));
		for (const rate of [Number.NaN, -1, 0, 10_000]) {
			assert.equal(profiles.observe("model", rate), undefined);
		}
		assert.equal(profiles.get("model"), undefined);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
