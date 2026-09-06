import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LIMITS, failure, parseResponse, validCode } from "./protocol.mjs";

export function workerEnvironment() {
  // No PATH, HOME, USERPROFILE, NODE_OPTIONS, API keys, or inherited debug/preload flags.
  return process.platform === "win32" && process.env.SystemRoot
    ? { SystemRoot: process.env.SystemRoot } : {};
}

function launchWorker() {
  return spawn(process.execPath, [
    "--max-old-space-size=96", fileURLToPath(new URL("./worker.mjs", import.meta.url)),
  ], {
    cwd: fileURLToPath(new URL("./", import.meta.url)),
    env: workerEnvironment(),
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// Offline host API, not a Pi tool. The optional launch seam is trusted test infrastructure;
// it must never be supplied by a guest, model argument, environment variable, or RPC field.
export class RuntimeProbe {
  #launch;
  #running = new Set();
  #closed = false;

  constructor({ launch = launchWorker } = {}) {
    this.#launch = launch;
  }

  get activeCount() { return this.#running.size; }

  async run(code, { signal } = {}) {
    if (this.#closed) return failure("CLOSED");
    if (!validCode(code)) return failure("INVALID_REQUEST");
    if (signal?.aborted) return failure("CANCELLED");
    if (this.#running.size >= LIMITS.concurrent) return failure("BUSY");
    let child;
    try {
      child = this.#launch();
    } catch {
      return failure("HOST_FAILED");
    }
    let finish;
    const promise = new Promise((resolve) => { finish = resolve; });
    let stopped;
    let bytes = 0;
    const chunks = [];
    const stop = (code) => {
      if (stopped) return;
      stopped = code;
      chunks.length = 0;
      // No guest subprocess API exists. This kills only our owned worker, not arbitrary PIDs.
      child.kill("SIGKILL");
    };
    const entry = { stop, promise };
    this.#running.add(entry);
    const abort = () => stop("CANCELLED");
    const timer = setTimeout(() => stop("WALL_LIMIT"), LIMITS.wallMs);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (stopped) return;
      bytes += chunk.length;
      if (bytes > LIMITS.responseBytes) return stop("PROTOCOL_ERROR");
      chunks.push(chunk);
    });
    // No stderr content is retained or returned; still drain it to prevent pipe deadlock.
    child.stderr.resume();
    child.on("error", () => stop("HOST_FAILED"));
    child.stdin.on("error", () => stop("HOST_FAILED"));
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.#running.delete(entry);
      finish(stopped ? failure(stopped) : exitCode !== 0 ? failure("HOST_FAILED")
        : parseResponse(Buffer.concat(chunks, bytes)));
    });
    // Recheck after listener installation, before handing source to the worker.
    if (signal?.aborted) abort();
    if (!stopped) child.stdin.end(JSON.stringify({ version: 1, code }));
    else child.stdin.destroy();
    // Resolve only on process close. Never report cleanup complete while the child is alive.
    return promise;
  }

  async close() {
    this.#closed = true;
    const entries = [...this.#running];
    for (const entry of entries) entry.stop("CANCELLED");
    await Promise.all(entries.map((entry) => entry.promise));
  }
}
