import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { workerEnvironment } from "./host.mjs";
import { LIMITS, failure, validCode, parseResponse } from "./protocol.mjs";
import {
  FrameDecoder, encodeFrame, exact, record, validToolName, validTools,
  resultJSON, boundedJSON, validDone, RPC_LIMITS,
} from "./rpc-protocol.mjs";

import { CELL_LIMITS, CellStore, cellTools, validOperation, operationJSON } from "./cell-protocol.mjs";
import { cellDiagnostics, validCellDone } from "./cell-diagnostics.mjs";
import { cellStartFrame } from "./tool-metadata.mjs";

function launchWorker(entry = "./rpc-worker.mjs") {
  return spawn(process.execPath, ["--max-old-space-size=96", fileURLToPath(new URL(entry, import.meta.url))], {
    cwd: fileURLToPath(new URL("./", import.meta.url)), env: workerEnvironment(), windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// TRUSTED offline adapter: gateway MUST be the real current handler's ctx.tools.
// This package cannot authenticate arbitrary installed JS. No guest flag can assert host trust.
// Lifetime is one awaited host handler, NOT a persistent exec/wait cell or production SDK.
export class AsyncRuntimeProbe {
  #launch;
  #running = new Set();
  #closed = false;
  #cell;
  constructor({ launch = launchWorker, cell } = {}) {
    if (cell && (!(cell.store instanceof CellStore) || typeof cell.output !== "function" || typeof cell.yield !== "function")) throw new Error("INVALID_REQUEST");
    this.#launch = launch; this.#cell = cell;
  }
  get activeCount() { return this.#running.size; }

  async run(code, { gateway, allowedTools, toolMetadata, signal } = {}) {
    if (this.#closed) return failure("CLOSED");
    const cell = this.#cell;
    if (!validCode(code) || !(cell ? cellTools(allowedTools) : validTools(allowedTools))) return failure("INVALID_REQUEST");
    if (!gateway || typeof gateway.invoke !== "function" || !(gateway.signal instanceof AbortSignal)) {
      return failure("GATEWAY_UNAVAILABLE");
    }
    if (signal?.aborted || gateway.signal.aborted) return failure("CANCELLED");
    if (this.#running.size >= LIMITS.concurrent) return failure("BUSY");
    // Copy and bound the complete start before launching; metadata never expands authority.
    let start;
    try {
      if (!cell && toolMetadata !== undefined) return failure("INVALID_REQUEST");
      start = cell ? cellStartFrame(code, allowedTools, toolMetadata) : { type: "start", code, tools: [...allowedTools] };
    } catch { return failure("INVALID_REQUEST"); }
    const allow = new Set(start.tools);
    const controller = new AbortController();
    let child;
    try { child = this.#launch(); } catch { return failure("HOST_FAILED"); }
    const decoder = new FrameDecoder();
    const diagnostics = cell ? cellDiagnostics() : undefined;
    const tasks = new Set();
    const toolTasks = new Set();
    const timers = new Map();
    let outputBytes = 0, outputCount = 0;
    let lastId = 0;
    let argumentBytes = 0;
    let resultBytes = 0;
    let sentBytes = 0;
    let stopped;
    let done;
    let closed = false;
    let finish;
    const promise = new Promise((resolve) => { finish = resolve; });
    const stop = (code) => {
      if (stopped) return;
      stopped = code;
      done = undefined;
      controller.abort();
      child.kill("SIGKILL");
    };
    const entry = { stop, promise };
    this.#running.add(entry);
    const abort = () => stop("CANCELLED");
    const signals = new Set([gateway.signal, signal].filter(Boolean));
    for (const source of signals) source.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => stop("WALL_LIMIT"), cell ? CELL_LIMITS.wallMs : LIMITS.wallMs);
    function send(frame) {
      const data = encodeFrame(frame);
      sentBytes += data.length;
      if (sentBytes > RPC_LIMITS.wireBytes) throw new Error("PROTOCOL_ERROR");
      child.stdin.write(data);
    }
    function accept(frame) {
      if (done || closed) return stop("PROTOCOL_ERROR");
      if (exact(frame, ["type", "result"]) && frame.type === "done") {
        const parsed = validDone(frame.result) || (cell && validCellDone(frame.result)) ? frame.result : parseResponse(Buffer.from(JSON.stringify(frame.result)));
        if (parsed.code === "PROTOCOL_ERROR") return stop("PROTOCOL_ERROR");
        if (toolTasks.size && parsed.status === "ok") return stop("DETACHED_TOOL");
        done = parsed;
        // End of guest ownership always revokes outstanding actions, including on failure.
        controller.abort();
        child.stdin.end();
        return;
      }
      if (cell && exact(frame, ["type", "text"]) && frame.type === "output") {
        if (typeof frame.text !== "string" || ++outputCount > CELL_LIMITS.outputCount || (outputBytes += Buffer.byteLength(frame.text)) > LIMITS.outputBytes) return stop("OUTPUT_LIMIT");
        if (controller.signal.aborted || gateway.signal.aborted) return stop("CANCELLED");
        cell.output(frame.text); return;
      }
      if (cell && exact(frame, ["type", "id"]) && frame.type === "yield") {
        if (frame.id !== lastId + 1 || ++lastId > CELL_LIMITS.operations) return stop("TOOL_LIMIT");
        if (controller.signal.aborted || gateway.signal.aborted) return stop("CANCELLED");
        cell.yield(); return;
      }
      if (cell && exact(frame, ["type", "id", "operation"]) && frame.type === "operation") {
        if (frame.id !== lastId + 1 || ++lastId > CELL_LIMITS.operations || !validOperation(frame.operation) || (tasks.size >= RPC_LIMITS.concurrent && frame.operation.kind !== "cancel")) return stop("TOOL_LIMIT");
        try {
          argumentBytes += Buffer.byteLength(boundedJSON({type: "operation", operation: frame.operation}, RPC_LIMITS.argumentBytes, "TOOL_LIMIT"));
          if (argumentBytes > RPC_LIMITS.totalArgumentBytes) return stop("TOOL_LIMIT");
        } catch { return stop("TOOL_LIMIT"); }
        const task = Promise.resolve().then(async () => {
          if (stopped || done || controller.signal.aborted || gateway.signal.aborted) return;
          let value;
          if (frame.operation.kind === "sleep") {
            if (timers.has(frame.operation.timer) || timers.size >= CELL_LIMITS.timers) throw new Error("TOOL_LIMIT");
            await new Promise(resolve => {
              const finish = () => { clearTimeout(timer); timers.delete(frame.operation.timer); controller.signal.removeEventListener("abort", finish); resolve(); };
              const timer = setTimeout(finish, frame.operation.ms);
              timers.set(frame.operation.timer, finish);
              controller.signal.addEventListener("abort", finish, {once: true});
              if (controller.signal.aborted) finish();
            });
            value = {};
          } else if (frame.operation.kind === "cancel") {
            timers.get(frame.operation.timer)?.();
            // Flush the completed sleep reply before acknowledging cancellation.
            await Promise.resolve();
            value = {cancelled: true};
          } else if (frame.operation.kind === "notify") {
            if (typeof gateway.notify !== "function" || typeof gateway.canNotify !== "function" || gateway.canNotify() !== true) value = null;
            else {
              value = await gateway.notify(frame.operation.text);
              if (typeof value !== "boolean") throw new Error("PROTOCOL_ERROR");
            }
          } else if (["image", "image-inline", "generated-image", "generated-image-inline", "evidence"].includes(frame.operation.kind)) {
            if (!cell.evidence) throw new Error("TOOL_LIMIT");
            value = await cell.evidence.apply(frame.operation, gateway);
          } else value = cell.store.apply(frame.operation);
          if (stopped || done || closed || controller.signal.aborted || gateway.signal.aborted) return;
          const json = operationJSON(value);
          resultBytes += Buffer.byteLength(json);
          if (resultBytes > RPC_LIMITS.totalResultBytes) return stop("TOOL_RESULT_LIMIT");
          send({type: "reply", id: frame.id, value: JSON.parse(json)});
        }).catch(() => { if (!stopped && !done && !closed) stop(frame.operation.kind === "notify" ? "GATEWAY_FAILED" : "TOOL_LIMIT"); }).finally(() => tasks.delete(task));
        tasks.add(task); return;
      }
      if (!exact(frame, ["type", "id", "name", "args"]) || frame.type !== "call"
        || !Number.isSafeInteger(frame.id) || frame.id !== lastId + 1 || !record(frame.args)) {
        return stop("PROTOCOL_ERROR");
      }
      if (!validToolName(frame.name) || !allow.has(frame.name)) return stop("TOOL_DENIED");
      let bytes;
      try {
        bytes = Buffer.byteLength(boundedJSON({ name: frame.name, args: frame.args }, RPC_LIMITS.argumentBytes, "TOOL_LIMIT"));
      } catch { return stop("TOOL_LIMIT"); }
      argumentBytes += bytes;
      if (++lastId > RPC_LIMITS.calls || tasks.size >= RPC_LIMITS.concurrent
        || bytes > RPC_LIMITS.argumentBytes || argumentBytes > RPC_LIMITS.totalArgumentBytes) return stop("TOOL_LIMIT");
      // No handler references, fake event bus or extra Agent. The supplied capability runs
      // real host validation/approvals/result hooks and revokes on model/registry changes.
      const task = Promise.resolve().then(async () => {
        if (stopped || done || controller.signal.aborted) return;
        const observeResult = diagnostics?.begin(frame.name);
        const value = await gateway.invoke(frame.name, frame.args, { signal: controller.signal });
        if (stopped || done || closed || controller.signal.aborted || gateway.signal.aborted) return;
        const json = resultJSON(cell?.evidence ? cell.evidence.project(value) : value);
        resultBytes += Buffer.byteLength(json);
        if (resultBytes > RPC_LIMITS.totalResultBytes) return stop("TOOL_RESULT_LIMIT");
        const projected = JSON.parse(json);
        observeResult?.(projected);
        send({ type: "reply", id: frame.id, value: projected });
      }).catch((error) => {
        if (!stopped && !done && !closed) stop(error?.message === "TOOL_RESULT_LIMIT" ? "TOOL_RESULT_LIMIT" : "GATEWAY_FAILED");
      }).finally(() => { tasks.delete(task); toolTasks.delete(task); });
      tasks.add(task); toolTasks.add(task);
    }
    child.stdout.on("data", (chunk) => {
      if (stopped) return;
      try {
        for (const frame of decoder.push(chunk)) {
          if (stopped) break;
          accept(frame);
        }
      } catch { stop("PROTOCOL_ERROR"); }
    });
    child.stderr.resume();
    child.on("error", () => stop("HOST_FAILED"));
    child.stdin.on("error", () => { if (!done) stop("HOST_FAILED"); });
    child.once("close", async (exitCode) => {
      closed = true;
      clearTimeout(timer);
      controller.abort();
      try { decoder.end(); } catch { stop("PROTOCOL_ERROR"); }
      // Cooperative tools may delay this drain. Never report cleanup while an owned
      // invocation is still pending, and never claim the worker kill undoes tool effects.
      await Promise.allSettled([...tasks]);
      for (const source of signals) source.removeEventListener("abort", abort);
      this.#running.delete(entry);
      const result = stopped ? failure(stopped) : exitCode !== 0 || !done ? failure("HOST_FAILED") : done;
      // Host-observed delegation summaries are not guest output or side-effect proof.
      finish(diagnostics && result.status === "error" ? {version:result.version,status:result.status,code:result.code,diagnostics:diagnostics.snapshot(result.phase)} : result);
    });
    if ([...signals].some((source) => source.aborted)) abort();
    if (!stopped) {
      try { send(start); } catch { stop("PROTOCOL_ERROR"); }
    } else child.stdin.destroy();
    return promise;
  }

  async close() {
    this.#closed = true;
    const entries = [...this.#running];
    for (const entry of entries) entry.stop("CANCELLED");
    await Promise.all(entries.map((entry) => entry.promise));
  }
}

// Portable semantic-test adapter; normal Code mode must use the contained Windows wrapper.
export class CellRuntime extends AsyncRuntimeProbe {
  constructor({ store, evidence, output, yield: onYield, launch = () => launchWorker("./cell-worker.mjs") }) {
    super({launch, cell: {store, evidence, output, yield: onYield}});
  }
}
