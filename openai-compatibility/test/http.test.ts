import assert from "node:assert/strict";
import test from "node:test";
import { assertServiceBaseUrl, readBoundedJson } from "../http.ts";
import { callCodexImages, buildImageRequest } from "../imagegen/core.ts";

test("bounded JSON reader rejects length headers, streamed overflow and malformed JSON", async () => {
	assert.deepEqual(await readBoundedJson(new Response('{"ok":true}'), 20), { ok: true });
	await assert.rejects(readBoundedJson(new Response("{}", { headers: { "content-length": "99" } }), 20), /limit/);
	await assert.rejects(readBoundedJson(new Response("x".repeat(100)), 20), /limit/);
	await assert.rejects(readBoundedJson(new Response("not json"), 20), /invalid JSON/);
});

test("untrusted endpoints fail before auth; loopback requires explicit test transport", async () => {
	assert.throws(() => assertServiceBaseUrl("http://127.0.0.1:1234", "https://chatgpt.com"), /Untrusted/);
	assert.doesNotThrow(() => assertServiceBaseUrl("http://127.0.0.1:1234", "https://chatgpt.com", fetch));
	let authCalls = 0;
	await assert.rejects(callCodexImages({ ...buildImageRequest("x", []), turnId: "test", baseUrl: "https://proxy.test", getAuth: async () => { authCalls++; return { token: "secret", accountId: "account" }; } }), /Untrusted/);
	assert.equal(authCalls, 0);
});

test("image requests reject redirects and suppress echoed secret-bearing error text", async () => {
	let calls = 0;
	await assert.rejects(callCodexImages({ ...buildImageRequest("x", []), turnId: "test", getAuth: async () => ({ token: "secret-token", accountId: "account-id" }), fetchImpl: async (_url, init) => {
		calls++; assert.equal(init?.redirect, "error");
		return new Response(JSON.stringify({ error: { message: "secret-token account-id", code: "secret-token" } }), { status: 401 });
	} }), (error: Error) => { assert.doesNotMatch(JSON.stringify(error) + error.message, /secret-token|account-id/); return true; });
	assert.equal(calls, 1);
});

test("ambiguous image transport failures are not automatically retried", async () => {
	let calls = 0;
	await assert.rejects(callCodexImages({ ...buildImageRequest("x", []), turnId: "test", getAuth: async () => ({ token: "secret", accountId: "account" }), fetchImpl: async () => { calls++; throw new TypeError("echo secret"); } }), /no API fallback/);
	assert.equal(calls, 1);
});
