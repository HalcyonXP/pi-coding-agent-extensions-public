# Direct Unified exec output contract

## Goal and scope

This source adapts **direct `exec_command` / `write_stdin` results**, separately from the [Code exec/wait contract](NATIVE-CODE-CONTRACT.md) and tool-specific nested projection work in [#19](https://github.com/HalcyonXP/pi-coding-agent-extensions-public/issues/19). The intended outcome is truthful process status, measured call time and literal returned shell text, rather than a model-facing JSON envelope. This document is an implementation contract, **not exact-head acceptance, complete Codex parity or public-release clearance**.

The reference is [`ExecCommandToolOutput` in openai/codex@45305dd229c01e6cb6e122f6559e4f9b805bae6b](https://github.com/openai/codex/blob/45305dd229c01e6cb6e122f6559e4f9b805bae6b/codex-rs/core/src/tools/context.rs). Its direct text and nested object are different projections. Source inspection is not an executed upstream runtime, hosted availability or exact rounding/truncation equivalence.

## Shared meanings and boundaries

| Surface | Meaning here |
| --- | --- |
| Direct Unified output | One native handler's model-facing text content, not a Code cell result or asynchronous completion report |
| Call wall time | Integer milliseconds from a monotonic clock around one awaited manager start/write; not process age, CPU time, billing or retention |
| Process status | The manager's returned collection snapshot; not an application-success inference or continuous live-state guarantee |
| Retained session ID | An existing lookup key requiring original native context/scope authority; an exited process can retain unread output |
| Nested result | Unchanged native `{result,isError}`; Unified data remains in `r.result.details`, with the original JSON content and no new timing metadata |
| Protected completion | Unchanged once-only native terminal evidence, including its correlation, non-consuming snapshot, persistence and cleanup ownership |

Native invocation/scope checks select the direct versus nested path. Guest arguments, result metadata and IDs do not select a projection or grant authority. Direct calls retain Pi's normal result rendering; there is no new heuristic JSON renderer or formatter applied after result hooks. Unknown/hook-modified content remains ordinary visible output. Historical results, nested quiet/grouped polling and the eight-line Code previews are not rewritten.

## Text and structured details

A stopped process with unread output can return:

```text
Wall time: 0.2140 seconds
Process exited with code 7
More output available with session ID example-owned-lookup
Supervisor preamble: received
Output:
Literal "quotes", backslash \, Unicode 雪 🌊
{"literal":"keep this JSON as text"}
```

`example-owned-lookup` is illustrative, not an ID to execute or adopt. A retained ID with `running:false` **must not** be called a running process. A running snapshot says `Process running with session ID ...`; an unknown terminal exit says `Process stopped; exit code unavailable`. Nonzero exit codes remain visible native returned data, not automatically rewritten as thrown invocation errors or top-level `isError:true`. Native validation, ownership, cancellation and manager throws continue through their original error path.

The same `output`, `exit_code`, `running`, `session_id`, `supervisor_ready`, `truncated_bytes` and `termination` fields remain in `message.details`. Direct results additionally contain exactly:

```json
{"unified_result":{"version":1,"wall_time_ms":214}}
```

**Direct SDK consumers must read native details, not `JSON.parse(message.content[0].text)`.** Code-mode callers keep using their existing `{result,isError}` / `r.result.details` contract. Protected completion consumers keep using `details.kind === "unified_exec_completion"`; neither the new heading nor timing metadata is evidence identity.

The four-decimal seconds display follows the inspected Unified header convention, but this implementation measures integer milliseconds. A zero-duration collection is valid, including when output was already ready. It does not measure how long the process ran. No chunk IDs, original token counts, billing telemetry or finer measurement precision are invented.

The formatter copies bounded plain scalar data, refuses accessors/symbols/unfamiliar fields, contradictory running/exit status and runtime-supplied timing, and does not mutate the manager outcome. This boundary creates no native authority. The existing manager's terminal-control cleanup and UTF-8 buffering happen before formatting; “literal” means the **returned** output string, not a promise to reproduce every raw process byte. The full existing 64-KiB per-response output still fits. Formatting adds no further text truncation or speculative summary.

Known readiness, termination and dropped-byte facts appear before `Output:` even when returned text is empty. `Supervisor preamble: received` is not proof the command succeeded or the child acknowledged it. An unconfirmed OS termination must not be labelled stopped merely because termination was requested. `Output omitted: N bytes · not recoverable by polling or expansion` reports already dropped bytes; a retained ID may separately allow collection of **remaining** buffered bytes. Native expansion reveals complete returned text, not omitted bytes or the whole process transcript.

## Preserved execution and open compatibility work

This increment does not change tool schemas/defaults, UUID lookup, ownership, hooks/approvals, protected evidence, model/provider/catalog/auth/cache ownership, Fast/footer, saved preferences, native production patch/packages/helper/lock or runtime budgets. Keep two active/draining scopes, four live processes, eight retained records, existing lifetime/idle/readiness/drain limits and same-cell nested polling. Delegated shell still has full OS permissions; no sandbox/escalation, PTY, shell/environment selector, coordinator fallback, invocation-time build/download or automatic idle turn is added.

Numeric target IDs, differing yield/output defaults, tool-specific nested object projection, complete hook/error/unknown-field behavior and target truncation/history algorithms remain work. Helper/notify, Web/image/context/continuation and lifecycle compatibility remain tracked under #19/#16. Redistribution/provenance/manual public executable delivery remains separately gated by #3. None of these gaps is a permanent waiver.

## Required validation

Source tests cover literal quotes/backslashes/Unicode/JSON/newlines, status/readiness/termination/loss, retained exited IDs, malformed data, separate clocks, native error propagation, unchanged nested results and both native Responses serializers. `distribution/unified-output-contract.mjs` independently checks actual direct text/details without importing the product formatter or treating metadata as authority.

Installed acceptance uses the original SDK dispatcher, synthetic auth/request SSE seams and real owned Windows shell/stdin/output. Both Responses routes must preserve function-call/result replay, literal before/after output, same-session collection, nonzero exit, partial terminal output, real buffer loss, measured time bounded by an independently observed prompt interval and zero remaining native scopes. Sixteen synthetic model requests are required; these are separate from the existing Code input's 24/12 scenarios, Code output's eight requests and other synthetic fixtures—not token/quota telemetry. Native component checks require visible direct status/loss and unchanged history through expansion. The shell fixture preserves child exit status; command text containing a marker is never sufficient evidence that it ran.

The profile contract retains all 31 historical named frames in order and appends five direct Unified running/retained/expanded/loss/hook views, for **36** total. Existing Code, quiet/grouped polling, protected completion and installed CLI/profile/restart/rollback tests remain required. Development checks on an accepted SDK with current extension source do not certify a new source-bearing archive. Separate reviewed-source, resulting-master and actual copied-artifact gates still apply; see [validation](VALIDATION.md).

Reference attribution: OpenAI Codex, Copyright 2025 OpenAI, Apache-2.0 and upstream NOTICE; see the extension's retained third-party notices. No upstream runtime or endorsement is included.
