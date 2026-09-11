// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Source extension on a caller-selected existing SDK: development only, never artifact acceptance.
// Invoke through develop-openai.mjs so isolation precedes SDK import.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verifyBundle } from "../../distribution/lib.mjs";
import { acceptUnifiedWait } from "../../distribution/accept-unified-wait.mjs";
import { acceptProjectedTools } from "../../distribution/accept-projected-tools.mjs";
import { exerciseSettings } from "../../distribution/settings-scenarios.mjs";
import { exerciseWebProjection, webProjectionTransport } from "../../distribution/web-projection-scenarios.mjs";

const [suite, bundle] = process.argv.slice(2);
assert.equal(process.argv.length, 4);
assert.ok(["unified-wait", "projection", "settings", "web-projection", "web-sequence"].includes(suite));
assert.equal(process.platform, "win32"); assert.equal(process.arch, "x64");
const home = process.env.HOME, profile = process.env.PI_CODING_AGENT_DIR;
assert.ok(home && profile); assert.equal(home, process.env.USERPROFILE);
assert.equal(resolve(profile), resolve(home, "agent")); assert.equal(process.env.PI_OFFLINE, "1");
for (const key of ["OPENAI_API_KEY", "CODEX_HOME", "NODE_OPTIONS", "GH_TOKEN", "GITHUB_TOKEN"]) assert.equal(process.env[key], undefined);
let networkAttempts = 0;
const webFixture = ["web-projection", "web-sequence"].includes(suite) ? webProjectionTransport() : undefined;
globalThis.fetch = webFixture ? webFixture.fetch : async () => { networkAttempts++; throw Error("Native development forbids external transport"); };
const source = fileURLToPath(new URL("../../", import.meta.url));
const resolvedBundle = await realpath(bundle);
assert.equal(resolvedBundle, resolve(bundle), "Do not follow a substituted SDK bundle location");
assert.ok(resolvedBundle.startsWith(resolve(source) + sep));
const { manifest } = await verifyBundle(bundle);
assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const sdkManifestSha256 = sha(await readFile(join(bundle, "bundle.json")));
assert.equal(manifest.host.patchSha256, sha(await readFile(join(source, "host-patches/pi-0.85.1/parent-bound-invocation.patch"))), "Development SDK must match the current native patch");
const sdkRoot = join(bundle, "node_modules/@earendil-works/pi-coding-agent");
const pkg = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
assert.equal(pkg.name, "@earendil-works/pi-coding-agent"); assert.equal(pkg.version, "0.85.1");
assert.ok(pkg.exports["."].import.startsWith("./dist/"));
const sdk = await import(pathToFileURL(join(sdkRoot, pkg.exports["."].import)).href);
const cwd = join(home, "workspace"); await mkdir(cwd);
const failures = []; let session, receipt;
try {
  if (suite === "settings") receipt = await exerciseSettings(sdk, bundle, profile, cwd, join(source, "openai-compatibility/index.ts"));
  else {
  const settings = sdk.SettingsManager.inMemory();
  const resources = new sdk.DefaultResourceLoader({ cwd, agentDir: profile, settingsManager: settings,
    additionalExtensionPaths: [join(source, "openai-compatibility/index.ts")], noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await resources.reload(); assert.deepEqual(resources.getExtensions().errors, []);
  const runtime = await sdk.ModelRuntime.create({ authPath: join(profile, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.hasConfiguredAuth = () => true; runtime.isUsingOAuth = id => id === "openai-codex";
  runtime.getAuth = async () => ({ auth: { apiKey: "synthetic-development" } }); runtime.checkAuth = async () => true;
  ({ session } = await sdk.createAgentSession({ cwd, agentDir: profile, modelRuntime: runtime,
    model: runtime.getModel("openai", "gpt-6-astra"), settingsManager: settings,
    sessionManager: sdk.SessionManager.create(cwd, join(profile, "sessions")), resourceLoader: resources }));
  await session.bindExtensions({ uiContext: { ...session.extensionRunner.createContext().ui, notify() {} } });
  assert.equal(session.autoCompactionEnabled, true);
  await session.prompt("/openai-tools unified_exec on"); await session.prompt("/openai-tools code_mode on");
  if (webFixture) await session.prompt("/openai-tools web_search on");
  receipt = webFixture ? await exerciseWebProjection(session, runtime, session.agent.streamFunction, cwd, resources, webFixture, suite === "web-sequence" ? "sequence-only" : "full")
    : suite === "unified-wait" ? await acceptUnifiedWait(session, runtime, session.agent.streamFunction, cwd, profile)
    : await acceptProjectedTools(session, runtime, session.agent.streamFunction, cwd, resources);
  assert.equal(networkAttempts, 0); assert.equal(session.autoCompactionEnabled, true);
  }
  assert.equal(networkAttempts, 0); assert.equal(webFixture?.state.externalAttempts ?? 0, 0);
} catch (error) { failures.push(error); }
finally {
  const clean = async action => { try { await action(); } catch (error) { failures.push(error); } };
  if (session) {
    await clean(() => session.agent.abort());
    await clean(() => session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }));
    await clean(() => session.dispose());
  }
  await writeFile(join(home, "native-development.json"), JSON.stringify({ kind: "source-on-predecessor-sdk-not-artifact-acceptance",
    suite, sdkBundleSource: manifest.sourceCommit, sdkManifestSha256, networkAttempts: networkAttempts + (webFixture?.state.externalAttempts ?? 0), receipt,
    failures: failures.map(e => ({ name: e.name, message: e.message, stack: e.stack })) }, null, 2) + "\n", { flag: "wx" });
}
if (failures.length) throw new AggregateError(failures, "Native development failed; preserve the profile, no effect replay");
console.log(JSON.stringify({ kind: "source-on-predecessor-sdk-not-artifact-acceptance", suite, passed: true, networkAttempts, receipt }));
