import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { validateSearchCommands, WebSearchError } from "./web-search.ts";

/** D14 observed this service model independently of the user's conversational model. */
export const VERIFIED_SEARCH_MODEL = "gpt-5.4-mini";
export const VerifiedSearchCommands = Type.Object(
	{
		search_query: Type.Optional(
			Type.Array(
				Type.Object(
					{
						q: Type.String({ minLength: 1, maxLength: 2000 }),
						domains: Type.Optional(
							Type.Array(Type.String({ minLength: 1, maxLength: 253 }), {
								minItems: 1,
								maxItems: 10,
							}),
						),
					},
					{ additionalProperties: false },
				),
				{ minItems: 1, maxItems: 1 },
			),
		),
		open: Type.Optional(
			Type.Array(
				Type.Object(
					{ ref_id: Type.String({ minLength: 1, maxLength: 4096 }) },
					{ additionalProperties: false },
				),
				{ minItems: 1, maxItems: 1 },
			),
		),
		response_length: Type.Optional(Type.Literal("short")),
	},
	{ additionalProperties: false },
);

export function validateVerifiedSearch(value: unknown) {
	if (!Value.Check(VerifiedSearchCommands, value))
		throw new WebSearchError(
			"arguments",
			"Verified Web search supports one search or public-URL open, short output only; find, recency, line offsets and other variants are unavailable.",
		);
	const commands = validateSearchCommands(value);
	if ((commands.search_query?.length ?? 0) + (commands.open?.length ?? 0) !== 1)
		throw new WebSearchError(
			"arguments",
			"Use exactly one search or public-URL open operation.",
		);
	return { ...commands, response_length: "short" as const };
}

/** The stock SDK has no nested gateway. Patched hosts must identify direct calls.
 * Never infer ownership from call-ID strings or a generated-JavaScript argument.
 * A nested path is allowed only with the native finalized-descendant publication scope.
 * Installed JavaScript remains trusted; model parameters cannot supply a context or callback.
 */
export function assertDirectSearch(ctx: ExtensionContext): void {
	try {
		const invocation = (
			ctx as ExtensionContext & { tools?: { readonly origin?: unknown; hasProtectedResults?: () => boolean } }
		).tools;
		if (invocation === undefined || invocation?.origin === "direct") return;
		if (invocation?.origin === "nested" && invocation.hasProtectedResults?.() === true) return;
	} catch {
		/* no raw context/metadata exceptions */
	}
	throw new WebSearchError(
		"unsupported",
		"Web search requires a direct tool call or protected native Code mode scope: this nested/unknown path cannot enforce citation evidence output.",
	);
}
