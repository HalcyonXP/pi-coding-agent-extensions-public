import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const OUTPUT_CONSTRAINT = "text only; no native audio or video";

const KNOWLEDGE_CUTOFFS_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"knowledge-cutoffs.json",
);

export interface ConstraintModel {
	provider: string;
	id: string;
	input: readonly string[];
	contextWindow: number;
}

export type KnowledgeCutoffs = Readonly<Record<string, string>>;

// Missing cutoffs are reported once per exact model key in this process.
const warnedMissingCutoffs = new Set<string>();

export function modelKey(model: Pick<ConstraintModel, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

function formatList(items: readonly string[]): string {
	if (items.length === 1) return items[0];
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/** Format known modalities exactly and preserve future modalities visibly. */
export function formatInputModalities(input: readonly string[]): string {
	const modalities = [...new Set(input)];
	if (modalities.length === 0) return "no input modalities configured";

	if (modalities.length === 1 && modalities[0] === "text") {
		return "text only";
	}
	if (
		modalities.length === 2 &&
		modalities.includes("text") &&
		modalities.includes("image")
	) {
		return "text and images only";
	}

	const labels = modalities.map((modality) =>
		modality === "image" ? "images" : modality,
	);
	return `${formatList(labels)} only`;
}

export function resolveKnowledgeCutoff(
	cutoffs: KnowledgeCutoffs,
	key: string,
): string | undefined {
	return Object.prototype.hasOwnProperty.call(cutoffs, key) ? cutoffs[key] : undefined;
}

function validateKnowledgeCutoffs(value: unknown, sourcePath: string): KnowledgeCutoffs {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(
			`model-constraints: ${sourcePath} must contain a JSON object of ` +
				`exact provider/model-id keys to cutoff strings`,
		);
	}

	const validated: Record<string, string> = Object.create(null) as Record<string, string>;
	for (const [key, cutoff] of Object.entries(value)) {
		const firstSlash = key.indexOf("/");
		if (
			key.length === 0 ||
			key.trim() !== key ||
			firstSlash <= 0 ||
			firstSlash === key.length - 1 ||
			/[\r\n]/.test(key)
		) {
			throw new Error(
				`model-constraints: invalid key ${JSON.stringify(key)} in ${sourcePath}; ` +
					`expected an exact provider/model-id key`,
			);
		}
		if (
			typeof cutoff !== "string" ||
			cutoff.length === 0 ||
			cutoff.trim() !== cutoff ||
			/[\r\n]/.test(cutoff)
		) {
			throw new Error(
				`model-constraints: cutoff for ${JSON.stringify(key)} in ${sourcePath} ` +
					`must be a non-empty, single-line string without surrounding whitespace`,
			);
		}
		validated[key] = cutoff;
	}

	return Object.freeze(validated);
}

/** Read and validate the registry. Called by the factory so /reload re-reads it. */
export function loadKnowledgeCutoffs(
	sourcePath: string = KNOWLEDGE_CUTOFFS_PATH,
): KnowledgeCutoffs {
	let source: string;
	try {
		source = readFileSync(sourcePath, "utf8");
	} catch (error) {
		throw new Error(
			`model-constraints: unable to read ${sourcePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ cause: error },
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(
			`model-constraints: invalid JSON in ${sourcePath}: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ cause: error },
		);
	}

	return validateKnowledgeCutoffs(parsed, sourcePath);
}

function formatContextWindow(contextWindow: number): string {
	if (!Number.isSafeInteger(contextWindow) || contextWindow <= 0) {
		throw new Error(
			`model-constraints: invalid context window ${JSON.stringify(contextWindow)}`,
		);
	}
	return String(contextWindow);
}

/** Format the machine's current local calendar date without a time component. */
export function formatCurrentDate(date: Date = new Date()): string {
	if (Number.isNaN(date.getTime())) {
		throw new Error("model-constraints: invalid current date");
	}
	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(date);
}

export function buildConstraintBlock(
	model: ConstraintModel,
	cutoff: string | undefined,
	currentDate: Date = new Date(),
): string {
	const key = modelKey(model);
	return [
		"# Your Architectural Constraints:",
		"",
		`* **Input**: ${formatInputModalities(model.input)}`,
		`* **Output**: ${OUTPUT_CONSTRAINT}`,
		`* **Context window**: ${formatContextWindow(model.contextWindow)} tokens`,
		`* **Knowledge cutoff**: ${cutoff ?? `not configured for ${key}`}`,
		`* **Current date**: ${formatCurrentDate(currentDate)}`,
	].join("\n");
}

export function appendConstraintBlock(systemPrompt: string, block: string): string {
	return `${systemPrompt}\n\n${block}`;
}

export default function modelConstraints(pi: ExtensionAPI): void {
	const cutoffs = loadKnowledgeCutoffs();

	pi.on("before_agent_start", (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		const key = modelKey(model);
		const cutoff = resolveKnowledgeCutoff(cutoffs, key);
		const block = buildConstraintBlock(model, cutoff);
		const systemPrompt = appendConstraintBlock(event.systemPrompt, block);

		if (cutoff === undefined && !warnedMissingCutoffs.has(key)) {
			warnedMissingCutoffs.add(key);
			ctx.ui.notify(
				`model-constraints: no knowledge cutoff is configured for ${key}; ` +
					`the prompt explicitly reports it as not configured. Add an exact entry ` +
					`to knowledge-cutoffs.json and run /reload.`,
				"warning",
			);
		}

		return { systemPrompt };
	});

	pi.registerCommand("model-constraints", {
		description: "Show active model constraints",
		handler: async (_args, ctx): Promise<void> => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("model-constraints: no model is currently selected.", "warning");
				return;
			}

			const key = modelKey(model);
			const cutoff = resolveKnowledgeCutoff(cutoffs, key);

			ctx.ui.notify(
				[
					`Model: ${key}`,
					`Input: ${formatInputModalities(model.input)}`,
					`Output: ${OUTPUT_CONSTRAINT}`,
					`Context window: ${formatContextWindow(model.contextWindow)} tokens`,
					`Knowledge cutoff: ${cutoff ?? "not configured"}`,
					`Current date: ${formatCurrentDate()}`,
				].join("\n"),
				cutoff === undefined ? "warning" : "info",
			);
		},
	});
}
