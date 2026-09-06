import {
	DefaultPackageManager,
	SettingsManager,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type PackageSource,
	type ResolvedResource,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";

const COMMAND_NAME = "skills";
const CONFIG_DIR_NAME = ".pi";
const CANCEL_LABEL = "Cancel";
const SHOW_CURRENT_LABEL = "Show current";
const DISABLE_ALL_LABEL = "Disable all skills";
const ENABLE_ALL_LABEL = "Enable all skills";
const TOGGLE_INDIVIDUAL_LABEL = "Toggle individual skill";
const RELOAD_LABEL = "Reload";
const RELOAD_NOW_LABEL = "Reload";
const RELOAD_LATER_LABEL = "Later";
const GLOBAL_ALL_SKILLS_EXCLUSION = "!*";

export const PACKAGE_SKILL_WARNING =
	"Package skills are managed in `pi config`; this list shows user/project skills only.";

export type SkillResource = ResolvedResource;

type SkillScope = "user" | "project";

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function toPosixPath(value: string): string {
	return value.replace(/\\/g, "/");
}

function normalizePatternForCompare(pattern: string): string {
	let normalized = toPosixPath(pattern.trim());
	while (normalized.startsWith("./")) {
		normalized = normalized.slice(2);
	}
	return normalized;
}

function normalizePatternForStorage(pattern: string): string {
	return toPosixPath(pattern.trim());
}

function getPatternPrefix(entry: string): string | undefined {
	const first = entry.trim()[0];
	return first === "!" || first === "+" || first === "-" ? first : undefined;
}

function getPatternBody(entry: string): string {
	const trimmed = entry.trim();
	return getPatternPrefix(trimmed) ? trimmed.slice(1) : trimmed;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function arePackageSourceArraysEqual(left: PackageSource[], right: PackageSource[]): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function getSkillName(skill: SkillResource): string {
	const fileName = path.basename(skill.path);
	return fileName === "SKILL.md" ? path.basename(path.dirname(skill.path)) : fileName;
}

function getSettingsPath(ctx: ExtensionCommandContext, scope: SkillScope): string {
	return scope === "project"
		? path.join(ctx.cwd, CONFIG_DIR_NAME, "settings.json")
		: path.join(getAgentDir(), "settings.json");
}

function getSkillEntries(settingsManager: SettingsManager, scope: SkillScope): string[] {
	const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
	return Array.isArray(settings.skills) ? settings.skills.filter((entry): entry is string => typeof entry === "string") : [];
}

function getPackageEntries(settingsManager: SettingsManager, scope: SkillScope): PackageSource[] {
	const settings = scope === "project" ? settingsManager.getProjectSettings() : settingsManager.getGlobalSettings();
	return Array.isArray(settings.packages) ? settings.packages : [];
}

function getSettingsManager(ctx: ExtensionCommandContext): SettingsManager {
	return SettingsManager.create(ctx.cwd, getAgentDir());
}

async function assertSettingsFlushed(settingsManager: SettingsManager): Promise<void> {
	await settingsManager.flush();
	const errors = settingsManager.drainErrors();
	if (errors.length === 0) return;
	throw new Error(errors.map(({ scope, error }) => `${scope}: ${getErrorMessage(error)}`).join("; "));
}

export async function setGlobalSkillPaths(settingsManager: SettingsManager, entries: string[]): Promise<void> {
	settingsManager.setSkillPaths(entries);
	await assertSettingsFlushed(settingsManager);
}

async function setSkillPathsForScope(settingsManager: SettingsManager, scope: SkillScope, entries: string[]): Promise<void> {
	if (scope === "project") {
		settingsManager.setProjectSkillPaths(entries);
	} else {
		settingsManager.setSkillPaths(entries);
	}
	await assertSettingsFlushed(settingsManager);
}

function setPackageSourcesForScope(settingsManager: SettingsManager, scope: SkillScope, packages: PackageSource[]): void {
	if (scope === "project") {
		settingsManager.setProjectPackages(packages);
	} else {
		settingsManager.setPackages(packages);
	}
}

async function resolveSkills(ctx: ExtensionCommandContext, settingsManager = getSettingsManager(ctx)): Promise<SkillResource[]> {
	const packageManager = new DefaultPackageManager({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		settingsManager,
	});
	const resolved = await packageManager.resolve();
	return resolved.skills;
}

function isTopLevelManageableSkill(skill: SkillResource): skill is SkillResource & { metadata: SkillResource["metadata"] & { scope: SkillScope } } {
	return skill.metadata.origin === "top-level" && (skill.metadata.scope === "user" || skill.metadata.scope === "project");
}

export function getTopLevelSkillPattern(
	skill: SkillResource,
	ctx: Pick<ExtensionCommandContext, "cwd">,
	agentDir = getAgentDir(),
): string | undefined {
	if (!isTopLevelManageableSkill(skill)) return undefined;
	// Auto-discovered .agents skills are matched relative to their own .agents
	// directory, not the .pi settings directory. The package manager exposes the
	// exact matching base so toggles must prefer it when available.
	const settingsBaseDir = skill.metadata.scope === "project" ? path.join(ctx.cwd, CONFIG_DIR_NAME) : agentDir;
	const baseDir = skill.metadata.baseDir ?? settingsBaseDir;
	return normalizePatternForStorage(path.relative(baseDir, skill.path));
}

export function formatSkillLabel(skill: SkillResource, pattern?: string): string {
	const state = skill.enabled ? "enabled" : "disabled";
	const marker = skill.enabled ? "[x]" : "[ ]";
	const location = pattern ?? toPosixPath(skill.path);
	return `${marker} ${getSkillName(skill)} (${state}, ${skill.metadata.scope}/${skill.metadata.origin}/${skill.metadata.source}) — ${location}`;
}

export function formatSkillToggleLabel(skill: SkillResource, disambiguator?: string): string {
	const marker = skill.enabled ? "✓" : "○";
	return `${marker} ${getSkillName(skill)} · ${skill.metadata.scope}${disambiguator ? ` · ${disambiguator}` : ""}`;
}

export function isAllSkillsExclusionEntry(entry: string): boolean {
	if (getPatternPrefix(entry) !== "!") return false;
	const body = normalizePatternForCompare(getPatternBody(entry));
	return body === "*" || body === "**" || body === "**/*";
}

function isGlobPatternEntry(entry: string): boolean {
	const trimmed = entry.trim();
	return trimmed.includes("*") || trimmed.includes("?");
}

function isSkillFilterEntry(entry: string): boolean {
	return getPatternPrefix(entry) !== undefined || isGlobPatternEntry(entry);
}

export function disableAllSkillEntries(entries: string[]): string[] {
	const plainEntries = entries.filter((entry) => !isSkillFilterEntry(entry));
	const allSkillsExclusion = entries.find(isAllSkillsExclusionEntry) ?? GLOBAL_ALL_SKILLS_EXCLUSION;
	return [...plainEntries, allSkillsExclusion];
}

export function enableAllSkillEntries(entries: string[]): string[] {
	return entries.filter((entry) => !isSkillFilterEntry(entry));
}

function removePackageSkillFilter(packageSource: Exclude<PackageSource, string>): PackageSource {
	const withoutSkills = { ...packageSource };
	delete withoutSkills.skills;
	return Object.keys(withoutSkills).length === 1 ? withoutSkills.source : withoutSkills;
}

export function disableAllPackageSkillEntries(packageSources: PackageSource[]): PackageSource[] {
	return packageSources.map((packageSource) => {
		if (typeof packageSource === "string") {
			return { source: packageSource, skills: [GLOBAL_ALL_SKILLS_EXCLUSION] };
		}

		if (Array.isArray(packageSource.skills) && packageSource.skills.length === 0) return packageSource;
		const currentSkills = Array.isArray(packageSource.skills)
			? packageSource.skills.filter((entry): entry is string => typeof entry === "string")
			: [];
		const updatedSkills = disableAllSkillEntries(currentSkills);
		if (Array.isArray(packageSource.skills) && areStringArraysEqual(currentSkills, updatedSkills)) return packageSource;
		return { ...packageSource, skills: updatedSkills };
	});
}

export function enableAllPackageSkillEntries(packageSources: PackageSource[]): PackageSource[] {
	return packageSources.map((packageSource) => {
		if (typeof packageSource === "string") return packageSource;
		if (!Object.prototype.hasOwnProperty.call(packageSource, "skills")) return packageSource;
		return removePackageSkillFilter(packageSource);
	});
}

export function removeSkillPatterns(entries: string[], pattern: string): string[] {
	const target = normalizePatternForCompare(pattern);
	return entries.filter((entry) => {
		const prefix = getPatternPrefix(entry);
		if (prefix !== "+" && prefix !== "-") return true;
		return normalizePatternForCompare(getPatternBody(entry)) !== target;
	});
}

export function setIndividualSkillEntry(entries: string[], pattern: string, currentlyEnabled: boolean): string[] {
	const updated = removeSkillPatterns(entries, pattern);
	updated.push(`${currentlyEnabled ? "-" : "+"}${normalizePatternForStorage(pattern)}`);
	return updated;
}

function formatSkillsSummary(skills: SkillResource[], ctx: ExtensionCommandContext): string {
	if (skills.length === 0) return "No skills are currently discovered.";
	const agentDir = getAgentDir();
	const lines = skills.map((skill) => {
		const pattern = getTopLevelSkillPattern(skill, ctx, agentDir);
		return `- ${formatSkillLabel(skill, pattern)}`;
	});
	const enabledCount = skills.filter((skill) => skill.enabled).length;
	return [`Skills (${enabledCount}/${skills.length} enabled):`, ...lines].join("\n");
}

async function showCurrentSkills(ctx: ExtensionCommandContext): Promise<void> {
	try {
		const skills = await resolveSkills(ctx);
		ctx.ui.notify(formatSkillsSummary(skills, ctx), "info");
		if (skills.some((skill) => skill.metadata.origin === "package")) {
			ctx.ui.notify(PACKAGE_SKILL_WARNING, "warning");
		}
	} catch (error) {
		ctx.ui.notify(`Could not resolve skills: ${getErrorMessage(error)}`, "error");
	}
}

async function maybeReload(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Settings updated. Changes apply after restart or /reload.", "info");
		return;
	}

	const selected = await ctx.ui.select("Settings updated. Reload resources now?", [RELOAD_NOW_LABEL, RELOAD_LATER_LABEL]);
	if (selected !== RELOAD_NOW_LABEL) {
		ctx.ui.notify("Settings updated. Changes apply after restart or /reload.", "info");
		return;
	}

	try {
		ctx.ui.notify("Reloading resources...", "info");
		await ctx.reload();
	} catch (error) {
		ctx.ui.notify(`Settings updated, but reload failed: ${getErrorMessage(error)}. Changes apply after restart or /reload.`, "warning");
	}
}

async function reloadResources(ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Reload requires the TUI. Changes apply after restart or /reload.", "warning");
		return;
	}
	try {
		ctx.ui.notify("Reloading resources...", "info");
		await ctx.reload();
	} catch (error) {
		ctx.ui.notify(`Reload failed: ${getErrorMessage(error)}`, "error");
	}
}

