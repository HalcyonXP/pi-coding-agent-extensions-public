import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const packageRoot = new URL("../../../openai-compatibility/", import.meta.url);
test("historical experiment imports are the exact cohesive implementation bindings", async () => {
  for (const file of ["host", "protocol", "engine", "evaluator", "rpc-host", "rpc-protocol", "windows-host", "native/artifact"]) {
    const legacy = await import(`../${file}.mjs`);
    const canonical = await import(new URL(`runtime/${file}.mjs`, packageRoot));
    assert.deepEqual(Object.keys(legacy), Object.keys(canonical));
    for (const name of Object.keys(canonical)) assert.equal(legacy[name], canonical[name], `${file}/${name}`);
  }
});
test("the cohesive lock alone owns exact engine dependencies and no automatic native build", async () => {
  const pkg = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
  const lock = JSON.parse(await readFile(new URL("package-lock.json", packageRoot), "utf8"));
  const fixture = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pkg.dependencies, { "@jitl/quickjs-wasmfile-release-sync": "0.32.0", "quickjs-emscripten-core": "0.32.0" });
  for (const name of ["@jitl/quickjs-wasmfile-release-sync", "quickjs-emscripten-core", "@jitl/quickjs-ffi-types"]) {
    assert.equal(lock.packages[`node_modules/${name}`].version, "0.32.0");
    assert.match(lock.packages[`node_modules/${name}`].integrity, /^sha512-/);
  }
  assert.deepEqual(fixture.dependencies ?? {}, {});
  for (const script of ["preinstall", "install", "postinstall", "prepare", "prepack"]) assert.equal(pkg.scripts[script], undefined);
  assert.equal(pkg.scripts["build:runtime"], "node runtime/native/build.mjs");
});
test("source-package inspection includes runtime/notices but never local binaries or manifests", async () => {
  const parent = fileURLToPath(new URL(".pi/", packageRoot)); await mkdir(parent, { recursive: true });
  const fixture = await mkdtemp(join(parent, "source-pack-exclusion-"));
  await writeFile(join(fixture, "local-evidence.json"), '{"syntheticLocalEvidence":true}', {flag:"wx"});
  let passed = false;
  try {
  // A fixed command with no interpolated data. No installation, network or publication.
  const output = execSync("npm pack --dry-run --json --offline --ignore-scripts", {
    cwd: fileURLToPath(packageRoot), encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  });
  const [pack] = JSON.parse(output);
  const paths = new Set(pack.files.map(file => file.path));
  for (const file of ["index.ts", "imagegen/core.ts", "runtime/engine.mjs", "runtime/native/WindowsRuntime.cs", "runtime/native/build.mjs", "runtime/LICENSE.quickjs"]) assert.ok(paths.has(file), `Missing ${file}`);
  for (const file of paths) assert.ok(!/^(?:runtime\/native\/bin|node_modules|\.pi)\/|\.(?:exe|pdb|tgz|log)$/i.test(file), `Unexpected artifact ${file}`);
  passed = true;
  } finally { if (passed) await rm(fixture, {recursive:true}); } // retain failed fixtures, not package them
});
