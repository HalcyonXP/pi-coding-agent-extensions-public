import { spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validCode, failure } from "./protocol.mjs";
import { validTools } from "./rpc-protocol.mjs";
import { verifiedExecutable } from "./native/artifact.mjs";
import { cellStartFrame } from "./tool-metadata.mjs";

export const WINDOWS_LIMITS = Object.freeze({
	processBytes: 256 * 1024 * 1024,
	jobBytes: 384 * 1024 * 1024,
	cpuSeconds: 10,
	processes: 2,
	concurrent: 2,
	startupMs: 10_000,
});
const active = new Set();
const unavailable = () =>
	new Error(
		"Windows runtime containment unavailable; no unrestricted fallback.",
	);
export function windowsContainmentSupported() {
	return process.platform === "win32" && process.arch === "x64";
}
export function containmentEnvironment() {
	return {
		SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
		TEMP: tmpdir(),
		TMP: tmpdir(),
	};
}
async function parentCreation(helper, signal) {
	// The parent must still be alive to receive this response. The later helper checks
	// the exact FILETIME on an opened process handle, preventing PID-reuse adoption.
	return new Promise((resolve, reject) => {
		const child = spawn(
			helper,
			["--parent-creation", String(process.pid)],
			{
				env: containmentEnvironment(),
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let output = "",
			stopped = false;
		const stop = () => {
			stopped = true;
			child.kill("SIGKILL");
		};
		const timer = setTimeout(stop, WINDOWS_LIMITS.startupMs);
		child.stdout.on("data", (chunk) => {
			if (stopped) return;
			output += chunk.toString("utf8");
			if (output.length > 4096) stop();
		});
		child.stderr.resume();
		child.on("error", stop);
		signal?.addEventListener("abort", stop, { once: true });
		if (signal?.aborted) stop();
		child.once("close", (code) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", stop);
			const value = output.trim();
			if (stopped || code !== 0 || !/^\d{17,19}$/.test(value))
				reject(unavailable());
			else resolve(value);
		});
	});
}

/** Trusted development launcher, NOT a tool or a guest-selected entry point.
 * Prepare before the existing five-second probe watchdog; launch consumes the
 * one-byte gate exactly once. Caller MUST close the lease even if run rejects.
 * Windows-only: other platforms fail closed instead of using a plain child.
 */
export async function prepareWindowsWorker(entry, { signal } = {}) {
	if (
		!windowsContainmentSupported() ||
		signal?.aborted ||
		active.size >= WINDOWS_LIMITS.concurrent
	)
		throw unavailable();
	const slot = {};
	active.add(slot);
	let child;
	let closed;
	try {
		const helper = await verifiedExecutable();
		const worker = await realpath(entry);
		signal?.throwIfAborted();
		const creation = await parentCreation(helper, signal);
		signal?.throwIfAborted();
		child = spawn(
			helper,
			[String(process.pid), creation, process.execPath, worker],
			{
				env: containmentEnvironment(),
				cwd: fileURLToPath(new URL("./", import.meta.url)),
				windowsHide: true,
				stdio: "pipe",
			},
		);
		closed = new Promise((resolve) =>
			child.once("close", (...args) => {
				active.delete(slot);
				resolve(args);
			}),
		);
		child.on("error", () => {});
		child.stdin.on("error", () => {});
		await new Promise((resolve, reject) => {
			let pending = "";
			const fail = () => {
				cleanup();
				reject(unavailable());
			};
			const timer = setTimeout(fail, WINDOWS_LIMITS.startupMs);
			const data = (chunk) => {
				pending += chunk.toString("utf8");
				if (pending.length > 4096) return fail();
				if (!pending.includes("\n")) return;
				if (pending.trim() !== "PI_RUNTIME_READY_V1") return fail();
				cleanup();
				child.stderr.pause();
				resolve();
			};
			const cleanup = () => {
				clearTimeout(timer);
				signal?.removeEventListener("abort", fail);
				child.stderr.off("data", data);
				child.off("close", fail);
				child.off("error", fail);
			};
			child.stderr.on("data", data);
			child.once("close", fail);
			child.once("error", fail);
			signal?.addEventListener("abort", fail, { once: true });
			if (signal?.aborted) fail();
		});
		let used = false;
		let released = false;
		return {
			child,
			launch() {
				if (
					used ||
					released ||
					signal?.aborted ||
					child.exitCode !== null ||
					child.signalCode !== null
				)
					throw unavailable();
				used = true;
				child.stdin.write(Buffer.from([1]));
				return child;
			},
			async close() {
				released = true;
				if (child.exitCode === null && child.signalCode === null)
					child.kill("SIGKILL");
				await closed;
			},
		};
	} catch {
		if (child) {
			child.kill("SIGKILL");
			await closed;
		} else active.delete(slot);
		throw unavailable();
	}
}

// Actual RPC implementation is reused, not a copied dispatcher. This wrapper owns
// bootstrap cancellation/drain and hands a one-shot prepared process to the probe.
export class WindowsAsyncRuntimeProbe {
	#cell;
	constructor(cell) { this.#cell = cell; }
	#closed = false;
	#tasks = new Set();
	get activeCount() {
		return this.#tasks.size;
	}
	run(code, options = {}) {
		if (this.#closed) return Promise.resolve(failure("CLOSED"));
		if (!validCode(code) || !(this.#cell ? cellTools(options.allowedTools) : validTools(options.allowedTools)))
			return Promise.resolve(failure("INVALID_REQUEST"));
		if (
			!options.gateway ||
			typeof options.gateway.invoke !== "function" ||
			!(options.gateway.signal instanceof AbortSignal)
		)
			return Promise.resolve(failure("GATEWAY_UNAVAILABLE"));
		if (this.#tasks.size >= WINDOWS_LIMITS.concurrent)
			return Promise.resolve(failure("BUSY"));
		try {
			if (!this.#cell && options.toolMetadata !== undefined) return Promise.resolve(failure("INVALID_REQUEST"));
			if (this.#cell) {
				const start = cellStartFrame(code, options.allowedTools, options.toolMetadata);
				options = {...options, allowedTools: start.tools, toolMetadata: start.toolMetadata};
			}
		} catch { return Promise.resolve(failure("INVALID_REQUEST")); }
		const controller = new AbortController();
		const signals = [
			controller.signal,
			options.signal,
			options.gateway?.signal,
		].filter((value) => value instanceof AbortSignal);
		const signal = AbortSignal.any(signals);
		const task = { controller, promise: undefined };
		const work = async () => {
			let lease, probe;
			try {
				const { AsyncRuntimeProbe, CellRuntime } = await import("./rpc-host.mjs");
				lease = await prepareWindowsWorker(
					fileURLToPath(new URL(this.#cell ? "./cell-worker.mjs" : "./rpc-worker.mjs", import.meta.url)),
					{ signal },
				);
				probe = this.#cell ? new CellRuntime({...this.#cell, launch: () => lease.launch()}) : new AsyncRuntimeProbe({ launch: () => lease.launch() });
				return await probe.run(code, { ...options, signal });
			} catch {
				return {
					version: 1,
					status: "error",
					code: signal.aborted ? "CANCELLED" : "HOST_FAILED",
				};
			} finally {
				try {
					await probe?.close();
				} finally {
					await lease?.close();
				}
			}
		};
		this.#tasks.add(task);
		task.promise = work().finally(() => this.#tasks.delete(task));
		return task.promise;
	}
	async close() {
		this.#closed = true;
		const tasks = [...this.#tasks];
		for (const task of tasks) task.controller.abort();
		await Promise.all(tasks.map((task) => task.promise));
	}
}

export class WindowsCellRuntime extends WindowsAsyncRuntimeProbe {
  constructor(options) {
    if (process.platform !== "win32" || process.arch !== "x64" || ![24,25].includes(Number(process.versions.node.split(".")[0])) || !(options?.store instanceof CellStore) || typeof options.output !== "function" || typeof options.yield !== "function") throw new Error("CELL_UNAVAILABLE");
    super(options);
  }
}
import { cellTools, CellStore } from "./cell-protocol.mjs";
