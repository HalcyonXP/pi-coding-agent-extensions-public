import assert from "node:assert/strict";
import test from "node:test";

import {
	buildManagedExtensions,
	getExtensionPattern,
	getPackageExtensionPattern,
	setGlobalExtensionEnabled,
} from "./core.ts";

class FakeSettingsManager {
	constructor(globalSettings = {}) {
		this.globalSettings = structuredClone(globalSettings);
	}
	getGlobalSettings() {
		return structuredClone(this.globalSettings);
	}
	setExtensionPaths(paths) {
		this.globalSettings.extensions = [...paths];
	}
	setPackages(packages) {
		this.globalSettings.packages = structuredClone(packages);
	}
}

const agentDir = "C:/Example/Pi/agent";

function topLevel(path, enabled = true, overrides = {}) {
	return {
		path,
		enabled,
		metadata: {
			source: "auto",
			scope: "user",
			origin: "top-level",
			baseDir: agentDir,
			...overrides,
		},
	};
}

function packaged(path, source, baseDir, enabled = true) {
	return {
		path,
		enabled,
		metadata: {
			source,
			scope: "user",
			origin: "package",
			baseDir,
		},
	};
}

test("builds a sorted global extension list with useful names", () => {
	const managerPath = `${agentDir}/extensions/extension-manager/index.ts`;
	const resources = [
		topLevel(`${agentDir}/extensions/llama-live-ctx.ts`),
		packaged(
			`${agentDir}/npm/pkg/extensions/second/index.ts`,
			"npm:pkg",
			`${agentDir}/npm/pkg`,
		),
		topLevel(managerPath),
		{
			...topLevel("C:/project/.pi/extensions/local.ts"),
			metadata: {
				source: "auto",
				scope: "project",
				origin: "top-level",
				baseDir: "C:/project/.pi",
			},
		},
	];

	const managed = buildManagedExtensions(resources, agentDir, managerPath);
	assert.equal(managed.length, 3);
	assert.equal(managed[0].name, "extension-manager");
	assert.equal(managed[0].isManager, true);
	assert.deepEqual(
		new Set(managed.map((item) => item.name)),
		new Set(["extension-manager", "llama-live-ctx", "second"]),
	);
});

test("stores exact top-level overrides without destroying broad filters", () => {
	const resource = topLevel(`${agentDir}/extensions/example/index.ts`);
	const settings = new FakeSettingsManager({
		extensions: ["!*", "+extensions/keep/index.ts", "C:/outside/custom.ts"],
	});

	assert.equal(getExtensionPattern(resource, agentDir), "extensions/example/index.ts");
	setGlobalExtensionEnabled(settings, resource, false, agentDir);
	assert.deepEqual(settings.globalSettings.extensions, [
		"!*",
		"+extensions/keep/index.ts",
		"C:/outside/custom.ts",
		"-extensions/example/index.ts",
	]);

	setGlobalExtensionEnabled(settings, resource, true, agentDir);
	assert.deepEqual(settings.globalSettings.extensions, [
		"!*",
		"+extensions/keep/index.ts",
		"C:/outside/custom.ts",
		"+extensions/example/index.ts",
	]);
});

test("converts a package source to filtered form when disabling one extension", () => {
	const baseDir = `${agentDir}/npm/example`;
	const resource = packaged(
		`${baseDir}/extensions/logger.ts`,
		"npm:example",
		baseDir,
	);
	const settings = new FakeSettingsManager({ packages: ["npm:example"] });

	assert.equal(getPackageExtensionPattern(resource), "extensions/logger.ts");
	setGlobalExtensionEnabled(settings, resource, false, agentDir);
	assert.deepEqual(settings.globalSettings.packages, [
		{
			source: "npm:example",
			extensions: ["-extensions/logger.ts"],
		},
	]);
});

test("enabling one extension from an empty package filter keeps siblings off", () => {
	const baseDir = `${agentDir}/npm/example`;
	const resource = packaged(
		`${baseDir}/extensions/logger.ts`,
		"npm:example",
		baseDir,
		false,
	);
	const settings = new FakeSettingsManager({
		packages: [{ source: "npm:example", extensions: [] }],
	});

	setGlobalExtensionEnabled(settings, resource, true, agentDir);
	assert.deepEqual(settings.globalSettings.packages[0].extensions, [
		"!*",
		"+extensions/logger.ts",
	]);
});

test("refuses to mutate project extension state", () => {
	const resource = topLevel("C:/project/.pi/extensions/project.ts", true, {
		scope: "project",
	});
	const settings = new FakeSettingsManager();
	assert.throws(
		() => setGlobalExtensionEnabled(settings, resource, false, agentDir),
		/cannot edit a project extension/,
	);
});
