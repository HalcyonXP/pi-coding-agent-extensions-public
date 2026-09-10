import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type {
	ToolDefinition,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	assertNoSymlinkEscape,
	buildImageRequest,
	callCodexImages,
	detectImageMimeType,

	isPathInside,
	MAX_INPUT_IMAGE_BYTES,
	MAX_REFERENCE_IMAGES,
	resolveDestinationLexically,
	sanitizeArtifactSegment,
	type ImageReference,

} from "./core.ts";

const EXTENSION_VERSION = "0.2.0";

const TOOL_NAME = "imagegen";
import type { CapabilityLease } from "../capability-policy.ts";
import { resolveSubscriptionAuth } from "../subscription.ts";

interface ImagegenDetails {
	status: "working" | "completed";
	operation?: "generate" | "edit";
	canonicalPath?: string;
	destinationPath?: string;
	/** Generation succeeded; optional copy failure must not discard the original. */
	copyStatus?: "failed";
	requestedDestinationPath?: string;
	background?: string;
	quality?: string;
	size?: string;
}

export const ImagegenParams = Type.Object(
	{
		prompt: Type.String({
			minLength: 1,
			description: "Detailed visual description or edit instructions. For edits, state what must change and what must remain unchanged.",
		}),
		referenced_image_paths: Type.Optional(
			Type.Array(Type.String(), {
				minItems: 1,
				maxItems: MAX_REFERENCE_IMAGES,
				description: "Workspace-local image paths to edit or use as references, in meaningful order. Paths outside the Pi workspace are rejected.",
			}),
		),
		referenced_image_refs: Type.Optional(Type.Array(Type.String({pattern: "^img_[a-f0-9-]{36}$"}), {
			minItems: 1, maxItems: MAX_REFERENCE_IMAGES,
			description: "Protected image references returned by Code mode in this native context. No filesystem fallback; exclusive with paths/recent images.",
		})),
		num_last_images_to_include: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: MAX_REFERENCE_IMAGES,
				description: "Use the smallest number of recent pathless conversation images needed for an edit. Do not combine with referenced_image_paths.",
			}),
		),
		destination_path: Type.Optional(
			Type.String({
				minLength: 1,
				description: "Optional .png file path relative to the current Pi workspace, for example public/images/hero.png. A canonical original is always retained separately.",
			}),
		),
	},
	{ additionalProperties: false },
);

function imageContent(value: unknown): value is ImageContent {
	if (typeof value !== "object" || value === null) return false;
	const item = value as Record<string, unknown>;
	return item.type === "image" && typeof item.data === "string" && typeof item.mimeType === "string";
}

