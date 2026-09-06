import { fileURLToPath } from "node:url";
import {
	DefaultPackageManager,
	getAgentDir,
	SettingsManager,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Input,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Focusable,
} from "@earendil-works/pi-tui";
import {
	buildManagedExtensions,
	setGlobalExtensionEnabled,
	type ManagedExtension,
} from "./core.ts";

interface ManagerResult {
	changed: boolean;
	managerDisabled: boolean;
}

class ExtensionManagerComponent implements Focusable {
	private readonly searchInput = new Input();
	private filtered: ManagedExtension[];
	private selectedIndex = 0;
	private pendingManagerDisable = false;
	private changed = false;
	private status?: { message: string; type: "info" | "warning" | "error" };
	private _focused = false;

	constructor(
		private readonly extensions: ManagedExtension[],
		private readonly theme: Theme,
		private readonly maxVisible: number,
		private readonly requestRender: () => void,
		private readonly toggle: (extension: ManagedExtension, enabled: boolean) => void,
		private readonly done: (result: ManagerResult) => void,
	) {
		this.filtered = [...extensions];
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	private current(): ManagedExtension | undefined {
		return this.filtered[this.selectedIndex];
	}

	private refilter(): void {
		const selectedPath = this.current()?.resource.path;
		const query = this.searchInput.getValue().trim().toLowerCase();
		this.filtered = query
			? this.extensions.filter((extension) =>
					[extension.name, extension.sourceLabel, extension.resource.path]
						.join("\n")
						.toLowerCase()
						.includes(query),
				)
			: [...this.extensions];
		const previousIndex = selectedPath
			? this.filtered.findIndex((extension) => extension.resource.path === selectedPath)
			: -1;
		this.selectedIndex = previousIndex >= 0 ? previousIndex : 0;
		this.pendingManagerDisable = false;
	}

	private move(delta: number): void {
		if (this.filtered.length === 0) return;
		this.selectedIndex = Math.max(
			0,
			Math.min(this.filtered.length - 1, this.selectedIndex + delta),
		);
		this.pendingManagerDisable = false;
		this.status = undefined;
	}

	private toggleCurrent(): void {
		const extension = this.current();
		if (!extension) return;

		if (extension.isManager && extension.enabled && !this.pendingManagerDisable) {
			this.pendingManagerDisable = true;
			this.status = {
				type: "warning",
				message: "Press Space/Enter again to disable the manager; re-enable it with `pi config`.",
			};
			return;
		}

		const enabled = !extension.enabled;
		try {
			this.toggle(extension, enabled);
			extension.enabled = enabled;
			this.changed = true;
			this.pendingManagerDisable = false;
			this.status = {
				type: "info",
				message: `${extension.name} will be ${enabled ? "enabled" : "disabled"} after reload.`,
			};
		} catch (error) {
			this.status = {
				type: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done({
				changed: this.changed,
				managerDisabled: this.extensions.some(
					(extension) => extension.isManager && !extension.enabled,
				),
			});
			return;
		}
		if (matchesKey(data, "up")) {
			this.move(-1);
		} else if (matchesKey(data, "down")) {
			this.move(1);
		} else if (matchesKey(data, "pageUp")) {
			this.move(-this.maxVisible);
		} else if (matchesKey(data, "pageDown")) {
			this.move(this.maxVisible);
		} else if (matchesKey(data, "space") || matchesKey(data, "return")) {
			this.toggleCurrent();
		} else {
			this.searchInput.handleInput(data);
			this.refilter();
			this.status = undefined;
		}
		this.requestRender();
	}

	private framed(content: string, innerWidth: number): string {
		return (
			this.theme.fg("border", "│") +
			truncateToWidth(content, innerWidth, "…", true) +
			this.theme.fg("border", "│")
		);
	}

	render(width: number): string[] {
		const innerWidth = Math.max(20, width - 2);
		const lines: string[] = [];
		const title = " Extension Manager ";
		const titleWidth = visibleWidth(title);
		const leftRule = Math.max(1, Math.floor((innerWidth - titleWidth) / 2));
		const rightRule = Math.max(0, innerWidth - titleWidth - leftRule);
		lines.push(
			this.theme.fg("border", `╭${"─".repeat(leftRule)}`) +
				this.theme.fg("accent", this.theme.bold(title)) +
				this.theme.fg("border", `${"─".repeat(rightRule)}╮`),
		);

		const inputWidth = Math.max(1, innerWidth - 11);
		const input = this.searchInput.render(inputWidth)[0] ?? "";
		lines.push(this.framed(` ${this.theme.fg("muted", "Filter:")} ${input}`, innerWidth));
		lines.push(this.framed("", innerWidth));

		if (this.filtered.length === 0) {
			lines.push(this.framed(`  ${this.theme.fg("muted", "No matching global extensions")}`, innerWidth));
		} else {
			const visibleCount = Math.min(this.maxVisible, this.filtered.length);
			const start = Math.max(
				0,
				Math.min(
					this.selectedIndex - Math.floor(visibleCount / 2),
					this.filtered.length - visibleCount,
				),
			);
			const end = Math.min(this.filtered.length, start + visibleCount);
			for (let index = start; index < end; index++) {
				const extension = this.filtered[index]!;
				const selected = index === this.selectedIndex;
				const cursor = selected ? this.theme.fg("accent", "›") : " ";
				const state = extension.enabled
					? this.theme.fg("success", "[on ]")
					: this.theme.fg("dim", "[off]");
				let name = extension.name + (extension.isManager ? "  (manager)" : "");
				if (selected) name = this.theme.bold(name);
				const source = this.theme.fg("dim", extension.sourceLabel);
				const left = ` ${cursor} ${state} ${name}`;
				const spacing = Math.max(2, innerWidth - visibleWidth(left) - visibleWidth(source) - 1);
				lines.push(this.framed(`${left}${" ".repeat(spacing)}${source} `, innerWidth));
			}
			if (this.filtered.length > visibleCount) {
				lines.push(
					this.framed(
						`  ${this.theme.fg("dim", `${this.selectedIndex + 1}/${this.filtered.length}`)}`,
						innerWidth,
					),
				);
			}
		}

		lines.push(this.framed("", innerWidth));
		const selectedPath = this.current()?.resource.path;
		if (this.status) {
			const color = this.status.type === "error" ? "error" : this.status.type === "warning" ? "warning" : "accent";
			lines.push(this.framed(` ${this.theme.fg(color, this.status.message)}`, innerWidth));
		} else if (selectedPath) {
			lines.push(this.framed(` ${this.theme.fg("dim", selectedPath.replace(/\\/g, "/"))}`, innerWidth));
		}
		lines.push(
			this.framed(
				` ${this.theme.fg("muted", "↑↓ navigate · Space/Enter toggle · type to filter · Esc save & reload")}`,
				innerWidth,
			),
		);
		lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {}
	dispose(): void {}
}

function formatSettingsErrors(errors: Array<{ error: Error }>): string {
	return errors.map(({ error }) => error.message).join("; ");
}

async function openExtensionManager(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify("/extension-manager requires Pi's interactive TUI", "error");
		return;
	}
	await ctx.waitForIdle();

	const agentDir = getAgentDir();
	const settingsManager = SettingsManager.create(ctx.cwd, agentDir, {
		projectTrusted: false,
	});
	const initialSettingsErrors = settingsManager.drainErrors();
	if (initialSettingsErrors.length > 0) {
		ctx.ui.notify(
			`Cannot open extension manager: ${formatSettingsErrors(initialSettingsErrors)}`,
			"error",
		);
		return;
	}

	let resolved;
	try {
		resolved = await new DefaultPackageManager({
			cwd: ctx.cwd,
			agentDir,
			settingsManager,
		}).resolve();
	} catch (error) {
		ctx.ui.notify(
			`Cannot discover global extensions: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return;
	}

	const managerPath = fileURLToPath(import.meta.url);
	const extensions = buildManagedExtensions(
		resolved.extensions,
		agentDir,
		managerPath,
	);

	const result = await ctx.ui.custom<ManagerResult>(
		(tui, theme, _keybindings, done) =>
			new ExtensionManagerComponent(
				extensions,
				theme,
				Math.max(5, Math.min(14, tui.terminal.rows - 12)),
				() => tui.requestRender(),
				(extension, enabled) =>
					setGlobalExtensionEnabled(
						settingsManager,
						extension.resource,
						enabled,
						agentDir,
					),
				done,
			),
		{
			overlay: true,
			overlayOptions: {
				width: "82%",
				minWidth: 50,
				maxHeight: "88%",
				anchor: "center",
				margin: 1,
			},
		},
	);

	await settingsManager.flush();
	const writeErrors = settingsManager.drainErrors();
	if (writeErrors.length > 0) {
		ctx.ui.notify(
			`Could not save extension settings: ${formatSettingsErrors(writeErrors)}`,
			"error",
		);
		return;
	}
	if (!result.changed) return;

	ctx.ui.notify(
		result.managerDisabled
			? "Extension settings saved. Reloading; use `pi config` to re-enable extension-manager."
			: "Extension settings saved. Reloading extensions…",
		"info",
	);
	await ctx.reload();
}

export default function extensionManager(pi: ExtensionAPI): void {
	pi.registerCommand("extension-manager", {
		description: "Globally enable or disable Pi extensions",
		handler: async (_args, ctx) => {
			await openExtensionManager(ctx);
		},
	});
}
