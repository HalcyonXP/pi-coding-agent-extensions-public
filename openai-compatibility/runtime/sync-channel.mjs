// Trusted worker I/O only. One reader, no async stdin prefetch or guest-visible fd.
import { readSync, writeSync } from "node:fs";
import { FrameDecoder, encodeFrame, RPC_LIMITS } from "./rpc-protocol.mjs";
export class SyncChannel {
  #read; #write; #buffer = Buffer.alloc(8192); #decoder = new FrameDecoder(); #queue = [];
  #bytes = 0; #frames = 0;
  constructor({ read = readSync, write = writeSync } = {}) { this.#read = read; this.#write = write; }
  send(frame) {
    const data = encodeFrame(frame);
    this.#bytes += data.length;
    if (++this.#frames > RPC_LIMITS.frames || this.#bytes > RPC_LIMITS.wireBytes) throw new Error("PROTOCOL_ERROR");
    let offset = 0;
    while (offset < data.length) {
      const written = this.#write(1, data, offset, data.length - offset, null);
      if (!Number.isSafeInteger(written) || written < 1 || written > data.length - offset) throw new Error("PROTOCOL_ERROR");
      offset += written;
    }
  }
  receive() {
    while (!this.#queue.length) {
      const count = this.#read(0, this.#buffer, 0, this.#buffer.length, null);
      if (!Number.isSafeInteger(count) || count < 1 || count > this.#buffer.length) throw new Error("PROTOCOL_ERROR");
      this.#queue.push(...this.#decoder.push(this.#buffer.subarray(0, count)));
    }
    return this.#queue.shift();
  }
}
