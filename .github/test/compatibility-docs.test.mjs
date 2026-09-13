// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Documentation consistency only: no SDK imports, network, artifact execution or acceptance certification.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("../../docs/openai-integration/", import.meta.url);
const names = ["README", "DELIVERY-PLAN", "CODEX-COMPATIBILITY", "FINAL-ACCEPTANCE", "MEDIA-INPUTS", "WEB-PROFILES", "CODE-RESULT-PROJECTION", "VALIDATION"];
const read = name => readFileSync(new URL(`${name}.md`, directory), "utf8");
const index = read("MILESTONES");

test("milestone index has distinct source/master identities and canonical PR links, not evidence inferred from formatting", () => {
  const rows = [...index.matchAll(/^\| \[PR #(\d+)\]\((https:\/\/[^)]+)\) \| `([a-f0-9]{40})` \| `([a-f0-9]{40})` \| ([^|]+) \|$/gm)];
  assert.deepEqual(rows.map(row => Number(row[1])), [32, 33, 34, 35, 36, 37]);
  const commits = [];
  for (const [, number, url, source, master, scope] of rows) {
    assert.equal(url, `https://github.com/HalcyonXP/pi-coding-agent-extensions-public/pull/${number}`);
    assert.notEqual(source, master);
    assert.ok(scope.trim().length > 20);
    commits.push(source, master);
  }
  assert.equal(new Set(commits).size, commits.length);
});

test("integration entry points link the shared milestone index", () => {
  for (const name of names) assert.match(read(name), /\]\(MILESTONES\.md\)/, name);
});

test("reconciled guide links resolve locally without network access", () => {
  for (const name of [...names, "MILESTONES"]) {
    for (const [, target] of read(name).matchAll(/\[[^\]]+\]\(([^\s)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(target)) continue;
      const url = new URL(target, new URL(`${name}.md`, directory));
      assert.equal(url.protocol, "file:");
      assert.ok(existsSync(fileURLToPath(url)), `${name}: ${target}`);
    }
  }
});

test("accepted subsets are not still labelled as pending development", () => {
  const obsolete = [
    "The accepted baseline is PR #32:", "Batch A accepted; Batch B in development",
    "new installed acceptance remains pending", "full Batch B milestone gates remain pending",
    "new Web projection is working-source development only", "# Code image inputs — Batch B working source",
    "is working-source C development, not new-artifact acceptance", "not yet run against a new B artifact",
    "it has not yet run against a new Batch B bundle"
  ];
  for (const name of names) for (const text of obsolete) assert.ok(!read(name).includes(text), `${name}: stale acceptance status`);
});

test("index retains source/master/copy distinctions and broader completion limits", () => {
  for (const text of ["exact-source, resulting-master and actual copied-handoff", "Later commits and working changes", "not mean whole-project completion", "independent approval", "not retrospectively accepted", "not required totals for every future tree", "Software licensing does not establish hosted-service entitlement"])
    assert.ok(index.includes(text), text);
});

test("supported surface distinguishes profiles, public URLs, forwarding and notifications", () => {
  const text = read("FINAL-ACCEPTANCE");
  for (const marker of ["`verified-v1`", "`experimental`", "`experimental-context`", "public-URL open/find/screenshot", "owned opaque references/click/continuation", "`generatedImage()`", "`await notify(value)`", "saved/effective separation", "positive numeric lookup IDs"])
    assert.ok(text.includes(marker), marker);
});

test("current gates retain complete framed CLI semantics and the acknowledgement exception", () => {
  const text = read("FINAL-ACCEPTANCE");
  for (const marker of ["accept-profile-framed.mjs", "all ordered receipt frames", "complete original CLI/settings semantics", "seven additional actual-bundle cohorts", "four quarantined scopes, not cleanup"])
    assert.ok(text.includes(marker), marker);
  assert.ok(read("README").includes("cancellation alone does not confirm closure"));
});
