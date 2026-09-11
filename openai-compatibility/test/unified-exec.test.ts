import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { UnifiedExecManager, nativeShell } from "../unified-exec.ts";

const node = (cmd: string) => ({ executable: process.execPath, args: ["-e", cmd] });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("persistent process supports polling, stdin, bounded output and exit code", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		let result = await manager.start("one", "process.stdout.write('ready\\n');process.stdin.once('data',b=>{process.stdout.write(b);process.exitCode=7;process.stdin.destroy()})", tmpdir(), 0, 100);
		assert.ok(result.session_id); const id = result.session_id;
		assert.equal(result.running, true);
		await assert.rejects(manager.write("foreign", id, "", 0, 100), /foreign/);
		result = await manager.write("one", id, "hello\n", 3000, 100);
		assert.match(result.output, /ready\nhello\n/);
		assert.equal(result.exit_code, 7);
		assert.equal(result.running, false);
		await assert.rejects(manager.write("one", id, "", 0, 100), /expired/);
	} finally { await manager.close(); }
});

test("bounded ring buffer reports truncation and drains remaining completed output", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		const result = await manager.start("one", "process.stdout.write('x'.repeat(2*1024*1024))", tmpdir(), 3000, 64 * 1024);
		assert.equal(result.running, false);
		assert.equal(result.output.length, 64 * 1024);
		assert.equal(result.truncated_bytes, 1024 * 1024);
		assert.ok(result.session_id);
		const next = await manager.write("one", result.session_id, "", 0, 10);
		assert.equal(next.output.length, 10);
		assert.equal(next.truncated_bytes, 0);
	} finally { await manager.close(); }
});

test("capacity, input limits, cancellation and stale IDs", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		const ids: number[] = [];
		for (let i = 0; i < 4; i++) ids.push((await manager.start("one", "setInterval(()=>{},1000)", tmpdir(), 0, 100)).session_id!);
		await assert.rejects(manager.start("one", "process.exit()", tmpdir(), 0, 100), /limit/);
		await assert.rejects(manager.write("one", ids[0], "x".repeat(65 * 1024), 0, 100), /64 KiB/);
		const stopped = await manager.write("one", ids[0], "\u0003", 1000, 100);
		assert.equal(stopped.running, false);
		assert.match(stopped.termination!, /Ctrl-C/);
		await manager.reset();
		await assert.rejects(manager.write("one", ids[1], "", 0, 100), /expired/);
	} finally { await manager.close(); }
});

test("abort while collecting and lifetime expiry terminate the child", async () => {
	const manager = new UnifiedExecManager(node, 300, 10_000);
	try {
		const controller = new AbortController();
		const pending = manager.start("one", "setInterval(()=>{},1000)", tmpdir(), 3000, 100, controller.signal);
		setTimeout(() => controller.abort(new Error("test cancellation")), 50);
		await assert.rejects(pending, /cancellation/);
		const result = await manager.start("one", "setInterval(()=>{},1000)", tmpdir(), 2000, 100);
		assert.equal(result.running, false);
		assert.match(result.termination!, /lifetime/);
	} finally { await manager.close(); }
});

test("EOF closes input, nonexistent workdir fails before launch, launch failure is visible", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		await assert.rejects(manager.start("one", "x", path.join(tmpdir(), "pi-nonexistent-workdir-87623"), 0, 100), /ENOENT/);
		const process = await manager.start("one", "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('eof'))", tmpdir(), 0, 100);
		const result = await manager.write("one", process.session_id!, "\u0004", 3000, 100);
		assert.equal(result.output, "eof");
		assert.equal(result.exit_code, 0);
	} finally { await manager.close(); }
	const missing = new UnifiedExecManager(() => ({ executable: path.join(tmpdir(), "pi-no-such-executable"), args: [] }));
	try { assert.match((await missing.start("one", "x", tmpdir(), 1000, 100)).termination!, /could not start/); }
	finally { await missing.close(); }
});

// Native PowerShell startup can exceed one tool yield on hosted Windows.
// Job support is now prebuilt; this completion fixture does not compile it.
// Poll the same owned job to completion; never relaunch/retry the command or hide exit errors.
async function nativeCompletion(manager: UnifiedExecManager, command: string, cwd: string, maxBytes: number) {
	const deadline = Date.now() + 90_000;
	let result = await manager.start("one", command, cwd, 1000, maxBytes);
	let output = result.output;
	while (result.session_id) {
		assert.ok(Date.now() < deadline, "Native fixture did not finish within 90 seconds");
		result = await manager.write("one", result.session_id, "", 1000, maxBytes);
		output += result.output;
	}
	return { ...result, output };
}

test("native shell handles Unicode, spaces and a real working directory", { timeout: 120_000 }, async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi unified exec unicode "));
	const manager = new UnifiedExecManager();
	try {
		const script = process.platform === "win32" ? "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output 'hello λ'; (Get-Location).Path" : "printf 'hello λ\\n'; pwd";
		const result = await nativeCompletion(manager, script, cwd, 10_000);
		assert.equal(result.exit_code, 0, result.output);
		assert.match(result.output, /hello λ/);
        assert.ok(!result.output.includes("PI_UNIFIED_READY"), "native startup frames are not user output");
		assert.ok(result.output.includes(await realpath(cwd)), result.output);
		assert.equal(result.running, false);
	} finally { await manager.close(); await rm(cwd, { recursive: true, force: true }); }
});

test("native supervisor kills background descendants when the shell exits", { timeout: 120_000 }, async () => {
	const cwd = await mkdtemp(path.join(tmpdir(), "pi process tree "));
	const marker = path.join(cwd, "orphan.txt");
	const fixture = path.join(cwd, "child.cjs");
	await writeFile(fixture, "require('node:fs').writeFileSync(process.argv[2]+'.ready','started');setTimeout(()=>require('node:fs').writeFileSync(process.argv[2],'orphan survived'),1800)");
	const manager = new UnifiedExecManager();
	try {
		const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
		const command = process.platform === "win32"
			? `Start-Process -FilePath ${quote(process.execPath)} -ArgumentList @('${'"'}${fixture}${'"'}', '${'"'}${marker}${'"'}') -NoNewWindow; for ($i=0; $i -lt 100 -and -not (Test-Path ${quote(marker + ".ready")}); $i++) { Start-Sleep -Milliseconds 50 }; Write-Output 'parent done'`
			: `"${process.execPath}" "${fixture}" "${marker}" >/dev/null 2>&1 & i=0; while [ ! -f "${marker}.ready" ] && [ "$i" -lt 100 ]; do i=$((i+1)); sleep 0.05; done; printf 'parent done'`;
		const result = await nativeCompletion(manager, command, cwd, 1000);
		assert.equal(result.exit_code, 0, result.output);
		assert.match(result.output, /parent done/);
		assert.equal(await readFile(marker + ".ready", "utf8"), "started", "descendant really started before parent exited");
		await delay(2200);
		await assert.rejects(readFile(marker), /ENOENT/);
	} finally { await manager.close(); await rm(cwd, { recursive: true, force: true }); }
});
