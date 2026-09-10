// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { UnifiedExecManager, nativeShell, type Launch } from "../unified-exec.ts";
import { verifiedExecutable } from "../runtime/native/artifact.mjs";
import { removeOwnedFixture, withFixtureCleanup } from "./fixture-cleanup.ts";
const root = fileURLToPath(new URL("../", import.meta.url));
const node = (code: string): Launch => ({ executable: process.execPath, args: ["-e", code] });

test("Windows supervisor runs with invocation-time compilation disabled and the original readiness budget", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
	const directory = await mkdtemp(join(tmpdir(), "prebuilt shell no compiler "));
	const wrapper = join(directory, "no compiler.ps1"), supervisor = join(root, "native/windows-job.ps1");
	await writeFile(wrapper, `param([string]$CommandBase64,[uint32]$ParentProcessId,[string]$VerifiedHelperPath)\nfunction global:Add-Type { throw 'Invocation-time compilation forbidden in this fixture' }\n& '${supervisor.replaceAll("'", "''")}' -CommandBase64 $CommandBase64 -ParentProcessId $ParentProcessId -VerifiedHelperPath $VerifiedHelperPath\n`);
	const manager = new UnifiedExecManager(async command => {
		const launch = await nativeShell(command);
		assert.equal(launch.args[launch.args.indexOf("-VerifiedHelperPath") + 1], await verifiedExecutable());
		const args = launch.args.slice(); args[args.indexOf("-File") + 1] = wrapper;
		return { ...launch, args };
	});
	try {
		assert.doesNotMatch(await readFile(supervisor, "utf8"), /Add-Type|csc\.exe|Invoke-WebRequest/);
		let result = await manager.start("fixture", "Write-Output READY", directory, 1, 1024), output = result.output;
		for (let i = 0; i < 30 && !output.includes("READY") && result.session_id; i++) {
			result = await manager.write("fixture", result.session_id, "", 300, 1024); output += result.output;
		}
		assert.match(output, /READY/); assert.equal(result.supervisor_ready, true);
		assert.doesNotMatch(output, /PI_UNIFIED_READY|compilation forbidden/);
	} finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Windows launch rejects missing and corrupted prebuilt helpers without creating a process", { skip: process.platform !== "win32" }, async () => {
	// A new ignored source-module fixture resolves only the repository's locked
	// development dependencies. Never modify a real artifact or installed bundle.
	const parent = join(root, ".pi"); await mkdir(parent, { recursive: true });
	const fixture = await mkdtemp(join(parent, "missing-shell-helper-"));
	const files = ["unified-exec.ts", "unified-exec-output.ts", "unified-completion.ts", "utf8-output.ts", "runtime/rpc-protocol.mjs", "runtime/protocol.mjs", "runtime/cell-helper-errors.mjs", ...["artifact.mjs", "WindowsRuntime.cs", "build.mjs", "toolchain.mjs", "toolchain.json"].map(name => "runtime/native/" + name)];
	await withFixtureCleanup(async () => {
		for (const name of files) { const target = join(fixture, name); await mkdir(dirname(target), { recursive: true }); await copyFile(join(root, name), target); }
		const api = await import(pathToFileURL(join(fixture, "unified-exec.ts")).href);
		const artifact = await import(pathToFileURL(join(fixture, "runtime/native/artifact.mjs")).href);
		const paths = await artifact.artifactPaths(), jobs = new api.UnifiedExecManager();
		await withFixtureCleanup(async () => {
			assert.equal((await api.nativeShellStatus()).available, false);
			await assert.rejects(jobs.start("fixture", "Write-Output 'must not run'", fixture, 1, 1024), /verified prebuilt helper/);
			assert.deepEqual(jobs.inspect("fixture"), []);
			await mkdir(paths.directory, { recursive: true });
			await writeFile(paths.executable, "tampered");
			await writeFile(paths.manifest, JSON.stringify({ version: 1, sourceSha256: paths.sourceSha256, recipeSha256: paths.recipeSha256, binarySha256: artifact.sha256(Buffer.from("expected")) }));
			assert.equal((await api.nativeShellStatus()).available, false);
			await assert.rejects(api.nativeShell("Write-Output 'must not run'"), /verified prebuilt helper/);
			assert.deepEqual(jobs.inspect("fixture"), []);
		}, async () => { await jobs.close(); });
	}, async bodyPassed => { if (bodyPassed) await removeOwnedFixture(fixture); });
});

for (const boundary of ["reset", "abort", "native scope"] as const) test(`asynchronous launch verification cannot cross ${boundary}`, async () => {
	let arrived!: () => void, release!: (launch: Launch) => void;
	const entered = new Promise<void>(resolve => { arrived = resolve; });
	const manager = new UnifiedExecManager(async () => { arrived(); return new Promise<Launch>(resolve => { release = resolve; }); });
	const abort = new AbortController(), scope = new AbortController(); let registrations = 0;
	const resource = { id: "fixture", signal: scope.signal, ownResource() { registrations++; return () => {}; } };
	try {
		const pending = manager.start("fixture", "setInterval(()=>{},1000)", tmpdir(), 1, 64, abort.signal, { resource });
		await entered;
		if (boundary === "reset") await manager.reset(); else if (boundary === "abort") abort.abort(); else scope.abort();
		release(node("setInterval(()=>{},1000)"));
		await assert.rejects(pending, /changed|aborted/); assert.equal(registrations, 0); assert.deepEqual(manager.inspect("fixture"), []);
	} finally { await manager.close(); }
});

test("parallel asynchronous verification still admits no more than four shell processes", async () => {
	let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
	let arrivals = 0, ready!: () => void; const entered = new Promise<void>(resolve => { ready = resolve; });
	const manager = new UnifiedExecManager(async command => { if (++arrivals === 5) ready(); await gate; return node(command); });
	try {
		const attempts = Array.from({ length: 5 }, () => manager.start("fixture", "setInterval(()=>{},1000);setTimeout(()=>process.exit(),30000)", tmpdir(), 0, 64));
		await entered; release(); const outcomes = await Promise.allSettled(attempts);
		assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 4);
		const failed = outcomes.filter(r => r.status === "rejected"); assert.equal(failed.length, 1); assert.match((failed[0] as PromiseRejectedResult).reason.message, /concurrent process limit/);
		assert.equal(manager.inspect("fixture").length, 4);
	} finally { release(); await manager.close(); }
});
