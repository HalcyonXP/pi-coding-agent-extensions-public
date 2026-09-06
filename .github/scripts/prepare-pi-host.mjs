import assert from "node:assert/strict";
import {verifyHostArtifacts} from "./pi-host-provenance.mjs";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// CI-only source materialization. Never install, overwrite an existing checkout, or patch node_modules.
const root = fileURLToPath(new URL("../../", import.meta.url));
const {provenance,patch,aiPackage}=verifyHostArtifacts();
const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === "--rpc"), "Only the optional --rpc isolated destination is supported");
const target = join(root, ".pi", args.length ? "host-rpc-checkout" : "host-gateway-checkout");
assert.equal(existsSync(target), false, "Refusing to reuse or overwrite an existing host checkout");
// D25/#40: selected source and catalog are both 0.85.1; historical pins remain frozen.

function git(args, cwd = root, capture = false) {
  const result = spawnSync("git", args, { cwd, stdio: capture ? "pipe" : "inherit", encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `git ${args[0]} failed: ${result.stderr ?? "see output"}`);
  return result.stdout?.trim();
}
mkdirSync(dirname(target), { recursive: true });
git(["-c", "core.autocrlf=false", "clone", "--filter=blob:none", "--no-checkout", "--depth", "1", "--branch", provenance.tag, provenance.repository, target]);
assert.equal(git(["rev-parse", "HEAD"], target, true), provenance.commit, "Upstream tag changed; review required");
git(["config", "--local", "core.autocrlf", "false"], target);
git(["checkout", "--detach", provenance.commit], target);
git(["apply", "--check", "--whitespace=error", patch], target);
git(["apply", "--whitespace=error", patch], target);
// Reuse the immutable npm release catalog, not live model metadata. Upstream check:model-data validates it.
cpSync(join(aiPackage, "dist", "providers", "data"), join(target, "packages", "ai", "src", "providers", "data"), { recursive: true });
console.log(`Prepared isolated Pi ${provenance.commit} with patch ${provenance.patchSha256}`);
