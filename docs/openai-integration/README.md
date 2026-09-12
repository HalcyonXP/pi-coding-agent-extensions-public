# Integration guide and glossary

This guide describes the public source's implementation and constraints, not an inherited private project's approval history. The target is **Codex-compatible observable tool behavior within Pi**, not merely similar names. See the pinned [compatibility contract and remaining gaps](CODEX-COMPATIBILITY.md). Read [architecture](ARCHITECTURE.md), [supported/deviating surface](FINAL-ACCEPTANCE.md), [validation](VALIDATION.md), [security](SECURITY.md), [local preview versus public release](LOCAL-PREVIEW.md) and [isolated installation](PRIVATE-RELEASE.md).

Use the [delivery plan](DELIVERY-PLAN.md) for coherent implementation batches, focused development commands and milestone acceptance. Functional completion and public redistribution remain separate.

| Term | Meaning in this project |
| --- | --- |
| Native/upstream models | Pi 0.85.1's own catalog/auth/transport/cache behavior; no extension provider factory or model backport |
| Patched/private host | Genuine pinned Pi source plus the explicit twenty-path native patch; not stock Pi, an official upstream binary, or a visibility claim |
| Code mode | Independently opted-in paired exec/wait with a saved profile choice, bounded QuickJS cells and current native ownership; not ambient Node/V8 |
| Native Code input | Raw-JavaScript custom provider tool, mapped by Pi to internal `{code}`; options in a first-line pragma, not top-level JSON fields. Wait remains JSON. See [input/result boundaries](NATIVE-CODE-CONTRACT.md). |
| Code projection | Default `tools` guest view for recognized normal Unified results, with full native-wrapper fallback; `nativeTools` preserves raw access and `projectedTools` is an identical alias. Legacy scripts need migration; native evidence/authority is unchanged. See [projection contract](CODE-RESULT-PROJECTION.md). |
| Web text projection | Working-source canonical `web_search` guest string after complete native publication and RPC admission; includes all literal text and opaque source associations. Not a Web reference, native citation renderer or new installed acceptance. |
| Web consistency stamp | `details.web_result` content/label checksum checked after hooks; not a signature or authority. A native post-publication hint permits the guest text view, never extra admission. |
| Web admission profile | Working-source saved `verified-v1`/`experimental` schema choice; applies only after extension reload/restart, not a Pi installation profile or execution authority. [Saved/effective contract](WEB-PROFILES.md). |
| Web service reference | Opaque remote `ref_id`, distinct from a native `ev_...` evidence reference. Opaque IDs/citation syntax are not currently admitted as continuation authority; public-URL open remains separate. |
| Native grammar capability | Selected Pi model's explicit grammar-tool support; absence disables Code without a JSON-provider fallback, not an execution-authority grant |
| Unified exec | Full-OS pipe-based shell delegation via exec_command/write_stdin; not a shell sandbox or PTY |
| Supervisor readiness | Private shell-supervisor preamble received; not child acknowledgement receipt, user-command success or native authority |
| Scope/context identity | Native branded authority and lifecycle identity, not guest IDs, metadata or strings |
| Unified session ID | Positive numeric lookup key, not a PID or scope/call identity. Native IDs stay opaque strings; history rendering does not restore live lookup authority. See [ID lifecycle](NATIVE-UNIFIED-CONTRACT.md#numeric-lookup-ids). |
| Protected evidence | Finalized native descendants or direct completion evidence persisted/published through native ownership outside guest text projection; not another live model turn or fsync/crash recovery |
| Draining | Native resources/publication whose closure is not yet confirmed; still consumes admission |
| Collector cancellation | Wakes the current Code exec/wait collection without waiting out its return timer; not confirmation of native closure or release of draining admission |
| Profile | New isolated configuration/workspace bound to an immutable bundle; not an imported active installation |
| Source acceptance | Exact-head local/hosted validation and labelled review; distinct from reproducible artifact and installed-profile acceptance |
| AI-assisted self-review | A COMMENTED review pinned to head/base, not independent approval |
| Public source | This repository's sanitized fresh history and implementation; not old private records, a paid entitlement guarantee or a prebuilt release |
| Release contract | [Scope, externally trusted pins and delivery gates](RELEASE-CONTRACT.md); not authorization to publish assets |
| Download pin verification | Offline byte/identity matching against already trusted archive/manifest/source/version pins; not signature verification, archive inspection or installation |
| Local preview ready | Accepted-merge-specific artifact/installed checks and verified new-path local handoff; not a public binary release or redistribution clearance |
| Release availability | Authorized assets actually uploaded and downloaded/verified; not source acceptance, a local handoff or an Actions provenance artifact |
| Runtime payload | Manifested files delivered in the immutable archive; not every build input or upstream example |
| Retained build inputs | Original locked host tarballs and excluded demo files preserved byte-identically beside the build output, outside the delivered archive |
| Redistribution review | [Actual package, bundled-code and embedded-work coverage](REDISTRIBUTION.md); notice candidates and zero returned advisories are not clearance |
| OpenAI controls | One `/openai-tools` entry point with saved Fast/capability preferences and the nested owned-jobs view; explicit subcommands retain non-TUI control |
| Cell diagnostics | Fixed guest phase plus host-observed delegation/result counters and shell categories; not exception text, application success or proof of external effects |
| Jobs snapshot | Passive same-session process records; cancellation is explicit user control over owned handles, not arbitrary-PID lookup or automatic retry |
| Saved preference | Profile-local Fast/capability/wait choice; Web admission changes specifically require extension reload/restart. Never restore live work; not credentials, jobs, entitlement or native authority |
| Effective switch | Saved choice currently applicable under route/ownership/exclusions/preflight; an inactive choice is retained, not permission to bypass a gate |
| Direct job | Returned shell owned by the original native conversation context; cell jobs additionally require their original scope |
| Completion collection | Consuming write_stdin read of output/status; a terminal result without session_id finishes collection |
| Completion report | Once-only native asynchronous terminal evidence for a direct job whose initial response was running; a bounded non-consuming snapshot of uncollected output, not the whole transcript or diagnostic metadata |
| Quiet local poll | Opted-in native cell-owned empty-stdin call with unchanged empty-running output; hidden in the updated native TUI and omitted from ordinary model-facing audits, not from native accounting |
| Tool-return audit | A finalized invocation returned; background work may still run. Not a process-completion report or a new model request |
| Poll visibility | Direct/model-issued calls, input/control, updates, output/loss, errors and terminal results remain visible; no inference about billed quota from card counts |
| Compact local-job group | Native TUI-only scoped shell-call view: short safe output/status rows, expandable original cards/audit text/correlation, no new execution or persistence authority |
| Audit-only replay | Grouped recorded returned-call text without restored running jobs, process status or cleanup claims; not a Jobs snapshot |
| Coordinator output | Guest-selected text() strings; prefer concise labelled facts for people, JSON only when needed/requested. Not protected evidence or authoritative job status |
| Readable Code result | Native exec/wait TUI status plus literal coordinator text; expansion does not change wire/history. Exact historical JSON and current text/details remain readable; no guessed summaries of arbitrary JSON |
| Direct Code output | Model-facing script status, measured call time and literal coordinator text; structured outcome remains in native details, not a direct JSON envelope or a nested projection |
| Code call wall time | Monotonic elapsed milliseconds around one awaited exec/wait operation, recorded as `details.code_result`; not cell age, delegated-process runtime, CPU usage or billing |
| Direct Unified output | Model-facing process status, per-call time and literal returned shell output; native details remain structured, nested JSON and protected completion reports are separate |
| Unified call wall time | Monotonic elapsed milliseconds around one awaited manager start/write, recorded as `details.unified_result`; not process age, retention, CPU use or billing |
| Retained exited ID | An exited process's lookup for remaining buffered output, not a running process or authority to adopt another context's job |
| Cell completion | The cell returned a terminal result; a failed cell is labelled failed. Not a blanket assertion that all delegated jobs succeeded |
| Code output omission | Bytes already omitted by the existing guest-output budget; prominently reported, not recoverable merely by expanding the UI |
| Omitted Unified controls | Initial wait10,000 ms; empty stdin5,000 ms/nonempty250 ms; output10,000 approximate tokens. Separate from Code defaults and execution budgets |
| Requested Unified wait | Non-negative safe-integer request clamped before native work: Windows initial10,000–30,000 ms (other platforms250–30,000); empty stdin5,000 to the profile ceiling (default/hard maximum300,000); nonempty250–30,000. Zero selects the floor; closure/cancellation can end collection sooner, without enlarging process lifetime or certifying cleanup |
| Nested output slice | UTF-8 collection bounded by the complete serialized native wrapper; unread bytes retain their original ID, distinct from lost output and later hook/aggregate-limit failures |
| Unified output loss | Bytes already dropped from the shell buffer, not unread retained output; further polling or expansion cannot recover the dropped bytes |
| Safe model step | Next native model request after valid tool-result ordering permits queued evidence; never modification of an already in-flight request |
| Idle turn | New assistant/model execution without another user request; completion reporting does not start one |
| Result retention | Up to eight in-memory process/output records; no completed-result poll TTL; eligible completed least-recently-collected records can be evicted for capacity |
| Settings availability | Passive route/ownership/preflight snapshot on open/change; unavailable rows explain why and cannot override exclusions |
| Standing project authorization | Delegated in-scope decisions and delivery planning; never a waiver of technical/privacy gates or permission to bypass guards |
| Exposed tool contract | Selected registration/schema, dispatch/defaults and output projection at a pinned source; not an internal argument type or a hosted-service/training guarantee |
| Nested projection | Tool-specific object/string returned to coordinator JavaScript; distinct from provider-facing direct output, native evidence and the current Pi result/isError wrapper |
| Output schema metadata | Source metadata that may inform nested descriptions; not necessarily serialized into a direct provider request |
| ALL_TOOLS | Frozen per-cell `{name,description}` snapshot of eligible native tools, matching TOOL_NAMES; [discovery data](CODE-TOOL-METADATA.md), not schemas, callbacks, current entitlement or native authority |
| Nested JSON-string argument | [Serialized object parsed inside QuickJS](CODE-COORDINATOR-COMPATIBILITY.md) before ordinary native validation, not arbitrary freeform input or tool authority |
| Image-reference forwarding | Passing an img_ reference or projected PNG/JPEG/GIF/WebP block to image(); it must resolve to existing journaled same-context evidence, never caller-replaced bytes or network URLs |
| Inline image publication | Working-source image() admission of canonical inline PNG/JPEG/GIF/WebP up to32KiB decoded. Native protected messages label guest provenance and issue references only after publication; not a native tool result or generation/save receipt. See [media inputs](MEDIA-INPUTS.md). |
| Generated-image publication | `generatedImage({image_url,output_hint?})` forwards owned/inline pixels with an unverified hint; no generation/save/fetch. Normal imagegen projection uses reference-valued image_url as explicit Pi adaptation. [Media contract](MEDIA-INPUTS.md). |
| Helper failure | Fixed allowlisted classification of an unhandled helper-created error; not inspection of arbitrary guest exception text. See [helper feedback](CODE-COORDINATOR-COMPATIBILITY.md). |
| Callable alias | Unambiguous hyphen-to-underscore tools entry dispatching the original native name; exact native entries win, metadata and authority stay unchanged. |
| Coordinator disposal | Ends admission of queued coordinator callbacks and ignores late results; native scopes still close already-delegated work |

The [pinned exposed-contract record](CODEX-TOOL-CONTRACTS.md) separates those surfaces and retains the PR #18 audit baseline. The [native Code contract](NATIVE-CODE-CONTRACT.md) and separate [direct Unified contract](NATIVE-UNIFIED-CONTRACT.md) describe deliberate direct-output transitions, SDK migration to structured details and unresolved nested/result work. [GitHub completion tracker #16](https://github.com/HalcyonXP/pi-coding-agent-extensions-public/issues/16) owns the remaining compatibility sequence; issue #3 remains the separate public-release tracker.

Original first-party documentation in this directory is licensed under [Apache-2.0](LICENSE); see [scope and attribution](NOTICE). Other source components and third-party works retain their own terms.

Stable error/workflow/package names containing “private” are retained compatibility labels. Historical code-comment design labels do not import an unpublished acceptance record. No routine test grants permission for new live service calls or consumes a prior validation authorization.
