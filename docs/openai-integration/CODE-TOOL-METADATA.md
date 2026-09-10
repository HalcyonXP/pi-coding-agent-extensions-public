# Code tool metadata

The native Code coordinator exposes `ALL_TOOLS`: a frozen array of frozen `{name, description}` records for exactly the eligible active tool names in `TOOL_NAMES`, in the same order. Descriptions are copied from Pi's native tool definitions. `tools.NAME(args)` remains the genuine native delegation route; its result remains `{result,isError}`. This helper changes neither nested result projection nor direct Code/Unified output.

```javascript
const tool = ALL_TOOLS.find(tool => tool.name === "read");
if (tool) text(tool.description);
```

## Shared terms and ownership

- **Metadata snapshot:** bounded name/description data captured for one newly admitted cell. No callbacks, schemas, credentials, native contexts or scope capabilities are copied into QuickJS.
- **Discovery:** inspecting this snapshot. Inspection does not call a tool, acquire a native scope for that tool, authenticate, perform network work or consume a child-call attempt.
- **Authority:** the current native invocation/scope and gateway checks. Metadata is not authority. A tool can become unavailable after the snapshot; native revocation and admission checks still decide subsequent calls. Newly enabled tools require a new eligible snapshot, not guest modification of `ALL_TOOLS`.

The production registration obtains both the active names and native definitions from Pi. Missing/duplicate admitted definitions, non-data names/descriptions and mismatched records refuse rather than fabricate descriptions. The adapter does not access inactive descriptions in the returned ToolInfo records. Pi's `getAllTools()` itself gathers configured definitions in trusted host JavaScript; this is not a sandbox for installed extensions or a claim that the native registry never reads inactive definitions. Code `exec`/`wait` remain excluded, and the existing maximum is32 eligible names. Names remain Pi's native names; metadata itself does not implement name normalization, string arguments, input schemas or additional helpers. The separate [coordinator boundary](CODE-COORDINATOR-COMPATIBILITY.md) now supports JSON-string object arguments and unambiguous callable hyphen-to-underscore aliases. Neither rewrites these metadata records or changes native dispatch identity.

## Bounds and compatibility

Each description is at most16KiB UTF-8; the complete serialized metadata is at most64KiB. Descriptions are never silently shortened. The entire start frame, including escaped source and metadata, must still fit the existing400KiB RPC frame bound. These checks happen before opening a cell scope or preparing a Windows worker; metadata cannot enlarge source, frame, wire, memory, execution, child-call or lifecycle budgets. Oversized combinations refuse instead of falling back without metadata.

`INVALID_TOOL_METADATA` identifies rejected metadata at coordinator admission. Invalid complete start frames retain native protocol validation. Parent and worker independently validate the snapshot; QuickJS receives JSON data only and freezes its copy before running guest source. Native hooks, approvals, events, accounting, protected evidence and ordinary tools remain in their existing paths.

The low-level offline runtime retains its name-only cell-start form for isolated legacy probes; it does not invent descriptions. Production Code registration always supplies metadata, including an exact empty array when no nested tools are eligible. Non-cell evaluator/RPC probes do not gain this helper and refuse metadata injection.

## Evidence boundary

This helper is based on source inspection of the pinned Codex `code-mode-protocol/src/description.rs` contract, not execution of upstream Codex or hosted-service parity. See [pinned tool contracts](CODEX-TOOL-CONTRACTS.md) for source provenance/notices and remaining helper/projection gaps. Local unit/QuickJS checks, native installed acceptance, exact-head CI/review, resulting-master acceptance and copied-handoff acceptance remain distinct gates; documenting this API does not establish those gates or public redistribution clearance.
