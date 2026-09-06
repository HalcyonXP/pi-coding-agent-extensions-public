import { assertServiceBaseUrl, readBoundedJson, SubscriptionAuthError, withAbort } from "../http.ts";
import { constants as fsConstants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const CODEX_IMAGE_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const IMAGE_MODEL = "gpt-image-2";
export const MAX_REFERENCE_IMAGES = 5;
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_OUTPUT_IMAGE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 300_000;

export type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type ImageOperation = "generate" | "edit";
export type ImageReference = { data: string; mimeType: SupportedImageMime };

export interface ImageRequestBody {
	prompt: string;
	background: "auto";
	model: typeof IMAGE_MODEL;
	quality: "auto";
	size: "auto";
	images?: Array<{ image_url: string }>;
}

export interface CodexImageResponse {
	created?: number;
	background?: "transparent" | "opaque" | "auto";
	quality?: "low" | "medium" | "high" | "auto";
	size?: string;
	data: Array<{ b64_json: string }>;
}

export interface CodexImageResult {
	imageBase64: string;
	imageBytes: Buffer;
	background?: CodexImageResponse["background"];
	quality?: CodexImageResponse["quality"];
	size?: string;
	requestId?: string;
	imagegenRequestId?: string;
}

export class CodexImagegenError extends Error {
	readonly status?: number;
	readonly code?: string;
	readonly requestId?: string;
	readonly resetAt?: number;
	readonly retryable: boolean;

	constructor(message: string, options: {
		status?: number;
		code?: string;
		requestId?: string;
		resetAt?: number;
		retryable?: boolean;
		cause?: unknown;
	} = {}) {
		super(message, options.cause === undefined ? undefined : { cause: options.cause });
		this.name = "CodexImagegenError";
		this.status = options.status;
		this.code = options.code;
		this.requestId = options.requestId;
		this.resetAt = options.resetAt;
		this.retryable = options.retryable ?? false;
	}
}

function decodeBase64Url(value: string): string {
	return Buffer.from(value, "base64url").toString("utf8");
}

export function extractChatGptAccountId(token: string): string {
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("OpenAI Codex credential is not a JWT");
	let payload: unknown;
	try {
		payload = JSON.parse(decodeBase64Url(parts[1]));
	} catch {
		throw new Error("Unable to decode the OpenAI Codex credential");
	}
	const auth = isRecord(payload) ? payload["https://api.openai.com/auth"] : undefined;
	const accountId = isRecord(auth) ? auth.chatgpt_account_id : undefined;
	if (typeof accountId !== "string" || !accountId.trim()) {
		throw new Error("OpenAI Codex credential does not contain a ChatGPT account ID");
	}
	return accountId;
}

export function buildImageRequest(prompt: string, references: ImageReference[]): {
	operation: ImageOperation;
	body: ImageRequestBody;
} {
	const trimmed = prompt.trim();
	if (!trimmed) throw new Error("prompt must not be empty");
	if (references.length > MAX_REFERENCE_IMAGES) {
		throw new Error(`at most ${MAX_REFERENCE_IMAGES} reference images are allowed`);
	}
	const base: ImageRequestBody = {
		prompt: trimmed,
		background: "auto",
		model: IMAGE_MODEL,
		quality: "auto",
		size: "auto",
	};
	if (references.length === 0) return { operation: "generate", body: base };
	return {
		operation: "edit",
		body: {
			...base,
			images: references.map(({ data, mimeType }) => ({
				image_url: `data:${mimeType};base64,${data}`,
			})),
		},
	};
}

export function detectImageMimeType(bytes: Uint8Array): SupportedImageMime | null {
	if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
	if (bytes.length >= 6) {
		const signature = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
		if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	}
	return null;
}

export function decodeAndValidateGeneratedPng(base64: string): Buffer {
	if (!base64.trim()) throw new Error("image response contained empty base64 data");
	const estimatedBytes = Math.floor((base64.length * 3) / 4);
	if (estimatedBytes > MAX_OUTPUT_IMAGE_BYTES + 2) {
		throw new Error(`generated image exceeds the ${MAX_OUTPUT_IMAGE_BYTES}-byte output limit`);
	}
	let bytes: Buffer;
	try {
		bytes = Buffer.from(base64, "base64");
	} catch {
		throw new Error("image response contained invalid base64 data");
	}
	if (bytes.length === 0 || bytes.length > MAX_OUTPUT_IMAGE_BYTES) {
		throw new Error(`generated image is empty or exceeds the ${MAX_OUTPUT_IMAGE_BYTES}-byte output limit`);
	}
	if (detectImageMimeType(bytes) !== "image/png") {
		throw new Error("Codex image endpoint returned a non-PNG payload");
	}
	return bytes;
}

export function sanitizeArtifactSegment(value: string, fallback = "generated-image"): string {
	const sanitized = value.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "");
	return sanitized.slice(0, 120) || fallback;
}

