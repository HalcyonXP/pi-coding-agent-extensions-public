// One fresh Wasm module/runtime/context per request. Only JSON crosses the optional
// async tool bridge; no Pi context, host objects, callbacks or credentials enter QuickJS.
import { LIMITS, failure } from "./protocol.mjs";
import { createEngine } from "./engine.mjs";
import { RPC_LIMITS, boundedJSON, exact, record, validToolName } from "./rpc-protocol.mjs";

import { CELL_BOOTSTRAP } from "./cell-bootstrap.mjs";
import { CELL_LIMITS, validOperation } from "./cell-protocol.mjs";

// cell is a native worker composition seam, never a guest-selected runtime flag.
export async function evaluate(code, { invoke, allowedTools = [], cell } = {}) {
  let phase = "initialize";
  const fail = code => cell ? {...failure(code), phase} : failure(code);
  let engine;
  try {
    engine = await createEngine();
  } catch {
    return fail("ENGINE_UNAVAILABLE");
  }

  const runtime = engine.newRuntime();
  let context;
  let evaluation;
  let fatal;
  const output = [];
  let outputBytes = 0;
  const pendingTools = new Map();
  let toolCalls = 0;
  let argumentBytes = 0;
  let wake;
  let decode;
  let exited = false;
  let disposed = false;
  function defer(run, kind = "tool", timer) {
    if (++toolCalls > RPC_LIMITS.calls || pendingTools.size >= RPC_LIMITS.concurrent) throw new Error("TOOL_LIMIT");
    const deferred = context.newPromise();
    const entry = { deferred, settled: false, kind, timer };
    pendingTools.set(toolCalls, entry);
    Promise.resolve().then(() => { if (disposed || fatal || exited || entry.cancelled) throw new Error("CANCELLED"); return run(); }).then(
      value => { entry.json = JSON.stringify(value); entry.settled = true; wake?.(); },
      () => { entry.error = true; entry.settled = true; wake?.(); },
    ).catch(() => { entry.error = true; entry.settled = true; wake?.(); });
    return deferred.handle;
  }
  // Cumulative engine elapsed time excludes idle tool waits; parent wall watchdog does not.
  let deadline = performance.now() + LIMITS.executionMs;
  const interrupted = () => {
    if (!fatal && performance.now() >= deadline) fatal = "EXECUTION_LIMIT";
    return Boolean(fatal) || exited;
  };
  try {
    runtime.setMemoryLimit(LIMITS.heapBytes);
    runtime.setMaxStackSize(LIMITS.stackBytes);
    runtime.setInterruptHandler(interrupted);
    runtime.setModuleLoader(() => {
      fatal = "IMPORT_DENIED";
      return { error: new Error("Module loading is disabled") };
    });
    context = runtime.newContext();
    const bridge = context.newFunction("emitEncodedString", (...args) => {
      if (interrupted()) return context.undefined;
      if (args.length !== 1 || context.typeof(args[0]) !== "string") {
        fatal = "INVALID_OUTPUT";
        return context.undefined;
      }
      // The captured guest intrinsic JSON-encodes primitive strings, avoiding getString's
      // NUL truncation. Never dump a guest object, invoke a getter, or coerce toString.
      // This copy is itself bounded by the guest heap; retained output has the tighter budget below.
      const text = JSON.parse(context.getString(args[0]));
      if (typeof text !== "string") {
        fatal = "INVALID_OUTPUT";
        return context.undefined;
      }
      outputBytes += Buffer.byteLength(text);
      if (outputBytes > LIMITS.outputBytes || output.length >= (cell ? CELL_LIMITS.outputCount : LIMITS.outputCount)) {
        fatal = "OUTPUT_LIMIT";
        return context.undefined;
      }
      output.push(text);
      if (cell) {
        try { cell.output(text); } catch { fatal = "PROTOCOL_ERROR"; }
      }
      return context.undefined;
    });
    try {
      const installer = context.evalCode(`(bridge) => {
        const encode = JSON.stringify;
        Object.defineProperty(globalThis, "emit", {
          configurable: false, writable: false,
          value: (...args) => {
            if (args.length !== 1 || typeof args[0] !== "string") return bridge();
            return bridge(encode(args[0]));
          }
        });
      }`, "bootstrap.js", { type: "global" });
      try {
        if (installer.error) return fail("HOST_FAILED");
        const installed = context.callFunction(installer.value, context.undefined, bridge);
        try {
          if (installed.error) return fail("HOST_FAILED");
        } finally {
          installed.dispose();
        }
      } finally {
        installer.dispose();
      }
    } finally {
      bridge.dispose();
    }
    if (invoke) {
      // The bridge receives a JSON primitive, never a guest object. Serialization/getters
      // run INSIDE QuickJS under its interrupt/heap limits. Both ends validate admission.
      const toolBridge = context.newFunction("invokeEncodedTool", (encoded) => {
        if (interrupted()) return context.undefined;
        try {
          if (!encoded || context.typeof(encoded) !== "string") throw new Error("INVALID_TOOL_CALL");
          const json = context.getString(encoded);
          const bytes = Buffer.byteLength(json);
          if (bytes > RPC_LIMITS.argumentBytes) throw new Error("TOOL_LIMIT");
          const call = JSON.parse(json);
          if (!exact(call, ["name", "args"]) || !record(call.args)) throw new Error("INVALID_TOOL_CALL");
          if (!validToolName(call.name) || !allowedTools.includes(call.name)) throw new Error("TOOL_DENIED");
          boundedJSON(call, RPC_LIMITS.argumentBytes, "TOOL_LIMIT");
          argumentBytes += bytes;
          if (argumentBytes > RPC_LIMITS.totalArgumentBytes) throw new Error("TOOL_LIMIT");
          return defer(() => invoke(call.name, call.args));
        } catch (error) {
          fatal = ["INVALID_TOOL_CALL", "TOOL_LIMIT", "TOOL_DENIED"].includes(error?.message)
            ? error.message : "INVALID_TOOL_CALL";
          return context.undefined;
        }
      });
      const bootstrap = context.evalCode(`(bridge, namesJSON) => {
        const stringify = JSON.stringify;
        const parse = JSON.parse;
        const api = Object.create(null);
        const call = (name, args) => {
          if (typeof name !== "string" || args === null || typeof args !== "object" || Array.isArray(args)) return bridge();
          return bridge(stringify({name, args}));
        };
        if (namesJSON === null) Object.defineProperty(api, "call", {value: call});
        else for (const name of parse(namesJSON)) Object.defineProperty(api, name, {value: args => call(name, args)});
        Object.freeze(api);
        Object.defineProperty(globalThis, "tools", { value: api });
        return (json) => parse(json);
      }`, "bootstrap.js", { type: "global" });
      try {
        if (bootstrap.error) return fail("HOST_FAILED");
        const names = cell ? context.newString(JSON.stringify(allowedTools)) : context.null;
        try {
          const installed = context.callFunction(bootstrap.value, context.undefined, toolBridge, names);
          try {
            if (installed.error) return fail("HOST_FAILED");
            decode = installed.value.dup();
          } finally { installed.dispose(); }
        } finally { if (cell) names.dispose(); }
      } finally { bootstrap.dispose(); toolBridge.dispose(); }
    }
    if (cell) {
      const operation = context.newFunction("cellOperation", encoded => {
        if (interrupted()) return context.undefined;
        try {
          if (!encoded || context.typeof(encoded) !== "string") throw new Error("INVALID_TOOL_CALL");
          const json = context.getString(encoded);
          if (Buffer.byteLength(json) > RPC_LIMITS.argumentBytes) throw new Error("TOOL_LIMIT");
          const value = JSON.parse(json);
          if (!validOperation(value)) throw new Error("TOOL_LIMIT");
          if (value.kind === "sleep") return defer(() => cell.operation(value), "timer", value.timer);
          const idleStart = performance.now();
          let answer;
          try { answer = cell.syncOperation(value); }
          finally { deadline += performance.now() - idleStart; }
          if (value.kind === "cancel") {
            for (const [id, entry] of pendingTools) if (entry.kind === "timer" && entry.timer === value.timer) {
              entry.cancelled = true; entry.deferred.resolve(context.undefined); entry.deferred.dispose(); pendingTools.delete(id);
            }
          }
          return context.newString(JSON.stringify(answer));
        } catch { fatal = "TOOL_LIMIT"; return context.undefined; }
      });
      const control = context.newFunction("cellControl", action => {
        if (interrupted()) return context.undefined;
        try {
          const name = action && context.typeof(action) === "string" ? context.getString(action) : "";
          if (name === "exit") exited = true;
          else if (name === "yield") cell.yield();
          else fatal = "INVALID_TOOL_CALL";
        } catch { fatal = "TOOL_LIMIT"; }
        return context.undefined;
      });
      const bootstrap = context.evalCode(CELL_BOOTSTRAP, "cell-bootstrap.js", {type: "global"});
      const names = context.newString(JSON.stringify(allowedTools));
      try {
        if (bootstrap.error) return fail("HOST_FAILED");
        const installed = context.callFunction(bootstrap.value, context.undefined, operation, control, names);
        try { if (installed.error) return fail("HOST_FAILED"); } finally { installed.dispose(); }
      } finally { bootstrap.dispose(); names.dispose(); operation.dispose(); control.dispose(); }
    }
    phase = "compile";
    // Compile a body as an argument inside QuickJS, never splice it into a wrapper.
    // Closing delimiters in guest source must not change the outer completion value.
    const constructor = context.evalCode("(async function(){}).constructor", "bootstrap.js", { type: "global" });
    const source = context.newString(code);
    try {
      if (constructor.error) return fail(fatal ?? "EXECUTION_FAILED");
      const compiled = context.callFunction(constructor.value, context.undefined, source);
      try {
        if (compiled.error) return fail(fatal ?? "EXECUTION_FAILED");
        phase = "execute";
        evaluation = context.callFunction(compiled.value, context.undefined);
      } finally {
        compiled.dispose();
      }
    } finally {
      source.dispose();
      constructor.dispose();
    }
    if (evaluation.error) return exited && !fatal ? { version: 1, status: "ok", output } : fail(fatal ?? "EXECUTION_FAILED");
    phase = "await";
    let jobs = 0;
    while (!interrupted()) {
      // A completed root is not a durable owner for detached asynchronous actions.
      if (pendingTools.size) {
        const root = context.getPromiseState(evaluation.value);
        if (root.type !== "pending") {
          if (root.type === "rejected") root.error.dispose();
          else if (!root.notAPromise) root.value.dispose();
          if ([...pendingTools.values()].some(entry => entry.kind === "tool")) return fail("DETACHED_TOOL");
          break;
        }
      }
      for (const [id, entry] of pendingTools) {
        if (!entry.settled) continue;
        if (entry.error) return fail("GATEWAY_FAILED");
        if (typeof entry.json !== "string" || Buffer.byteLength(entry.json) > RPC_LIMITS.resultBytes) {
          return fail("TOOL_RESULT_LIMIT");
        }
        const json = context.newString(entry.json);
        const decoded = context.callFunction(decode, context.undefined, json);
        try {
          if (decoded.error) return fail(fatal ?? "EXECUTION_FAILED");
          entry.deferred.resolve(decoded.value);
        } finally { decoded.dispose(); json.dispose(); entry.deferred.dispose(); }
        pendingTools.delete(id);
      }
      if (runtime.hasPendingJob()) {
        if (++jobs > LIMITS.jobs) { fatal = "EXECUTION_LIMIT"; break; }
        const pending = runtime.executePendingJobs(1);
        try {
          if (pending.error) return exited && !fatal ? {version: 1, status: "ok", output} : fail(fatal ?? "EXECUTION_FAILED");
        } finally { pending.dispose(); }
        continue;
      }
      if (!pendingTools.size) break;
      const idleStart = performance.now();
      if (cell) {
        // Flush Node microtasks before a blocking pipe read: invokes/replies may still be queued.
        await new Promise(resolve => setImmediate(resolve));
        if (![...pendingTools.values()].some(entry => entry.settled)) cell.pump();
        await new Promise(resolve => setImmediate(resolve));
      } else await new Promise((resolve) => {
        wake = resolve;
        if ([...pendingTools.values()].some((entry) => entry.settled)) resolve();
      });
      wake = undefined;
      deadline += performance.now() - idleStart;
    }
    if (fatal) return fail(fatal);
    if (exited) return { version: 1, status: "ok", output };
    const state = context.getPromiseState(evaluation.value);
    if (state.type === "pending") return fail("PENDING_PROMISE");
    if (state.type === "rejected") {
      state.error.dispose();
      return fail("EXECUTION_FAILED");
    }
    // For non-Promises the API returns the original handle, not a fresh owned value.
    if (state.notAPromise) return fail("EXECUTION_FAILED");
    state.value.dispose();
    return { version: 1, status: "ok", output };
  } catch {
    // Never serialize guest exceptions, dependency paths, stderr, source, or host stacks.
    return fail(fatal ?? "EXECUTION_FAILED");
  } finally {
    wake = undefined;
    for (const entry of pendingTools.values()) entry.deferred.dispose();
    pendingTools.clear();
    decode?.dispose();
    evaluation?.dispose();
    context?.dispose();
    runtime.dispose();
  }
}
