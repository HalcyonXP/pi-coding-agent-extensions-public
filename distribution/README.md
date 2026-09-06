# Windows bundle tooling — 0.3.0-private.1

Builds a deterministic, source-specific Windows x64 bundle with the compatible patched Pi 0.85.1 packages, locked production dependencies, one cohesive extension, verified prebuilt helper, provenance/notices and isolated installer/launcher. The version and stable “private” names identify a non-upstream pre-release variant, not a claim about source visibility or published asset availability.

**No installation-ready release is implied by source publication.** Read the [build/install/update/rollback guide](../docs/openai-integration/PRIVATE-RELEASE.md) and [acceptance boundaries](../docs/openai-integration/FINAL-ACCEPTANCE.md).

The builder requires a clean committed source and new output paths. It checks canonical Git blobs, exact native source/patch equality and immutable consumer-lock integrity; no lock regeneration, stock-host fallback, global SDK replacement or runtime compilation/download. Compiler/reference packages are explicit pinned build inputs, never runtime payload. Deterministic file-only tar/gzip uses bounded manifest/path/reparse checks.

Two separate output builds must match, followed by real tar extraction (including spaced paths), distribution/accept.mjs and distribution/accept-profile.mjs. CI uses Node 24; compare its exact-source manifest/archive digest with local supported-Node reproduction. Source tests alone are not installed-artifact acceptance. CI uploads only manifests/checksums, no executables or deployment assets.

The archive includes canonical docs/openai-integration/*.md with the installation guide and supported-surface map; installed acceptance requires both. It excludes profiles, credentials, sessions, user images, development dependencies and private local receipts. Relative documentation crosslinks retain repository layout; use the matching source for development-only links.

Profiles are always new and separate from immutable bundles. Launch holds an exclusive lifetime lock. Rollback uses native capability-name exclusions while preserving Fast/footer, native models, preferences/auth/history/originals; no unsafe retired loader is restored. Never recycle unconfirmed locks by PID lookup, overwrite a live profile, rebind an old receipt or import active credentials automatically.
