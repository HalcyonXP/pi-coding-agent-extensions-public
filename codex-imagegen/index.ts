interface MigrationNoticeAPI {
	on(event: "session_start", handler: (event: unknown, ctx: { hasUI: boolean; ui: { notify(message: string, kind: "warning"): void } }) => void): void;
}

/** Retired loader: no tools or credentials. An old settings entry cannot bypass the new trust gates. */
export default function retiredImagegen(pi: MigrationNoticeAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.notify("codex-imagegen has moved into openai-compatibility. Remove the legacy extension entry after reviewing the migration guide.", "warning");
	});
}
