# Historical upstream fixture — Pi 0.85.0

This frozen patch/provenance/license fixture targets upstream https://github.com/earendil-works/pi at v0.85.0, commit 107d79f11072bbc8a3a757ed7fd69596bee7d68c. The dev-only pi-host-model-baseline npm alias retains its original model-data version for regression checks.

It is not the selected production host, an installed SDK, an unrestricted fallback or a current acceptance receipt. Current prepare-pi-host.mjs materializes the separately pinned [0.85.1 patched host](../pi-0.85.1/README.md); it must not silently repatch this historical fixture. Upstream source, license and catalog pins are preserved. Two test-header comments were generalized for public source; their patch index entries and digest were recomputed. Native implementation and test assertions did not change. The original private development history is not published here.
