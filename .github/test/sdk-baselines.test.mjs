import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {verifyHostArtifacts} from "../scripts/pi-host-provenance.mjs";

const root = new URL("../../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

test("normal SDK/model packages are locked to the upstream-native release", () => {
  const pkg = readJson("openai-compatibility/package.json");
  const lock = readJson("openai-compatibility/package-lock.json");
  for (const name of ["pi-coding-agent", "pi-ai", "pi-tui"]) {
    const dependency = `@earendil-works/${name}`;
    assert.equal(pkg.devDependencies[dependency], "0.85.1");
    assert.equal(lock.packages[`node_modules/${dependency}`].version, "0.85.1");
    assert.equal(readJson(`openai-compatibility/node_modules/${dependency}/package.json`).version, "0.85.1");
  }
});

test("historical gateway catalog remains an explicit dev-only alias, never the production SDK", () => {
  const pkg = readJson("openai-compatibility/package.json");
  const provenance = readJson("host-patches/pi-0.85.0/provenance.json");
  const alias = "pi-host-model-baseline";
  assert.equal(pkg.devDependencies[alias], `npm:@earendil-works/pi-ai@${provenance.npmVersion}`);
  assert.equal(pkg.dependencies[alias], undefined);
  const release = readJson(`openai-compatibility/node_modules/${alias}/package.json`);
  assert.equal(release.name, "@earendil-works/pi-ai");
  assert.equal(release.version, provenance.npmVersion);
  assert.notEqual(release.version, pkg.devDependencies["@earendil-works/pi-ai"]);
  for (const path of ["index.ts", "capabilities.ts", "capability-policy.ts", "subscription.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(`openai-compatibility/${path}`, root), "utf8"), /pi-host-model-baseline|astra\.ts/);
  }
});

test("selected genuine host source, patch, license and every native release-catalog file are pinned",()=>{
 const {provenance}=verifyHostArtifacts();assert.equal(provenance.npmVersion,"0.85.1");
 assert.notEqual(provenance.commit,readJson("host-patches/pi-0.85.0/provenance.json").commit);
});