// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectSuites, isolatedEnvironment, runStep } from "../scripts/develop-openai.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-focused-test-"));
  // A failed assertion preserves the owned directory rather than hiding the failure with cleanup.
  t.after(() => { if (t.passed) rmSync(dir, { recursive: true }); });
  return dir;
}
test("suite selection is explicit, bounded and does not accept arbitrary commands", () => {
  for (const names of [[], ["--host"], ["../script.mjs"], ["__proto__"], ["coordinator", "coordinator"], ["--list", "types"]]) assert.throws(() => selectSuites(names), /distinct named suites/);
  const selected = selectSuites(["coordinator", "unified", "types"]);
  assert.deepEqual(selected.map(s => s.name), ["coordinator", "unified", "types"]);
  selected[0].args.push("unexpected");
  assert.ok(!selectSuites(["coordinator"])[0].args.includes("unexpected"));
});
test("native development requires an explicit workspace SDK and cannot select an active external installation", () => {
  assert.throws(() => selectSuites(["native-wait"]), /require --sdk-bundle/);
  assert.throws(() => selectSuites(["types"], ".pi/example-bundle"), /require --sdk-bundle/);
  assert.throws(() => selectSuites(["native-projection"], "../external-bundle"), /inside this worktree/);
  const selected = selectSuites(["native-projection", "native-wait"], ".pi/example-bundle");
  assert.deepEqual(selected.map(s => s.args.slice(0, 2)), [[".github/scripts/develop-native.mjs", "projection"], [".github/scripts/develop-native.mjs", "unified-wait"]]);
  assert.equal(selected[0].args[2], resolve(root, ".pi/example-bundle"));
});
test("runtime and extension test suites serialize file-level adversarial tests", () => {
  for (const suite of selectSuites(["coordinator", "unified", "settings", "web-media", "lifecycle", "extension", "runtime", "distribution", "workflow"])) {
    assert.deepEqual(suite.args.slice(0, 2), ["--test", "--test-concurrency=1"]);
    assert.ok(suite.args.slice(2).every(p => /\.test\.(?:mjs|ts)$/.test(p)));
    for (const path of suite.args.slice(2).filter(p => !p.includes("*"))) assert.ok(existsSync(join(root, path)), path);
  }
  assert.deepEqual(selectSuites(["types"])[0].args.slice(-2), ["-p", "openai-compatibility/tsconfig.json"]);
});
test("environment isolation is established before any child import and refuses profile reuse", t => {
  const dir = fixture(t), home = join(dir, "profile");
  const env = isolatedEnvironment(home, { PATH: "synthetic-path", NODE_OPTIONS: "--unexpected", OPENAI_API_KEY: "synthetic", GH_TOKEN: "synthetic", HTTP_PROXY: "synthetic", HOME: "unused", PI_CODING_AGENT_DIR: "unused", GIT_CONFIG_COUNT: "1", npm_config_registry: "unused" });
  assert.equal(env.PATH, "synthetic-path");
  for (const key of ["NODE_OPTIONS", "OPENAI_API_KEY", "GH_TOKEN", "HTTP_PROXY", "GIT_CONFIG_COUNT", "npm_config_registry"]) assert.ok(!Object.hasOwn(env, key));
  assert.equal(env.HOME, home); assert.equal(env.USERPROFILE, home);
  for (const key of ["APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "PI_CODING_AGENT_DIR"]) assert.ok(env[key].startsWith(home));
  for (const key of ["GIT_CONFIG_GLOBAL", "npm_config_userconfig", "npm_config_globalconfig"]) assert.equal(readFileSync(env[key], "utf8"), "");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1"); assert.equal(env.PI_OFFLINE, "1"); assert.equal(env.PI_TELEMETRY, "0");
  assert.throws(() => isolatedEnvironment(home), { code: "EEXIST" });
});
test("child receives only the isolated environment and retains raw output bytes", t => {
  const dir = fixture(t), env = isolatedEnvironment(join(dir, "profile"));
  const code = 'const a=require("node:assert/strict");a.equal(require("node:os").homedir(),process.env.HOME);a.ok(!process.env.NODE_OPTIONS);a.ok(!process.env.OPENAI_API_KEY);process.stdout.write(Buffer.from([0,255,195,169,13,10]));process.stderr.write("synthetic diagnostic");';
  const out = join(dir, "success"), result = runStep(out, ["-e", code], root, env);
  assert.equal(result.passed, true); assert.equal(result.status, 0);
  assert.deepEqual(readFileSync(join(out, "stdout.log")), Buffer.from([0, 255, 195, 169, 13, 10]));
  assert.equal(readFileSync(join(out, "stderr.log"), "utf8"), "synthetic diagnostic");
  assert.match(result.stdoutSha256, /^[a-f0-9]{64}$/); assert.ok(result.elapsedMs >= 0);
  const before = readFileSync(join(out, "result.json"));
  assert.throws(() => runStep(out, ["-e", 'throw Error("must not run")'], root, env), { code: "EEXIST" });
  assert.deepEqual(readFileSync(join(out, "result.json")), before);
});
test("failed children retain diagnostics and do not become passing or replayable attempts", t => {
  const dir = fixture(t), env = isolatedEnvironment(join(dir, "profile")), out = join(dir, "failure");
  const result = runStep(out, ["-e", 'process.stdout.write("before failure");process.stderr.write("expected failure");process.exitCode=7;'], root, env);
  assert.equal(result.passed, false); assert.equal(result.status, 7);
  assert.equal(readFileSync(join(out, "stdout.log"), "utf8"), "before failure");
  assert.equal(readFileSync(join(out, "stderr.log"), "utf8"), "expected failure");
  assert.equal(JSON.parse(readFileSync(join(out, "result.json"))).passed, false);
});
test("missing child working directory is recorded as launch failure, not success", t => {
  const dir = fixture(t), env = isolatedEnvironment(join(dir, "profile")), out = join(dir, "missing-cwd");
  const result = runStep(out, ["-e", ""], resolve(dir, "does-not-exist"), env);
  assert.equal(result.passed, false); assert.equal(result.error, "ENOENT");
  assert.equal(readFileSync(join(out, "stdout.log")).length, 0);
});

test("Web native development separates full and incremental URL-sequence coverage under the same SDK isolation", () => {
 const selected=selectSuites(["native-web", "native-web-sequence"], ".pi/example-bundle");
 assert.deepEqual(selected.map(s=>s.args.slice(0,2)), [[".github/scripts/develop-native.mjs","web-projection"],[".github/scripts/develop-native.mjs","web-sequence"]]);
 for(const s of selected)assert.equal(s.args[2],resolve(root,".pi/example-bundle"));
 assert.throws(()=>selectSuites(["native-web"]),/require --sdk-bundle/);
});
