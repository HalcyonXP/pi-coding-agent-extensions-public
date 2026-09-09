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
| Direct Code result | Still the native `CellOutcome` JSON text plus details. Native custom-call output pairing changes with the input kind, not the result payload. |
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

## Native path and validation

1. Extension registers native grammar metadata; route/ownership/capability policy determines effective tool availability.
2. Pi's selected native Responses serializer emits the custom declaration. Its streaming parser reconstructs the `code` string, including quotes, Unicode and newline boundaries.
3. Native preparation/validation and ordinary call hooks run. The extension checks input again at execution, so post-validation hook changes do not bypass its pragma/field restrictions.
4. Genuine native invocation/scope authority admits the existing restricted worker. Delegations still traverse approvals, native hooks/events/accounting and protected finalized evidence.
5. Native result hooks complete before native history/provider replay. Custom call and custom output remain correlated. Hook errors stay visible; a successful cell does not prove every delegated action succeeded.

The offline test contract includes parser/delta/replay fixtures and actual installed native OpenAI **and** Codex Responses paths using synthetic per-request transports and authentication seams. Installed scenarios cover raw CRLF source with a real owned restricted cell/native read, invalid pragma, rejected legacy options, argument mutation, call blocking and finalized result-hook feedback. The acceptance helper requires both APIs, 24 synthetic model requests, 12 scenarios and confirmed native scope cleanup. These are acceptance requirements, not evidence that an unvalidated head passed them. No live model/service, account entitlement, billing, WebSocket transport or upstream runtime conformance is inferred.

## Unresolved result and runtime work

Raw transport does not make QuickJS an upstream V8 module, supply missing helpers or make wrapper results tool-specific Codex objects. Direct versus nested output projection, IDs/defaults, full hook/error/truncation equivalence, helper/notify ordering, Web/image references and continuation remain explicit dependencies. Do not serialize internal `output_schema` into direct requests, guess wall/chunk/job facts, fabricate protected evidence or derive authority from an identifier. No compatibility alias or heuristic JSON summary substitutes for a deliberate native result contract.

Ordinary tools, native model/provider/auth/cache ownership, Fast/footer, approvals, originals and notices are preserved. Restricted coordinator JavaScript does not sandbox delegated full-OS shell commands. Two active/draining scopes, four live shell processes, eight retained records and existing budgets remain unchanged; no unrestricted fallback or invocation-time compilation/download is introduced.
