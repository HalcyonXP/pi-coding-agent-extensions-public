// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { execInput } from "./runtime/cell-input.mjs";

// Grammar from OpenAI Codex at 45305dd229c01e6cb6e122f6559e4f9b805bae6b,
// core/src/tools/code_mode/execute_spec.rs. See THIRD_PARTY_NOTICES.md.
export const CODE_GRAMMAR = `
start: pragma_source | plain_source
pragma_source: PRAGMA_LINE NEWLINE SOURCE
plain_source: SOURCE

PRAGMA_LINE: /[ \\t]*\\/\\/ @exec:[^\\r\\n]*/
NEWLINE: /\\r?\\n/
SOURCE: /[\\s\\S]+/
`;
export const CODE_CONSTRAINED_SAMPLING = Object.freeze({
	type: "grammar",
	variants: Object.freeze({ openai_lark: CODE_GRAMMAR }),
} satisfies ToolDefinition["constrainedSampling"]);

/** Native catalog capability, not a provider override or invocation authority. */
export function supportsNativeCodeInput(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	return !!model && ["openai-responses", "openai-codex-responses"].includes(model.api) &&
		!!model.compat && "supportsOpenAIGrammarTools" in model.compat &&
		model.compat.supportsOpenAIGrammarTools === true;
}

/** Preserve raw source for native history. Do not silently discard legacy options
 * during custom-call replay: model/RPC calls must put them in the source pragma.
 * Internal CodeMode.exec remains the structured runtime API, not the wire API. */
export function prepareCodeArguments(args: unknown): { code: string } {
	const invalid = () => new Error("Code exec requires only {code: raw JavaScript}; put yield_time_ms/max_output_tokens in a first-line // @exec: JSON pragma. Other fields are not accepted.");
	if (!args || typeof args !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) throw invalid();
	const keys = Reflect.ownKeys(args), value = Object.getOwnPropertyDescriptor(args, "code");
	if (keys.length !== 1 || keys[0] !== "code" || !value || !("value" in value) || typeof value.value !== "string") throw invalid();
	// Reuse the authoritative bounded pragma parser; no compilation, scope, auth,
	// process or service access is performed by native prepareArguments.
	execInput(value.value);
	return { code: value.value };
}
