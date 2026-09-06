import assert from "node:assert/strict";
import test from "node:test";
import { Utf8OutputBuffer } from "../utf8-output.ts";

test("decoder state is stream-local and survives empty repeated polls", () => {
	const output = new Utf8OutputBuffer();
	output.append("stdout", Buffer.from([0xe2, 0x82]));
	output.append("stderr", Buffer.from([0xc2]));
	for (let i = 0; i < 3; i++) assert.deepEqual(output.read(4), { output: "", truncatedBytes: 0 });
	output.append("stderr", Buffer.from([0xa2]));
	assert.equal(output.read(4).output, "¢");
	output.append("stdout", Buffer.from([0xac]));
	assert.equal(output.read(4).output, "€");
});

test("ring eviction and reads retain complete characters at every small boundary", () => {
	const source = "a¢€🌿z";
	for (let capacity = 4; capacity <= 16; capacity++) {
		for (let cut = 4; cut <= 10; cut++) {
			const output = new Utf8OutputBuffer(capacity);
			for (const byte of Buffer.from(source)) output.append("stdout", Buffer.from([byte]));
			assert.ok(output.byteLength <= capacity);
			let text = "", dropped = 0;
			do { const part = output.read(cut); assert.ok(Buffer.byteLength(part.output) <= cut); text += part.output; dropped += part.truncatedBytes; } while (output.byteLength);
			assert.ok(source.endsWith(text)); assert.doesNotMatch(text, /�/);
			assert.equal(Buffer.byteLength(text) + dropped, Buffer.byteLength(source));
			assert.deepEqual(output.read(4), { output: "", truncatedBytes: 0 });
		}
	}
});

test("malformed bytes and incomplete EOF use deterministic replacement exactly once", () => {
	const output = new Utf8OutputBuffer();
	output.append("stdout", Buffer.from([255, 65, 0xe2, 0x82]));
	assert.equal(output.read(100).output, "�A");
	output.end("stdout"); output.end("stdout");
	assert.equal(output.read(100).output, "�");
	output.append("stdout", Buffer.from("late"));
	assert.equal(output.read(100).output, "");
});

test("buffer and per-response limits are enforced on normalized UTF-8 bytes", () => {
	assert.throws(() => new Utf8OutputBuffer(3)); assert.throws(() => new Utf8OutputBuffer(1024 * 1024 + 1));
	const output = new Utf8OutputBuffer();
	output.append("stderr", Buffer.from("🌿".repeat(300_000)));
	assert.equal(output.byteLength, 1024 * 1024);
	const first = output.read(1_000_000);
	assert.equal(Buffer.byteLength(first.output), 64 * 1024);
	assert.equal(first.truncatedBytes, 1_200_000 - 1024 * 1024);
	assert.equal(output.byteLength, 1024 * 1024 - 64 * 1024);
});
