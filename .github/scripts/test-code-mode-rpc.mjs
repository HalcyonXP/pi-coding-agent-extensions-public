import assert from "node:assert/strict";
import {verifyHostArtifacts} from "./pi-host-provenance.mjs";
import { spawnSync } from "node:child_process";
import { copyFileSync, constants, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Offline-only test materialization. No installed Pi changes; no production loader imports.
const root = fileURLToPath(new URL("../../", import.meta.url));
const {provenance,patch}=verifyHostArtifacts();
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--rpc"), "Only --rpc is supported");
const host = join(root, ".pi", args.length ? "host-rpc-checkout" : "host-gateway-checkout");
const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: host, encoding: "utf8" });
assert.equal(head.status, 0);
assert.equal(head.stdout.trim(), provenance.commit);
const check = spawnSync("git", ["apply", "--reverse", "--check", patch], { cwd: host, stdio: "inherit" });
assert.equal(check.status, 0, "Expected private gateway patch must already be applied");
const source = join(root, "experiments", "code-mode-runtime", "integration", "pi-rpc.test.ts");
const target = join(host, "packages", "coding-agent", "test", "suite", "code-mode-rpc.test.ts");
// Git autocrlf and upstream formatting may differ only in line endings. Preserve
// the existing file, and still reject every other source change before execution.
if (existsSync(target)) assert.equal(readFileSync(target, "utf8").replace(/\r\n/g, "\n"), readFileSync(source, "utf8").replace(/\r\n/g, "\n"), "Refusing to overwrite a changed test");
else copyFileSync(source, target, constants.COPYFILE_EXCL);
const result = spawnSync(process.execPath, [join(host, "node_modules", "vitest", "dist", "cli.js"), "--run", "test/suite/code-mode-rpc.test.ts"], {
  cwd: join(host, "packages", "coding-agent"), stdio: "inherit",
  env: { ...process.env, PI_OFFLINE: "1", PI_CODE_MODE_RPC_MODULE: pathToFileURL(join(root, "openai-compatibility", "runtime", "rpc-host.mjs")).href,
    PI_CODE_MODE_ENTRY_MODULE: pathToFileURL(join(root, "openai-compatibility", "index.ts")).href,
    PI_CODE_MODE_CAPABILITIES_MODULE: pathToFileURL(join(root, "openai-compatibility", "capabilities.ts")).href,
    PI_CODE_MODE_CELLS_MODULE: pathToFileURL(join(root, "openai-compatibility", "runtime", "cells.mjs")).href,
    PI_CODE_MODE_WINDOWS_MODULE: pathToFileURL(join(root, "openai-compatibility", "runtime", "windows-host.mjs")).href },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
