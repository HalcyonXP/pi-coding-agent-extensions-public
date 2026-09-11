# Opt-in Code result projection

`projectedTools` is a Pi-specific migration aid, not an upstream namespace or default-API parity claim. Existing `tools.NAME(args)` calls continue returning native `{result,isError}`. Both namespaces expose exactly the same eligible canonical names and unambiguous aliases, use the same object/JSON-object-string argument rules, and delegate through the same native controls. `ALL_TOOLS`/`TOOL_NAMES`, permissions, hooks, accounting and ownership are unchanged. Non-cell probes do not expose this namespace.

## Terms and return contract

- **Native wrapper:** the finalized `{result,isError}` crossing the existing RPC/evidence boundary. It remains authoritative for native presentation, hooks and protected evidence.
- **Opt-in projection:** a guest-only data view for canonical `exec_command` and `write_stdin`, created after ordinary result validation and budgeting. Unknown tools, including differently named tools with similar aliases, retain their wrappers.
- **Bridge wall time:** coordinator-observed monotonic elapsed time around one native invocation, rounded to milliseconds and expressed as `wall_time_seconds`. This includes transport/coordination overhead, not just process execution, and is not supplied by guest clocks or result metadata. It does not claim the upstream handler's exact timing semantics.

Recognized normal results become `{wall_time_seconds, output, exit_code?, session_id?}`. The optional fields are omitted when unavailable; chunk IDs and original-token counts are not invented. A nonzero exit is data, not necessarily a tool error. A numeric `session_id` can refer to unread output after exit: collect it within the same owning cell rather than assume the process is running. It is never native authority or a PID.

**Fallback preserves information.** Errors, dropped-output counts, unready/terminated states, protected evidence/images, extra fields and content changed by hooks remain complete native wrappers. Projection requires the single text block to match the known scalar details. Callers must handle both shapes:

```javascript
let r = await projectedTools.exec_command({cmd: "echo projection"});
if (Object.hasOwn(r, "output")) {
  text(r.output);
  // Collect any r.session_id with projectedTools.write_stdin in this cell.
} else {
  // Inspect and report the native error/warning/loss/evidence, never discard it.
  text(JSON.stringify(r));
}
```

`text()` still accepts primitives only. The adapter does not inspect or coerce arbitrary guest error objects. It parses native result JSON using captured intrinsics; private timing is associated with that decoded reply, not accepted from guest properties. The raw wrapper is checked against the existing64KiB per-result and aggregate budgets **before** projection. Smaller guest views do not expand the shell's collection allowance or consume more unread output. No native patch, helper recompilation, alternate provider route or shell sandbox is introduced.

## Scope and verification

The field names follow the pinned [Unified source-inspection contracts](CODEX-TOOL-CONTRACTS.md). Upstream execution, default namespace compatibility, identical timing/error/truncation behavior and projections for other tools remain unestablished. Opt-in staging preserves accepted scripts rather than silently changing their return types; migrating the default `tools` API is separate work.

Runtime tests cover shape admission/fallback, private intrinsics, alias identity, ordinary wrappers, bounded workers and the contained Windows path. `distribution/accept-projected-tools.mjs` adds isolated installed-SDK checks on both native Responses routes: nonzero completion, numeric-ID collection of escaped/Unicode unread output, hook-warning fallback and unchanged default wrappers. It retains native events, payload/history observations, scopes and cleanup failures; uses synthetic auth/transport; keeps auto-compaction enabled; and makes16 synthetic requests/eight scenarios, with zero live calls. Development on an accepted predecessor SDK is not new-artifact acceptance. Exact source, hosted checks, resulting master and copied installation remain separate gates.

Automatic issue closures: none.
