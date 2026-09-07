# Reproduce validation without hosted-service calls

Use a separate checkout, existing Node 24/25 and new output paths. Windows x64/.NET Framework 4.8 are required for production containment and bundle acceptance. Ubuntu runs the applicable portable/native-host tests with explicit Windows-only exclusions. Never count a skipped case as a current-head pass.

## Source and privacy

From the repository root:

    npm ci --ignore-scripts --prefix openai-compatibility
    node .github/scripts/check-publication.mjs --remote-refs
    node .github/scripts/scan-secrets.mjs
    node .github/scripts/prepare-native-compiler.mjs
    node .github/scripts/validate-openai.mjs

The privacy ref fetch is read-only and requires the exact intended repository remote. Before a remote exists, --staged checks the proposed local tree without network access; it does not replace the later platform/ref audit. GitHub-generated PR metadata must be checked before publication, not inferred from clean local author fields.

The compiler preparation command is Windows-only and explicitly downloads hash-pinned public build inputs. The subsequent helper build is offline. Gitleaks preparation downloads its checksum-pinned public binary, not a hosted OpenAI request; no scanner report prints matched values. Dependency/tool acquisition is separate from model/service use.

## Genuine patched host

    node .github/scripts/prepare-pi-host.mjs --rpc
    cd .pi/host-rpc-checkout
    npm ci --ignore-scripts
    npm run check:model-data
    npm run check
    cd ../..
    node .github/scripts/validate-openai.mjs --host

Preparation refuses existing destinations. The native materializer verifies upstream/tag/license/patch/catalog and only installs the selected test fixture. Full host checks include formatting, type/entry graphs and bundle smoke checks; do not let incidental formatting silently alter the canonical fixture. Never run the unrestricted upstream provider suite or change active Pi settings.

## Reproducible bundle and actual installed acceptance

From a clean committed Windows source snapshot and its prepared host:

    node distribution/build.mjs --host .pi/host-rpc-checkout --out C:/Pi-Builds/bundle-a
    node distribution/build.mjs --host .pi/host-rpc-checkout --out C:/Pi-Builds/bundle-b

Use new absolute output paths and unused sibling `<output>.build-inputs` paths; compare complete archive and manifest hashes. The latter directories retain original locked tarballs and the excluded DOOM example, not release assets. Curation checks their exact file/byte/hash policy and byte-identical retention without altering the native patch or consumer lock. Do not include these directories in the runtime archive or any upload allowlist. Both installed commands also verify the packaged policy, curation record, and absence of the excluded demo and archive candidates. Extract an archive with real tar into a new directory (also test a path containing spaces), then:

    node distribution/accept.mjs C:/Pi-Builds/extracted
    node distribution/accept-profile.mjs C:/Pi-Builds/extracted

`accept-profile.mjs` also runs the source-only `accept-settings.mjs` against the actual extracted SDK/normal extension: Pi's real SettingsList and native theme, synthetic keyboard input, persistent Fast changes, session switches, filtering, normal/excluded contexts and zero network attempts. The recorded frames are genuine component render output, not a capture of the user's terminal or profile.

These installed checks are separate commands, not extra unit-test counts. Synthetic conversation/auth/HTTP seams must remain labelled synthetic. Genuine SDK/native invocation/process/publication/CLI behavior still runs. Record zero final native active/draining ownership and preserve failed outputs for inspection rather than reusing paths.

Runtime test files run with `--test-concurrency=1` in both the local validator and the runtime package's `npm test`. Independent adversarial process/memory/CPU fixtures must not compete for one another's fixed wall watchdogs. Explicit in-file concurrency/admission cases, every test, and all runtime limits/expected outcomes remain unchanged. Serialization avoids harness-induced contention; it does not prove the cause of an earlier timeout or waive a current failure.

CI selects Node 24 on Windows/Ubuntu, reproduces the Windows helper/bundle twice and runs extracted installed acceptance. Compare its exact-source archive/manifest with local supported-Node reproduction. Required contexts are CI's two test jobs, runtime's two jobs, native host's two jobs, the Windows artifact job, and Publication privacy. All current-head rollup checks must pass before integration; a missing context is not success.

No automated live service check, OAuth refresh probe, account entitlement claim, executable upload or deployment is part of these commands. Local success does not substitute for required hosted checks. Read [acceptance boundaries](FINAL-ACCEPTANCE.md) and [consumer verification/delivery gates](RELEASE-CONTRACT.md). The development privacy policy is repository-only: read root `PUBLICATION.md` from the matching trusted source commit; it is deliberately not a bundle-relative link or an installation prerequisite.
