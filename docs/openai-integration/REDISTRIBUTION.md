# Redistribution and release-risk review

**Status: release blocked, not installation-ready.** This is a bounded first-party review, not independent legal/security approval. The selected first delivery is an **unsigned Windows x64 technical preview**, retaining `0.3.0-private.1` and the compatible patched Pi 0.85.1 names. Recommend an existing maintained Node 24 LTS installation; Node 25 compatibility testing is not a promise of continued upstream security support. No code-signing or account operations are planned.

The maintainer delegated autonomous in-project completion. That removes approval pauses for in-scope decisions; it does not remove exact-head review/CI/privacy/installed acceptance, authorize credential migration or active replacement, or override a refused repository operation. Freeze a tested repository/source/tag/asset-pinned manual plan before any delivery. Actions must remain provenance-only, without executable deployment.

## Vocabulary and review layers

| Term | Meaning |
| --- | --- |
| Installed package inventory | Actual package records and byte-pinned notice candidates in an integrity-verified bundle; retain every version/location |
| Notice candidate | A named license/notice or a README grant; presence does not establish applicability or cover a parent/embedded dependency |
| Host-bundled JavaScript | Dependencies incorporated into the patched CLI during its locked host build, possibly different from installed consumer versions |
| Embedded dependency | Code/data inside a vendored JS, native or WASM payload; not necessarily visible in either npm dependency tree |
| Redistribution clearance | Reviewed coverage and obligations for the actual payload, including embedded works; not merely SPDX metadata or zero returned advisories |
| Release-risk disposition | Explicit resolution, exclusion or justified documented residual risk; not deleting failed evidence or calling it flaky |

Run the source-only read-only inventory from matching trusted source, after [download pin verification](RELEASE-CONTRACT.md):

    node distribution/audit-bundle.mjs C:/Pi-Bundles/verified

It verifies the whole manifested tree before reading package JSON as data. It never imports package code, installs dependencies, queries services or writes to the bundle. Its status is `inventory-only-not-release-clearance`. Relative component paths and byte hashes are reported, not authors or raw package metadata. Review output before publication; do not upload raw local receipts. Native payloads and nested archives are listed, not disassembled/extracted or cleared for release.

## Established baseline and findings

The following findings concern accepted source `9658c4b53771003fdaa2816e4b858d28b652af03`, archive `b311ee032bfc2832535efb0f63c00e8f2b989cfb3565f3bff3af2e922e447291`, manifest `15d35d10dfb88454e75803551ba8342ca2538aa70d90c907cf675f55b68c29e5`. These are **historical inspection identities**, not hashes for a subsequent source/document change or an available public binary.

1. **The package graph alone is incomplete.** The baseline has 130 installed package records. A separate same-options host-bundling inspection, with every resulting JavaScript output byte-compared against the prepared canonical host build, identified 92 incorporated npm package records. Twenty-seven name/version pairs are absent from the installed inventory. Vendored HTML-export highlight.js is 11.9.0, while the installed npm version is 10.7.3. Review each actual version, not just a top-level lock or last-name-wins map.
2. **Out-of-scope demo payload.** Both the coding-agent tarball and its installed examples contain the DOOM overlay's `doom.wasm`. Its README identifies doomgeneric/id Software provenance and a first-run shareware download. This is not part of the cohesive runtime scope. Before delivery, either deliberately exclude it from every delivered representation with tested packaging/provenance, or satisfy its separate code/data redistribution obligations. Removing only the installed example while shipping the original tarball is insufficient. Do not relabel it MIT based on the host package's metadata.
3. **Notice location is not notice coverage.** The six Pi packages use the already included `host-patches/pi-0.85.1/LICENSE.pi`; esbuild's platform package can refer to its companion package's notice. data-uri-to-buffer contains the complete MIT grant in its README. A nested dependency's LICENSE must not be credited to its parent. The corrected inventory finds 13 records without an own notice candidate: seven have the Pi/esbuild shared-notice locations above, and six require further reconciliation. AWS credential-provider-http/login/nested-clients, clipboard and its native platform package, and standardwebhooks need explicit source/version/license-scope reconciliation or supplemental notices. Preserve existing grants and attribution; do not invent copyright holders or assume all missing filenames mean missing rights.
4. **Embedded works require their own accounting.** Inspect the prebuilt clipboard Rust module, Photon WASM (including incorporated crates/fonts), esbuild's Go runtime/dependencies, QuickJS/Emscripten, jiti's bundled transforms and vendored HTML-export libraries. The npm package's SPDX field is not a complete static-link inventory. Registry source revisions help locate terms but are not reproducible binary provenance. Photon 0.3.4's recorded source revision contains a crate manifest labelled 0.3.3 and no tracked Cargo.lock at the checked root/crate locations; do not silently invent an exact binary dependency closure from current semver resolution.
5. **Advisory result is bounded.** On 2026-09-07 the public npm bulk advisory endpoint returned no advisories for 122 names /151 distinct versions covering all installed versions, observed host-bundled JS and vendored highlight.js. This supersedes an incomplete exploratory query that lost duplicate versions and omitted embedded host JS. It does not cover the native/Rust/Go/Emscripten closure, prove absence of vulnerabilities, verify all upstream advisories, or establish service entitlement. Recheck the final actual payload before delivery; no model/service calls are needed.

