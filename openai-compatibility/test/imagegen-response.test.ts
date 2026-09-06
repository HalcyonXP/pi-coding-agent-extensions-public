import assert from "node:assert/strict";
import test from "node:test";
import { buildImageRequest, callCodexImages } from "../imagegen/core.ts";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const auth = { token: "synthetic-review-token", accountId: "synthetic-review-account" };
const request = { ...buildImageRequest("offline fixture", []), turnId: "review", getAuth: async () => auth };
const cleanError = (error: Error) => {
	assert.doesNotMatch(error.message + JSON.stringify(error), /synthetic-review-token|synthetic-review-account/);
	return true;
};

test("image metadata has a bounded runtime contract; unknown fields are not reflected", async () => {
	const result = await callCodexImages({ ...request, fetchImpl: async () => Response.json({ data: [{ b64_json: png }], background: "opaque", quality: "high", size: "1024x1536", unknown: auth.token }) });
	assert.equal(result.background, "opaque"); assert.equal(result.quality, "high"); assert.equal(result.size, "1024x1536");
	assert.doesNotMatch(JSON.stringify(result), /synthetic-review/);
});

test("image metadata rejects credential echoes, wrong types, invalid dimensions and oversize fields", async () => {
	for (const metadata of [
		{ size: auth.token }, { quality: auth.accountId }, { background: auth.token },
		{ size: {} }, { quality: 3 }, { background: [] }, { size: null }, { quality: "unknown" },
		{ size: "0x1" }, { size: "16385x1" }, { size: "01x1" }, { size: "1024x1024\n" },
		{ size: "x".repeat(100_000) }, { background: "x".repeat(100_000) },
	]) {
		await assert.rejects(callCodexImages({ ...request, fetchImpl: async () => Response.json({ data: [{ b64_json: png }], ...metadata }) }), cleanError);
	}
});

test("otherwise-valid metadata cannot echo the authentication material", async () => {
	await assert.rejects(callCodexImages({ ...request, getAuth: async () => ({ token: "opaque", accountId: "1024x1024" }), fetchImpl: async () => Response.json({ data: [{ b64_json: png }], background: "opaque", size: "1024x1024" }) }), (error: Error) => {
		assert.doesNotMatch(error.message + JSON.stringify(error), /opaque|1024x1024/); return true;
	});
});

test("remote diagnostic headers are omitted on both success and error", async () => {
	for (const status of [200, 401, 429, 500]) {
		const operation = callCodexImages({ ...request, fetchImpl: async () => Response.json(status === 200 ? { data: [{ b64_json: png }] } : { error: { message: auth.token, code: auth.accountId } }, {
			status, headers: { "x-request-id": auth.token, "x-codex-imagegen-request-id": auth.accountId },
		}) });
		if (status === 200) {
			const result = await operation;
			assert.equal("requestId" in result, false); assert.equal("imagegenRequestId" in result, false);
			assert.doesNotMatch(JSON.stringify(result), /synthetic-review/);
		} else await assert.rejects(operation, cleanError);
	}
});

test("quota reset diagnostics accept only bounded integral Unix seconds", async () => {
	for (const reset of [1.5, -1, 1e100, 253402300800]) {
		await assert.rejects(callCodexImages({ ...request, fetchImpl: async () => Response.json({ error: { resets_at: reset } }, { status: 429 }) }), (error: Error & { resetAt?: number }) => {
			assert.equal(error.resetAt, undefined); assert.equal(error.message, "Codex image-generation usage limit reached"); return true;
		});
	}
});
