/** Text-only selection from an already authorized native context snapshot.
 * This is NOT a session-history reader or a guest capability. The caller must
 * supply the finalized, hook-approved context; raw session ancestry is unsafe.
 * Forwarding requires the separate experimental-context profile and a native
 * serialized-request-confirmed snapshot. Existing profiles do not upload conversation text.
 */
export interface VisibleHistoryTurn {
	readonly role: "user" | "assistant";
	readonly text: string;
}

export interface WebHistoryMessage {
	readonly type: "message";
	readonly role: "user" | "assistant";
	readonly content: readonly { readonly type: "input_text" | "output_text"; readonly text: string }[];
}

/** Source-derived SearchInput::Items text DTO, without IDs, phases or metadata. */
export function webHistoryInput(messages: readonly { role: string; content?: unknown }[]): readonly WebHistoryMessage[] {
	const input = visibleWebHistory(messages).map(turn => Object.freeze({
		type: "message" as const, role: turn.role,
		content: Object.freeze([Object.freeze({ type: turn.role === "user" ? "input_text" as const : "output_text" as const, text: turn.text })]),
	}));
	if (Buffer.byteLength(JSON.stringify(input), "utf8") > WEB_HISTORY_LIMITS.serializedBytes) refused();
	return Object.freeze(input);
}

export const WEB_HISTORY_LIMITS = Object.freeze({
	scannedMessages: 512,
	contentBlocks: 128,
	assistantBytes: 4000,
	serializedBytes: 8192,
});

function refused(): never {
	throw new Error("WEB_HISTORY_LIMIT");
}

function textOf(message: { content?: unknown }, allowance?: number): { text: string; truncated: boolean } {
	if (typeof message.content === "string") {
		const text = allowance === undefined ? message.content : prefixBytes(message.content, allowance);
		return { text, truncated: text !== message.content };
	}
	if (!Array.isArray(message.content)) return { text: "", truncated: false };
	if (message.content.length > WEB_HISTORY_LIMITS.contentBlocks) refused();
	const text: string[] = [];
	let chars = 0;
	let truncated = false;
	for (const block of message.content) {
		if (block?.type !== "text" || typeof block.text !== "string") continue;
		if (allowance !== undefined) {
			const separator = text.length ? 1 : 0;
			if (allowance < separator) {
				truncated = true;
				break;
			}
			const part = prefixBytes(block.text, allowance - separator);
			allowance -= separator + Buffer.byteLength(part, "utf8");
			text.push(part);
			truncated = part !== block.text;
			if (truncated || allowance === 0) break;
		} else {
			chars += block.text.length;
			if (chars > WEB_HISTORY_LIMITS.serializedBytes) refused();
			text.push(block.text);
		}
	}
	return { text: text.join("\n"), truncated };
}

function prefixBytes(text: string, limit: number): string {
	if (text.length <= limit && Buffer.byteLength(text, "utf8") <= limit) return text;
	let bytes = 0;
	let end = 0;
	for (const point of text) {
		const size = Buffer.byteLength(point, "utf8");
		if (bytes + size > limit) break;
		bytes += size;
		end += point.length;
	}
	return text.slice(0, end);
}

/** Last two native user turns through the latest user, with intervening visible
 * assistant text only. Never include later commentary, tool/evidence/custom
 * messages, thinking, images or metadata as extra context. This is not a secret
 * scrubber: selected literal user/assistant text still requires native approval.
 * Assistant truncation is a Pi byte restriction, NOT upstream token parity.
 * User text is never silently truncated; an oversized window refuses.
 * Input is trusted native plain data, not arbitrary guest objects or Proxies.
 */
export function visibleWebHistory(
	messages: readonly { role: string; content?: unknown }[],
): readonly VisibleHistoryTurn[] {
	if (!Array.isArray(messages)) refused();
	const lower = Math.max(0, messages.length - WEB_HISTORY_LIMITS.scannedMessages);
	let latest = -1;
	let earliest = -1;
	for (let i = messages.length - 1; i >= lower; i--) {
		if (messages[i].role !== "user") continue;
		if (latest < 0) latest = earliest = i;
		else {
			earliest = i;
			break;
		}
	}
	// Do not silently call an incomplete scan a complete conversation window.
	if (lower > 0 && (latest < 0 || earliest === latest)) refused();
	if (latest < 0) return Object.freeze([]);
	let assistantRemaining: number = WEB_HISTORY_LIMITS.assistantBytes;
	const turns: VisibleHistoryTurn[] = [];
	for (let i = earliest; i <= latest; i++) {
		const message = messages[i];
		if (message.role !== "user" && message.role !== "assistant") continue;
		if (message.role === "assistant" && assistantRemaining === 0) continue;
		const selected = textOf(message, message.role === "assistant" ? assistantRemaining : undefined);
		const text = selected.text;
		if (message.role === "assistant") {
			assistantRemaining = selected.truncated ? 0 : assistantRemaining - Buffer.byteLength(text, "utf8");
			if (!text) continue;
		}
		// Preserve an image-only user as an empty text boundary, not its image.
		if (text.length > WEB_HISTORY_LIMITS.serializedBytes) refused();
		turns.push(Object.freeze({ role: message.role, text }));
	}
	if (Buffer.byteLength(JSON.stringify(turns), "utf8") > WEB_HISTORY_LIMITS.serializedBytes) refused();
	return Object.freeze(turns);
}
