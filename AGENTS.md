# Pi Coding Agent Extensions

This is a public source repository, not the active Pi installation. Develop and validate in isolated directories/profiles. Never import credentials, modify global settings/SDKs, or run live hosted-service checks as part of routine validation.

- Preserve native model/provider ownership, ordinary tools, Fast/footer, generated originals and required third-party notices.
- Code mode requires the compatible patched Pi host, Windows x64, Node 24/25 and the verified prebuilt helper. No unrestricted/portable fallback or invocation-time compilation/download.
- Restricted coordinator JavaScript does not sandbox deliberately delegated shell commands.
- Public shell session IDs are lookup values, not native scope/call IDs or authority. ID-contract changes must update native quiet-poll/grouping classification and matched host artifacts together; retain historical rendering without admitting historical IDs to live tools.
- Working-source Code API migration: `tools` now projects recognized normal Unified data after the unchanged RPC/evidence boundary; `nativeTools` preserves raw `{result,isError}` and `projectedTools === tools` preserves the earlier alias. Wrapper-based Unified scripts must migrate explicitly; do not rewrite history or old bundles. Errors, loss, hook changes and protected evidence retain full wrappers. Private bridge timing is not process runtime; full Codex API parity and this batch's installed acceptance remain unestablished. See `docs/openai-integration/CODE-RESULT-PROJECTION.md`.
- Unified's separate `unified-preferences.ts` store and `/openai-tools background-wait` control a 5,000–300,000 ms empty-poll ceiling. Snapshot per call; do not reset jobs or widen native budgets. Invalid saved policy blocks Unified activation, not other capabilities or Jobs cancellation; preserve malformed files. Existing four-boolean preferences and Fast storage stay separate. See `NATIVE-UNIFIED-CONTRACT.md` in the integration docs.
- Read docs/openai-integration/README.md for shared terms and docs/openai-integration/VALIDATION.md for exact commands and acceptance boundaries.
- Public Git history uses a non-personal maintainer identity. Do not publish personal email, machine-specific paths, private records, credentials, local receipts or user artwork. See PUBLICATION.md.
- Require exact-head checks and a labelled COMMENTED AI-assisted self-review before guarded integration. A self-review is not independent approval; local tests do not replace hosted CI or installed-artifact acceptance.
- Never use a default server-side merge that can select a personal account email. Verify every new commit's author/committer before upload, including merges. No automatic release/deployment from Actions.

## Development cadence and navigation

- Follow `docs/openai-integration/DELIVERY-PLAN.md`: coherent coordinator/shell, Web/media and lifecycle/context batches; public release remains separate. Keep one active functional batch, use focused checks during implementation, and perform full mandatory acceptance at completed milestones—not after each small edit.
- From the verified feature-branch root, `node .github/scripts/develop-openai.mjs --list` lists reusable focused suites; e.g. `node .github/scripts/develop-openai.mjs coordinator unified types`. Requires existing dependencies/helper. It creates isolated per-suite profiles and new private `.pi/development/` byte logs/input snapshots, never builds/downloads, replaces the shared full-validation receipt, or performs integration/delivery. For working-source native probes, add `--sdk-bundle <workspace-local accepted bundle>` before `native-projection native-wait`; this checks existing bundle bytes/current patch and loads source only inside isolated children, not artifact acceptance. Run the session guard preflight separately.
- Do not create another near-identical controller tree or handoff for a helper-sized change. Keep exact-head source, resulting-master and actual-copy gates, failed evidence, historical freezes and required review/CI controls. Never treat an architectural adaptation or unverified gap as completed compatibility.

## Canonical development target and local guards

- Develop only in the fresh public repository: https://github.com/HalcyonXP/pi-coding-agent-extensions-public (GitHub repository ID `R_kgDOUQewAQ`). Before edits, confirm the Git worktree/common directory, exact origin, repository identity and non-personal commit identity. Folder names alone are not authority.
- Installation and private-history checkouts are not development targets. Never repoint an old checkout to this public origin or import its Git history. Use feature branches and retain the existing exact-head review/CI/integration gates.
- Maintainer-local accident guards may be installed under the Git common directory's `workspace-guard/`. They are local configuration, not a portable sandbox or inherited protection for fresh clones. When present, run the preflight before work and use its explicitly scoped GitHub wrapper:

```powershell
$guard = Join-Path (git rev-parse --path-format=absolute --git-common-dir) 'workspace-guard/guard.mjs'
node $guard preflight --online
node $guard github pr view 1
```

- The local commit hooks check identity/staged privacy; push hooks check destination, available history and pinned secret scans. GitHub wrapper operations pin this repository and refuse repository overrides, URL selectors, raw API/admin, server-side merge, release and deployment commands. These checks do not supply review/CI approval or authorize integration.
- A new clone does not inherit local hooks. Establish equivalent safeguards before writes; do not interpret a missing hook as permission to skip repository, identity, privacy or acceptance checks. Pinned local validators require deliberate maintenance after reviewed updates, not automatic replacement with unreviewed source.