function addChangedScope(scopes: SkillScope[], scope: SkillScope): void {
	if (!scopes.includes(scope)) scopes.push(scope);
}

function formatChangedSettingsPaths(ctx: ExtensionCommandContext, scopes: SkillScope[]): string {
	const paths = scopes.map((scope) => getSettingsPath(ctx, scope));
	if (paths.length === 1) return paths[0];
	return `${paths.slice(0, -1).join(", ")} and ${paths[paths.length - 1]}`;
}

async function disableAllSkills(ctx: ExtensionCommandContext): Promise<void> {
	const settingsManager = getSettingsManager(ctx);
	const currentUserSkills = getSkillEntries(settingsManager, "user");
	const currentProjectSkills = getSkillEntries(settingsManager, "project");
	const currentUserPackages = getPackageEntries(settingsManager, "user");
	const currentProjectPackages = getPackageEntries(settingsManager, "project");

	const updatedUserSkills = disableAllSkillEntries(currentUserSkills);
	const updatedProjectSkills = disableAllSkillEntries(currentProjectSkills);
	const updatedUserPackages = disableAllPackageSkillEntries(currentUserPackages);
	const updatedProjectPackages = disableAllPackageSkillEntries(currentProjectPackages);

	const changedScopes: SkillScope[] = [];
	const userSkillsChanged = !areStringArraysEqual(currentUserSkills, updatedUserSkills);
	const projectSkillsChanged = !areStringArraysEqual(currentProjectSkills, updatedProjectSkills);
	const userPackagesChanged = !arePackageSourceArraysEqual(currentUserPackages, updatedUserPackages);
	const projectPackagesChanged = !arePackageSourceArraysEqual(currentProjectPackages, updatedProjectPackages);
	if (userSkillsChanged || userPackagesChanged) addChangedScope(changedScopes, "user");
	if (projectSkillsChanged || projectPackagesChanged) addChangedScope(changedScopes, "project");

	if (changedScopes.length === 0) {
		ctx.ui.notify("All skills are already disabled.", "info");
		return;
	}

	try {
		if (userSkillsChanged) settingsManager.setSkillPaths(updatedUserSkills);
		if (projectSkillsChanged) settingsManager.setProjectSkillPaths(updatedProjectSkills);
		if (userPackagesChanged) setPackageSourcesForScope(settingsManager, "user", updatedUserPackages);
		if (projectPackagesChanged) setPackageSourcesForScope(settingsManager, "project", updatedProjectPackages);
		await assertSettingsFlushed(settingsManager);
		ctx.ui.notify(
			`Disabled all skills in ${formatChangedSettingsPaths(ctx, changedScopes)}. Configured skill directories and packages were preserved.`,
			"info",
		);
		await maybeReload(ctx);
	} catch (error) {
		ctx.ui.notify(`Could not update skills settings: ${getErrorMessage(error)}`, "error");
	}
}

