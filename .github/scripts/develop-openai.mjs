// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Focused development only. No builds, downloads, publication or acceptance receipt replacement.
import { spawnSync, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const extension = "openai-compatibility/test/";
const runtime = "experiments/code-mode-runtime/test/";
const tests = (...files) => ["--test", "--test-concurrency=1", ...files];
const suites = Object.freeze({
  coordinator: tests(...["coordinator-compatibility", "helper-feedback", "tool-metadata", "tool-result-projection", "image-input"].map(n => `${runtime}${n}.test.mjs`)),
  unified: tests(`${extension}unified-*.test.ts`),
  settings: tests("openai-compatibility/index.test.mjs", ...["settings-menu", "jobs-menu", "capability-preferences", "unified-preferences", "web-preferences", "capabilities"].map(n => `${extension}${n}.test.ts`)),
  "web-media": tests(...["web-search*", "verified-search", "web-preferences", "imagegen-*"].map(n => `${extension}${n}.test.ts`)),
  context: tests(`${extension}web-history.test.ts`, `${extension}web-context.test.ts`, `${runtime}notifications.test.mjs`, `${extension}helper-feedback.test.ts`, "distribution/test/helper-feedback.test.mjs"),
  "context-receipts": tests("distribution/test/native-context.test.mjs", "distribution/test/code-output.test.mjs", "distribution/test/notification-ack.test.mjs"),
  lifecycle: tests(...["cell-manager", "draining-wait", "evidence"].map(n => `${runtime}${n}.test.mjs`)),
  extension: tests("openai-compatibility/index.test.mjs", `${extension}*.test.ts`),
  runtime: tests(`${runtime}*.test.mjs`),
  distribution: tests("distribution/test/*.test.mjs"),
  types: ["openai-compatibility/node_modules/typescript/bin/tsc", "--noEmit", "-p", "openai-compatibility/tsconfig.json"],
  syntax: ["openai-compatibility/runtime/check.mjs"],
  workflow: tests(".github/test/development.test.mjs"),
  "native-wait": [".github/scripts/develop-native.mjs", "unified-wait"],
  "native-projection": [".github/scripts/develop-native.mjs", "projection"],
  "native-settings": [".github/scripts/develop-native.mjs", "settings"],
  "native-web": [".github/scripts/develop-native.mjs", "web-projection"],
  "native-web-sequence": [".github/scripts/develop-native.mjs", "web-sequence"],
  "native-web-profile": [".github/scripts/develop-native.mjs", "web-profile"],
  "native-media": [".github/scripts/develop-native.mjs", "media-input"],
  "native-media-canvas": [".github/scripts/develop-native.mjs", "media-canvas"],
  "native-generated-image": [".github/scripts/develop-native.mjs", "generated-image"],
  "native-imagegen-projection": [".github/scripts/develop-native.mjs", "imagegen-projection"],
});
export function selectSuites(names, sdkBundle) {
  if (!names.length || names.some(n => !Object.hasOwn(suites, n)) || new Set(names).size !== names.length) {
    throw new Error(`Select distinct named suites: ${Object.keys(suites).join(", ")}. Use --list for commands.`);
  }
  const native = names.some(name => name.startsWith("native-"));
  if (native !== (typeof sdkBundle === "string" && sdkBundle.length > 0)) throw Error("Native suites require --sdk-bundle <workspace-local bundle>; do not pass it for ordinary suites.");
  const bundle = native ? resolve(root, sdkBundle) : undefined;
  if (native && !bundle.startsWith(resolve(root) + sep)) throw Error("Development SDK must remain inside this worktree, not an active installation.");
  return names.map(name => ({ name, args: [...suites[name], ...(name.startsWith("native-") ? [bundle] : [])] }));
}
const write = (path, value) => writeFileSync(path, value, { flag: "wx" });
const json = (path, value) => write(path, `${JSON.stringify(value, null, 2)}\n`);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export {isolatedEnvironment} from "../../distribution/isolated-environment.mjs";
import {isolatedEnvironment} from "../../distribution/isolated-environment.mjs";

/** One attempted child, no automatic retry. Private byte logs survive success and failure. */
export function runStep(directory, args, cwd, env) {
  mkdirSync(directory);
  const started = Date.now();
  json(join(directory, "started.json"), { at: new Date(started).toISOString(), args });
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: null, timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  write(join(directory, "stdout.log"), result.stdout ?? Buffer.alloc(0));
  write(join(directory, "stderr.log"), result.stderr ?? Buffer.alloc(0));
  const receipt = { at: new Date().toISOString(), elapsedMs: Date.now() - started, passed: result.status === 0 && !result.error, status: result.status,
    signal: result.signal, error: result.error?.code, stdoutSha256: sha(result.stdout ?? Buffer.alloc(0)), stderrSha256: sha(result.stderr ?? Buffer.alloc(0)) };
  json(join(directory, "result.json"), receipt);
  return receipt;
}

export function develop(names, sdkBundle) {
  const selected = selectSuites(names, sdkBundle); // Refuse unknown input before creating outputs or executing a child.
  const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  if (resolve(process.cwd()) !== resolve(root) || resolve(git(["rev-parse", "--show-toplevel"]).trim()) !== resolve(root)) throw Error("Run from the canonical worktree root.");
  if (git(["remote", "get-url", "origin"]).trim() !== "https://github.com/HalcyonXP/pi-coding-agent-extensions-public.git") throw Error("Unexpected repository destination.");
  const branch = git(["branch", "--show-current"]).trim();
  if (!branch || ["master", "main"].includes(branch)) throw Error("Focused development requires a feature branch.");
  for (const role of ["AUTHOR", "COMMITTER"]) if (!git(["var", `GIT_${role}_IDENT`]).startsWith("Project Maintainers <maintainers@example.invalid> ")) throw Error("Unexpected maintainer identity.");
  const head = git(["rev-parse", "HEAD"]).trim();
  const attempt = join(root, ".pi", "development", `${Date.now()}-${randomUUID()}`);
  mkdirSync(attempt, { recursive: true });
  // Dirty inputs + the committed HEAD preserve development state without cloning a controller tree.
  const changedPaths = () => [...new Set(git(["ls-files", "-z", "--modified", "--others", "--exclude-standard"]).split("\0").filter(Boolean)
    .concat(git(["diff", "--cached", "--name-only", "-z"]).split("\0").filter(Boolean)))].sort();
  const paths = changedPaths();
  const inputs = [];
  for (const path of paths) {
    const source = resolve(root, path);
    if (!source.startsWith(resolve(root) + sep) || path.startsWith(".pi/")) throw Error("Unexpected source snapshot path.");
    let stat;
    try { stat = lstatSync(source); } catch (error) { if (error.code !== "ENOENT") throw error; inputs.push({ path, deleted: true }); continue; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw Error("Source snapshot requires bounded regular files.");
    const bytes = readFileSync(source), destination = join(attempt, "inputs", path);
    mkdirSync(dirname(destination), { recursive: true }); write(destination, bytes);
    inputs.push({ path, sha256: sha(bytes) });
  }
  write(join(attempt, "source.patch"), execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: root }));
  json(join(attempt, "inputs.json"), { head, branch, node: process.version, platform: process.platform, selected, inputs });
  console.log(`Focused development evidence: ${attempt}`);
  const results = [];
  for (const suite of selected) {
    const env = isolatedEnvironment(join(attempt, `${suite.name}-profile`));
    const result = runStep(join(attempt, suite.name), ["--import", "./openai-compatibility/test/offline.mjs", ...suite.args], root, env);
    results.push({ name: suite.name, ...result });
    console.log(`${suite.name}: ${result.passed ? "passed" : "FAILED; preserve evidence"}`);
    if (!result.passed) break;
  }
  const changed = head !== git(["rev-parse", "HEAD"]).trim() || branch !== git(["branch", "--show-current"]).trim()
    || JSON.stringify(paths) !== JSON.stringify(changedPaths()) || inputs.some(input => {
    try { return input.deleted || sha(readFileSync(join(root, input.path))) !== input.sha256; } catch (error) { return error.code !== "ENOENT" || !input.deleted; }
  }) || git(["diff", "HEAD", "--binary"]) !== readFileSync(join(attempt, "source.patch"), "utf8");
  const passed = results.length === selected.length && results.every(r => r.passed) && !changed;
  json(join(attempt, "result.json"), { kind: "focused-development-not-acceptance", passed, inputsChangedDuringRun: changed, results,
    credentialEnvironmentInherited: false, liveServiceChecksRequested: false, buildsOrDownloadsRequested: false, integrationOrDelivery: false });
  if (!passed) throw Error("Focused development failed or inputs changed; inspect the new attempt. No operations were retried.");
  return attempt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--list") console.log(JSON.stringify(suites, null, 2));
  else if (args[0] === "--sdk-bundle") develop(args.slice(2), args[1]);
  else develop(args);
}
