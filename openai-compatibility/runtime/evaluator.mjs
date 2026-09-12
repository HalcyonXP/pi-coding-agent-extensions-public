// One fresh Wasm module/runtime/context per request. Only JSON crosses the optional
// async tool bridge; no Pi context, host objects, callbacks or credentials enter QuickJS.
import { LIMITS, failure } from "./protocol.mjs";
import { createEngine } from "./engine.mjs";
import { RPC_LIMITS, boundedJSON, exact, record, validToolName } from "./rpc-protocol.mjs";

import { CELL_BOOTSTRAP } from "./cell-bootstrap.mjs";
import { CELL_LIMITS, validOperation } from "./cell-protocol.mjs";
import { toolMetadataJSON } from "./tool-metadata.mjs";
import { CELL_HELPER_ERRORS } from "./cell-helper-errors.mjs";
import { TOOL_RESULT_PROJECTION } from "./tool-result-projection.mjs";

// cell is a native worker composition seam, never a guest-selected runtime flag.
export async function evaluate(code, { invoke, allowedTools = [], toolMetadata, cell } = {}) {
  let phase = "initialize";
  const fail = code => cell ? {...failure(code), phase} : failure(code);
  let metadata;
  try {
    if (toolMetadata !== undefined) {
      if (!cell) return fail("INVALID_REQUEST");
      metadata = toolMetadataJSON(allowedTools, toolMetadata);
    }
  } catch { return fail("INVALID_REQUEST"); }
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
  let classifyHelper;
  function guestFailure(error) {
    if (fatal) return fail(fatal);
    if (!classifyHelper) return fail("EXECUTION_FAILED");
    // Call a closed, captured WeakMap lookup inside QuickJS. No guest property
    // inspection, object dumping, coercion, exception text or stack crosses out.
    const classified = context.callFunction(classifyHelper, context.undefined, error);
    try {
      if (fatal) return fail(fatal);
      if (!classified.error && context.typeof(classified.value) === "string") {
        const code = context.getString(classified.value);
        if (CELL_HELPER_ERRORS.includes(code)) return fail(code);
      }
      return fail("EXECUTION_FAILED");
    } finally { classified.dispose(); }
  }
  let exited = false;
  let disposed = false;
  function defer(run, kind = "tool", timer) {
    if (++toolCalls > RPC_LIMITS.calls || pendingTools.size >= RPC_LIMITS.concurrent) throw new Error("TOOL_LIMIT");
    const deferred = context.newPromise();
    const entry = { deferred, settled: false, kind, timer };
    pendingTools.set(toolCalls, entry);
    let started;
    Promise.resolve().then(() => { if (disposed || fatal || exited || entry.cancelled) throw new Error("CANCELLED"); started = performance.now(); return run(); }).then(
      value => { if (disposed || entry.cancelled) return; entry.elapsedMs = Math.max(0, Math.round(performance.now() - started)); entry.json = JSON.stringify(value); entry.settled = true; wake?.(); },
      () => { if (disposed || entry.cancelled) return; entry.error = true; entry.settled = true; wake?.(); },
    ).catch(() => { if (disposed || entry.cancelled) return; entry.error = true; entry.settled = true; wake?.(); });
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
        const api = Object.create(null), projectedApi = Object.create(null);
        const projection = ${TOOL_RESULT_PROJECTION};
        const then = Function.prototype.call.bind(Promise.prototype.then);
        const projectedCall = (name, args) => then(call(name, args), value => projection.project(name, value));
        const call = (name, args) => {
          // Named cell tools accept serialized JSON objects; parsing stays inside
          // the bounded guest. Portable tools.call and native gateway input stay objects.
          if (namesJSON !== null && typeof args === "string") {
            if (args.length > ${RPC_LIMITS.argumentBytes}) return bridge();
            try { args = parse(args); } catch { return bridge(); }
          }
          if (typeof name !== "string" || args === null || typeof args !== "object" || Array.isArray(args)) return bridge();
          return bridge(stringify({name, args}));
        };
        if (namesJSON === null) Object.defineProperty(api, "call", {value: call});
        else {
          const names = parse(namesJSON), aliases = Object.create(null);
          for (const name of names) {
            Object.defineProperty(api, name, {value: args => call(name, args)});
            Object.defineProperty(projectedApi, name, {value: args => projectedCall(name, args)});
            // Under the admitted native identifier grammar only hyphens need
            // normalization. Canonical names and metadata remain unchanged.
            const alias = name.replace(/-/g, "_");
            aliases[alias] = (aliases[alias] ?? 0) + 1;
          }
          for (const name of names) {
            const alias = name.replace(/-/g, "_");
            if (aliases[alias] === 1 && !Object.hasOwn(api, alias)) {
              Object.defineProperty(api, alias, {value: args => call(name, args)});
              Object.defineProperty(projectedApi, alias, {value: args => projectedCall(name, args)});
            }
          }
        }
        Object.freeze(api);
        Object.freeze(projectedApi);
        // Cell API migration: recognized Unified results project by default.
        // Explicit nativeTools preserves the original raw-wrapper contract;
        // projectedTools remains the identical compatibility alias, not new authority.
        Object.defineProperty(globalThis, "tools", { value: namesJSON === null ? api : projectedApi });
        if (namesJSON !== null) {
          Object.defineProperty(globalThis, "nativeTools", { value: api });
          Object.defineProperty(globalThis, "projectedTools", { value: projectedApi });
        }
        return (json, elapsedJSON) => {
          const value = parse(json);
          if (elapsedJSON !== undefined) projection.remember(value, parse(elapsedJSON));
          return value;
        };
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
      // Timer replies also need a captured decoder in cells without a tool bridge.
      if (!decode) {
        const decoder = context.evalCode("(() => { const parse = JSON.parse; return json => parse(json); })()", "cell-decoder.js", {type: "global"});
        try { if (decoder.error) return fail("HOST_FAILED"); decode = decoder.value.dup(); }
        finally { decoder.dispose(); }
      }
      const operation = context.newFunction("cellOperation", encoded => {
        if (interrupted()) return context.undefined;
        try {
          if (!encoded || context.typeof(encoded) !== "string") throw new Error("INVALID_TOOL_CALL");
          const json = context.getString(encoded);
          if (Buffer.byteLength(json) > RPC_LIMITS.argumentBytes) throw new Error("TOOL_LIMIT");
          const value = JSON.parse(json);
          if (!validOperation(value)) throw new Error("TOOL_LIMIT");
          if (value.kind === "sleep") return defer(() => cell.operation(value), "timer", value.timer);
          if (value.kind === "notify") return defer(() => cell.operation(value), "notification");
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
      const control = context.newFunction("cellControl", (action, detail) => {
        if (interrupted()) return context.undefined;
        try {
          const name = action && context.typeof(action) === "string" ? context.getString(action) : "";
          if (name === "exit") exited = true;
          else if (name === "yield") cell.yield();
          else if (name === "timerError") {
            const code = detail && context.typeof(detail) === "string" ? context.getString(detail) : "";
            fatal = CELL_HELPER_ERRORS.includes(code) ? code : "EXECUTION_FAILED";
          } else fatal = "INVALID_TOOL_CALL";
        } catch { fatal = "TOOL_LIMIT"; }
        return context.undefined;
      });
      const bootstrap = context.evalCode(CELL_BOOTSTRAP, "cell-bootstrap.js", {type: "global"});
      const names = context.newString(JSON.stringify(allowedTools));
      const metadataValue = metadata === undefined ? context.null : context.newString(metadata);
      try {
        if (bootstrap.error) return fail("HOST_FAILED");
        const installed = context.callFunction(bootstrap.value, context.undefined, operation, control, names, metadataValue);
        try {
          if (installed.error || context.typeof(installed.value) !== "function") return fail("HOST_FAILED");
          classifyHelper = installed.value.dup();
        } finally { installed.dispose(); }
      } finally { bootstrap.dispose(); names.dispose(); if (metadata !== undefined) metadataValue.dispose(); operation.dispose(); control.dispose(); }
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
    if (evaluation.error) return exited && !fatal ? { version: 1, status: "ok", output } : guestFailure(evaluation.error);
    phase = "await";
    let jobs = 0;
    while (!interrupted()) {
      // A completed root is not a durable owner for detached asynchronous actions.
      if (pendingTools.size) {
        const root = context.getPromiseState(evaluation.value);
        if (root.type !== "pending") {
          if (root.type === "rejected") root.error.dispose();
          else if (!root.notAPromise) root.value.dispose();
          if ([...pendingTools.values()].some(entry => entry.kind !== "timer")) return fail("DETACHED_TOOL");
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
        // Private monotonic bridge timing is separate from the unchanged native
        // result JSON/RPC budget. Guest clocks and result metadata cannot supply it.
        const elapsed = cell && entry.kind === "tool" ? context.newString(JSON.stringify(entry.elapsedMs)) : undefined;
        const decoded = context.callFunction(decode, context.undefined, json, elapsed ?? context.undefined);
        try {
          if (decoded.error) return fail(fatal ?? "EXECUTION_FAILED");
          entry.deferred.resolve(decoded.value);
        } finally { decoded.dispose(); json.dispose(); elapsed?.dispose(); entry.deferred.dispose(); }
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
      try { return guestFailure(state.error); }
      finally { state.error.dispose(); }
    }
    // For non-Promises the API returns the original handle, not a fresh owned value.
    if (state.notAPromise) return fail("EXECUTION_FAILED");
    state.value.dispose();
    return { version: 1, status: "ok", output };
  } catch {
    // Never serialize guest exceptions, dependency paths, stderr, source, or host stacks.
    return fail(fatal ?? "EXECUTION_FAILED");
  } finally {
    // Queued host microtasks must not admit work or touch late results after the
    // isolate ends. Native scopes still own teardown of work already delegated.
    disposed = true;
    wake = undefined;
    for (const entry of pendingTools.values()) entry.deferred.dispose();
    pendingTools.clear();
    decode?.dispose();
    classifyHelper?.dispose();
    evaluation?.dispose();
    context?.dispose();
    runtime.dispose();
  }
}