async function enableAllSkills(ctx: ExtensionCommandContext): Promise<void> {
	const settingsManager = getSettingsManager(ctx);
	const currentUserSkills = getSkillEntries(settingsManager, "user");
	const currentProjectSkills = getSkillEntries(settingsManager, "project");
	const currentUserPackages = getPackageEntries(settingsManager, "user");
	const currentProjectPackages = getPackageEntries(settingsManager, "project");

	const updatedUserSkills = enableAllSkillEntries(currentUserSkills);
	const updatedProjectSkills = enableAllSkillEntries(currentProjectSkills);
	const updatedUserPackages = enableAllPackageSkillEntries(currentUserPackages);
	const updatedProjectPackages = enableAllPackageSkillEntries(currentProjectPackages);

	const changedScopes: SkillScope[] = [];
	const userSkillsChanged = !areStringArraysEqual(currentUserSkills, updatedUserSkills);
	const projectSkillsChanged = !areStringArraysEqual(currentProjectSkills, updatedProjectSkills);
	const userPackagesChanged = !arePackageSourceArraysEqual(currentUserPackages, updatedUserPackages);
	const projectPackagesChanged = !arePackageSourceArraysEqual(currentProjectPackages, updatedProjectPackages);
	if (userSkillsChanged || userPackagesChanged) addChangedScope(changedScopes, "user");
	if (projectSkillsChanged || projectPackagesChanged) addChangedScope(changedScopes, "project");

	if (changedScopes.length === 0) {
		ctx.ui.notify("All skills are already enabled.", "info");
		return;
	}

	try {
		if (userSkillsChanged) settingsManager.setSkillPaths(updatedUserSkills);
		if (projectSkillsChanged) settingsManager.setProjectSkillPaths(updatedProjectSkills);
		if (userPackagesChanged) setPackageSourcesForScope(settingsManager, "user", updatedUserPackages);
		if (projectPackagesChanged) setPackageSourcesForScope(settingsManager, "project", updatedProjectPackages);
		await assertSettingsFlushed(settingsManager);
		ctx.ui.notify(
			`Enabled all skills in ${formatChangedSettingsPaths(ctx, changedScopes)}. Configured skill directories and packages were preserved.`,
			"info",
		);
		await maybeReload(ctx);
	} catch (error) {
		ctx.ui.notify(`Could not update skills settings: ${getErrorMessage(error)}`, "error");
	}
}

