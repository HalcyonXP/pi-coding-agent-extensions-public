import { evaluate } from "./evaluator.mjs";
import { failure, validCode } from "./protocol.mjs";
import { exact, validResult, boundedJSON, RPC_LIMITS } from "./rpc-protocol.mjs";
import { CELL_LIMITS, cellTools, validOperation } from "./cell-protocol.mjs";
import { SyncChannel } from "./sync-channel.mjs";

const channel = new SyncChannel();
const pending = new Map();
let operations = 0, results = 0, argumentsBytes = 0;
function next() { if (++operations > CELL_LIMITS.operations) throw new Error("TOOL_LIMIT"); return operations; }
function request(frame, kind, sync = false) {
  // One synchronous cancellation control may coexist with four owned operations.
  if (pending.size >= RPC_LIMITS.concurrent && frame.operation?.kind !== "cancel") throw new Error("TOOL_LIMIT");
  const id = next();
  argumentsBytes += Buffer.byteLength(boundedJSON(frame, RPC_LIMITS.argumentBytes, "TOOL_LIMIT"));
  if (argumentsBytes > RPC_LIMITS.totalArgumentBytes) throw new Error("TOOL_LIMIT");
  const entry = {kind, settled: false};
  let promise;
  if (!sync) promise = new Promise((resolve, reject) => Object.assign(entry, {resolve, reject}));
  pending.set(id, entry);
  channel.send({...frame, id});
  if (!sync) return promise;
  while (!entry.settled) pump();
  return entry.value;
}
function pump() {
  if (!pending.size) throw new Error("PROTOCOL_ERROR");
  const frame = channel.receive();
  if (!exact(frame, ["type", "id", "value"]) || frame.type !== "reply" || !Number.isSafeInteger(frame.id) || !pending.has(frame.id)) throw new Error("PROTOCOL_ERROR");
  const entry = pending.get(frame.id);
  const json = boundedJSON(frame.value, RPC_LIMITS.resultBytes, "TOOL_RESULT_LIMIT");
  if (entry.kind === "tool" && !validResult(frame.value)) throw new Error("PROTOCOL_ERROR");
  results += Buffer.byteLength(json);
  if (results > RPC_LIMITS.totalResultBytes) throw new Error("TOOL_RESULT_LIMIT");
  pending.delete(frame.id);
  entry.settled = true; entry.value = JSON.parse(json); entry.resolve?.(entry.value);
}
let result;
try {
  const frame = channel.receive();
  if (!exact(frame, ["type", "code", "tools"]) || frame.type !== "start" || !validCode(frame.code) || !cellTools(frame.tools)) throw new Error("PROTOCOL_ERROR");
  result = await evaluate(frame.code, {
    allowedTools: frame.tools,
    invoke: (name, args) => request({type: "call", name, args}, "tool"),
    cell: {
      output: text => channel.send({type: "output", text}),
      yield: () => channel.send({type: "yield", id: next()}),
      operation: value => {
        if (!validOperation(value) || value.kind !== "sleep") throw new Error("TOOL_LIMIT");
        return request({type: "operation", operation: value}, "timer");
      },
      syncOperation: value => request({type: "operation", operation: value}, "storage", true),
      pump,
    },
  });
} catch { result = failure("PROTOCOL_ERROR"); }
// Parent receives output incrementally; do not duplicate it in the final frame.
if (result.status === "ok") result = {...result, output: []};
for (const entry of pending.values()) entry.reject?.(new Error("CANCELLED"));
pending.clear();
try { channel.send({type: "done", result}); } catch { process.exitCode = 1; }
