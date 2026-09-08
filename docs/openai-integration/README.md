# Integration guide and glossary

This guide describes the public source's implementation and constraints, not an inherited private project's approval history. The target is **Codex-compatible observable tool behavior within Pi**, not merely similar names. See the pinned [compatibility contract and remaining gaps](CODEX-COMPATIBILITY.md). Read [architecture](ARCHITECTURE.md), [supported/deviating surface](FINAL-ACCEPTANCE.md), [validation](VALIDATION.md), [security](SECURITY.md), [local preview versus public release](LOCAL-PREVIEW.md) and [isolated installation](PRIVATE-RELEASE.md).

| Term | Agreed meaning |
| --- | --- |
| Native/upstream models | Pi 0.85.1's own catalog/auth/transport/cache behavior; no extension provider factory or model backport |
| Patched/private host | Genuine pinned Pi source plus the explicit twenty-path native patch; not stock Pi, an official upstream binary, or a visibility claim |
| Code mode | Independently opted-in paired exec/wait with a saved profile choice, bounded QuickJS cells and current native ownership; not ambient Node/V8 |
| Unified exec | Full-OS pipe-based shell delegation via exec_command/write_stdin; not a shell sandbox or PTY |
| Supervisor readiness | Private shell-supervisor preamble received; not child acknowledgement receipt, user-command success or native authority |
| Scope/context identity | Native branded authority and lifecycle identity, not guest IDs, metadata or strings |
| Protected evidence | Finalized native descendants or direct completion evidence persisted/published through native ownership outside guest text projection; not another live model turn or fsync/crash recovery |
| Draining | Native resources/publication whose closure is not yet confirmed; still consumes admission |
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
| Saved preference | Profile-local Fast or capability choice restored across new sessions/reload/restart; not credentials, jobs, entitlement or native authority |
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
| Readable Code result | Native exec/wait TUI status plus literal coordinator text; expandable cell metadata, unchanged wire/history, no guessed summaries of arbitrary JSON |
| Cell completion | The cell returned a terminal result; a failed cell is labelled failed. Not a blanket assertion that all delegated jobs succeeded |
| Output omission | Bytes already omitted by the existing guest-output budget; prominently reported, not recoverable merely by expanding the UI |
| Safe model step | Next native model request after valid tool-result ordering permits queued evidence; never modification of an already in-flight request |
| Idle turn | New assistant/model execution without another user request; completion reporting does not start one |
| Result retention | Up to eight in-memory process/output records; no completed-result poll TTL; eligible completed least-recently-collected records can be evicted for capacity |
| Settings availability | Passive route/ownership/preflight snapshot on open/change; unavailable rows explain why and cannot override exclusions |
| Standing project authorization | Delegated in-scope decisions and delivery planning; never a waiver of technical/privacy gates or permission to bypass guards |

Original first-party documentation in this directory is licensed under [Apache-2.0](LICENSE); see [scope and attribution](NOTICE). Other source components and third-party works retain their own terms.

Stable error/workflow/package names containing “private” are retained compatibility labels. Historical code-comment design labels do not import an unpublished acceptance record. No routine test grants permission for new live service calls or consumes a prior validation authorization.
