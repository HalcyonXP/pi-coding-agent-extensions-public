# Compatibility delivery plan

## Outcome and current boundary

Deliver Codex-compatible observable tools through Pi's native framework, then separately qualify public redistribution. The [accepted milestone index](MILESTONES.md) records exact source/master/copied-handoff boundaries through PR #37. PR #32 accepted bounded coordinator/shell behavior; PR #33 accepted bounded Web/media; PR #34 accepted native context/notifications. PRs #35–37 accepted scoped notice work, not whole-project or redistribution completion. [Compatibility gaps](CODEX-COMPATIBILITY.md), [pinned contracts](CODEX-TOOL-CONTRACTS.md), issue #19 and completion tracker #16 define the functional backlog; issue #3 owns public release.

A **batch** is a related implementation/review unit with an end-to-end exit criterion, not one helper function or one test cohort. A **milestone handoff** is an independently accepted resulting-master artifact and actual copied bundle tested in isolated profiles, not the user's active installation. Several development commits can belong to one batch; a commit is not a handoff.

## Implementation batches

| Order | Coherent scope | Exit criteria / unresolved decisions |
| --- | --- | --- |
| A — Coordinator and shell contracts | Default nested-API migration, tool-specific result handling, helper/alias/error behavior, configurable background return waits. | Bounded subset accepted in PR32. Preserve explicit `nativeTools` access, native-hook/unknown/loss/evidence fallback and numeric-ID collection. Full default-API/error/truncation equivalence and unlike concurrency/lifetimes remain open. |
| B — Web and media workflows | Web command variants, citations/references/continuation; image inputs/results/recovery and remaining coordinator media helpers. | Bounded subset accepted in PR33. Trace remaining variants to pinned source and an implementation or explicit gap. Owned opaque references/click require an authoritative issuance/lifetime contract; do not substitute citation parsing. Audio, detail hints and broader remote media remain open. Preserve originals and use synthetic transport, not routine paid calls. |
| C — Lifecycle and integrated compatibility | Context/history ordering, completion/continuation, notification ordering, resource pressure, reload/crash behavior; cross-batch workflows. | Bounded context/notification subset accepted in PR34. Preserve final-hook/serialized-request confirmation and active-turn ordering. Resolve the idle-turn contract before adding automatic model turns. Keep PTY, permissions, concurrency, recovery and remaining #16/#19 differences explicit; an adaptation does not close the broader goal. |
| D — Public release qualification | Installed/bundled/embedded notices, sanitized durable provenance and pinned manual public delivery. | PR35–37 qualified scoped notice presence only. Complete #3's remaining redistribution and release-contract gates against the final payload, then verify repository/source/tag/assets and an actual download. No automatic Actions release/deployment. Installation readiness alone is insufficient. |

A precedes integrated acceptance in C. B's independent transport work can proceed without reopening accepted native boundaries. D's final receipts and delivery depend on the final accepted payload. These groupings are **not a promise of exactly four PRs or a verified schedule**. Split only for a material dependency, incompatible migration or independently reviewable risk—not because a small change happens to pass tests. Record the reason when splitting.

## What the accepted subsets include

- **A:** Default recognized Unified projections through `tools`; raw `nativeTools`; `projectedTools === tools`; fixed helper feedback and unambiguous callable aliases; bounded saved empty-poll ceilings. Historical scripts need the documented migration, not silent rewriting. Wait collection does not extend process lifetime or certify closure. See [projection](CODE-RESULT-PROJECTION.md) and [coordinator helpers](CODE-COORDINATOR-COMPATIBILITY.md).
- **B:** Nine-family experimental Web admission with at most four operations: search/image query, public-URL open/find/screenshot, finance, weather, sports and time. `verified-v1` remains narrow. Both context-free profiles use protected evidence without conversation upload. Saved schema changes require reload/restart. Inline images admit at most 32KiB decoded PNG/JPEG/GIF/WebP with declared-container/canvas limits; those checks are not pixel decoding. `generatedImage()` forwards pixels and an unverified hint; it does not generate/fetch/save. Normal imagegen results use an owned Pi reference, not upstream data-URL parity. Native originals and raw/warning fallback remain. See [Web profiles](WEB-PROFILES.md) and [media inputs](MEDIA-INPUTS.md).
- **C:** Explicit reload-required `experimental-context` discloses bounded current native text only after final hooks, actual request serialization and successful completion. It is not secret scrubbing or history reconstruction. Primitive `await notify(value)` provides additional output for the original exec across adopted waits—not a toast, another completion/usage event or permission for an idle turn. Normal cohorts require zero active/draining scopes; the separate acknowledgement-fault cohort retains four quarantines, not cleanup.
- **D:** Scoped notice associations, exact original grants and full witnesses are retained outside upstream package directories. This is notice presence, not complete linkage/provenance or public redistribution clearance. See [accepted scope](MILESTONES.md) and [release boundaries](FINAL-ACCEPTANCE.md).

Separate source, resulting-master and actual-copy acceptance completed for the commits in the milestone index. Earlier source-on-SDK probes remain development evidence, not retrospectively relabelled artifact acceptance. The accepted native-context settings migration retained all 50 PR33 frames and added five context views; PR35–37 retained those 55. Do not reuse an older layout comparator for a different migration.

## Development loop, now in use

1. Verify the canonical repository, neutral Git identity and local guard at session start; create/use a feature branch. Keep one active functional batch. Do not alter the active installation.
2. Implement related changes with focused checks: `node .github/scripts/develop-openai.mjs --list` lists named suites. Multiple suites run in one invocation. The runner uses existing dependencies/helper, a new credential-free environment and exclusive per-attempt raw logs/input snapshots. It neither downloads/builds artifacts nor changes the shared full-validation receipt.
3. Repeat only affected focused checks after changes. Run broader regressions when shared code changes warrant them, and full required validation when the batch meets its exit criteria—not after each helper edit. Failed evidence remains; inspect the outcome before any fresh unfinished continuation. Never replay a spent build, probe, download or public mutation for reassurance.
4. Use one batch PR with exact-head hosted checks, privacy scans and a labelled COMMENTED AI-assisted self-review. Self-review is not independent approval or integration authorization. Preserve guarded integration and independently verify the resulting master. New source/native/lock changes invalidate affected evidence; batching never waives a gate.
5. Produce a handoff only at a completed milestone. Exact source, resulting master and actual copy remain distinct acceptance gates. Retain historical artifacts/freezes; do not rebuild, redownload, recopy or repost completed operations for reassurance.

Reuse stable commands and parameterized development tooling. Do not create a new near-identical orchestration/controller tree for each small change. Milestone-only frozen integration/delivery controls still require their exact inputs and preservation checks; never automatically refresh pinned guard validators from unreviewed code.

## Progress and completion reporting

Updates should state the batch, user-visible behavior completed, material blocker and next action. Distinguish **implemented**, **focused-tested**, **exact-source accepted**, **actual-copy accepted**, **functionally complete** and **publicly released**. Keep milestone status in [the shared index](MILESTONES.md); a tested increment is not nearly finished merely because its handoff passed.

The earlier working-hour estimate was assumption-based, not a measured remaining-work breakdown. Do not derive a new completion date from this grouping. Record implementation time separately from validation/CI/delivery time, then revise the estimate using resolved scope and observed overhead. No billing cap or live-service parity is established.

Automatic issue closures: none.
