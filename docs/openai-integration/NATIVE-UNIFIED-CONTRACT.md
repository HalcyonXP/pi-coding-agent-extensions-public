# Unified session IDs and direct output contract

## Goal and scope

This source adapts **direct `exec_command` / `write_stdin` results**, separately from the [Code exec/wait contract](NATIVE-CODE-CONTRACT.md) and tool-specific nested projection work in [#19](https://github.com/HalcyonXP/pi-coding-agent-extensions-public/issues/19). The intended outcome is truthful process status, measured call time and literal returned shell text, rather than a model-facing JSON envelope. This document is an implementation contract, **not exact-head acceptance, complete Codex parity or public-release clearance**.

The reference is [`ExecCommandToolOutput` in openai/codex@45305dd229c01e6cb6e122f6559e4f9b805bae6b](https://github.com/openai/codex/blob/45305dd229c01e6cb6e122f6559e4f9b805bae6b/codex-rs/core/src/tools/context.rs). Its direct text and nested object are different projections. Source inspection is not an executed upstream runtime, hosted availability or exact rounding/truncation equivalence.

## Shared meanings and boundaries

| Surface | Meaning here |
| --- | --- |
| Direct Unified output | One native handler's model-facing text content, not a Code cell result or asynchronous completion report |
| Call wall time | Integer milliseconds from a monotonic clock around one awaited manager start/write; not process age, CPU time, billing or retention |
| Process status | The manager's returned collection snapshot; not an application-success inference or continuous live-state guarantee |
| Retained session ID | A positive integer lookup key requiring original native context/scope authority; not a PID or an authority token. An exited process can retain unread output |
| Nested result | Unchanged native `{result,isError}`; Unified data remains in `r.result.details`, with the original JSON content and no new timing metadata |
| Protected completion | Unchanged once-only native terminal evidence, including its correlation, non-consuming snapshot, persistence and cleanup ownership |

Native invocation/scope checks select the direct versus nested path. Guest arguments, result metadata and IDs do not select a projection or grant authority. Direct calls retain Pi's normal result rendering; there is no new heuristic JSON renderer or formatter applied after result hooks. Unknown/hook-modified content remains ordinary visible output. Historical results, nested quiet/grouped polling and the eight-line Code previews are not rewritten.

## Numeric lookup IDs

Current `session_id` values are integers1–2,147,483,647 in direct/nested results, stdin arguments, Jobs snapshots and protected completion reports. Native scope IDs, call IDs and evidence identities stay opaque strings. Never stringify an ID for JSON `write_stdin` or convert a historical UUID. The CLI's separate `jobs cancel` grammar accepts canonical positive decimal text; its menu passes the captured numeric value, not a parsed display row.

A constant-memory, nonwrapping allocator reserves IDs before resource registration/spawn and never recycles them within the Node realm, including manager reset/replacement and module re-evaluation. Only the sequence survives in runtime memory: no job, credential, authority or settings file is retained. A process restart chooses a fresh random starting point, not durable recovery or a guarantee of global uniqueness. Exhaustion refuses further launches. This differs from the inspected Codex random1,000–99,999 allocator; the aligned surface is the numeric `i32` lookup, not its allocation algorithm or exact error language.

Native quiet-poll/grouping code accepts typed numeric lookup values without broadening native scope/call ID checks. Numeric1701 and legacy string`"1701"` are distinct. A changed returned ID remains visible rather than being classified quiet. Legacy synthetic/history rendering remains readable but cannot admit a historical string ID to current Unified tools. This requires the updated matched host artifacts, not an extension-only schema swap.

## Bounded nested collection

A **nested output slice** fits the complete unchanged serialized `{result,isError}` within the existing64KiB RPC result cap, not merely the raw output string. The manager checks non-consuming UTF-8 snapshots before collection, accounting for duplicate JSON/details and escaping. Unread bytes retain the original session ID, including after process exit; they are not reported as dropped output. Existing sanitization and once-only buffer-loss accounting remain. A preview that cannot fit refuses before consuming output or loss counters.

The sizing increment left direct output and defaults unchanged; current omitted defaults are described below. No aggregate/call/lifetime/readiness/drain/evidence budget increases. Result hooks still run afterwards: oversized hook-modified results and aggregate overflow remain failures, not silently truncated or rewritten finalized evidence. Collection requires the original scope/context and never relaunches work. This is bounded transport correctness, not tool-specific Codex projection parity.

## Omitted controls

Omitting `yield_time_ms` now selects10,000 ms for `exec_command`,5,000 ms for empty/omitted `write_stdin.chars`, and250 ms for nonempty stdin. Whitespace and Ctrl-C/Ctrl-D are nonempty; input is not trimmed. Earlier process closure returns sooner. Omitted `max_output_tokens` selects10,000 approximate tokens (40,000 UTF-8 bytes), on direct and nested calls. Nested serialized wrappers may require smaller slices; collect the original ID rather than relaunching.

These replace the historical1,000 ms/4,096-token defaults. Current explicit `yield_time_ms` requests accept non-negative safe integers and clamp them before native scope admission or stdin effects: initial Windows10,000–30,000 ms (other platforms250–30,000 ms); empty stdin5,000–300,000 ms; nonempty stdin250–30,000 ms. Zero requests the applicable floor, not an immediate poll. Fractions, unsafe/nonfinite numbers and coercible values refuse. The background ceiling is fixed here; upstream configuration of that ceiling is not implemented.

Only the empty-poll **return wait** ceiling grows. Output remains1–16,384 tokens; process lifetime, idle timeout, supervisor readiness, cleanup, Code exec/wait controls and aggregate/evidence limits do not grow. Closure can still return sooner. Caller, native context/resource/cell cancellation or manager reset wakes a long collection and awaits the existing bounded stop attempt; unconfirmed closure retains ownership/admission and does not consume output. Native hooks finalize normally and can still cause refusal.

## Text and structured details

A stopped process with unread output can return:

```text
Wall time: 0.2140 seconds
Process exited with code 7
More output available with session ID 1701
Supervisor preamble: received
Output:
Literal "quotes", backslash \, Unicode 雪 🌊
{"literal":"keep this JSON as text"}
```

`1701` is illustrative, not an ID to execute or adopt. A retained ID with `running:false` **must not** be called a running process. A running snapshot says `Process running with session ID ...`; an unknown terminal exit says `Process stopped; exit code unavailable`. Nonzero exit codes remain visible native returned data, not automatically rewritten as thrown invocation errors or top-level `isError:true`. Native validation, ownership, cancellation and manager throws continue through their original error path.

The same `output`, `exit_code`, `running`, `session_id`, `supervisor_ready`, `truncated_bytes` and `termination` fields remain in `message.details`. Direct results additionally contain exactly:

```json
{"unified_result":{"version":1,"wall_time_ms":214}}
```

**Direct SDK consumers must read native details, not `JSON.parse(message.content[0].text)`.** Code-mode callers keep using their existing `{result,isError}` / `r.result.details` contract. Protected completion consumers keep using `details.kind === "unified_exec_completion"`; neither the new heading nor timing metadata is evidence identity.

The four-decimal seconds display follows the inspected Unified header convention, but this implementation measures integer milliseconds. Measured call time can round to zero for already completed output; this is not a zero requested wait bypassing the floor. It does not measure how long the process ran. No chunk IDs, original token counts, billing telemetry or finer measurement precision are invented.

The formatter copies bounded plain scalar data, refuses accessors/symbols/unfamiliar fields, contradictory running/exit status and runtime-supplied timing, and does not mutate the manager outcome. This boundary creates no native authority. The existing manager's terminal-control cleanup and UTF-8 buffering happen before formatting; “literal” means the **returned** output string, not a promise to reproduce every raw process byte. The full existing 64-KiB per-response output still fits. Formatting adds no further text truncation or speculative summary.

Known readiness, termination and dropped-byte facts appear before `Output:` even when returned text is empty. `Supervisor preamble: received` is not proof the command succeeded or the child acknowledged it. An unconfirmed OS termination must not be labelled stopped merely because termination was requested. `Output omitted: N bytes · not recoverable by polling or expansion` reports already dropped bytes; a retained ID may separately allow collection of **remaining** buffered bytes. Native expansion reveals complete returned text, not omitted bytes or the whole process transcript.

## Preserved execution and open compatibility work

Apart from the documented defaults, clamped waits, collection cancellation and numeric lookup transition, this source retains schema field names, output ranges, ownership, hooks/approvals, protected evidence, model/provider/catalog/auth/cache ownership, Fast/footer, saved preferences and runtime budgets. Numeric classification changes the native agent/coding-agent packages and their patch/archive/consumer-integrity pins; the verified helper, other host packages and dependency versions remain unchanged. Keep two active/draining scopes, four live processes, eight retained records, existing lifetime/idle/readiness/drain limits and same-cell nested polling. Delegated shell still has full OS permissions; no sandbox/escalation, PTY, shell/environment selector, coordinator fallback, invocation-time build/download or automatic idle turn is added.

Exact target allocation/error behavior, configurable background ceilings, tool-specific nested object projection, complete hook/error/unknown-field behavior and target truncation/history algorithms remain work. Helper/notify, Web/image/context/continuation and lifecycle compatibility remain tracked under #19/#16. Redistribution/provenance/manual public executable delivery remains separately gated by #3. None of these gaps is a permanent waiver.

## Required validation

Source tests cover literal quotes/backslashes/Unicode/JSON/newlines, status/readiness/termination/loss, retained exited IDs, malformed data, separate clocks, native error propagation, unchanged nested results and both native Responses serializers. `distribution/unified-output-contract.mjs` independently checks actual direct text/details without importing the product formatter or treating metadata as authority.

Installed acceptance uses the original SDK dispatcher, synthetic auth/request SSE seams and real owned Windows shell/stdin/output. Both Responses routes must preserve function-call/result replay, numeric positive-i32 IDs (`numericSessionIDs`), literal before/after output, same-session collection, nonzero exit, partial terminal output, real buffer loss, measured time bounded by an independently observed prompt interval and zero remaining native scopes. Sixteen synthetic model requests are required; these are separate from the existing Code input's 24/12 scenarios, Code output's eight requests and other synthetic fixtures—not token/quota telemetry. Native component checks require visible direct status/loss and unchanged history through expansion. The shell fixture preserves child exit status; command text containing a marker is never sufficient evidence that it ran.

Omitted-default acceptance adds12 separately counted synthetic requests/six scenarios across both native Responses routes: a real1500ms child completes on the initial default wait, direct output returns40,000 bytes with original-ID remainder collection, and a contained cell collects escaped output under unchanged serialized wrappers with all shell controls omitted. Handler seams independently check exact initial/empty/nonempty defaults and current explicit wait clamping. Restoration failures are aggregated; no source fixture or passed development probe substitutes for exact-artifact acceptance.

`accept-unified-wait.mjs` additionally requires22 synthetic model requests/six scenarios: on each native Responses route, explicit zero initial wait observes a1500ms child exit, nonempty zero wait yields a running armed job, a single empty poll collects its output after more than30 seconds, and a separate300,000ms poll is cancelled with zero final scopes. Raw timing/count/ownership observations are revalidated by the isolated parent. Deterministic timer tests cover exact300,000/30,000ms ceilings without sleeping five minutes; controlled unconfirmed-stop tests prove notification does not claim OS closure. These evidence roles are separate.

The profile contract retains all 31 historical named frames in order and appends five direct Unified running/retained/expanded/loss/hook views, for **36** total. Existing Code, quiet/grouped polling, protected completion and installed CLI/profile/restart/rollback tests remain required. Development checks on an accepted SDK with current extension source do not certify a new source-bearing archive. Separate reviewed-source, resulting-master and actual copied-artifact gates still apply; see [validation](VALIDATION.md).

Reference attribution: OpenAI Codex, Copyright 2025 OpenAI, Apache-2.0 and upstream NOTICE; see the extension's retained third-party notices. No upstream runtime or endorsement is included.
