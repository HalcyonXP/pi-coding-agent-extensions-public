# OpenAI compatibility

One Pi extension provides a persistent Fast preference/shared compact footer and cohesive OpenAI capabilities. Pi **0.85.1** owns the native catalogs, models, auth, transports, pricing and cache behavior. This extension does not register replacement model/provider factories or backport Astra. Ordinary providers/tools remain available.

The locked native catalog includes openai-codex/gpt-6-astra and openai/gpt-6-astra. Authenticate normally with /login in a new isolated profile; choose the official provider/model through /model. Stock Pi supplies models/Fast support, but production Code mode additionally requires the [compatible patched host](../host-patches/pi-0.85.1/README.md).

## Settings menu

In the terminal, **`/openai-tools`** is the single OpenAI entry point, using Pi's native searchable `SettingsList`. Fast and the owned-jobs view are inside it; there are no standalone `/fast` or `/openai-jobs` commands. Values sit beside their labels, with a description for the selected row. Use Up/Down, type to filter, Enter/Space to change, or the native mouse controls. The menu stays open after changes. **Changes apply immediately; Esc closes, it does not undo them.** Narrow terminals ask you to widen the view rather than change invisible controls.

Fast is saved for this Pi profile; tool switches are session-only. An inactive Fast preference remains visibly on with the reason in its description. Unavailable/excluded/conflicting capabilities are read-only and explain why; neither this menu nor on commands can bypass rollback exclusions. Route, configured OAuth and native-runtime rows are passive information, not entitlement or execution authority. Runtime preflight distinguishes ready, busy and draining. Status is checked on open and after changes, not a live job monitor.

Opening the menu never refreshes credentials, launches a worker/compiler or calls a model/service. Pending updates show `applying…`, not optimistic success; failures refresh actual values, or freeze unknown state until reopened. Close/session/model changes revoke pending menu work. Tool preference changes preserve the existing cancellation behavior for running capability work. Pi's own `/settings`, model selection, ordinary tools and Fast/footer ownership are not replaced.

The **Jobs** row opens a same-session snapshot inside this menu. Enter a job to choose Keep or confirm cancellation; unconfirmed cleanup stays visible and can only be retried explicitly. Refresh updates the snapshot and resets the jobs filter; Esc returns to the parent list without losing its filter. Completed effects are never undone. Closing/model/session changes revoke pending UI actions; no job is launched by inspection.

Explicit subcommands remain available below. `/openai-tools fast status`, `/openai-tools jobs status` and `/openai-tools status` always produce text. Bare commands in RPC/non-terminal contexts retain text status rather than open a modal. `/openai-tools fast` or `/openai-tools jobs` focuses that row in the same TUI menu.

## Independent controls

- /openai-tools fast on, off, toggle or status: persistent preference; eligible official models receive service_tier: priority. Priority usage/cost is separate from subscription capability use and ordinary conversation billing. Unsupported routes remain inactive.
- /openai-tools status: passive availability inspection; no compile, worker launch, auth refresh or request.
- /openai-tools imagegen on|off: eligible official-route image generation is initially enabled.
- /openai-tools web_search on|off: fixed, bounded subscription Web profile; initially off.
- /openai-tools unified_exec on|off: exec_command/write_stdin; initially off.
- /openai-tools code_mode on|off: paired exec/wait on a compatible host/runtime; initially off.
- /openai-tools jobs status and /openai-tools jobs cancel <session_id>: inspect or explicitly cancel this session's owned Unified exec jobs. The existing --fast startup flag, saved preference and shared footer remain; only redundant command entry points were removed.

Web, Unified exec and Code mode are independent session opt-ins and reset off on reload/new session. Image preference also follows session policy. Model/provider/lifecycle changes revoke pending authority; switching away and back cannot revive it. Recorded history is not erased. Fast is a separate persistent preference, including across genuine CLI restarts.

## Capability contracts

Hosted imagegen/Web use Codex subscription authentication only, with official conversation and service configurations checked before auth. No paid API fallback. Endpoint/model names alone do not establish trust; overridden/proxied providers are denied. Account entitlement and protocol availability may vary.

