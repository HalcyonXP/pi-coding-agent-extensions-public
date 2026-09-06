import { validCode } from "./protocol.mjs";
import { record } from "./rpc-protocol.mjs";
export const validYield = value => Number.isSafeInteger(value) && value >= 0 && value <= 30_000;
export const validTokens = value => Number.isSafeInteger(value) && value >= 0 && value <= 16_384;
export function execInput(source, options = {}) {
  if (!validCode(source) || !source.trim()) throw new Error("INVALID_REQUEST");
  if ((options.yield_time_ms !== undefined && !validYield(options.yield_time_ms)) || (options.max_output_tokens !== undefined && !validTokens(options.max_output_tokens))) throw new Error("INVALID_REQUEST");
  const lines = source.split(/\n/, 1);
  const pragma = /^\s*\/\/\s*@exec:\s*(.*)$/.exec(lines[0]);
  let settings = {};
  if (pragma) {
    try { settings = JSON.parse(pragma[1]); } catch { throw new Error("INVALID_REQUEST"); }
    if (!record(settings) || Object.keys(settings).some(key => !["yield_time_ms", "max_output_tokens"].includes(key))) throw new Error("INVALID_REQUEST");
    source = source.slice(lines[0].length + 1);
    if (!source.trim()) throw new Error("INVALID_REQUEST");
    for (const key of Object.keys(settings)) if (options[key] !== undefined) throw new Error("INVALID_REQUEST");
  }
  const yieldMs = options.yield_time_ms ?? settings.yield_time_ms ?? 10_000;
  const tokens = options.max_output_tokens ?? settings.max_output_tokens ?? 10_000;
  if (!validYield(yieldMs) || !validTokens(tokens)) throw new Error("INVALID_REQUEST");
  // Explicit null is not omission in the pragma.
  if ((Object.hasOwn(settings,"yield_time_ms") && !validYield(settings.yield_time_ms)) || (Object.hasOwn(settings,"max_output_tokens") && !validTokens(settings.max_output_tokens))) throw new Error("INVALID_REQUEST");
  return {code: source, yieldMs, tokens};
}
// Deliberately an estimate: four UTF-8 bytes per requested token, guest text only.
// Whole finalized tool results crossing RPC are never clipped by this presentation budget.
export function budgetOutput(output, tokens) {
  if (!validTokens(tokens)) throw new Error("INVALID_REQUEST");
  let remaining = tokens * 4, omitted = 0;
  const visible = [];
  for (const text of output) {
    const bytes = Buffer.from(text);
    let end = Math.min(bytes.length, remaining);
    let value;
    while (true) {
      try { value = new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(0,end)); break; }
      catch { if (!end) throw new Error("INVALID_REQUEST"); end--; }
    }
    if (value || !bytes.length) visible.push(value);
    remaining -= end; omitted += bytes.length - end;
  }
  return {output: visible, ...(omitted ? {omitted_output_bytes: omitted} : {})};
}
