import { LIMITS } from "./protocol.mjs";

// Offline v2 duplex protocol. No caller-supplied parent IDs, paths, module names or credentials.
export const RPC_LIMITS = Object.freeze({
  calls: 64, concurrent: 4, argumentBytes: 64 * 1024, resultBytes: 64 * 1024,
  totalArgumentBytes: 256 * 1024, totalResultBytes: 256 * 1024,
  frameBytes: 400 * 1024, wireBytes: 4 * 1024 * 1024, frames: 132, tools: 32,
  depth: 32, nodes: 16384,
});
export const RPC_ERRORS = Object.freeze([
  "GATEWAY_UNAVAILABLE", "TOOL_DENIED", "TOOL_LIMIT", "INVALID_TOOL_CALL",
  "GATEWAY_FAILED", "TOOL_RESULT_LIMIT", "DETACHED_TOOL",
]);
export function exact(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
export const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const validToolName = (name) => typeof name === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(name)
  && !["exec", "wait"].includes(name);
export const validTools = (tools) => Array.isArray(tools) && tools.length > 0 && tools.length <= RPC_LIMITS.tools
  && tools.every(validToolName) && new Set(tools).size === tools.length;
export function encodeFrame(value) {
  const data = Buffer.from(JSON.stringify(value) + "\n");
  if (data.length > RPC_LIMITS.frameBytes) throw new Error("PROTOCOL_ERROR");
  return data;
}
// Incremental bytes, not readline's unbounded line buffering. Reject malformed UTF-8.
export class FrameDecoder {
  #buffer = Buffer.alloc(0);
  #total = 0;
  #frames = 0;
  push(chunk) {
    this.#total += chunk.length;
    if (this.#total > RPC_LIMITS.wireBytes) throw new Error("PROTOCOL_ERROR");
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const frames = [];
    let end;
    while ((end = this.#buffer.indexOf(10)) !== -1) {
      if (end + 1 > RPC_LIMITS.frameBytes || ++this.#frames > RPC_LIMITS.frames) throw new Error("PROTOCOL_ERROR");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(this.#buffer.subarray(0, end));
      frames.push(JSON.parse(text));
      this.#buffer = this.#buffer.subarray(end + 1);
    }
    if (this.#buffer.length >= RPC_LIMITS.frameBytes) throw new Error("PROTOCOL_ERROR");
    return frames;
  }
  end() { if (this.#buffer.length) throw new Error("PROTOCOL_ERROR"); }
}
export function validResult(value) {
  // Preserve the full finalized Pi result, including details/citations/images, or reject it.
  // This is not a text-flattening adapter or a substitute for the real host result hooks.
  return exact(value, ["result", "isError"]) && typeof value.isError === "boolean"
    && record(value.result) && Array.isArray(value.result.content);
}
// Copy only bounded plain data before JSON serialization. Do not invoke toJSON/getters
// or flatten structured evidence. Host proxies/installed extensions remain trusted JS.
export function boundedJSON(value, maxBytes, limitCode) {
  let nodes = 0;
  let bytes = 0;
  const account = (text) => {
    bytes += Buffer.byteLength(text);
    if (bytes > maxBytes) throw new Error(limitCode);
    return text;
  };
  function copy(input, depth) {
    if (++nodes > RPC_LIMITS.nodes || depth > RPC_LIMITS.depth) throw new Error(limitCode);
    if (typeof input === "string") return account(input);
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object" || input === null) throw new Error("INVALID_JSON_DATA");
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("INVALID_JSON_DATA");
    const output = array ? [] : Object.create(null);
    function property(key) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor) return null; // Array holes follow JSON's null convention.
      if (!Object.hasOwn(descriptor, "value")) throw new Error("INVALID_JSON_DATA");
      if (descriptor.value === undefined) return array ? null : undefined;
      return copy(descriptor.value, depth + 1);
    }
    if (array) {
      if (input.length > RPC_LIMITS.nodes) throw new Error(limitCode);
      for (let i = 0; i < input.length; i++) output.push(property(String(i)));
    } else {
      for (const key in input) {
        if (!Object.hasOwn(input, key)) continue;
        account(key);
        // Count even omitted undefined properties to bound wide results.
        if (++nodes > RPC_LIMITS.nodes) throw new Error(limitCode);
        const next = property(key);
        if (next !== undefined) output[key] = next;
      }
    }
    return output;
  }
  const json = JSON.stringify(copy(value, 0));
  if (Buffer.byteLength(json) > maxBytes) throw new Error(limitCode);
  return json;
}
export function resultJSON(value) {
  const json = boundedJSON(value, RPC_LIMITS.resultBytes, "TOOL_RESULT_LIMIT");
  if (!validResult(JSON.parse(json))) throw new Error("GATEWAY_FAILED");
  return json;
}
export function validDone(value) {
  if (!exact(value, ["version", "status", "code"]) || value.version !== 1 || value.status !== "error") return false;
  return RPC_ERRORS.includes(value.code);
}
export { LIMITS };
