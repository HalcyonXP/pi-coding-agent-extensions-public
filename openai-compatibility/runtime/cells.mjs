import { randomUUID } from "node:crypto";
import { CellEvidence } from "./evidence.mjs";
import { WindowsCellRuntime } from "./windows-host.mjs";
import { CellStore, cellTools } from "./cell-protocol.mjs";
import { execInput, validYield, validTokens, budgetOutput } from "./cell-input.mjs";
import { copyCellDiagnostics } from "./cell-diagnostics.mjs";

// owner and signal come from native session/policy composition, never model IDs.
// runtimeFactory is a trusted offline test seam; normal composition is Windows-contained only.
export class CodeCells {
  #owner; #signal; #contextSignal; #evidence; #factory; #store = new CellStore(); #cells = new Map(); #closed = false; #closing;
  constructor({owner, contextSignal, signal = contextSignal, runtimeFactory = options => new WindowsCellRuntime(options)}) {
    if (!owner || typeof owner !== "object" || !(signal instanceof AbortSignal) || !(contextSignal instanceof AbortSignal)) throw new Error("INVALID_REQUEST");
    this.#owner = owner; this.#contextSignal = contextSignal; this.#signal = AbortSignal.any([signal, contextSignal]); this.#factory = runtimeFactory;
    this.#evidence = new CellEvidence(this.#signal);
    this.#signal.addEventListener("abort", this.#revoke, {once: true});
    if (this.#signal.aborted) this.#revoke();
  }
  #revoke = () => { void this.close(); };
  #assert(owner, invocation) {
    for (const [id, cell] of this.#cells) if (cell.expires <= performance.now() && cell.scope.state === "closed") {
      cell.output = []; cell.result = undefined; this.#cells.delete(id);
    }
    if (this.#closed || this.#signal.aborted || owner !== this.#owner || invocation?.contextSignal !== this.#contextSignal || invocation?.origin !== "direct" || invocation.signal?.aborted || typeof invocation.openScope !== "function" || typeof invocation.adoptScope !== "function") throw new Error("CELL_UNAVAILABLE");
  }
  async exec({owner, invocation, code, tools, yield_time_ms, max_output_tokens}) {
    this.#assert(owner, invocation);
    const input = execInput(code, {yield_time_ms, max_output_tokens});
    code = input.code;
    if (!cellTools(tools) || this.#cells.size >= 2) throw new Error("INVALID_REQUEST");
    const scope = invocation.openScope({
      onResult: event => this.#evidence.capture(scope, event),
      resolveImageReference: ref => this.#evidence.resolveImage(ref),
    });
    const cell = {id: randomUUID(), scope, expires:performance.now()+360_000, state: "running", output: [], cursor: 0, listeners: new Set(), acknowledging: false};
    const notify = () => { for (const listener of [...cell.listeners]) listener(); };
    cell.notify = notify;
    cell.revoke = () => {
      if (cell.controlledClose) return;
      cell.output = []; cell.cursor = 0; cell.state = "draining"; notify();
      // A revoked native generation invalidates session memory, not only this worker.
      void this.close();
    };
    this.#cells.set(cell.id, cell);
    scope.signal.addEventListener("abort", cell.revoke, {once: true});
    let runtime, release, initialized;
    const ready = new Promise(resolve => { initialized = resolve; });
    try {
      release = scope.ownResource(async () => { await ready; await runtime?.close(); });
      runtime = this.#factory({store: this.#store, evidence: this.#evidence,
        output: text => { if (cell.state === "running" && !scope.signal.aborted && !this.#closed) cell.output.push(text); },
        yield: () => { if (cell.state === "running" && !scope.signal.aborted) { cell.yielded = true; notify(); } },
      });
    } catch {
      cell.state = "draining";
      initialized();
      await this.#terminate(cell);
      if (cell.state === "terminated") this.#cells.delete(cell.id);
      throw new Error("CELL_UNAVAILABLE");
    } finally { initialized(); }
    cell.work = (async () => {
      let result;
      try { result = await runtime.run(code, {gateway: scope, allowedTools: tools, signal: this.#signal}); }
      catch { result = {version: 1, status: "error", code: "HOST_FAILED"}; }
      try { await runtime.close(); release(); }
      catch { void this.#terminate(cell); notify(); return; }
      if (cell.state === "running" && !scope.signal.aborted && !this.#closed) {
        // The real worker already removes output from its done frame. Keep the
        // manager boundary free of raw output too, including trusted test factories.
        // Only the fixed diagnostic schema may accompany an error.
        const diagnostics = result.status === "error" ? copyCellDiagnostics(Object.getOwnPropertyDescriptor(result, "diagnostics")?.value) : undefined;
        cell.result = {version:result.version,status:result.status,...(result.code ? {code:result.code} : {}),...(diagnostics ? {diagnostics} : {})};
        void this.#complete(cell);
      }
      notify();
    })();
    return this.#poll(cell, invocation.signal, input.yieldMs, input.tokens);
  }
  async wait({owner, invocation, cell_id, yield_time_ms = 10_000, max_tokens = 10_000, terminate = false}) {
    this.#assert(owner, invocation);
    if (typeof cell_id !== "string" || !validYield(yield_time_ms) || !validTokens(max_tokens) || typeof terminate !== "boolean") throw new Error("INVALID_REQUEST");
    const cell = this.#cells.get(cell_id);
    if (!cell) throw new Error("CELL_UNAVAILABLE");
    // Lookup IDs are not authority. A fresh genuine handler must adopt the native capability.
    if (cell.state === "running" || cell.state === "completed") invocation.adoptScope(cell.scope);
    if (terminate) void this.#terminate(cell);
    return this.#poll(cell, invocation.signal, yield_time_ms, max_tokens);
  }
  #complete(cell) {
    if (cell.closing) return cell.closing;
    cell.controlledClose = true; cell.state = "draining";
    // Completion owns returned shell teardown even when nobody calls wait again.
    cell.closing = Promise.resolve().then(() => cell.scope.close()).then(() => { cell.state = cell.terminated ? "terminated" : "ready"; cell.notify(); }, () => { cell.state = "draining"; cell.notify(); });
    return cell.closing;
  }
  #terminate(cell) {
    cell.terminated = true; cell.output = []; cell.cursor = 0;
    if (cell.closing) {
      if (cell.scope.state === "closed") { cell.state = "terminated"; cell.notify(); }
      return cell.closing;
    }
    cell.state = "draining"; cell.output = []; cell.cursor = 0; cell.notify();
    cell.controlledClose = true;
    cell.closing = Promise.resolve().then(() => cell.scope.close()).then(() => { cell.state = "terminated"; cell.notify(); }, () => { cell.state = "draining"; cell.notify(); });
    return cell.closing;
  }
  async #poll(cell, signal, ms, tokens) {
    if (cell.polling) throw new Error("CELL_BUSY");
    cell.polling = true;
    const deadline = performance.now() + ms;
    const reconcile = () => {
      // A failed closer can later report independent, genuinely confirmed native release.
      if (cell.state === "draining" && cell.scope.state === "closed") cell.state = cell.terminated || !cell.result ? "terminated" : "ready";
    };
    const pause = () => new Promise(resolve => {
      const finish = () => { clearTimeout(timer); cell.listeners.delete(finish); resolve(); };
      const timer = setTimeout(finish, Math.max(0, deadline - performance.now())); cell.listeners.add(finish);
    });
    const abort = () => { void this.#terminate(cell); };
    signal?.addEventListener("abort", abort, {once: true});
    try {
      if (signal?.aborted) abort();
      reconcile();
      while ((cell.state === "running" || cell.state === "draining") && !cell.yielded && !signal?.aborted && !this.#closed && performance.now() < deadline) { await pause(); reconcile(); }
      cell.yielded = false;
      reconcile();
      if (this.#signal.aborted || signal?.aborted || this.#closed) return {cell_id: cell.id, status: cell.state === "terminated" ? "terminated" : "draining", output: []};
      const output = cell.state === "draining" ? [] : cell.output.slice(cell.cursor);
      if (cell.state !== "draining") cell.cursor = cell.output.length;
      if (cell.state === "ready" || cell.state === "terminated") {
        cell.scope.signal.removeEventListener("abort", cell.revoke);
        this.#cells.delete(cell.id);
        return cell.state === "ready" ? {cell_id: cell.id, status: "completed", ...budgetOutput(output, tokens), result: cell.result} : {cell_id: cell.id, status: "terminated", output: []};
      }
      return {cell_id: cell.id, status: cell.state, ...budgetOutput(output, tokens)};
    } finally { cell.polling = false; signal?.removeEventListener("abort", abort); }
  }
  close() {
    if (this.#closing) return this.#closing;
    this.#closed = true; this.#store.close(); this.#evidence.close(); this.#signal.removeEventListener("abort", this.#revoke);
    // Install the promise before revoking scopes: abort callbacks are reentrant.
    this.#closing = Promise.resolve().then(() => Promise.all([...this.#cells.values()].map(cell => this.#terminate(cell))));
    return this.#closing;
  }
}
