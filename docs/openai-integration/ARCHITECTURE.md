# Architecture and ownership contract

## Composition and trust

openai-compatibility/index.ts is the single normal entry. Native Pi owns model/provider catalogs and transports. capabilities.ts owns shared policy, paired reserved tool registration and independent capability opt-ins. The normal entry supplies profile-local capability-preferences.ts storage: four bounded versioned booleans, atomic replacement and conservative invalid-state handling. Fast's existing storage is separate and unchanged. tool-ownership.ts checks winning schema/definition identity: conflicting, excluded or replaced reserved tools are not overwritten. Stock/older hosts leave ordinary tool names intact.

Hosted imagegen/Web require eligible official conversation routes and genuine Codex service configuration before authentication. Provider/model names are insufficient; custom overrides/proxies are denied. Auth and service selection never fall back to paid API credentials. Ordinary conversation billing and Fast priority usage are separate.

Policy persists beyond individual handler leases. Saved preferences are restored on session start only after passive compatibility inspection; they cannot restore jobs or authority. Session/reload reset increments a preference epoch so an old asynchronous command or delayed restoration cannot re-enable a newer session. Captured calls are rechecked around async boundaries. Native runner invalidation, model/provider/registry/transcript replacement and context revocation invalidate old authority even after switching back. Recorded history remains history.

## Genuine native gateway

The fifteen-path patch runs delegated calls through Pi's actual preparation, approval, post-approval normalization/validation, before/result hooks, image normalization and lifecycle—not copied handlers. Trusted ownership fields follow caller parameters. Current registry identity is checked before execution.

Native ancestry supplies direct/nested origin; guest IDs cannot impersonate a parent. Recursion and orchestration tool nesting are denied. A normal invocation expires with its handler. A separately issued branded native scope can own durable resources after that return, using native context identity. contextSignal reports context lifetime, not execution authority.

Gateway limits include 64 child attempts per parent tree, four admitted outstanding child calls, four tool levels including root and a **64 KiB serialized argument boundary**. Sequential siblings act as barriers. Child execution/result events do not fabricate separate assistant turns or message-level visibility. Arbitrary installed JavaScript remains trusted/cooperatively cancellable.

Passive toolGatewayInfo is immutable, lazy status: version, protectedResults, activeScopes, drainingScopes and maxScopes (2). It does not mint/adopt scope authority. A stale runner getter rejects access. Status never compiles, spawns, authenticates or frees draining ownership. Ready artifacts can coexist with unavailable admission; waiting/termination of existing work does not require new free capacity.

## Cells, limits and guest surface

The CodeCells facade binds to exact native session/context identity. Production requires Windows x64, Node 24/25, the compatible host, native protected publication and the verified prebuilt helper. Unsupported conditions fail closed; portable probes are tests, not a runtime selector.

A cell executes a bounded QuickJS async-function body in a supervised worker. No ambient process, filesystem, environment, auth, imports or conversation objects enter the guest. At most 32 eligible active tool names are frozen into TOOL_NAMES; it is a name list, not a complete schema catalog. tools.NAME(args) returns bounded result/isError. text accepts primitive output; explicit JSON serialization is available. store/load retain same-context bounded data/references; image/evidence project owned finalized references. yield_control and bounded timers support asynchronous orchestration.

exec fields: code, yield_time_ms (0–30,000), max_output_tokens (0–16,384). wait fields: cell_id, yield_time_ms (0–30,000), max_tokens (0–16,384), terminate. Extra owner/context/launcher/runtime fields and duplicated first-line @exec options are rejected. cell_id is lookup data, never ownership. Native two-scope/six-minute limits and bounded completed-record retention apply; unconfirmed cleanup never expires into free capacity. The fixed active-engine budget is 500 ms, with separate heap/Wasm/stack/RPC/output limits enforced in the runtime. Historical probe wall deadlines are not production cell lifetime.

Automatic completion starts native drain without another wait. A pending explicit yield may precede completion, but guest success/cancellation/handler return does not confirm native closure. Status-only manager metadata is defense in depth; it is not a claim that zero-output-budget protection was previously absent.

