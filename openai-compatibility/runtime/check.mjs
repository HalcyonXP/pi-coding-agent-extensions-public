// Explicit source validation, never part of a tool invocation or package lifecycle.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
if (process.argv.length !== 2) throw new Error("Runtime source check takes no arguments");
for (const file of ["host", "worker", "protocol", "engine", "evaluator", "rpc-host", "rpc-worker", "rpc-protocol", "windows-host", "native/artifact", "native/build", "cell-input", "cell-bootstrap", "tool-result-projection", "cell-protocol", "cell-worker", "cells", "sync-channel"]) {
  const result = spawnSync(process.execPath, ["--check", fileURLToPath(new URL(`${file}.mjs`, import.meta.url))], { stdio: "inherit", timeout: 30_000 });
  if (result.error || result.status !== 0) throw new Error(`Runtime syntax check failed: ${file}`);
}