async function toggleIndividualSkill(ctx: ExtensionCommandContext): Promise<void> {
	const settingsManager = getSettingsManager(ctx);
	let warnedAboutPackageSkills = false;

	while (true) {
		let skills: SkillResource[];
		try {
			skills = await resolveSkills(ctx, settingsManager);
		} catch (error) {
			ctx.ui.notify(`Could not resolve skills: ${getErrorMessage(error)}`, "error");
			return;
		}

		if (!warnedAboutPackageSkills && skills.some((skill) => skill.metadata.origin === "package")) {
			warnedAboutPackageSkills = true;
			ctx.ui.notify(PACKAGE_SKILL_WARNING, "warning");
		}

		const agentDir = getAgentDir();
		const manageable = skills
			.filter(isTopLevelManageableSkill)
			.map((skill) => ({ skill, pattern: getTopLevelSkillPattern(skill, ctx, agentDir) }))
			.filter((entry): entry is { skill: SkillResource & { metadata: SkillResource["metadata"] & { scope: SkillScope } }; pattern: string } => Boolean(entry.pattern));

		if (manageable.length === 0) {
			ctx.ui.notify("No top-level user or project skills are available to toggle.", "info");
			return;
		}

		const baseLabels = manageable.map((entry) => formatSkillToggleLabel(entry.skill));
		const baseLabelCounts = new Map<string, number>();
		for (const label of baseLabels) {
			baseLabelCounts.set(label, (baseLabelCounts.get(label) ?? 0) + 1);
		}

		const labels = new Map<string, { skill: SkillResource & { metadata: SkillResource["metadata"] & { scope: SkillScope } }; pattern: string }>();
		for (const [index, entry] of manageable.entries()) {
			const baseLabel = baseLabels[index]!;
			const label = (baseLabelCounts.get(baseLabel) ?? 0) > 1 ? formatSkillToggleLabel(entry.skill, entry.pattern) : baseLabel;
			labels.set(label, entry);
		}

		const selected = await ctx.ui.select("Toggle a skill (✓ on, ○ off)", [...labels.keys(), RELOAD_LABEL, CANCEL_LABEL]);
		if (!selected || selected === CANCEL_LABEL) return;
		if (selected === RELOAD_LABEL) {
			await reloadResources(ctx);
			return;
		}

		const entry = labels.get(selected);
		if (!entry) continue;

		const scope = entry.skill.metadata.scope;
		const current = getSkillEntries(settingsManager, scope);
		const updated = setIndividualSkillEntry(current, entry.pattern, entry.skill.enabled);
		if (areStringArraysEqual(current, updated)) {
			ctx.ui.notify("No settings change was needed.", "info");
			continue;
		}

		try {
			await setSkillPathsForScope(settingsManager, scope, updated);
			const action = entry.skill.enabled ? "disabled" : "enabled";
			ctx.ui.notify(`${getSkillName(entry.skill)} ${action}. Select Reload to apply changes.`, "info");
		} catch (error) {
			ctx.ui.notify(`Could not update skills settings: ${getErrorMessage(error)}`, "error");
		}
	}
}