These findings block binary publication of the baseline. Green source checks and package-license counts must not close issue #3 or declare redistribution complete. Preserve original artifacts and failed evidence; corrections require new source-specific artifacts and exact acceptance.

## Earlier synthetic shell observation

Initial PR #4 head `b5167535ae327a72cc0a8a7107a2e0a03d7e2f6d` failed installed synthetic shell readiness in run `34087953229` with nested status `error` rather than `ok`. The old assertion did not retain the bounded error code. Its cause remains unresolved. The later CRLF/canonical-license correction is a separately proven defect, not an explanation of that shell result.

The current acceptance path still requires a real returned shell's READY marker, successful cell result, automatic scope-owned teardown without another wait, and zero final active/draining scopes. Runtime limits, native supervisor admission and bounded polling remain intact. The diagnostic allowlist includes both base runtime and RPC error codes, so `TOOL_LIMIT`/`GATEWAY_FAILED` are not hidden as unclassified. A source-only observer of genuine native shell events retains bounded start/end counts, last operation/status/exit code, known termination categories and output presence—not command/ID/output/error text. It does not alter the guest program or act as ownership authority. Do not print guest output, private paths or payloads to diagnose it.

Genuine QuickJS tests of the unchanged acceptance program now distinguish immediate and final-poll readiness from three synthetic failures: launch denied, poll denied and no READY within thirty polls. All three failures yield `EXECUTION_FAILED`; this proves the old status assertion cannot distinguish these causes, not that the historical CI run took any of them. Further bounded experiments must distinguish actual shell startup/readiness failures from runtime/RPC limits using new isolated evidence. Do not replay the old head hoping for green, relax success/drain assertions, or claim a historical root cause from unrelated current success. A final preview needs an explicit release-risk disposition in addition to its own passing checks.

PR #5 initial head `458fbaf37198e6362d2854311cee3b0cc4944c32` also failed hosted acceptance: artifact run `34095727194` recorded `EXECUTION_FAILED` with no shell marker, and runtime run `34095727202` recorded `WALL_LIMIT` rather than the expected syntax failure. Local success did not override either failure; no same-head rerun occurred. Native event diagnostics address the remaining visibility gap. Outer runtime test files are now serialized to avoid independent stress fixtures competing for fixed watchdog windows; in-file concurrency cases, runtime limits and expected results are unchanged. The causes of these specific runs remain unresolved until evidence establishes them.

## Completion gates

- Resolve actual package and embedded notice coverage, out-of-scope archives and advisory findings; retain required attribution.
- Review each packaging/runtime change through a new feature PR and labelled COMMENTED AI-assisted self-review, not independent approval.
- Require all eight contexts and every other current-head check, matching exact-source Node 24 CI and local double builds, and real extracted SDK/profile/Fast/rollback acceptance.
- Freeze the final sanitized durable record and tested manual delivery plan under standing authorization. Existing wrappers are not to be bypassed or weakened.
- Verify actual uploaded/downloaded bytes and new isolated installed acceptance before reporting availability. The user's intended profile/login remains their separate installation action; never import active credentials.
