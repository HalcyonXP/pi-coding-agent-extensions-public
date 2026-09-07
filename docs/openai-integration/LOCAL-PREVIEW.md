# Local Windows technical preview versus a public release

The immediate completion target is a verified cohesive Windows preview for the maintainer to install locally. Requiring a public binary release first was an unnecessarily broad interpretation of that request. Standing authorization covers in-project completion and choosing new isolated handoff paths; no additional routine approval is requested. It does not authorize active-installation replacement, credential import, global SDK/settings changes or a guard bypass.

## Separate outcomes

| Outcome | Required evidence |
| --- | --- |
| Source accepted | Exact reviewed head/base/tree, labelled COMMENTED AI-assisted self-review (not independent approval), all eight required and every other current-head check, guarded integration |
| Local preview ready to install | That accepted merge's own CI/local reproducible artifacts, verified local handoff bytes, fresh real extraction and SDK/profile/Fast/rollback acceptance, precise new-path instructions and known limitations |
| Public binary available | Separate redistribution/notice/advisory clearance, frozen repository/tag/assets delivery plan, actual upload/download verification and durable sanitized provenance |

A verified locally built handoff is **not** a downloaded public release. Do not fabricate a release URL, claim upload/download acceptance, or mark public redistribution review complete. The [redistribution tracker](REDISTRIBUTION.md) remains applicable to future distribution. Local preview use does not supply missing third-party permissions or establish complete redistribution rights. Existing component licenses/notices remain unchanged; do not redistribute the retained build inputs or this preview as a cleared public product.

## Bounded preview risk disposition

The earlier failed CI runtime/shell observations remain preserved and unexplained. Subsequent success is not causal proof. Their available evidence records syntax/readiness assertion failures, not an established containment escape; that distinction is not a claim that all failure modes are understood.

For the **local unsigned technical preview**, retain these as disclosed reliability limitations rather than require a historical root-cause claim before any local use. This disposition depends on every new exact-source acceptance gate passing; it cannot waive a current failure. Independent adversarial runtime test files are serialized without changing explicit concurrency cases or production budgets. Source-only native diagnostics now expose bounded failure categories without guest output. READY/success checks, native admission/teardown/drain assertions and fail-closed behavior remain mandatory. Code mode and Unified exec stay independently opt-in; no portable/unrestricted fallback is added.

If startup or shell readiness fails, preserve the failure and owned state. Use the documented bounded diagnostics in a new isolated reproduction; do not blind-rerun a failed acceptance head, loosen assertions, erase draining/lock state or assume a PID is safe to recycle. Do not replay exhausted live-service checks. Broader public release-risk and embedded-dependency review remain separate work.

This is not a production/security certification, independent review or hosted entitlement guarantee. All automated service/auth seams are synthetic. Normal user-directed login and service usage in the chosen new profile are distinct from validation and may have account/billing requirements. Recommend an existing maintained Node 24 LTS; Node 25 compatibility is not a promise of upstream security maintenance.

## Local handoff and installation

A local handoff must carry the exact archive, detached manifest and checksum/pin record associated with the **accepted merge**, not merely the reviewed source or an equal tree. Copy into new paths, compare bytes with the accepted record, run the trusted source-only checker, extract with real tar into a new immutable directory and verify its internal manifest before executing extracted code. Then run both matching-source installed acceptance commands against that actual extraction. Retain the original builds and all failed evidence.

Use the [pre-execution procedure](RELEASE-CONTRACT.md) for byte/identity matching. A local copy is not a network download or an authenticity root. Do not put `<build-output>.build-inputs` into the handoff: it contains the original host tarballs and out-of-scope demo, deliberately preserved outside the runtime archive. Package/lock JSON in the runtime tree is build provenance, not an npm installation workspace.

The private local handoff instructions may name the exact chosen local archive/source/extraction/profile paths and verified digests. Those machine-specific instructions/receipts must remain outside public Git/Actions/comments. Public summaries contain only sanitized source/artifact identities and evidence boundaries.

Installation itself remains the user's next action: choose a new profile outside the immutable extracted bundle, use `distribution/install.mjs --create`, then `distribution/launch.mjs --profile`. Authenticate normally with `/login` in that new profile; no active credentials are copied. Follow [installation and rollback](PRIVATE-RELEASE.md). Existing profiles and unconfirmed locks remain untouched; no global PATH, SDK or settings change is needed.