export async function runSkillsMenu(ctx: ExtensionCommandContext): Promise<void> {
	const selected = await ctx.ui.select("Skill settings", [
		SHOW_CURRENT_LABEL,
		DISABLE_ALL_LABEL,
		ENABLE_ALL_LABEL,
		TOGGLE_INDIVIDUAL_LABEL,
		RELOAD_LABEL,
		CANCEL_LABEL,
	]);

	if (!selected || selected === CANCEL_LABEL) return;
	if (selected === SHOW_CURRENT_LABEL) return showCurrentSkills(ctx);
	if (selected === DISABLE_ALL_LABEL) return disableAllSkills(ctx);
	if (selected === ENABLE_ALL_LABEL) return enableAllSkills(ctx);
	if (selected === TOGGLE_INDIVIDUAL_LABEL) return toggleIndividualSkill(ctx);
	if (selected === RELOAD_LABEL) return reloadResources(ctx);
}

async function runSkillsCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	if (args.trim()) {
		ctx.ui.notify(`/${COMMAND_NAME} uses an interactive menu; ignoring direct arguments.`, "warning");
	}
	if (!ctx.hasUI) {
		await showCurrentSkills(ctx);
		ctx.ui.notify(`/${COMMAND_NAME} requires the TUI for settings changes.`, "warning");
		return;
	}
	await runSkillsMenu(ctx);
}

export default function enableSkillsConfig(pi: ExtensionAPI) {
	pi.registerCommand(COMMAND_NAME, {
		description: "Open the skills loading configuration menu",
		handler: runSkillsCommand,
	});
}
