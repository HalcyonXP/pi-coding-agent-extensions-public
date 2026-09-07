// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import { DynamicBorder, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, SettingsList, Text, truncateToWidth, type SettingItem, type TuiMouseEvent } from "@earendil-works/pi-tui";

export interface SettingsRow {
	id: string;
	label: string;
	value: string;
	description: string;
	values?: string[];
}
export interface SettingsController {
	read(): Promise<SettingsRow[]>;
	change(id: string, value: string, signal: AbortSignal): Promise<string>;
	isCurrent(): boolean;
	onBoundary(close: () => void): () => void;
}
/** Native configuration can contain custom model names; never render terminal controls. */
export function settingsText(value: string): string {
	return value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Uses Pi's real settings list; no copied widget or custom keybinding scheme. */
export class OpenAISettingsPanel extends Container {
	private readonly list: SettingsList;
	private readonly items: SettingItem[];
	private readonly feedback: Text;
	private readonly controller: SettingsController;
	private readonly requestRender: () => void;
	private readonly abort = new AbortController();
	private readonly unsubscribe: () => void;
	private readonly closeMenu: () => void;
	private rows: SettingsRow[];
	private busy = false;
	private closed = false;
	private width = 80;

	constructor(rows: SettingsRow[], controller: SettingsController, theme: ExtensionContext["ui"]["theme"], requestRender: () => void, done: () => void, focus = "fast") {
		super();
		this.rows = rows; this.controller = controller; this.requestRender = requestRender;
		this.items = rows.map(row => ({ id: row.id, label: settingsText(row.label), currentValue: settingsText(row.value), description: settingsText(row.description), values: row.values?.slice() }));
		// Use the theme passed by ui.custom: jiti can have a separate SDK theme cache.
		this.list = new SettingsList(this.items, 8, {
			label: (text, selected) => selected ? theme.fg("accent", text) : text,
			value: (text, selected) => theme.fg(selected ? "accent" : "muted", text),
			description: text => theme.fg("dim", text),
			cursor: theme.fg("accent", "→ "),
			hint: text => theme.fg("dim", text.replace("Esc to cancel", "Esc to close")),
		}, (id, value) => { void this.change(id, value); }, () => this.closeMenu(), { enableSearch: true });
		this.list.selectItem(focus);
		this.feedback = new Text(theme.fg("dim", "Changes apply immediately. Tool changes cancel running capability work."), 1, 0);
		this.addChild(new DynamicBorder(text => theme.fg("border", text)));
		this.addChild(new Text(theme.fg("accent", "OpenAI settings"), 1, 0));
		this.addChild(new Text(theme.fg("muted", "Fast: saved for this profile · Tools: this session only"), 1, 0));
		this.addChild(this.list);
		this.addChild(this.feedback);
		this.addChild(new DynamicBorder(text => theme.fg("border", text)));
		this.closeMenu = () => { if (this.closed) return; this.dispose(); done(); };
		this.unsubscribe = controller.onBoundary(() => this.closeMenu());
		if (!controller.isCurrent()) queueMicrotask(() => this.closeMenu());
	}

	private update(rows: SettingsRow[]): void {
		this.rows = rows;
		for (const item of this.items) {
			const row = rows.find(row => row.id === item.id);
			item.currentValue = row ? settingsText(row.value) : "unavailable";
			item.description = row ? settingsText(row.description) : "Configuration changed. Close and reopen settings.";
			item.values = this.busy ? undefined : row?.values?.slice();
		}
	}
	private async change(id: string, value: string): Promise<void> {
		if (this.closed || this.busy) return;
		if (this.width < 32) { this.update(this.rows); return; }
		const row = this.rows.find(row => row.id === id);
		if (!row?.values?.includes(value) || !this.controller.isCurrent()) { this.closeMenu(); return; }
		this.busy = true; this.update(this.rows); // undo SettingsList's optimistic value until backend confirmation
		this.list.updateValue(id, "applying…");
		this.feedback.setText(` ${settingsText(row.label)}: applying…`); this.requestRender();
		let message: string;
		try { message = await this.controller.change(id, value, this.abort.signal); }
		catch (error) { message = `Change failed: ${settingsText(error instanceof Error ? error.message : "Unable to change setting")}`; }
		if (this.closed) return;
		try {
			const rows = await this.controller.read();
			if (this.closed || !this.controller.isCurrent()) { this.closeMenu(); return; }
			this.busy = false; this.update(rows);
			this.feedback.setText(` ${settingsText(message)}`);
		} catch {
			// Do not leave an actionable stale view if authoritative state cannot be read.
			this.busy = true;
			for (const item of this.items) { item.currentValue = "unknown"; item.values = undefined; item.description = "Current state could not be refreshed. Close and reopen settings."; }
			this.feedback.setText(" Unable to refresh settings. Close and reopen; no further changes are available.");
		}
		if (!this.closed) this.requestRender();
	}
	handleInput(data: string): void { if (!this.closed) this.list.handleInput(data); }
	handleMouse(event: TuiMouseEvent) { return !this.closed && event.width >= 32 ? super.handleMouse(event) : undefined; }
	render(width: number): string[] {
		this.width = width;
		if (width <= 0) return [];
		if (width < 32) return [truncateToWidth("Widen terminal for settings · Esc closes", width, "")];
		return super.render(width).map(line => truncateToWidth(line, width, ""));
	}
	dispose(): void { if (this.closed) return; this.closed = true; this.abort.abort(); this.unsubscribe?.(); }
}

export async function showOpenAISettings(ctx: ExtensionContext, controller: SettingsController, focus?: string): Promise<void> {
	const rows = await controller.read();
	if (!controller.isCurrent()) return;
	await ctx.ui.custom<void>((tui, theme, _keys, done) => new OpenAISettingsPanel(rows, controller, theme, () => tui.requestRender(), () => done(), focus));
}
