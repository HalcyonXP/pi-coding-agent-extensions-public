import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	assertNoSymlinkEscape,
	buildImageRequest,
	callCodexImages,
	CodexImagegenError,
	decodeAndValidateGeneratedPng,
	detectImageMimeType,
	extractChatGptAccountId,
	resolveDestinationLexically,
} from "../imagegen/core.ts";

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

function token(accountId = "acct-test"): string {
	const payload = Buffer.from(JSON.stringify({
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	})).toString("base64url");
	return `header.${payload}.signature`;
}

test("extracts ChatGPT account ID without exposing the credential", () => {
	assert.equal(extractChatGptAccountId(token()), "acct-test");
	assert.throws(() => extractChatGptAccountId("not-a-jwt"), /not a JWT/);
});

test("builds exact Codex generation and edit payloads", () => {
	const generated = buildImageRequest("  a blue whale  ", []);
	assert.equal(generated.operation, "generate");
	assert.deepEqual(generated.body, {
		prompt: "a blue whale",
		background: "auto",
		model: "gpt-image-2",
		quality: "auto",
		size: "auto",
	});
	const edited = buildImageRequest("add a hat", [{ data: TINY_PNG, mimeType: "image/png" }]);
	assert.equal(edited.operation, "edit");
	assert.match(edited.body.images?.[0].image_url ?? "", /^data:image\/png;base64,/);
});

test("detects and validates generated PNGs", () => {
	const bytes = decodeAndValidateGeneratedPng(TINY_PNG);
	assert.equal(detectImageMimeType(bytes), "image/png");
	assert.throws(() => decodeAndValidateGeneratedPng(Buffer.from("not png").toString("base64")), /non-PNG/);
});

test("workspace destinations remain relative, PNG-only, and traversal-safe", () => {
	const root = path.resolve("C:/workspace");
	assert.equal(resolveDestinationLexically(root, "public/images/hero.png"), path.resolve(root, "public/images/hero.png"));
	assert.throws(() => resolveDestinationLexically(root, "../escape.png"), /escapes/);
	assert.throws(() => resolveDestinationLexically(root, "C:\\escape.png"), /relative/);
	assert.throws(() => resolveDestinationLexically(root, "public/hero.jpg"), /\.png/);
	assert.throws(() => resolveDestinationLexically(root, "public/CON.png"), /reserved Windows name/);
});

test("symlink ancestors cannot escape the workspace", async (t) => {
	const root = await mkdtemp(path.join(tmpdir(), "pi-imagegen-root-"));
	const outside = await mkdtemp(path.join(tmpdir(), "pi-imagegen-outside-"));
	t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
	await mkdir(path.join(root, "safe"));
	await assertNoSymlinkEscape(root, path.join(root, "safe", "image.png"));
	try {
		await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
	} catch (error) {
		t.skip(`symlink creation unavailable: ${String(error)}`);
		return;
	}
	await assert.rejects(assertNoSymlinkEscape(root, path.join(root, "escape", "image.png")), /symlink/);
});

async function withServer(handler: (request: IncomingMessage, response: ServerResponse) => void, run: (baseUrl: string) => Promise<void>): Promise<void> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("missing test server address");
	try { await run(`http://127.0.0.1:${address.port}`); }
	finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
}

test("calls the Codex endpoint with required headers and returns PNG data", async () => {
	await withServer((request, response) => {
		assert.equal(request.url, "/images/generations");
		assert.equal(request.headers.authorization, "Bearer test-token");
		assert.equal(request.headers["chatgpt-account-id"], "acct-test");
		assert.equal(request.headers["x-codex-image-turn-id"], "00000000-0000-4000-8000-000000000000");
		assert.equal(request.headers.originator, "pi");
		response.setHeader("content-type", "application/json");
		response.setHeader("x-codex-imagegen-request-id", "req-image-1");
		response.end(JSON.stringify({ data: [{ b64_json: TINY_PNG }], background: "opaque", size: "1024x1024" }));
	}, async (baseUrl) => {
		const request = buildImageRequest("a blue whale", []);
		const result = await callCodexImages({
			...request,
			turnId: "00000000-0000-4000-8000-000000000000",
			getAuth: async () => ({ token: "test-token", accountId: "acct-test" }),
			baseUrl, fetchImpl: fetch,
			maxAttempts: 1,
		});
		assert.equal(result.background, "opaque");
		assert.equal(result.size, "1024x1024");
		assert.equal(result.imagegenRequestId, undefined, "remote diagnostics are deliberately omitted");
		assert.equal(result.imageBytes.length > 0, true);
	});
});

test("does not retry subscription usage limits", async () => {
	let requests = 0;
	await withServer((_request, response) => {
		requests++;
		response.statusCode = 429;
		response.setHeader("content-type", "application/json");
		response.setHeader("x-image-gen-primary-reset-at", "1800000000");
		response.end(JSON.stringify({ error: { type: "usage_limit_reached", message: "limit reached" } }));
	}, async (baseUrl) => {
		const request = buildImageRequest("a blue whale", []);
		await assert.rejects(
			callCodexImages({ ...request, turnId: "00000000-0000-4000-8000-000000000000", getAuth: async () => ({ token: "x", accountId: "y" }), baseUrl, fetchImpl: fetch, maxAttempts: 4 }),
			(error: unknown) => error instanceof CodexImagegenError && error.status === 429 && error.resetAt === 1800000000,
		);
	});
	assert.equal(requests, 1);
});
