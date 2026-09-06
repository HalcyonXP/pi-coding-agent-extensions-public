import { evaluate } from "./evaluator.mjs";
import { failure, validCode } from "./protocol.mjs";
import { FrameDecoder, encodeFrame, exact, validTools, validResult, RPC_LIMITS } from "./rpc-protocol.mjs";

const decoder = new FrameDecoder();
const pending = new Map();
let started = false;
let finished = false;
let nextId = 0;
let sentBytes = 0;
let resultBytes = 0;
function send(frame) {
  const data = encodeFrame(frame);
  sentBytes += data.length;
  if (sentBytes > RPC_LIMITS.wireBytes) throw new Error("PROTOCOL_ERROR");
  process.stdout.write(data);
}
function finish(result) {
  if (finished) return;
  finished = true;
  // All guest work has stopped. Parent cancels/drains outstanding real tools on done/close.
  for (const entry of pending.values()) entry.reject(new Error("CANCELLED"));
  pending.clear();
  process.stdin.destroy();
  try { send({ type: "done", result }); } catch { /* Parent detects missing/partial result. */ }
  process.stdout.end();
}
function invoke(name, args) {
  if (finished || pending.size >= RPC_LIMITS.concurrent || ++nextId > RPC_LIMITS.calls) {
    return Promise.reject(new Error("TOOL_LIMIT"));
  }
  return new Promise((resolve, reject) => {
    pending.set(nextId, { resolve, reject });
    send({ type: "call", id: nextId, name, args });
  });
}
function accept(frame) {
  if (finished) throw new Error("PROTOCOL_ERROR");
  if (!started) {
    if (!exact(frame, ["type", "code", "tools"]) || frame.type !== "start"
      || !validCode(frame.code) || !validTools(frame.tools)) throw new Error("PROTOCOL_ERROR");
    started = true;
    void evaluate(frame.code, { invoke, allowedTools: frame.tools }).then(finish, () => finish(failure("HOST_FAILED")));
    return;
  }
  if (!exact(frame, ["type", "id", "value"]) || frame.type !== "reply"
    || !Number.isSafeInteger(frame.id) || !pending.has(frame.id) || !validResult(frame.value)) {
    throw new Error("PROTOCOL_ERROR");
  }
  const bytes = Buffer.byteLength(JSON.stringify(frame.value));
  resultBytes += bytes;
  if (bytes > RPC_LIMITS.resultBytes || resultBytes > RPC_LIMITS.totalResultBytes) throw new Error("PROTOCOL_ERROR");
  const entry = pending.get(frame.id);
  pending.delete(frame.id);
  entry.resolve(frame.value);
}
process.stdin.on("data", (chunk) => {
  try { for (const frame of decoder.push(chunk)) accept(frame); }
  catch { finish(failure("PROTOCOL_ERROR")); }
});
process.stdin.on("end", () => {
  // Supervisor death/closed input cannot leave a cell waiting for tool replies.
  // A CPU-bound guest is still bounded by the engine interrupt; no OS containment claim.
  if (!finished) finish(failure("PROTOCOL_ERROR"));
});
process.stdin.on("error", () => finish(failure("PROTOCOL_ERROR")));
process.stdout.on("error", () => { process.stdin.destroy(); });
