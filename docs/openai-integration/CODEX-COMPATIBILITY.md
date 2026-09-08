# Codex compatibility contract

## Objective and evidence boundary

The confirmed project target is **Codex-compatible observable tool behavior implemented through Pi's extension/native framework**, not simply similarly named capabilities. Using the model's learned tool expectations motivates this target; the project's source inspection does not independently establish GPT-6's training data or exact training-harness version.

The initial public CLI/core comparison is pinned to [`openai/codex@45305dd229c01e6cb6e122f6559e4f9b805bae6b`](https://github.com/openai/codex/tree/45305dd229c01e6cb6e122f6559e4f9b805bae6b). This is a source reference, not a claim about every hosted Codex product or a built/tested upstream binary. The compatibility goal remains broader than the currently implemented subset.

## Returned-job increment

The former completed-record sweep measured one minute from the **start of the last collection**, not child closure. Isolated real-child/controlled-clock regressions demonstrate that it could delete unread output 1 ms after a longer process closed. Missing IDs do not prove commands never ran and must never cause blind replay.

This implementation removes that completed-result TTL. It retains up to eight records/1 MiB each until collection, capacity eviction of an eligible completed least-recently-collected record, cancellation or reset. Unsettled/failed reporting is not evictable; live processes are not killed for record capacity. The existing four-process/two-native-scope limits and execution/idle/readiness/teardown/native lifetime budgets remain unchanged.

A direct job with an initial running response receives one protected native terminal report, correlating the existing invocation/job with exit/termination and up to 64 KiB of uncollected output plus dropped/remaining byte counts. The snapshot does not consume polling output or claim a complete transcript. Synchronous initial completions are not duplicated. Nested Code-mode jobs retain their owning-cell behavior. Physical close is not publication settlement; failure remains owned/visible without automatic retry.

The existing native publisher journals before context publication. History/UI delivery is immediate when idle or queued while streaming, then included in the next safe model request. It does not modify an in-flight request or start an idle assistant turn. The installed acceptance procedure tests native journal/history/UI/model-boundary behavior with synthetic model responses and a real 65-second other-work interval, not a live service or the user's commands.

## Comparison and remaining work

“Implemented” below describes source behavior, not exact-head acceptance. See [validation](VALIDATION.md) and [acceptance boundaries](FINAL-ACCEPTANCE.md). **Gap** means missing compatibility work, **Adaptation** an explicit architectural difference, and **Unverified** an incomplete target audit; none is a permanent waiver.

| Surface | Current status |
| --- | --- |
| Completed-result retention | Implemented defect repair. Pinned Codex uses collection/capacity/explicit removal rather than this former last-poll sweep. Pi's hard eight-record bound still differs from Codex's 64-entry soft process store. |
| Terminal reporting | Implemented Pi adaptation through genuine protected evidence. Codex has independent bounded output/exit watchers; Pi terminal snapshots are not a full transcript or incremental stream. |
| Model continuation | Next safe native model request supported. Automatic idle turns remain a gap/open contract question; inspected Codex client events alone do not prove automatic model messages/turns. |
| Concurrency/lifetimes | Adaptation requiring further native design: two shared active/draining scopes versus Codex's unlike 64-entry soft store. No silent limit copying or cleanup relaxation. |
| Yield/defaults | Known differences: Pi defaults 1,000 ms, 0–30,000 ms; inspected Codex initial default 10,000 ms and different Windows/empty-poll floors. Poll wait is not process lifetime or retention. |
| Schemas/formatting/errors | Partial audit only. Exported schemas/formatters, ID types, units and shell/environment options need pin-specific verification; internal Rust arguments do not establish the exposed contract. |
| PTY/terminal | Gap: Pi is pipe-only with tty:false, not ConPTY/terminal emulation. |
| Approval/sandbox | Adaptation: preserve real native Pi policy. Delegated shell runs with full OS permissions; do not accept sandbox/permission fields without enforcement. |
| Local polling visibility | Pi adaptation: updated native TUI hides opted-in cell-owned no-input/no-output running polls; corresponding ordinary audits do not enter model input. Meaningful/direct calls and native events/limits remain. No billed-token measurement or Codex UI parity claim. |
| Code mode | Further catalog/runtime/helper/lifecycle audit required. Preserve restricted coordination, native delegation, original cell ownership and confirmed cleanup. |
| Web/image | Existing bounded subsets remain compatibility work, not blanket exclusions. Audit schema/continuation/citations/references/errors while preserving authentication, originals and evidence boundaries. |
| Session recovery | Unverified upstream recovery parity; Pi does not restore jobs/authority after reload or crash. Saved menu preferences are separate. |

Pinned source anchors: [process retention/pruning](https://github.com/openai/codex/blob/45305dd229c01e6cb6e122f6559e4f9b805bae6b/codex-rs/core/src/unified_exec/process_manager.rs#L996-L1189), [capacity policy](https://github.com/openai/codex/blob/45305dd229c01e6cb6e122f6559e4f9b805bae6b/codex-rs/core/src/unified_exec/process_manager.rs#L1607-L1679), [asynchronous watchers](https://github.com/openai/codex/blob/45305dd229c01e6cb6e122f6559e4f9b805bae6b/codex-rs/core/src/unified_exec/async_watcher.rs#L56-L241), [client completion event](https://github.com/openai/codex/blob/45305dd229c01e6cb6e122f6559e4f9b805bae6b/codex-rs/core/src/tools/events.rs#L562-L590).

Native models/providers, ordinary tools, Fast/footer, saved menu choices, generated originals and notices remain owned/preserved as before. This work is separate from issue #3's unresolved public redistribution/provenance/advisory/upload/download gates. Local validation and AI-assisted self-review are not hosted/installed acceptance or independent approval.