const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function rejectDangerousWindowsSegments(input: string): void {
	for (const segment of input.split(/[\\/]+/)) {
		if (!segment || segment === "." || segment === "..") continue;
		if (segment.includes(":")) throw new Error("destination_path may not contain Windows alternate-data-stream syntax");
		if (WINDOWS_DEVICE_NAME.test(segment)) throw new Error(`destination_path contains reserved Windows name: ${segment}`);
		if (/[. ]$/.test(segment)) throw new Error("destination_path segments may not end in a dot or space");
	}
}

export function isPathInside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function resolveDestinationLexically(workspace: string, rawPath: string): string {
	let requested = rawPath.trim();
	if (requested.startsWith("@")) requested = requested.slice(1);
	if (!requested || requested.includes("\0")) throw new Error("destination_path is empty or invalid");
	if (path.isAbsolute(requested) || /^[A-Za-z]:/.test(requested) || requested.startsWith("\\\\") || requested.startsWith("//")) {
		throw new Error("destination_path must be relative to the Pi workspace");
	}
	rejectDangerousWindowsSegments(requested);
	if (path.extname(requested).toLowerCase() !== ".png") throw new Error("destination_path must end in .png");
	const root = path.resolve(workspace);
	const target = path.resolve(root, requested);
	if (!isPathInside(root, target)) throw new Error("destination_path escapes the Pi workspace");
	return target;
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
	let current = candidate;
	for (;;) {
		try {
			await access(current, fsConstants.F_OK);
			return current;
		} catch {
			const parent = path.dirname(current);
			if (parent === current) throw new Error(`no existing ancestor for ${candidate}`);
			current = parent;
		}
	}
}

export async function assertNoSymlinkEscape(workspace: string, target: string): Promise<void> {
	const lexicalRoot = path.resolve(workspace);
	if (!isPathInside(lexicalRoot, path.resolve(target))) throw new Error("path escapes the Pi workspace");
	const realRoot = await realpath(lexicalRoot);
	const ancestor = await nearestExistingAncestor(target);
	const ancestorStat = await lstat(ancestor);
	const realAncestor = await realpath(ancestor);
	if (!isPathInside(realRoot, realAncestor)) throw new Error("path escapes the Pi workspace through a symlink");
	const resolvedStat = ancestorStat.isSymbolicLink() ? await stat(realAncestor) : ancestorStat;
	if (!resolvedStat.isDirectory() && ancestor !== target) throw new Error("destination parent is not a directory");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resetTimestamp(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 253402300799 ? value : undefined;
}

/** Only validated metadata may reach the image tool's summary/details. Never echo HTTP IDs. */
function imageMetadata(data: Record<string, unknown>, secrets: string[]) {
	const invalid = () => { throw new CodexImagegenError("Codex image endpoint returned invalid or unsafe metadata."); };
	for (const key of ["background", "quality", "size"]) {
		if (data[key] === undefined) continue;
		if (typeof data[key] !== "string" || secrets.some((secret) => secret && (data[key] as string).includes(secret))) invalid();
	}
	if (data.background !== undefined && !["transparent", "opaque", "auto"].includes(data.background as string)) invalid();
	if (data.quality !== undefined && !["low", "medium", "high", "auto"].includes(data.quality as string)) invalid();
	if (data.size !== undefined) {
		const size = data.size as string;
		if (size.trim() !== size || !/^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$/.test(size) || size.split("x").some((dimension) => Number(dimension) > 16384)) invalid();
	}
	return { background: data.background as CodexImageResponse["background"], quality: data.quality as CodexImageResponse["quality"], size: data.size as string | undefined };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(new Error("Image request cancelled."));
		const finish = () => { signal?.removeEventListener("abort", onAbort); resolve(); };
		const timer = setTimeout(finish, ms);
		const onAbort = () => { clearTimeout(timer); reject(new Error("Image request cancelled.")); };
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}
export interface CallCodexImagesOptions {
	operation: ImageOperation;
	body: ImageRequestBody;
	turnId: string;
	getAuth: () => Promise<{ token: string; accountId: string }>;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	baseUrl?: string;
	maxAttempts?: number;
	userAgent?: string;
	/** Trusted host/test policy; not a model-controlled image tool parameter. */
	timeoutMs?: number;
	assertCurrent?: () => void;
}

export async function callCodexImages(options: CallCodexImagesOptions): Promise<CodexImageResult> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS) throw new CodexImagegenError("Invalid image request deadline.");
	const timeout = new AbortController();
	const signal = options.signal ? AbortSignal.any([timeout.signal, options.signal]) : timeout.signal;
	const timer = setTimeout(() => timeout.abort(), timeoutMs);
	try {
		return await performImageRequest({ ...options, signal });
	} catch (error) {
		if (signal.aborted) throw new CodexImagegenError("Codex image request cancelled or timed out; result withheld. Remote work may already have occurred.");
		throw error;
	} finally { clearTimeout(timer); }
}

