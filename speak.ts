import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

/**
 * speak — local TTS for Dan
 *
 * Speaks text aloud on Dan's speakers via the Kokoro-82M server
 * (tts_server.py, port 8888, Fun project). Playback is NON-BLOCKING:
 * audio starts and the tool returns immediately, so Dan reads the
 * following text while hearing the voice — dual-channel input.
 *
 * The TUI renders the call (renderCall) BEFORE playback, so every
 * spoken line is telegraphed. No ambushes.
 *
 * Protocol: voice is ON REQUEST only. Dan says "voice" (or asks for it).
 * Not ambient.
 */

const SPEAK_URL = "http://127.0.0.1:8888/speak";

const SPEAK_DESCRIPTION =
	"Speak text aloud on Dan's speakers via the local Kokoro TTS server (port 8888). " +
	"Playback is non-blocking: the line is spoken while Dan reads the rest of the reply. " +
	"VOICE IS DAN'S DEFAULT CHANNEL (standing order, 2026-08-30): speak every user-facing line to Dan through this tool. " +
	"Write spoken text FOR THE EAR: short sentences, no lists, no markdown, no tables. " +
	"Keep spoken lines to a few sentences — the rest of the reply continues as text he reads while hearing you. " +
	"Use plain text only when Dan says 'text only' (the session off switch).";

const SpeakParams = Type.Object({
	text: Type.String({ description: "The exact words to speak." }),
	voice: Type.Optional(
		Type.String({
			description:
				"Kokoro voice id. Default af_heart (warm female). Alternatives: am_michael (low male), bf_emma (British female).",
		}),
	),
});

type SpeakDetails = {
	spoken: boolean;
	duration_s?: number;
	voice?: string;
	error?: string;
};

function createResult(text: string, details: SpeakDetails): AgentToolResult<SpeakDetails> {
	return {
		content: [{ type: "text", text }],
		details,
	};
}

export default function speakExtension(pi: ExtensionAPI) {
	pi.registerTool<typeof SpeakParams, SpeakDetails>({
		name: "speak",
		label: "Speak",
		description: SPEAK_DESCRIPTION,
		promptSnippet:
			"Speak a line aloud on Dan's speakers via the local TTS server (non-blocking; he reads text while hearing it). On request only.",
		promptGuidelines: [
			"Dan's standing order: voice is always on. Speak your lines to him through speak — he reads your text while hearing it (non-blocking). Chunk spoken lines short (2-4 sentences) so audio doesn't out-run the text.",
		],
		parameters: SpeakParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx: ExtensionContext) {
			const details: SpeakDetails = { spoken: false, voice: params.voice ?? "af_heart" };
			try {
				const res = await fetch(SPEAK_URL, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ text: params.text, voice: params.voice ?? "af_heart" }),
				});
				const body = (await res.json()) as { status: string; duration_s?: number; voice?: string };
				details.spoken = res.ok && body.status === "playing";
				details.duration_s = body.duration_s;
				details.voice = body.voice;
				if (details.spoken) {
					return createResult(
						`Spoke ${body.duration_s ?? "?"}s via ${body.voice ?? "af_heart"}. Dan is reading this reply while hearing it.`,
						details,
					);
				}
				return createResult(`TTS server responded ${res.status}: ${body.status}`, details);
			} catch (err) {
				details.error = String(err);
				return createResult(
					`TTS server not reachable at ${SPEAK_URL} (${err}). The line was delivered as text — Dan is reading it. Start the server: pythonw tts_server.py in the Fun project.`,
					details,
				);
			}
		},

		renderCall(args, theme) {
			const text = typeof args.text === "string" ? args.text : "";
			return new Text(theme.fg("toolTitle", theme.bold("speak ")) + theme.fg("muted", text), 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SpeakDetails | undefined;
			if (!details) {
				return new Text(
					result.content
						.filter((part): part is { type: "text"; text: string } => part.type === "text")
						.map((part) => part.text)
						.join("\n"),
					0,
					0,
				);
			}
			if (!details.spoken) {
				return new Text(theme.fg("warning", "TTS unavailable — line delivered as text"), 0, 0);
			}
			return new Text(
				theme.fg("success", "✓ Spoke ") + theme.fg("accent", `${details.duration_s ?? "?"}s via ${details.voice}`),
				0,
				0,
			);
		},
	});
}
