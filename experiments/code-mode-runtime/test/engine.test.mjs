import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createEngine } from "../engine.mjs";
import { LIMITS } from "../protocol.mjs";

test("installed Wasm artifact matches the inspected pinned binary", async () => {
  const resolve = createRequire(new URL("../../../openai-compatibility/runtime/engine.mjs", import.meta.url)).resolve;
  const binary = await readFile(resolve("@jitl/quickjs-wasmfile-release-sync/wasm"));
  assert.equal(binary.length, 503134);
  assert.equal(createHash("sha256").update(binary).digest("hex"), "105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232");
  // This checks provenance/absence of a WASI namespace, not proof that imports are safe.
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(binary));
  assert.ok(imports.every(entry => entry.module === "a"));
  assert.equal(imports.filter(entry => entry.kind === "memory").length, 1);
});

test("actual engine loader supplies a hard 32 MiB Wasm memory maximum", async () => {
  const engine = await createEngine();
  const memory = engine.getWasmMemory();
  assert.equal(memory.buffer.byteLength, 16 * 1024 * 1024);
  memory.grow((LIMITS.wasmBytes - memory.buffer.byteLength) / 65536);
  assert.equal(memory.buffer.byteLength, LIMITS.wasmBytes);
  assert.throws(() => memory.grow(1), RangeError);
});
