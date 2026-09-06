# OpenAI compatibility

One Pi extension provides a persistent Fast preference/shared compact footer and cohesive OpenAI capabilities. Pi **0.85.1** owns the native catalogs, models, auth, transports, pricing and cache behavior. This extension does not register replacement model/provider factories or backport Astra. Ordinary providers/tools remain available.

The locked native catalog includes openai-codex/gpt-6-astra and openai/gpt-6-astra. Authenticate normally with /login in a new isolated profile; choose the official provider/model through /model. Stock Pi supplies models/Fast support, but production Code mode additionally requires the [compatible patched host](../host-patches/pi-0.85.1/README.md).

## Independent controls

- /fast on, off, toggle or status: persistent preference; eligible official models receive service_tier: priority. Priority usage/cost is separate from subscription capability use and ordinary conversation billing. Unsupported routes remain inactive.
- /openai-tools status: passive availability inspection; no compile, worker launch, auth refresh or request.
- /openai-tools imagegen on|off: eligible official-route image generation is initially enabled.
- /openai-tools web_search on|off: fixed, bounded subscription Web profile; initially off.
- /openai-tools unified_exec on|off: exec_command/write_stdin; initially off.
- /openai-tools code_mode on|off: paired exec/wait on a compatible host/runtime; initially off.
- /openai-jobs and /openai-jobs cancel <session_id>: inspect or explicitly cancel owned Unified exec jobs.

Web, Unified exec and Code mode are independent session opt-ins and reset off on reload/new session. Image preference also follows session policy. Model/provider/lifecycle changes revoke pending authority; switching away and back cannot revive it. Recorded history is not erased. Fast is a separate persistent preference, including across genuine CLI restarts.

## Capability contracts

Hosted imagegen/Web use Codex subscription authentication only, with official conversation and service configurations checked before auth. No paid API fallback. Endpoint/model names alone do not establish trust; overridden/proxied providers are denied. Account entitlement and protocol availability may vary.

Imagegen accepts prompt, up to five workspace-local referenced_image_paths OR up to five recent pathless conversation images, and an optional safe workspace-relative PNG destination. Protected nested edits use native referenced_image_refs, not guest-chosen filesystem substitution. Service settings/model are fixed and automatic, not arbitrary API model/size/quality/background selectors. Canonical PNGs remain immutable; existing destinations are not overwritten. Ambiguous failures do not trigger automatic retries.

Web accepts one search query or initial absolute-public-URL open per call, using fixed gpt-5.4-mini with a short/low bounded profile. Domain filters are advisory, not enforcement. Preserve the full bounded source records and cite original URLs; no general find, deep research, opaque continuation or native citation-widget parity is promised.

Unified exec delegates full-OS shell commands, not a shell sandbox or PTY. Windows uses supervised Job Object/held-parent identities and a private readiness acknowledgement; POSIX process groups do not establish Windows crash equivalence. Exact native scope/context identity owns nested returned jobs and stdin, not a returned string ID. Unconfirmed cleanup stays draining.

Code mode runs a bounded QuickJS async-function body, not ambient Node/V8. exec accepts code, yield_time_ms and max_output_tokens; wait accepts cell_id, yield_time_ms, max_tokens and terminate. Helpers include tools.NAME(args), text, store/load, image/evidence and yield_control. At most 32 eligible native tool names are exposed; exec/wait recursion is denied. Zero guest text cannot suppress protected finalized source/image evidence. Coordinator restrictions do not constrain the OS permissions of explicitly delegated native tools.

See [architecture/limits](../docs/openai-integration/ARCHITECTURE.md), [supported/deviating surface](../docs/openai-integration/FINAL-ACCEPTANCE.md), and the [isolated profile guide](../docs/openai-integration/PRIVATE-RELEASE.md). Never load the retired standalone imagegen directory as a second implementation or select an unrestricted fallback.

## Development

From the repository root: npm ci --ignore-scripts --prefix openai-compatibility, then node .github/scripts/validate-openai.mjs. This uses offline guards and temporary storage. Source tests are not a binary release, live-service proof or permission to modify an active installation. [Full host/build commands](../docs/openai-integration/VALIDATION.md) use separate prepared directories and pinned inputs.

[Third-party notices](THIRD_PARTY_NOTICES.md) and [Apache-2.0 license](LICENSE) are preserved. The hosted OpenAI backend is not distributed by this repository.
