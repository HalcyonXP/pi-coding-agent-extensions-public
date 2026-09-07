# Cohesive restricted runtime

This is the single maintained QuickJS/Wasm and Windows supervisor implementation. Experiment entry points re-export it; there is no duplicate production engine/dependency installation. The normal extension uses the CodeCells facade only on a compatible patched host.

Install the locked cohesive dependencies without lifecycle scripts. Explicitly prepare pinned compiler/reference inputs with node .github/scripts/prepare-native-compiler.mjs from the repository root; then node openai-compatibility/runtime/native/build.mjs is offline. Runtime invocation never compiles, downloads or falls back. Missing/invalid artifacts fail closed. Build into new directories and preserve earlier outputs.

Direct engine packages are quickjs-emscripten-core and @jitl/quickjs-wasmfile-release-sync **0.32.0**, with transitive FFI/integrity locked. The Wasm SHA-256 is 105c3bed22d457e43e3d1c3c1c6959fda62a8fe06f0fc8a985303c3a2be72232. LICENSE.quickjs preserves upstream notices. The deterministic Windows helper uses pinned Roslyn 4.14.0 and .NET 4.8 references 1.0.3; its source, recipe, compiler/reference inputs and relocated binary equality are verified before use.

WindowsAsyncRuntimeProbe is the contained Windows path. Portable probes are trusted test/feasibility components, not a fallback runtime selector. Installed JavaScript, Node, Wasm glue and explicitly delegated native tools remain trusted. Restricted guest JavaScript does not sandbox shell commands.

Cell failures include bounded `diagnostics`: the observed guest phase (or unknown), native delegation/result/error counters, and the last-started delegation's fixed category/shell summary. Only validated JSON primitives/categories cross this boundary; no raw exception message/stack, source, arguments, output text, paths, IDs or arbitrary getters. A result is not proof of external effects, and native closure/admission/publication remain independent authority. The portable probe protocol stays unchanged; only contained/semantic cell composition accepts a fixed phase in a worker's error frame. See the extension guide for return shapes and why cell-owned GUI children are not persistent desktop sessions.

See [architecture](../../docs/openai-integration/ARCHITECTURE.md), [validation](../../docs/openai-integration/VALIDATION.md) and [distribution](../../distribution/README.md). Hash equality establishes identity, not independent approval, authenticity of hostile installed JavaScript, or a shipping release.
