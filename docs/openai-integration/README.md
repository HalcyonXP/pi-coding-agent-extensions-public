# Integration guide and glossary

This guide describes the public source's implementation and constraints, not an inherited private project's approval history. Read [architecture](ARCHITECTURE.md), [supported/deviating surface](FINAL-ACCEPTANCE.md), [validation](VALIDATION.md), [security](SECURITY.md), [local preview versus public release](LOCAL-PREVIEW.md) and [isolated installation](PRIVATE-RELEASE.md).

| Term | Agreed meaning |
| --- | --- |
| Native/upstream models | Pi 0.85.1's own catalog/auth/transport/cache behavior; no extension provider factory or model backport |
| Patched/private host | Genuine pinned Pi source plus the explicit fifteen-path native patch; not stock Pi, an official upstream binary, or a visibility claim |
| Code mode | Session-opt-in paired exec/wait with bounded QuickJS cells and native ownership; not ambient Node/V8 |
| Unified exec | Full-OS pipe-based shell delegation via exec_command/write_stdin; not a shell sandbox or PTY |
| Scope/context identity | Native branded authority and lifecycle identity, not guest IDs, metadata or strings |
| Protected evidence | Finalized native descendants persisted/published outside guest text projection; not another live model turn or fsync/crash recovery |
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
| Settings value | Current saved Fast preference or applicable session tool switch; not service entitlement or native execution authority |
| Settings availability | Passive route/ownership/preflight snapshot on open/change; unavailable rows explain why and cannot override exclusions |
| Standing project authorization | Delegated in-scope decisions and delivery planning; never a waiver of technical/privacy gates or permission to bypass guards |

Original first-party documentation in this directory is licensed under [Apache-2.0](LICENSE); see [scope and attribution](NOTICE). Other source components and third-party works retain their own terms.

Stable error/workflow/package names containing “private” are retained compatibility labels. Historical code-comment design labels do not import an unpublished acceptance record. No routine test grants permission for new live service calls or consumes a prior validation authorization.
