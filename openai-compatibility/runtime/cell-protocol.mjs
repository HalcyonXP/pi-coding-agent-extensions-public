import { boundedJSON, exact, RPC_LIMITS, validTools } from "./rpc-protocol.mjs";
import { imageInput } from "./image-input.mjs";
export const CELL_LIMITS = Object.freeze({ wallMs: 360_000, outputCount: 64, operations: 64, keys: 32, keyBytes: 128, valueBytes: 16 * 1024, storageBytes: 256 * 1024, timers: 16, timerMs: 60_000, completed: 8 });
export const cellTools = value => Array.isArray(value) && (!value.length || validTools(value));
export function validOperation(value) {
  if (value?.kind === "generated-image" || value?.kind === "generated-image-inline") {
    const fields=value.kind === "generated-image" ? ["kind","ref"] : ["kind","data","mimeType"];
    if (!exact(value,fields) && !exact(value,[...fields,"output_hint"])) return false;
    if (Object.hasOwn(value,"output_hint") && (typeof value.output_hint !== "string" || Buffer.byteLength(value.output_hint)>4096)) return false;
    return value.kind === "generated-image" ? typeof value.ref === "string" && /^img_[a-f0-9-]{36}$/.test(value.ref) : imageInput({type:"image",data:value.data,mimeType:value.mimeType}) !== undefined;
  }
  if (exact(value, ["kind", "data", "mimeType"]) && value.kind === "image-inline") return imageInput({type:"image",data:value.data,mimeType:value.mimeType}) !== undefined;
  if (exact(value, ["kind", "ref"]) && value.kind === "image") return typeof value.ref === "string" && /^img_[a-f0-9-]{36}$/.test(value.ref);
  if (exact(value, ["kind", "ref", "offset", "length"]) && value.kind === "evidence") return typeof value.ref === "string" && /^ev_[a-f0-9-]{36}$/.test(value.ref) && Number.isSafeInteger(value.offset) && value.offset >= 0 && value.offset <= 16 * 1024 * 1024 && Number.isSafeInteger(value.length) && value.length >= 1 && value.length <= 8192;
  if (exact(value, ["kind", "key"]) && value.kind === "load") return validKey(value.key);
  if (exact(value, ["kind", "key", "value"]) && value.kind === "store") {
    if (!validKey(value.key)) return false;
    try { boundedJSON(value.value, CELL_LIMITS.valueBytes, "TOOL_LIMIT"); return true; } catch { return false; }
  }
  if (!Number.isSafeInteger(value?.timer) || value.timer < 1 || value.timer > CELL_LIMITS.operations) return false;
  if (exact(value, ["kind", "timer"]) && value.kind === "cancel") return true;
  return exact(value, ["kind", "ms", "timer"]) && value.kind === "sleep" && Number.isSafeInteger(value.ms) && value.ms >= 0 && value.ms <= CELL_LIMITS.timerMs;
}
function validKey(key) { return typeof key === "string" && key.length > 0 && Buffer.byteLength(key) <= CELL_LIMITS.keyBytes; }
// Native session/epoch-owned memory only. No paths, auth, tool effects or object capabilities.
export class CellStore {
  #values = new Map(); #bytes = 0; #closed = false;
  apply(operation) {
    if (this.#closed || !validOperation(operation) || !["store", "load"].includes(operation.kind)) throw new Error("TOOL_LIMIT");
    const old = this.#values.get(operation.key);
    if (operation.kind === "load") return old === undefined ? { found: false } : { found: true, value: JSON.parse(old) };
    const json = boundedJSON(operation.value, CELL_LIMITS.valueBytes, "TOOL_LIMIT");
    const bytes = this.#bytes - (old === undefined ? 0 : Buffer.byteLength(old)) + Buffer.byteLength(json);
    if (bytes > CELL_LIMITS.storageBytes || (old === undefined && this.#values.size >= CELL_LIMITS.keys)) throw new Error("TOOL_LIMIT");
    this.#values.set(operation.key, json); this.#bytes = bytes;
    return { stored: true };
  }
  close() { this.#closed = true; this.#values.clear(); this.#bytes = 0; }
}
export function operationJSON(value) { return boundedJSON(value, RPC_LIMITS.resultBytes, "TOOL_RESULT_LIMIT"); }
