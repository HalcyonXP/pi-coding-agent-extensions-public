# Code result projection and API migration

**Working source transition, not a new accepted installation:** cell `tools.NAME(args)` now projects recognized normal Unified results by default. `nativeTools.NAME(args)` preserves the original `{result,isError}` guest contract; `projectedTools` remains the identical object as `tools` for scripts using the earlier opt-in API. This deliberately supersedes PR #31's default-wrapper behavior. It does not rewrite old source, history or installed bundles, and does not establish full Codex API parity.

All three names expose the same eligible canonical tools/aliases and object/JSON-object-string argument rules, delegating through the same native controls. `ALL_TOOLS`/`TOOL_NAMES`, permissions, hooks, accounting and ownership are unchanged. Non-cell probes keep their original `tools.call` API and expose neither added namespace.

## Migration before installation

Scripts that read Unified `r.result.details` must call `nativeTools.exec_command` / `nativeTools.write_stdin` instead of `tools`, or handle the new projected/fallback contract below. For scripts shared with the previous accepted runtime, bind `const raw = typeof nativeTools === "undefined" ? tools : nativeTools;` and use `raw.NAME(args)`. This preserves wrapper-based code, not the old meaning of an unchanged `tools` expression. No automatic script rewriting or action replay occurs.

## Terms and return contract

- **Native wrapper:** the finalized `{result,isError}` crossing the existing RPC/evidence boundary. It remains authoritative for native presentation, hooks and protected evidence.
- **Default Unified projection:** a guest-only data view for canonical `exec_command` and `write_stdin`, created after ordinary result validation and budgeting. Unknown tools, including differently named tools with similar aliases, retain their wrappers.
- **Bridge wall time:** coordinator-observed monotonic elapsed time around one native invocation, rounded to milliseconds and expressed as `wall_time_seconds`. This includes transport/coordination overhead, not just process execution, and is not supplied by guest clocks or result metadata. It does not claim the upstream handler's exact timing semantics.

Recognized normal results become `{wall_time_seconds, output, exit_code?, session_id?}`. The optional fields are omitted when unavailable; chunk IDs and original-token counts are not invented. A nonzero exit is data, not necessarily a tool error. A numeric `session_id` can refer to unread output after exit: collect it within the same owning cell rather than assume the process is running. It is never native authority or a PID.

**Fallback preserves information.** Errors, dropped-output counts, unready/terminated states, protected evidence/images, extra fields and content changed by hooks remain complete native wrappers. Projection requires the single text block to match the known scalar details. Callers must handle both shapes:

```javascript
let r = await tools.exec_command({cmd: "echo projection"});
if (Object.hasOwn(r, "output")) {
  text(r.output);
  // Collect any r.session_id with tools.write_stdin in this cell.
} else {
  // Inspect and report the native error/warning/loss/evidence, never discard it.
  text(JSON.stringify(r));
}
```

`text()` still accepts primitives only. The adapter does not inspect or coerce arbitrary guest error objects. It parses native result JSON using captured intrinsics; private timing is associated with that decoded reply, not accepted from guest properties. The raw wrapper is checked against the existing64KiB per-result and aggregate budgets **before** projection. Smaller guest views do not expand the shell's collection allowance or consume more unread output. No native patch, helper recompilation, alternate provider route or shell sandbox is introduced.

## Scope and verification

The field names follow the pinned [Unified source-inspection contracts](CODEX-TOOL-CONTRACTS.md). Upstream execution, full default-API compatibility, identical timing/error/truncation behavior and projections for other tools remain unestablished. This migration only makes the already bounded Unified projection the default. The explicit legacy namespace avoids losing raw access; callers still need the documented source change.

Runtime tests cover shape admission/fallback, private intrinsics, alias identity, ordinary wrappers, bounded workers and the contained Windows path. `distribution/accept-projected-tools.mjs` adds isolated installed-SDK checks on both native Responses routes: default nonzero completion, numeric-ID collection through the retained `projectedTools` alias, default hook-warning fallback and unchanged raw wrappers through `nativeTools`. It retains native events, payload/history observations, scopes and cleanup failures; uses synthetic auth/transport; keeps auto-compaction enabled; and makes16 synthetic requests/eight scenarios, with zero live calls. Development on an accepted predecessor SDK is not new-artifact acceptance. Exact source, hosted checks, resulting master and copied installation remain separate gates.

Automatic issue closures: none.
