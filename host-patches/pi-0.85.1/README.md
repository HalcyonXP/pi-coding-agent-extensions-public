# Compatible patched Pi 0.85.1 host

Selected upstream: https://github.com/earendil-works/pi, tag v0.85.1, commit d981de1229ef899957bbe968bc8dcda02a21f477. provenance.json pins the fifteen-path patch, exact upstream MIT license, matching npm catalog integrity and catalog manifest. Every catalog file is checked before materialization.

The patch extends the genuine native invocation/approval/validation/lifecycle pipeline with branded scopes, durable resources, protected finalized publication, rendering and passive compatibility metadata. It is not a copied-handler dispatcher or replacement Agent. Status metadata cannot issue authority. Source publication does not make these modified packages official upstream binaries or automatically install them.

The term “private host” in stable identifiers/metadata means this non-upstream patched variant, not a repository visibility guarantee. Upstream package version labels remain 0.85.1; distribution provenance identifies the patch explicitly.

Use node .github/scripts/prepare-pi-host.mjs --rpc from a fresh source checkout after locked dependency installation. Preparation verifies pins and refuses an existing destination. Install its lock without lifecycle scripts, run check:model-data/full checks, then the selected offline tests. [Full commands and constraints](../../docs/openai-integration/VALIDATION.md).

The pi-0.85.0 directory is a historical upstream/patch fixture, not the selected production host or fallback. Both fixtures preserve upstream/catalog/license pins. Two test-header comments per patch were generalized for publication, with corresponding patch indexes/digests recomputed; native implementation and test assertions remain unchanged. It does not contain the private project's Git history or acceptance receipts. Preserve all required upstream notices.
