import { boundedJSON, encodeFrame, RPC_LIMITS, validToolName } from "./rpc-protocol.mjs";
import { validCode } from "./protocol.mjs";

// Discovery data only. These limits do not enlarge the tool registry, RPC frame or execution budgets.
// Native registry code/host proxies remain trusted JavaScript; this is not their sandbox.
export const TOOL_METADATA_LIMITS = Object.freeze({ descriptionBytes: 16 * 1024, totalBytes: 64 * 1024 });
const invalid = () => new Error("INVALID_TOOL_METADATA");
function denseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > RPC_LIMITS.tools) return false;
  const keys = Reflect.ownKeys(value);
  return keys.length === value.length + 1 && keys.every(key => key === "length" || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length && "value" in Object.getOwnPropertyDescriptor(value, key)));
}
function namesOK(names) {
  return denseArray(names) && names.every(validToolName) && new Set(names).size === names.length;
}
function scalar(record, key) {
  if (!record || typeof record !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(record))) throw invalid();
  const d = Object.getOwnPropertyDescriptor(record, key);
  if (!d || !("value" in d) || typeof d.value !== "string") throw invalid();
  return d.value;
}
/** Exact admitted names, in order; no accessor evaluation, missing-description invention or implicit truncation. */
export function toolMetadataJSON(names, metadata) {
  if (!namesOK(names) || !denseArray(metadata) || metadata.length !== names.length) throw invalid();
  for (const row of metadata) {
    if (!row || typeof row !== "object" || Reflect.ownKeys(row).length !== 2 || !Object.hasOwn(row, "name") || !Object.hasOwn(row, "description")) throw invalid();
    scalar(row, "name"); scalar(row, "description");
  }
  let copy;
  try { copy = JSON.parse(boundedJSON(metadata, TOOL_METADATA_LIMITS.totalBytes, "INVALID_TOOL_METADATA")); } catch { throw invalid(); }
  for (let i = 0; i < copy.length; i++) {
    const row = copy[i];
    if (!row || Array.isArray(row) || Object.keys(row).sort().join(",") !== "description,name"
      || row.name !== names[i] || typeof row.description !== "string"
      || Buffer.byteLength(row.description) > TOOL_METADATA_LIMITS.descriptionBytes) throw invalid();
  }
  return JSON.stringify(copy);
}
/** Read native ToolInfo name/description data, not schemas, callbacks or inactive-tool metadata. */
export function snapshotToolMetadata(names, definitions) {
  if (!namesOK(names) || !Array.isArray(definitions)) throw invalid();
  const wanted = new Set(names), selected = new Map();
  for (let i = 0; i < definitions.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(definitions, String(i));
    if (!descriptor || !("value" in descriptor)) throw invalid();
    const row = descriptor.value, name = scalar(row, "name");
    if (!wanted.has(name)) continue;
    if (selected.has(name)) throw invalid();
    selected.set(name, { name, description: scalar(row, "description") });
  }
  if (selected.size !== names.length) throw invalid();
  return JSON.parse(toolMetadataJSON(names, names.map(name => selected.get(name))));
}
/** Validate/copy the complete cell start before opening a scope or preparing a worker. */
export function cellStartFrame(code, names, metadata) {
  if (!validCode(code) || !namesOK(names)) throw new Error("INVALID_REQUEST");
  const frame = { type: "start", code, tools: [...names] };
  if (metadata !== undefined) frame.toolMetadata = JSON.parse(toolMetadataJSON(frame.tools, metadata));
  encodeFrame(frame); // Existing whole-frame bound, including source escaping and metadata.
  return frame;
}
