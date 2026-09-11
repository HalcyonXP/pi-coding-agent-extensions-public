# Compatibility delivery plan

## Outcome and current boundary

Deliver Codex-compatible observable tools through Pi's native framework, then separately qualify public redistribution. The accepted baseline is PR #31: opt-in Unified projections, not default API parity or whole-project completion. [Compatibility gaps](CODEX-COMPATIBILITY.md), [pinned contracts](CODEX-TOOL-CONTRACTS.md), issue #19 and completion tracker #16 define the functional backlog; issue #3 owns public release.

This plan changes **batching**, not acceptance requirements. A **batch** is a related implementation/review unit with an end-to-end exit criterion, not one helper function or one test cohort. A **milestone handoff** is an independently accepted resulting-master artifact and actual copied installation. Several development commits can belong to one batch; a commit is not a handoff.

## Implementation batches

| Order | Coherent scope | Exit criteria / unresolved decisions |
| --- | --- | --- |
| A — Coordinator and shell contracts | Default nested-API migration, tool-specific result handling, helper/alias/error behavior, configurable background return waits. | Record the default API migration contract and explicit legacy access before changing `tools`; exercise old scripts, new scripts and native-hook/unknown/loss/evidence fallbacks. Verify direct/nested wait configuration, invalid configuration, cancellation and retained numeric-ID collection. Preserve all native ownership, output and cleanup limits. Include other projections here when their native shape is already established; media/Web-dependent projections belong to B. |
| B — Web and media workflows | Web command variants, citations/references/continuation; image inputs/results/recovery and remaining coordinator media helpers. | Trace every requested variant to pinned source and a supported implementation or an explicit unresolved gap. Exercise multi-step search/open/find/reference flows, malformed/expired references, media forwarding and copy-failure recovery with synthetic transport. No silent field dropping, authentication fallback, fabricated references, discarded originals or routine paid calls. Missing source evidence triggers a focused contract investigation, not a parity claim. |
| C — Lifecycle and integrated compatibility | Context/history ordering, completion/continuation, notification ordering, resource pressure, reload/crash behavior; cross-batch workflows. | Resolve the idle-turn contract from evidence before adding autonomous model turns. Exercise real native workflows under streaming, cancellation, scope pressure and reload, preserving auto-compaction and ordinary tools/Fast. Account for every remaining #16/#19 gap, including PTY, permissions, concurrency and recovery: implement it, or keep it explicitly open. An architectural difference is not permission to close the goal by redefining it. |
| D — Public release qualification | Installed/bundled/embedded notices, advisories, sanitized durable provenance, pinned manual public delivery. | Complete #3's redistribution and release-contract gates against the final payload; verify repository/source/tag/assets and an actual download. No automatic Actions release/deployment. Installation readiness alone is insufficient. |

A precedes integrated acceptance in C. B's independent transport work can be developed after A without reopening accepted native boundaries. D's inventory analysis can occur earlier, but final receipts and delivery depend on the final accepted payload. These are scope groupings, **not a promise of exactly four PRs or a verified schedule**. Split only for a material dependency, incompatible migration or independently reviewable risk—not because a small change happens to pass tests. Record the reason when splitting.

## Batch A working state

The working source now includes the bounded saved background-wait preference and default Unified guest projection with explicit `nativeTools` legacy access. Runtime/extension/distribution development checks and both native Responses routes have exercised these changes with synthetic transport on a predecessor SDK. This is not a completed milestone: validate the fresh matching canonical host fixture and perform exact-source/hosted/review/integration/master/copy gates before a handoff. Native settings development now checks the saved ceiling and its failure/reload/exclusion views; an exact ten-frame layout migration replaces the former all36-byte-identical claim without rewriting history. The pinned helper-description audit confirms that inline image/generatedImage/audio work depends on B's media/evidence contracts, while `notify` requests additional immediate provider output and therefore depends on C's native ordering/continuation work; neither is implemented by aliasing a local output helper. Existing bounded text, exit, timers, storage and discovery remain, with their documented restrictions. These outstanding features remain open, not compatibility waivers. Other tool-specific media/Web projections remain in B; do not claim full default-API parity.

## Development loop, now in use

1. Verify the canonical repository, neutral Git identity and local guard at session start; create/use a feature branch. Keep one active functional batch. Do not alter the active installation.
2. Implement related changes with focused checks: `node .github/scripts/develop-openai.mjs --list` lists named suites. Multiple suites run in one invocation. The runner uses existing dependencies/helper, a new credential-free environment and exclusive per-attempt raw logs/input snapshots. It neither downloads/builds artifacts nor changes the shared full-validation receipt.
3. Repeat only affected focused checks after changes. Run broader regressions when shared code changes warrant them, and full required validation when the batch meets its exit criteria—not after each helper edit. Failed evidence remains; retry only after inspecting the outcome and giving the attempt a new path.
4. Use one batch PR with exact-head hosted checks, privacy scans and a labelled COMMENTED AI-assisted self-review. The self-review is not independent approval or integration authorization. Preserve guarded integration and independently verify the resulting master. New source/native/lock changes invalidate affected evidence; batching never waives a gate.
5. Produce a handoff only at a completed milestone. Exact source, resulting master and actual copy remain distinct acceptance gates. Retain historical artifacts/freezes, but do not rebuild, redownload, recopy or repost completed operations for reassurance.

Reuse stable commands and parameterized development tooling. Do not create a new near-identical orchestration/controller tree for each small change. Milestone-only frozen integration/delivery controls still require their exact inputs and preservation checks; never automatically refresh pinned guard validators from unreviewed code.

## Progress and completion reporting

Updates should state the batch, user-visible behavior completed, material blocker and next action. Distinguish **implemented**, **focused-tested**, **exact-source accepted**, **installation-accepted**, **functionally complete** and **publicly released**. A tested increment must not be described as nearly finished merely because its handoff passed.

The earlier working-hour estimate was assumption-based, not a measured remaining-work breakdown. Do not derive a new completion date from this grouping. Record implementation time separately from validation/CI/delivery time at the next milestone, then revise the estimate using resolved scope and observed overhead. No billing cap or live-service parity is established.

Automatic issue closures: none.
