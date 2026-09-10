# Native Code input and result boundaries

## Objective and decisions

Completion tracker [#16](https://github.com/HalcyonXP/pi-coding-agent-extensions-public/issues/16) calls for functional, installable Codex-observable compatibility through genuine Pi. [#19](https://github.com/HalcyonXP/pi-coding-agent-extensions-public/issues/19) separates native input transport from direct/nested result adaptation. This document describes the implementation, **not a source/artifact acceptance certificate or completion of either tracker**. Public release remains separately gated by #3.

PR #18 established the pinned source contract before adaptation. Its fact fixture retains the accepted audit baseline, including the former three-field JSON exec schema. Current-source tests explicitly supersede that input baseline; they do not rewrite what the earlier source exposed.

Pi 0.85.1 already implements `ToolDefinition.constrainedSampling`, OpenAI custom-tool serialization, streamed custom input and paired history replay. Using that native API avoids a replacement provider, catalog edit, SDK patch just for transport, or extension-owned network adapter. The grammar comes from Codex `45305dd229c01e6cb6e122f6559e4f9b805bae6b`; attribution is retained in the extension's third-party notices.

## Shared terms and current contract

| Surface | Meaning / implementation |
| --- | --- |
| Provider input | `exec` is a native custom Lark tool carrying raw JavaScript, not JSON or Markdown fences. `wait` remains a JSON function. |
| Internal input | Native Pi maps raw source to `{code: string}`. The schema and `prepareArguments` require exactly that own-data field. This object is not the exposed provider format. |
| Pragma controls | Optional first-line `// @exec: {"yield_time_ms":1000,"max_output_tokens":10000}`. LF and CRLF work. Unknown, fractional, null, negative and over-limit values fail before Code runtime admission. |
| Runtime controls | The internal `CodeMode.exec`/`CodeCells` APIs can still receive structured options. They are not an alternate model-facing JSON tool. |
| Native grammar capability | The selected native Responses model must explicitly advertise grammar tools. Missing/false support makes Code unavailable without inspecting/starting its runtime; saved preference is retained. Metadata is not invocation authority. |
| Direct Code result | Current `exec`/`wait` content is script status, measured per-call wall time and literal coordinator text. Structured `CellOutcome` fields remain in native `details`, with versioned `code_result` timing metadata. This deliberately replaces the direct JSON envelope, not the nested wrapper. |
| Nested result | Still `{result,isError}`. For Unified exec, inspect `r.isError` and `r.result.details`, not `r.output`. Protected image/source projection is unchanged. |
| Presentation | Existing readable results, quiet polls, native groups, errors/loss, expandable returned data and history remain separate from provider input serialization. |

Example **provider input**:

```javascript
// @exec: {"yield_time_ms":1000,"max_output_tokens":10000}
const r = await tools.read({path: "input.txt"});
if (r.isError) throw Error("Read failed");
text(r.result.content[0].text);
```

An SDK/RPC caller issuing the same native call supplies one `code` string containing the pragma and source. Former top-level `yield_time_ms` / `max_output_tokens` fields **fail visibly**, rather than being silently dropped when native custom history serializes only its required string property. Move those options into the pragma. There is no automatic migration of saved transcripts, active profiles, old immutable bundles or existing cells/jobs. Invalid input does not authorize replay of a command whose effects are unknown.

Source defaults remain 10000 ms and 10000 approximate tokens, with unchanged ranges 0–30000 ms and 0–16384 tokens. Pragma handling shares the existing bounded parser; its CRLF recognition is repaired so a Windows newline cannot silently replace requested limits with defaults. These controls do **not** enlarge retention, admission, worker execution, idle, lifetime, readiness or cleanup budgets.

## Direct output and consumer transition

For example, the model receives plain text rather than a JSON-escaped envelope:

```text
Script completed
Wall time 1.3 seconds
Output:
Task A: DONE · exit 0
```

A running result identifies its cell for a subsequent genuine `wait`; that identifier is still only a lookup key. Failed, terminated and draining results have distinct titles. Draining explicitly says cleanup is unconfirmed. Fixed failure diagnostics and omitted-byte notices remain visible even when the coordinator-text budget is zero. “Script completed” describes the cell, not success of every delegated action. Native invocation/validation failures remain ordinary native errors, not manufactured successful Code results.

`details.code_result` is exactly `{version: 1, wall_time_ms: number}`. Milliseconds are a nonnegative safe integer measured with a monotonic clock around the actual awaited `CodeMode.exec` or `wait` operation, then displayed rounded to tenths of a second. This is **this call's elapsed time**, including work it awaits—not cell age, child-process runtime, CPU usage, billing, retention or a guessed upstream timer. This formatting does not claim byte-for-byte upstream rounding/truncation equivalence.

**SDK/RPC consumers must read structured `details`, not `JSON.parse(content[0].text)`.** Current-source acceptance checks content/details agreement independently. Guest code still receives delegated `{result,isError}`; Unified exec remains under `r.result.details`. The Code increment does not normalize nested tool results or serialize internal `output_schema` metadata into provider requests. Direct Unified exec output has a [separate transition and timing contract](NATIVE-UNIFIED-CONTRACT.md).

Historical messages are not rewritten. The native renderer accepts either exact historical JSON/details agreement without the new metadata, or exact current text/details agreement with it. Unknown, partial, nontext, native-error, mismatched or hook-added results use Pi's ordinary visible fallback. The same collapsed output and loss notices are retained; expansion includes complete returned details and the new timing. No guessed summary replaces guest JSON, and no existing cell, job, profile or immutable bundle is migrated.

## Cancellation while draining

A Code collector is the current manager `exec`/`wait` operation, not the worker or native scope. Cancellation wakes a sleeping collector even when native closure is already pending or has failed. The manager suppresses cancelled guest output and returns `draining` until native closure is confirmed; the final invocation's cancellation/error presentation remains host-owned. Waking the collector neither repeats a closer nor frees admission, prunes an unconfirmed cell, or claims successful termination. A noncancelled collector still waits normally for closure or its return deadline. No wait, execution, readiness or cleanup budget changes.

Deterministic state tests cover caller abort, context revocation and manager close with pending/rejected native closure. A separate installed fixture uses genuine SDK handlers and contained QuickJS with an intentionally held **owned test resource**, not an unkillable shell or a production cleanup bypass. Both native Responses routes check context revocation and manager close, prompt collector return, retained native draining ownership, once-only closure, and zero scopes after explicitly releasing the fixture. Its 14 synthetic requests/four scenarios are separate from the existing input/output cohorts. Native resource views expose identity and ownership operations; draining/closed accounting is observed through the native gateway, not inferred from an aborted signal or an invented resource-view state property.

## Native path and validation

1. Extension registers native grammar metadata; route/ownership/capability policy determines effective tool availability.
2. Pi's selected native Responses serializer emits the custom declaration. Its streaming parser reconstructs the `code` string, including quotes, Unicode and newline boundaries.
3. Native preparation/validation and ordinary call hooks run. The extension checks input again at execution, so post-validation hook changes do not bypass its pragma/field restrictions.
4. Genuine native invocation/scope authority admits the existing restricted worker. Delegations still traverse approvals, native hooks/events/accounting and protected finalized evidence.
5. Native result hooks complete before native history/provider replay. Custom call and custom output remain correlated. Hook errors stay visible; a successful cell does not prove every delegated action succeeded.

The offline test contract includes parser/delta/replay fixtures and actual installed native OpenAI **and** Codex Responses paths using synthetic per-request transports and authentication seams. Installed scenarios cover raw CRLF source with a real owned restricted cell/native read, invalid pragma, rejected legacy options, argument mutation, call blocking and finalized result-hook feedback. The input-transport helper retains both APIs, 24 synthetic model requests, 12 scenarios and confirmed native scope cleanup. A separate direct-output helper requires eight additional synthetic requests: a real restricted `exec` yields, and a native function-tool `wait` collects the same owning cell, through each provider's original SDK dispatcher. It checks custom/function output replay, literal before/after text, history preservation, per-call timing bounded by an independently observed interval and zero remaining scopes. Installed SDK checks additionally require zero-output failure/loss and structured details. Thirty-one named Code/settings/job TUI frames preserve the original twenty-seven and add current-format, expansion, hook-fallback and loss coverage. The separate direct Unified increment retains those 31 and appends five views, making the combined requirement 36. These are acceptance requirements, not evidence that an unvalidated head passed them. No live model/service, account entitlement, billing, WebSocket transport or upstream runtime conformance is inferred.

## Unresolved result and runtime work

The [ALL_TOOLS metadata helper](CODE-TOOL-METADATA.md) supplies bounded frozen native names/descriptions matching TOOL_NAMES; discovery never grants invocation authority. Raw transport does not make QuickJS an upstream V8 module, supply the remaining missing helpers or make wrapper results tool-specific Codex objects. Tool-specific nested projection, IDs/defaults, full hook/error/truncation equivalence, helper/notify ordering, Web/image references and continuation remain explicit dependencies. The separate direct Unified status/text adaptation is not completion of its exact target truncation/history or nested contracts. The new direct Code text/timing format does not complete those contracts or add inline image/audio helpers. Do not serialize internal `output_schema` into direct requests, guess child/chunk/job facts, fabricate protected evidence or derive authority from an identifier. No compatibility alias or heuristic JSON summary substitutes for a deliberate native result contract.

Ordinary tools, native model/provider/auth/cache ownership, Fast/footer, approvals, originals and notices are preserved. Restricted coordinator JavaScript does not sandbox delegated full-OS shell commands. Two active/draining scopes, four live shell processes, eight retained records and existing budgets remain unchanged; no unrestricted fallback or invocation-time compilation/download is introduced.
