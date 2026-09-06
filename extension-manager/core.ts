import { basename, dirname, extname, relative, resolve } from "node:path";
import type {
	PackageSource,
	ResolvedResource,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";

export interface ManagedExtension {
	resource: ResolvedResource;
	name: string;
	sourceLabel: string;
	enabled: boolean;
	isManager: boolean;
}

function toPosix(path: string): string {
	return path.replace(/\\/g, "/");
}

function pathKey(path: string): string {
	const normalized = toPosix(resolve(path));
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function samePath(left: string, right: string): boolean {
	return pathKey(left) === pathKey(right);
}

function stripEntryPrefix(entry: string): string {
	return entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-")
		? entry.slice(1)
		: entry;
}

function hasGlobSyntax(pattern: string): boolean {
	return /[*?\[\]{}]/.test(pattern);
}

function isExactEntryForResource(
	entry: string,
	pattern: string,
	resourcePath: string,
	baseDir: string,
): boolean {
	if (!(entry.startsWith("!") || entry.startsWith("+") || entry.startsWith("-"))) {
		return false;
	}

	const target = stripEntryPrefix(entry);
	if (hasGlobSyntax(target)) return false;

	const normalizedTarget = toPosix(target).replace(/^\.\//, "");
	const normalizedPattern = toPosix(pattern).replace(/^\.\//, "");
	if (normalizedTarget === normalizedPattern) return true;

	try {
		return samePath(resolve(baseDir, target), resourcePath);
	} catch {
		return false;
	}
}

export function getExtensionPattern(resource: ResolvedResource, agentDir: string): string {
	const baseDir = resource.metadata.baseDir ?? agentDir;
	return toPosix(relative(baseDir, resource.path));
}

export function getPackageExtensionPattern(resource: ResolvedResource): string {
	const baseDir = resource.metadata.baseDir ?? dirname(resource.path);
	return toPosix(relative(baseDir, resource.path));
}

function getPackageSource(pkg: PackageSource): string {
	return typeof pkg === "string" ? pkg : pkg.source;
}

/**
 * Persist one global extension state using Pi's native resource-filter syntax.
 * Existing broad filters and unrelated explicit paths are preserved.
 */
export function setGlobalExtensionEnabled(
	settingsManager: SettingsManager,
	resource: ResolvedResource,
	enabled: boolean,
	agentDir: string,
): void {
	if (resource.metadata.scope === "project") {
		throw new Error("The global extension manager cannot edit a project extension");
	}

	if (resource.metadata.origin === "package") {
		setGlobalPackageExtensionEnabled(settingsManager, resource, enabled);
		return;
	}

	const current = settingsManager.getGlobalSettings().extensions ?? [];
	const pattern = getExtensionPattern(resource, agentDir);
	const baseDir = resource.metadata.baseDir ?? agentDir;
	const updated = current.filter(
		(entry) => !isExactEntryForResource(entry, pattern, resource.path, baseDir),
	);
	updated.push(`${enabled ? "+" : "-"}${pattern}`);
	settingsManager.setExtensionPaths(updated);
}

function setGlobalPackageExtensionEnabled(
	settingsManager: SettingsManager,
	resource: ResolvedResource,
	enabled: boolean,
): void {
	const packages = [...(settingsManager.getGlobalSettings().packages ?? [])];
	const packageIndex = packages.findIndex(
		(pkg) => getPackageSource(pkg) === resource.metadata.source,
	);
	if (packageIndex < 0) {
		throw new Error(`Could not find global package ${resource.metadata.source}`);
	}

	const original = packages[packageIndex]!;
	const pkg =
		typeof original === "string"
			? { source: original }
			: { ...original };
	const pattern = getPackageExtensionPattern(resource);
	const baseDir = resource.metadata.baseDir ?? dirname(resource.path);
	const current = pkg.extensions;
	let updated = (current ?? []).filter(
		(entry) => !isExactEntryForResource(entry, pattern, resource.path, baseDir),
	);

	// In Pi, [] means "load none", while [+path] means "load everything, then
	// force this path on". Keep the empty-filter baseline when enabling one item.
	if (enabled && current?.length === 0) {
		updated = ["!*"];
	}
	updated.push(`${enabled ? "+" : "-"}${pattern}`);
	pkg.extensions = updated;
	packages[packageIndex] = pkg;
	settingsManager.setPackages(packages);
}

function formatExtensionName(resource: ResolvedResource, agentDir: string): string {
	const baseDir =
		resource.metadata.origin === "package"
			? resource.metadata.baseDir
			: resolve(agentDir, "extensions");
	let display = baseDir ? toPosix(relative(baseDir, resource.path)) : basename(resource.path);

	if (!display || display.startsWith("../")) display = basename(resource.path);
	if (display.startsWith("extensions/")) display = display.slice("extensions/".length);
	if (display.endsWith("/index.ts") || display.endsWith("/index.js")) {
		display = display.slice(0, display.lastIndexOf("/"));
	} else {
		display = display.slice(0, -extname(display).length);
	}
	return display || basename(dirname(resource.path));
}

function formatSourceLabel(resource: ResolvedResource): string {
	if (resource.metadata.origin === "package") return resource.metadata.source;
	return resource.metadata.source === "auto" ? "global" : "global settings";
}

export function buildManagedExtensions(
	resources: readonly ResolvedResource[],
	agentDir: string,
	managerPath: string,
): ManagedExtension[] {
	return resources
		.filter((resource) => resource.metadata.scope !== "project")
		.map((resource) => ({
			resource,
			name: formatExtensionName(resource, agentDir),
			sourceLabel: formatSourceLabel(resource),
			enabled: resource.enabled,
			isManager: samePath(resource.path, managerPath),
		}))
		.sort((left, right) => {
			if (left.isManager !== right.isManager) return left.isManager ? -1 : 1;
			const source = left.sourceLabel.localeCompare(right.sourceLabel);
			return source || left.name.localeCompare(right.name);
		});
}