async function performImageRequest(options: CallCodexImagesOptions & { signal: AbortSignal }): Promise<CodexImageResult> {
	const check = () => { options.signal.throwIfAborted(); options.assertCurrent?.(); options.signal.throwIfAborted(); };
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = (options.baseUrl ?? CODEX_IMAGE_BASE_URL).replace(/\/$/, "");
	assertServiceBaseUrl(baseUrl, CODEX_IMAGE_BASE_URL, options.fetchImpl);
	const route = options.operation === "generate" ? "images/generations" : "images/edits";
	const maxAttempts = Math.max(1, options.maxAttempts ?? 1);
	let lastError: unknown;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		let response: Response | undefined;
		try {
			check();
			const { token, accountId } = await withAbort(Promise.resolve().then(() => { check(); return options.getAuth(); }), options.signal);
			check();
			response = await withAbort<Response>(Promise.resolve().then(async () => {
				check();
				const acquired = await fetchImpl(`${baseUrl}/${route}`, {
				method: "POST",
				redirect: "error",
				headers: {
					Authorization: `Bearer ${token}`,
					"ChatGPT-Account-ID": accountId,
					"Content-Type": "application/json",
					Accept: "application/json",
					"X-Codex-Image-Turn-ID": options.turnId,
					Originator: "pi",
					"User-Agent": options.userAgent ?? "pi-codex-imagegen/0.1.0",
				},
				body: JSON.stringify(options.body),
				signal: options.signal,
				});
				try { check(); return acquired; }
				catch (error) { void acquired.body?.cancel().catch(() => {}); throw error; }
			}), options.signal);
			check();
			// Diagnostic headers are not part of the model-facing contract: omit them on every path.
			if (!response.ok) {
				const parsed = await readBoundedJson(response, 64 * 1024, options.signal).catch(() => ({}));
				check();
				const rawReset = isRecord(parsed) && isRecord(parsed.error) ? parsed.error.resets_at : undefined;
				const candidateReset = resetTimestamp(rawReset) ?? resetTimestamp(Number(response.headers.get("x-image-gen-primary-reset-at")));
				const resetAt = candidateReset !== undefined && ![token, accountId].some((secret) => secret && String(candidateReset).includes(secret)) ? candidateReset : undefined;
				const retryable = response.status >= 500 && response.status <= 599;
				const message = response.status === 429
					? `Codex image-generation usage limit reached${resetAt ? `; resets at ${String(resetAt)}` : ""}`
					: `Codex image request failed (HTTP ${response.status}); remote error text withheld.`;
				throw new CodexImagegenError(message, { status: response.status, resetAt, retryable });
			}
			const parsed: unknown = await readBoundedJson(response, 46 * 1024 * 1024, options.signal);
			check();
			if (!isRecord(parsed) || !Array.isArray(parsed.data) || !isRecord(parsed.data[0]) || typeof parsed.data[0].b64_json !== "string") {
				throw new CodexImagegenError("Codex image endpoint returned an invalid response");
			}
			const metadata = imageMetadata(parsed, [token, accountId]);
			const imageBase64 = parsed.data[0].b64_json;
			return { imageBase64, imageBytes: decodeAndValidateGeneratedPng(imageBase64), ...metadata };
		} catch (error) {
			lastError = error;
			if (options.signal?.aborted) throw options.signal.reason ?? error;
			const retryable = error instanceof CodexImagegenError ? error.retryable : error instanceof TypeError;
			if (!retryable || attempt === maxAttempts) {
				if (error instanceof CodexImagegenError || error instanceof SubscriptionAuthError) throw error;
				throw new CodexImagegenError("Codex image request failed or exceeded its response limit; no API fallback was attempted.");
			}
			await abortableDelay(200 * 2 ** (attempt - 1), options.signal);
		} finally { void response?.body?.cancel().catch(() => {}); }
	}
	throw lastError;
}
