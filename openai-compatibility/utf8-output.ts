import { StringDecoder } from "node:string_decoder";

type Stream = "stdout" | "stderr";

/** Bounded normalized UTF-8, with separate (at most three-byte) stream tails.
 * Merge complete decoded chunks in arrival order, never raw bytes from different pipes.
 * Malformed bytes and incomplete EOF tails use Node's U+FFFD replacement policy.
 */
export class Utf8OutputBuffer {
	private buffer = Buffer.alloc(0);
	private dropped = 0;
	private decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
	private ended = new Set<Stream>();
	private readonly limit: number;
	constructor(limit = 1024 * 1024) {
		if (!Number.isSafeInteger(limit) || limit < 4 || limit > 1024 * 1024) throw new Error("Invalid UTF-8 output buffer limit.");
		this.limit = limit;
	}
	get byteLength(): number { return this.buffer.length; }
	append(stream: Stream, chunk: Buffer): void {
		if (!this.ended.has(stream)) this.appendText(this.decoders[stream].write(chunk));
	}
	end(stream: Stream): void {
		if (this.ended.has(stream)) return;
		this.ended.add(stream);
		this.appendText(this.decoders[stream].end());
	}
	private appendText(text: string): void {
		if (!text) return;
		const combined = Buffer.concat([this.buffer, Buffer.from(text, "utf8")]);
		let drop = Math.max(0, combined.length - this.limit);
		// The normalized buffer is valid UTF-8. Evict whole characters, including up to
		// three extra bytes when a capacity boundary would leave an orphan continuation.
		while (drop < combined.length && (combined[drop] & 0xc0) === 0x80) drop++;
		this.dropped += drop;
		this.buffer = drop ? Buffer.from(combined.subarray(drop)) : combined;
	}
	/** Non-consuming bounded snapshot for native terminal publication; not another retained buffer. */
	peek(maxBytes: number): { output: string; truncatedBytes: number; remainingBytes: number } {
		if (!Number.isFinite(maxBytes)) throw new Error("Invalid UTF-8 output read limit.");
		let take = Math.min(this.buffer.length, Math.max(4, Math.min(Math.floor(maxBytes), 64 * 1024)));
		while (take < this.buffer.length && (this.buffer[take] & 0xc0) === 0x80) take--;
		return { output: this.buffer.subarray(0, take).toString("utf8"), truncatedBytes: this.dropped, remainingBytes: this.buffer.length - take };
	}
	read(maxBytes: number): { output: string; truncatedBytes: number } {
		const { output, truncatedBytes } = this.peek(maxBytes);
		this.buffer = Buffer.from(this.buffer.subarray(Buffer.byteLength(output)));
		this.dropped = 0;
		return { output, truncatedBytes };
	}
}