function normalizeConversationImage(image: ImageContent): ImageReference {
	if (image.data.length > Math.ceil(MAX_INPUT_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) {
		throw new Error("conversation image must contain bounded canonical base64");
	}
	const bytes = Buffer.from(image.data, "base64");
	if (bytes.toString("base64") !== image.data) throw new Error("conversation image must contain canonical base64");
	if (!bytes.length || bytes.length > MAX_INPUT_IMAGE_BYTES) {
		throw new Error(`conversation image is empty or exceeds ${MAX_INPUT_IMAGE_BYTES} bytes`);
	}
	const detected = detectImageMimeType(bytes);
	if (!detected) throw new Error(`unsupported conversation image type: ${image.mimeType}`);
	return { data: bytes.toString("base64"), mimeType: detected };
}

function collectRecentImages(ctx: ExtensionContext, count: number): ImageReference[] {
	const found: ImageReference[] = [];
	const branch = ctx.sessionManager.getBranch();
	for (let entryIndex = branch.length - 1; entryIndex >= 0 && found.length < count; entryIndex--) {
		const entry = branch[entryIndex];
		if (entry.type !== "message" && entry.type !== "custom_message") continue;
		const content = entry.type === "custom_message" ? entry.content : (entry.message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (let contentIndex = content.length - 1; contentIndex >= 0 && found.length < count; contentIndex--) {
			const item = content[contentIndex];
			if (imageContent(item)) found.push(normalizeConversationImage(item));
		}
	}
	found.reverse();
	if (found.length !== count) {
		throw new Error(`requested ${count} recent conversation image(s), but only ${found.length} were available`);
	}
	return found;
}

async function loadWorkspaceReference(workspace: string, rawPath: string): Promise<ImageReference> {
	let requested = rawPath.trim();
	if (requested.startsWith("@")) requested = requested.slice(1);
	if (!requested || requested.includes("\0")) throw new Error("reference image path is empty or invalid");
	const workspacePath = path.resolve(workspace);
	const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(workspacePath, requested);
	if (!isPathInside(workspacePath, candidate)) throw new Error(`reference image is outside the Pi workspace: ${rawPath}`);
	await assertNoSymlinkEscape(workspacePath, candidate);
	const resolved = await realpath(candidate);
	const realWorkspace = await realpath(workspacePath);
	if (!isPathInside(realWorkspace, resolved)) throw new Error(`reference image escapes the Pi workspace through a symlink: ${rawPath}`);
	const info = await stat(resolved);
	if (!info.isFile()) throw new Error(`reference image is not a file: ${rawPath}`);
	if (info.size <= 0 || info.size > MAX_INPUT_IMAGE_BYTES) throw new Error(`reference image is empty or exceeds 50 MB: ${rawPath}`);
	const bytes = await readFile(resolved);
	const mimeType = detectImageMimeType(bytes);
	if (!mimeType) throw new Error(`unsupported reference image format: ${rawPath}`);
	return { data: bytes.toString("base64"), mimeType };
}

async function writeNewWorkspaceFile(workspace: string, target: string, bytes: Buffer, withFileMutationQueue: MutationQueue, guard: () => void): Promise<void> {
	await withFileMutationQueue(target, async () => {
		guard();
		await assertNoSymlinkEscape(workspace, target);
		guard();
		await mkdir(path.dirname(target), { recursive: true });
		await assertNoSymlinkEscape(workspace, target);
		guard();
		await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
	});
}

async function canonicalOutputPath(ctx: ExtensionContext, toolCallId: string): Promise<string> {
	const session = sanitizeArtifactSegment(ctx.sessionManager.getSessionId(), "session");
	const call = sanitizeArtifactSegment(toolCallId, "image");
	const root = path.resolve(ctx.cwd, ".pi", "Agent", "Work", "generated_images", session);
	let candidate = path.join(root, `${call}.png`);
	try {
		await stat(candidate);
		candidate = path.join(root, `${call}-${randomUUID().slice(0, 8)}.png`);
	} catch {
		// The preferred immutable path is available.
	}
	return candidate;
}

function relativeForDisplay(workspace: string, file: string): string {
	const relative = path.relative(workspace, file);
	return relative && !relative.startsWith("..") ? relative : file;
}

export type MutationQueue = <T>(path: string, operation: () => Promise<T>) => Promise<T>;

export function createImagegenTool(
	getLease: (ctx: ExtensionContext, signal?: AbortSignal) => CapabilityLease,
	getTurnId: () => string,
	mutationQueue: MutationQueue,
) {
	return {
		name: TOOL_NAME,
		label: "Codex Image Generation",
		description:
			"Generate or edit a raster image with the subscription-backed OpenAI Codex image service. Uses gpt-image-2 with automatic size, quality, and background. Keeps an immutable canonical PNG and can copy it to a safe workspace-relative destination.",
		promptSnippet: "Generate or edit raster images with the subscription-backed Codex image service",
		promptGuidelines: [
			"Use imagegen when the user requests an AI-generated or AI-edited raster image; prefer SVG, HTML/CSS, or project-native vector assets when those better fit the task.",
			"For a new image, call imagegen with prompt only. For edits, select exactly one of referenced_image_paths, num_last_images_to_include, or Code mode referenced_image_refs.",
			"Use imagegen destination_path only when the intended workspace-relative .png path is clear; existing files are never overwritten.",
		],
		parameters: ImagegenParams,
		executionMode: "sequential",

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const lease = getLease(ctx, signal);
			try {
				if ([params.referenced_image_paths, params.num_last_images_to_include, params.referenced_image_refs].filter(value => value !== undefined).length > 1) {
					throw new Error("Provide only one reference source: referenced_image_paths, num_last_images_to_include, or referenced_image_refs, not both/multiple");
				}
				if (params.destination_path) {
					const destination = resolveDestinationLexically(ctx.cwd, params.destination_path);
					await assertNoSymlinkEscape(ctx.cwd, destination);
					const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
						if (error.code !== "ENOENT") throw error;
						return undefined;
					});
					if (existing) throw new Error("Image destination already exists; choose a new PNG path.");
					lease.assertCurrent();
				}
				onUpdate?.({
					content: [{ type: "text", text: "Preparing Codex image request…" }],
					details: { status: "working" } satisfies ImagegenDetails,
				});

				let references: ImageReference[] = [];
				if (params.referenced_image_paths) {
					references = await Promise.all(params.referenced_image_paths.map((file) => loadWorkspaceReference(ctx.cwd, file)));
				} else if (params.num_last_images_to_include !== undefined) {
					references = collectRecentImages(ctx, params.num_last_images_to_include);
				} else if (params.referenced_image_refs) {
					const invocation = (ctx as ExtensionContext & {tools?: {hasProtectedResults?: () => boolean; resolveImageReference?: (ref: string) => ImageContent}}).tools;
					if (!invocation?.hasProtectedResults?.() || !invocation.resolveImageReference) throw new Error("Protected image references require the native Code mode context.");
					references = params.referenced_image_refs.map(ref => normalizeConversationImage(invocation.resolveImageReference!(ref)));
				}
				const request = buildImageRequest(params.prompt, references);
				onUpdate?.({
					content: [{ type: "text", text: `${request.operation === "generate" ? "Generating" : "Editing"} image with Codex…` }],
					details: { status: "working", operation: request.operation } satisfies ImagegenDetails,
				});

				lease.assertCurrent();
				const result = await callCodexImages({
					operation: request.operation,
					body: request.body,
					turnId: getTurnId(),
					getAuth: () => resolveSubscriptionAuth(ctx, lease),
					signal: lease.signal,
					assertCurrent: lease.assertCurrent,
					userAgent: `pi-openai-compatibility/${EXTENSION_VERSION}`,
				});

				lease.assertCurrent();
				const canonicalPath = await canonicalOutputPath(ctx, toolCallId);
				lease.assertCurrent();
				await writeNewWorkspaceFile(ctx.cwd, canonicalPath, result.imageBytes, mutationQueue, lease.assertCurrent);

				let destinationPath: string | undefined, requestedDestinationPath: string | undefined;
				if (params.destination_path) {
					lease.assertCurrent();
					const target = resolveDestinationLexically(ctx.cwd, params.destination_path);
					try {
						if (path.resolve(target) !== path.resolve(canonicalPath)) {
							await writeNewWorkspaceFile(ctx.cwd, target, result.imageBytes, mutationQueue, lease.assertCurrent);
						}
						destinationPath = target;
					} catch {
						// Revocation remains a refusal, not successful delivery. Otherwise
						// preserve the generated image in native output/evidence and make
						// the optional-copy failure explicit without echoing OS diagnostics.
						lease.assertCurrent();
						requestedDestinationPath = target;
					}
				}

				lease.assertCurrent();
				const canonicalDisplay = relativeForDisplay(ctx.cwd, canonicalPath);
				const destinationDisplay = destinationPath ? relativeForDisplay(ctx.cwd, destinationPath) : undefined;
				const summary = [
					`${request.operation === "generate" ? "Generated" : "Edited"} image saved to ${canonicalDisplay}.`,
					destinationDisplay && destinationDisplay !== canonicalDisplay ? `Workspace copy: ${destinationDisplay}.` : undefined,
					requestedDestinationPath ? "Workspace copy failed; no successful copy is claimed. The canonical original is retained. Do not regenerate; recover the original instead." : undefined,
					result.size ? `Size: ${result.size}.` : undefined,
					result.quality ? `Quality: ${result.quality}.` : undefined,
					result.background ? `Background: ${result.background}.` : undefined,
				].filter(Boolean).join(" ");

				return {
					content: [
						{ type: "image", data: result.imageBase64, mimeType: "image/png" },
						{ type: "text", text: summary },
					],
					details: {
						status: "completed",
						operation: request.operation,
						canonicalPath,
						destinationPath,
						...(requestedDestinationPath ? { copyStatus: "failed" as const, requestedDestinationPath } : {}),
						background: result.background,
						quality: result.quality,
						size: result.size,
					} satisfies ImagegenDetails,
				};
			} finally { lease.release(); }
		},
	} satisfies ToolDefinition<typeof ImagegenParams>;
}