## Protected finalized results

The host observes descendants only after genuine approvals, validation, hooks, image normalization and listeners. It captures protected evidence before untrusted guest projection. Guest output limits—including zero text—filtering, omitted helper calls, failure or early yield cannot suppress finalized source/image evidence.

Broker bounds: 16 MiB per result; 32 MiB retained logical bytes; 64 records; 16 PNGs of at most 8 MiB each; six-minute monotonic retention; bounded 8,192-character views. Native publication is bounded to 16 MiB per publication, 32 MiB/32 queued-or-next-context entries, four pending/64 total records. References are bounded before the unchanged 64 KiB RPC limit. Native referenced_image_refs resolution occurs before auth, without a filesystem fallback.

Publication persists before context projection and participates in native settlement. Failed publication stays owned/draining; no automatic repair/retry/replay into another context. Revocation withdraws pending/reference authority in its original context, not recorded history. Native TUI rendering displays images or a bounded fallback. A receipt is not immediate separate live-model visibility, fsync, durable crash recovery or a new LLM turn.

## Returned shell resources and Windows containment

Unified exec owns cleanup before OS launch. Each direct native job uses one of the two shared active/draining scope slots, independently of the extension's four-process ceiling. Returned jobs and stdin remain bound to exact native scope/context after handler return. Ordinary work or another denied admission does not itself revoke those jobs. Completion output is collected by explicit polling, not automatic messages or new assistant turns; completed buffers have bounded retention and context/lifetime changes still revoke access. Real child close releases ownership; cached stop failure is superseded by confirmed closure, not by apparent process death or cancellation. Unconfirmed cleanup/admission is retained; explicit same-owner retry is distinct from automatic repair.

Windows holds supervisor/parent process identities and uses a private readiness/acknowledgement gate before running the command. The startup gate is bounded to ten seconds/four KiB; normal stdin/EOF cannot acknowledge it, and startup frames are not guest output. Parent death terminates the owned Job Object through held identity, not later PID lookup. No forced PID-reuse or malicious-shell-containment claim follows.

The verified prebuilt assembly contains two independent Job Object types. Its executable entry point and restricted coordinator limits are unchanged. PowerShell loads only the full-OS shell supervision type as a library; it does not run the coordinator entry point or compile C# during invocation. The parent verifies source/recipe/binary pins before launch and rechecks cancellation, generation and process capacity after asynchronous verification. Missing/corrupt helpers fail closed; no compiler, download or alternate-helper fallback is selected. Explicit build preparation precedes Windows shell tests.

The optional `supervisor_ready` result (Windows supervision only) means the private preamble was received and the parent can acknowledge it. It does not prove the child read that acknowledgement, that a command produced output, or that native ownership can be released. Bounded acceptance diagnostics expose this boolean without commands, output, paths or IDs. The unchanged 30 × 300 ms readiness polls still require READY and final zero active/draining ownership. Earlier failures do not contain this new field and cannot be retroactively classified.

Shell supervision remains separate in policy from coordinator containment, even though its fixed type is built into the same assembly. No unrestricted coordinator executable mode was added. Shell commands retain the user's OS permissions. POSIX process groups, pipes and cooperative cleanup do not establish PTY/ConPTY, hard-real-time shell quotas or Windows crash-equivalence guarantees.

## Artifacts and profiles

The builder verifies committed clean source, canonical Git blobs, exact upstream/patch equivalence and locked package integrity. Deterministic relocated helper compilation and sorted bounded file-only tar/gzip produce source-specific identities. Hashes are integrity/provenance, not authenticity against hostile installed code or independent approval.

Install creates a new profile outside the immutable bundle and imports no auth. Launch verifies the bundle/profile receipt and holds an exclusive lifetime record. Rollback excludes all six capability names natively while preserving ordinary behavior, native models, Fast/footer and data. Unconfirmed locks are never recycled by PID lookup; side-by-side updates use new bundle/profile paths and fresh normal authentication.