Imagegen accepts prompt, up to five workspace-local referenced_image_paths OR up to five recent pathless conversation images, and an optional safe workspace-relative PNG destination. Protected nested edits use native referenced_image_refs, not guest-chosen filesystem substitution. Service settings/model are fixed and automatic, not arbitrary API model/size/quality/background selectors. Canonical PNGs remain immutable; existing destinations are not overwritten. Ambiguous failures do not trigger automatic retries.

Web accepts one search query or initial absolute-public-URL open per call, using fixed gpt-5.4-mini with a short/low bounded profile. Domain filters are advisory, not enforcement. Preserve the full bounded source records and cite original URLs; no general find, deep research, opaque continuation or native citation-widget parity is promised.

Unified exec delegates full-OS shell commands, not a shell sandbox or PTY. On Windows x64 it requires the verified prebuilt helper: PowerShell loads its independent Job Object type as a library, with no per-launch compilation/download or unverified fallback. The restricted coordinator executable entry point and limits remain unchanged. Windows uses supervised Job Object/held-parent identities and a private readiness acknowledgement; POSIX process groups do not establish Windows crash equivalence. Exact native scope/context identity owns nested returned jobs and stdin, not a returned string ID. Unconfirmed cleanup stays draining.

Code mode runs a bounded QuickJS async-function body, not ambient Node/V8. exec accepts code, yield_time_ms and max_output_tokens; wait accepts cell_id, yield_time_ms, max_tokens and terminate. Helpers include tools.NAME(args), text, store/load, image/evidence and yield_control. At most 32 eligible native tool names are exposed; exec/wait recursion is denied. Zero guest text cannot suppress protected finalized source/image evidence. Coordinator restrictions do not constrain the OS permissions of explicitly delegated native tools.

### Code mode diagnostics and desktop tasks

Code mode is not a built-in computer-use/desktop-control service. PowerShell automation may be deliberately delegated, but foreground focus, window titles, permissions and application lifecycle need their own verification. Normal child processes are owned: finishing a cell closes its returned shell jobs/descendants, so launching a background GUI does not create an independent persistent desktop session. This does not establish the cause of any earlier failure; do not disable cleanup or automatically replay a partially completed action.

Use `await tools.NAME(args)` and inspect the returned `{result,isError}`. Unified exec data lives under `result.details` (`output`, `running`, `exit_code`, `session_id`), not top-level `output`; a returned native result is not proof that a GUI action succeeded. Poll `tools.write_stdin` within the original owning cell; `wait` polls the cell rather than adopting a shell job. Emit non-sensitive checkpoints where needed.

A failed cell retains its stable error code plus bounded `result.diagnostics`: guest phase (initialize/compile/execute/await, or unknown when not observed), delegation/result/error counts, the last-started delegation's fixed category and bounded shell observations. Concurrent completions do not relabel another call's result. These fields never include exception messages/stacks, source, commands, paths, IDs or output text. `effects: not_determined` is intentional: neither a thrown guest error nor a closed process proves which external effects occurred. Raw guest exceptions remain withheld, including objects with hostile getters. Native cleanup/publication authority and output limits are unchanged.

See [architecture/limits](../docs/openai-integration/ARCHITECTURE.md), [supported/deviating surface](../docs/openai-integration/FINAL-ACCEPTANCE.md), and the [isolated profile guide](../docs/openai-integration/PRIVATE-RELEASE.md). Never load the retired standalone imagegen directory as a second implementation or select an unrestricted fallback.

## Development

From the repository root: npm ci --ignore-scripts --prefix openai-compatibility, explicitly prepare the pinned compiler inputs on Windows, then node .github/scripts/validate-openai.mjs. The validator builds/verifies the prebuilt assembly before native shell tests; standalone Windows `npm test` also needs that explicit build first. This uses offline guards and temporary storage. Source tests are not a binary release, live-service proof or permission to modify an active installation. [Full host/build commands](../docs/openai-integration/VALIDATION.md) use separate prepared directories and pinned inputs.

[Third-party notices](THIRD_PARTY_NOTICES.md) and [Apache-2.0 license](LICENSE) are preserved. The hosted OpenAI backend is not distributed by this repository.
