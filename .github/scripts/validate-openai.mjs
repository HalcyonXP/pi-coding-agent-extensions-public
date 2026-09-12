import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && args[0] !== "--host")) throw new Error("Only --host is supported");
const results = [];
function run(name, cwd, argv, env = {}) {
  const started = Date.now();
  console.log(`\n== ${name} ==`);
  const result = spawnSync(process.execPath, argv, { cwd, stdio: "inherit", env: { ...process.env, ...env }, timeout: 180_000 });
  results.push({ name, passed: result.status === 0 && !result.error, elapsedMs: Date.now() - started });
  mkdirSync(join(root, ".pi", "maintenance"), { recursive: true });
  writeFileSync(join(root, ".pi", "maintenance", "offline-validation.json"), JSON.stringify({ node: process.version, platform: process.platform, results }, null, 2));
  if (result.error || result.status !== 0) throw new Error(`${name} failed; later suites were not run`, { cause: result.error });
}
run("Repository privacy and SDK provenance", root, ["--test", ".github/test/*.test.mjs"]);
run("Private artifact primitives (offline)", root, ["--test", "distribution/test/*.test.mjs"]);
run("Existing repository regressions", root, ["--test", "context-usage-injection/index.test.mjs", "extension-manager/core.test.mjs", "model-constraints/index.test.mjs", "todays-date/index.test.mjs", "tokens-per-second/core.test.mjs", "tokens-per-second/index.test.mjs", "tokens-per-second/reasoning-rates.test.mjs"]);
// Windows Unified exec also loads its independently scoped Job Object type from
// this prebuilt assembly. Build explicitly before shell tests, never on invocation.
if (process.platform === "win32" && process.arch === "x64") run("Offline native helper build/verification", root, ["openai-compatibility/runtime/native/build.mjs"]);
run("Cohesive extension (network guarded)", join(root, "openai-compatibility"), ["--import", "./test/offline.mjs", "--test", "index.test.mjs", "test/*.test.ts"]);
run("Native/extension CLI catalog equality (isolated, network guarded)", root, [".github/scripts/check-catalog.mjs"]);
run("Strict extension typecheck", join(root, "openai-compatibility"), ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"]);
// File-level isolation prevents independent OS/CPU/memory stress fixtures from
// competing for one another's fixed wall watchdogs. In-file concurrency tests remain.
run("Restricted runtime", join(root, "experiments", "code-mode-runtime"), ["--test", "--test-concurrency=1", "test/*.test.mjs"]);
run("Canonical runtime syntax", join(root, "openai-compatibility", "runtime"), ["check.mjs"]);
if (args.includes("--host")) {
  // An existing provenance-checked fixture is required. Never clone over or repatch user work.
  run("Actual engine / Pi gateway integration", root, [".github/scripts/test-code-mode-rpc.mjs", "--rpc"]);
  const host = join(root, ".pi", "host-rpc-checkout");
  const vitest = join(host, "node_modules", "vitest", "dist", "cli.js");
  run("Native serialized request regressions", join(host, "packages", "ai"), [vitest, "--run", "test/serialized-request.test.ts", "test/openai-codex-stream.test.ts"], { PI_OFFLINE: "1" });
  run("Real agent regressions", join(host, "packages", "agent"), [vitest, "--run", "test/tool-scopes.test.ts", "test/tool-invocation.test.ts", "test/agent-loop.test.ts", "test/agent.test.ts", "test/notification-scopes.test.ts", "test/tool-context.test.ts", "test/tool-context-loop.test.ts"], { PI_OFFLINE: "1" });
  run("Real session regressions", join(host, "packages", "coding-agent"), [vitest, "--run", "test/suite/tool-invocation.test.ts", "test/tool-result-images.test.ts", "test/suite/agent-session-model-extension.test.ts", "test/suite/tool-notifications.test.ts", "test/suite/tool-context.test.ts"], { PI_OFFLINE: "1" });
}
console.log("\nAll selected offline checks passed. This does not run live probes, migration, production packaging or the unrestricted upstream provider suite.");
