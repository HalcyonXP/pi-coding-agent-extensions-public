// Fixed spike limits, not guest-controlled options. All byte budgets are UTF-8.
export const LIMITS = Object.freeze({
  codeBytes: 64 * 1024,
  requestBytes: 400 * 1024, // JSON escaping can expand source sixfold.
  outputBytes: 64 * 1024,
  outputCount: 128,
  responseBytes: 400 * 1024,
  heapBytes: 16 * 1024 * 1024,
  wasmBytes: 32 * 1024 * 1024,
  stackBytes: 64 * 1024,
  executionMs: 500,
  wallMs: 5000,
  jobs: 1024,
  concurrent: 4,
});

export const ERROR_CODES = Object.freeze([
  "INVALID_REQUEST", "ENGINE_UNAVAILABLE", "EXECUTION_FAILED", "EXECUTION_LIMIT",
  "IMPORT_DENIED", "OUTPUT_LIMIT", "INVALID_OUTPUT", "PENDING_PROMISE",
  "HOST_FAILED", "PROTOCOL_ERROR", "WALL_LIMIT", "CANCELLED", "BUSY", "CLOSED",
]);

export function failure(code) {
  return { version: 1, status: "error", code };
}

function keysAre(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

export function validCode(code) {
  return typeof code === "string" && code.length <= LIMITS.codeBytes
    && Buffer.byteLength(code) <= LIMITS.codeBytes && !code.includes("\0");
}

export function parseRequest(buffer) {
  if (buffer.length > LIMITS.requestBytes) throw new Error("INVALID_REQUEST");
  const value = JSON.parse(buffer.toString("utf8"));
  if (!keysAre(value, ["version", "code"]) || value.version !== 1 || !validCode(value.code)) {
    throw new Error("INVALID_REQUEST");
  }
  return value;
}

export function parseResponse(buffer) {
  if (buffer.length > LIMITS.responseBytes) return failure("PROTOCOL_ERROR");
  try {
    const value = JSON.parse(buffer.toString("utf8"));
    if (value?.version !== 1) return failure("PROTOCOL_ERROR");
    if (value.status === "error" && keysAre(value, ["version", "status", "code"])
      && ERROR_CODES.includes(value.code)) return value;
    if (!keysAre(value, ["version", "status", "output"]) || value.status !== "ok"
      || !Array.isArray(value.output) || value.output.length > LIMITS.outputCount) {
      return failure("PROTOCOL_ERROR");
    }
    let bytes = 0;
    for (const text of value.output) {
      if (typeof text !== "string") return failure("PROTOCOL_ERROR");
      bytes += Buffer.byteLength(text);
      if (bytes > LIMITS.outputBytes) return failure("PROTOCOL_ERROR");
    }
    return value;
  } catch {
    return failure("PROTOCOL_ERROR");
  }
}
