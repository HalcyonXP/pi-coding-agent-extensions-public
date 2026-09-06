import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Exercise the same locked, unmodified SDK as index.test.mjs. No global install,
// inherited provider credentials, project discovery, catalog network or model turn.
const root = fileURLToPath(new URL("../../", import.meta.url));
const sdk = join(root, "openai-compatibility", "node_modules", "@earendil-works", "pi-coding-agent");
assert.equal(JSON.parse(readFileSync(join(sdk, "package.json"), "utf8")).version, "0.85.1");
const directory = mkdtempSync(join(tmpdir(), "pi-native-catalog-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ["path", "systemroot", "windir", "comspec", "pathext", "temp", "tmp"].includes(key.toLowerCase())));
Object.assign(env, {
  HOME: directory, USERPROFILE: directory, PI_CODING_AGENT_DIR: join(directory, "agent"),
  PI_OFFLINE: "1", OPENAI_API_KEY: "ci-catalog-validation-only",
});
function catalog(extension) {
  const result = spawnSync(process.execPath, [
    "--import", pathToFileURL(join(root, "openai-compatibility", "test", "offline.mjs")).href,
    join(sdk, "dist", "bundle", "cli.js"), "--no-extensions",
    ...(extension ? ["-e", join(root, "openai-compatibility", "index.ts")] : []),
    "--list-models", "openai",
  ], { cwd: directory, env, encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, "Isolated catalog CLI failed");
  assert.equal(result.stderr.trim(), "", "Catalog loading must not hide extension warnings/errors");
  return result.stdout.replace(/\r\n/g, "\n");
}
try {
  const native = catalog(false);
  assert.match(native, /^openai\s+gpt-6-astra\s/m);
  assert.match(native, /^openai\s+gpt-5\.6-sol\s/m);
  assert.equal(catalog(true), native, "The cohesive extension must leave the native catalog unchanged");
  console.log("Pi 0.85.1 native and extension CLI catalogs match; no model request or global SDK install.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
