# Coordinator arguments, images and completion

The argument/image cohort extends the existing restricted Code coordinator without changing native names, scopes, `{result,isError}`, direct output or runtime budgets. The subsequent helper-feedback increment below changes only the relevant failure codes and fixed hints, retaining the direct-output structure and those same boundaries.

- **JSON-string argument:** `await tools.read('{"path":"input.txt"}')` is equivalent to passing that object. Parsing occurs inside QuickJS using captured intrinsics. Only an object is accepted, never arrays, null, numbers or arbitrary freeform text. A preparse cap of 65,536 UTF-16 code units bounds string handling; the unchanged 64KiB serialized native-call byte cap and aggregate/call limits still apply. Ordinary native tool validation/hooks/approvals run on the resulting object. Portable `tools.call` probes remain object-only.
- **Image-reference block:** `image(result.result.content[0])` accepts the native projected `{type:"image_reference",ref,mimeType:"image/png",bytes:...}` block, or the existing reference string. The block does not supply image bytes or authority: the original journaled image must still resolve in the live owning context. Foreign/expired/revoked references, raw image bytes, data URLs and network URLs do not gain access. Original images and protected evidence remain in their existing native paths. This is not upstream inline-image/audio/generatedImage parity.
- **Coordinator disposal:** completion, failure or `exit()` invalidates queued host work and discards late promise results. Timers alone do not keep a completed script alive. Native scopes still close work already delegated; disposal does not undo OS effects or sandbox full-OS shell commands. Detached tool promises remain visible `DETACHED_TOOL` failures rather than silently claiming success.

`exit`, `setTimeout` and `clearTimeout` already existed before this batch. The lifecycle changes prevent not-yet-started callbacks from invoking native work after evaluator disposal and allow timer-only semantic cells to decode replies without a tool bridge. They are correctness fixes, not newly invented helpers.

Focused tests cover exact Unicode/NUL objects, captured intrinsics, invalid and oversized inputs, reference ownership, late results, exit and timer-only cells, plus the real contained Windows bridge. Installed acceptance reuses its existing read/image fixtures and both Responses raw-input scenarios to exercise these additions without extra synthetic model/service requests. Unit or development success is not exact-head, master or copied-artifact acceptance.

## Fixed helper feedback and callable aliases

`text()` remains primitive-only, as explicitly specified in the pinned upstream description. Passing `ALL_TOOLS.filter(...)` directly is invalid; use `text(ALL_TOOLS.map(tool => tool.name).join("\n"))` for readable names or explicitly serialize structured data. This is not automatic object rendering.

Unhandled helper-created errors now carry fixed codes and corrective hints in direct output and collapsed/expanded native cards:

| Code | Meaning / correction |
| --- | --- |
| `TEXT_VALUE_UNSUPPORTED` | Serialize arrays/objects explicitly or project readable strings before calling `text`. |
| `IMAGE_REFERENCE_REQUIRED` | Supply a native reference string or projected PNG `image_reference` block, not bytes or URLs. Valid syntax still requires live same-context evidence. |
| `TIMER_CALLBACK_REQUIRED` | Supply a function callback to `setTimeout`, not a command string. |

Classification uses a private QuickJS WeakMap keyed by helper-created error identity and captured intrinsics. It never reads guest `message`, `stack` or `code`, coerces a thrown value or publishes arbitrary exception text. Caught errors remain catchable and do not poison later successful outcomes; rethrowing the same error retains classification, whereas forged/copy/proxy errors remain generic. An uncaught synchronous timer-callback exception now terminates the awaiting cell with a classified or generic failure instead of silently waiting for the wall watchdog. Timers still do not keep a completed cell alive; asynchronous callback-returned promises are not newly awaited. Existing exit, cancellation, native cleanup, diagnostic counters and effect uncertainty remain separate.

**Callable alias** means an additional `tools.native_name` entry for an admitted native name such as `native-name`. Only hyphens become underscores. Exact native entries win; if multiple native names map to the same otherwise unused alias, that alias is absent. `tools["native-name"]` stays callable. `ALL_TOOLS` and `TOOL_NAMES` retain exact native names/order/descriptions, and the original name reaches native validation, hooks, approvals and audit. Aliases add no registration, tool entitlement or recursion route. This is not general name/schema normalization or tool-specific nested-projection parity.

Installed acceptance adds a **test-only inline native extension**, never a production tool or installed preference. Both Responses routes execute real contained cells for helper errors, opaque mutated error properties, timer-callback failure and an alias-dispatched owned read. Twenty-four separately counted synthetic model requests cover twelve scenarios; existing transport/metadata/wrapper and36 fixed native views remain required. The hook validator selects exactly the Code owner plus explicitly named hook-free fixtures rather than assuming every test profile contains one extension. Local development evidence is not a new accepted artifact.

## Image input and artifact recovery

The same cohort snapshots hook-finalized capability arguments before asynchronous work; existing schema revalidation was already present and remains enforced. Later host-side mutation cannot redirect an admitted command or image destination. Conversation/native reference images require canonical bounded base64, rather than silently accepting ignored bytes.

If generation and the canonical save succeed but an optional workspace copy fails, imagegen returns the original image and its path with a visible recovery warning. `details.status:"completed"` refers to generation; `copyStatus:"failed"` and `requestedDestinationPath` report the failed optional operation, and `destinationPath` is absent. Native `isError:false` does not mean the copy succeeded. No automatic regeneration, overwrite or deletion is attempted; a partial/competing destination may remain. Canonical-save failure and authorization/context cancellation still refuse normally. Nested protected image publication and reference forwarding retain the original even in the copy-failure case.

Installed recovery acceptance adds one separately counted synthetic image-service request. It creates a destination collision after the request starts and checks the original bytes, competing file, visible failure and native forwarding. This is not a live paid generation or a promise of disk/crash recovery.

Pinned basis: [exposed tool contracts](CODEX-TOOL-CONTRACTS.md). Tool-specific nested projections, numeric IDs/defaults, broader normalized naming, notify ordering, inline media and broader Web/image/context/lifecycle parity remain open. No additional native authority, provider fallback, PTY or hosted-service guarantee is introduced.
