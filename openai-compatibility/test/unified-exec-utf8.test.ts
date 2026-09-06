import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { UnifiedExecManager, type ExecResult } from "../unified-exec.ts";
const node = (command: string) => ({ executable: process.execPath, args: ["-e", command] });
async function until(manager: UnifiedExecManager, current: ExecResult, predicate: (text: string) => boolean) {
	let output = current.output;
	const deadline = Date.now() + 5000;
	while (!predicate(output)) {
		assert.ok(current.session_id, "fixture exited before its handshake");
		assert.ok(Date.now() < deadline, "fixture did not reach its handshake");
		current = await manager.write("owner", current.session_id, "", 20, 1024);
		output += current.output;
	}
	return { ...current, output };
}
async function drain(manager: UnifiedExecManager, current: ExecResult, maxBytes = 64 * 1024) {
	let output = current.output, dropped = current.truncated_bytes;
	while (current.session_id) {
		current = await manager.write("owner", current.session_id, "", 100, maxBytes);
		output += current.output; dropped += current.truncated_bytes;
	}
	return { output, dropped };
}

for (const text of ["¢", "€", "🌿"]) test(`Unified exec preserves ${Buffer.byteLength(text)}-byte UTF-8 at every split across polls`, async () => {
	const bytes = Buffer.from(text);
	for (let split = 1; split < bytes.length; split++) {
		const manager = new UnifiedExecManager(node);
		try {
			const command = `process.stdout.write(Buffer.concat([Buffer.from('begin'),Buffer.from(${JSON.stringify([...bytes.subarray(0, split)])})])); process.stdin.once('data',()=>{process.stdout.write(Buffer.from(${JSON.stringify([...bytes.subarray(split)])}));process.stdin.destroy()});`;
			const first = await until(manager, await manager.start("owner", command, tmpdir(), 0, 1024), (text) => text.includes("begin"));
			assert.equal(first.output, "begin", "incomplete character must be retained, not decoded as a replacement");
			assert.ok(first.session_id);
			const final = await drain(manager, await manager.write("owner", first.session_id, "finish\n", 3000, 4), 4);
			assert.equal(first.output + final.output, "begin" + text);
			assert.equal(final.dropped, 0);
		} finally { await manager.close(); }
	}
});

test("stdout/stderr partial characters cannot mix with each other's decoder state", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		const command = `process.stdout.write(Buffer.from([65,0xe2,0x82]));process.stderr.write(Buffer.from([66,0xf0,0x9f]));process.stdin.once('data',()=>{process.stdout.write(Buffer.from([0xac,67]));process.stderr.write(Buffer.from([0x8c,0xbf,68]));process.stdin.destroy()});`;
		const first = await until(manager, await manager.start("owner", command, tmpdir(), 0, 1024), (text) => text.includes("A") && text.includes("B"));
		assert.equal([...first.output].sort().join(""), "AB");
		const final = await drain(manager, await manager.write("owner", first.session_id!, "finish\n", 3000, 4), 4);
		assert.deepEqual([...(first.output + final.output)].sort(), [..."AB€🌿CD"].sort());
	} finally { await manager.close(); }
});

test("ring-buffer eviction and output cutoffs preserve complete UTF-8 and byte accounting", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		const result = await manager.start("owner", "process.stdout.write('€'.repeat(400000))", tmpdir(), 3000, 5);
		assert.equal(result.running, false);
		assert.equal(result.output, "€");
		const complete = await drain(manager, result);
		assert.doesNotMatch(complete.output, /�/);
		assert.ok(complete.dropped >= 1_200_000 - 1024 * 1024);
		assert.equal(Buffer.byteLength(complete.output) + complete.dropped, 1_200_000);
		assert.ok(Buffer.byteLength(complete.output) <= 1024 * 1024);
	} finally { await manager.close(); }
});

test("EOF flushes an incomplete sequence once; malformed input retains adjacent valid text", async () => {
	const manager = new UnifiedExecManager(node);
	try {
		const result = await manager.start("owner", "process.stdout.write(Buffer.from([255,65,0xe2,0x82]));process.stderr.write(Buffer.from([66,0xc2]));", tmpdir(), 3000, 4);
		const complete = await drain(manager, result, 4);
		assert.deepEqual([...complete.output].sort(), [..."�A�B�"].sort());
		assert.equal(complete.dropped, 0);
	} finally { await manager.close(); }
});
