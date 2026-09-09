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

The compiler preparation command is Windows-only and explicitly downloads hash-pinned public build inputs. The subsequent helper build is offline. The validator builds/verifies that assembly before the Windows extension shell tests: Unified exec now loads its independent Job Object type from it instead of invoking a C# compiler in PowerShell. To run `npm test --prefix openai-compatibility` alone on Windows, explicitly prepare the pinned compiler and run `node openai-compatibility/runtime/native/build.mjs` first. No tool/menu/launcher/installer performs these builds. Gitleaks preparation downloads its checksum-pinned public binary, not a hosted OpenAI request; no scanner report prints matched values. Dependency/tool acquisition is separate from model/service use.

## Source-inspection contract fixtures

The ordinary extension suite includes `test/codex-contracts.test.ts` and the source-only `test/fixtures/codex-contracts.json`. They pin the [inspected exposed tool contract](CODEX-TOOL-CONTRACTS.md), refuse unearned runtime/hosted/parity claims and compare actual Pi schemas/defaults with nonexecuting manager seams. No upstream source is downloaded or executed by these tests; no tool, model, service or authentication is invoked. The source-file hashes are reviewed provenance, not an independently run Codex conformance suite. A deliberate Pi contract change must update the gap record and tests rather than treating the baseline differences as permanent waivers.

## Native Code transport boundaries

`openai-compatibility/test/code-mode-input.test.ts` exercises the existing native custom declaration, streamed Codex input and call/output history pairing, plus exact internal fields, bounded pragma controls and fail-closed model capability checks. These native parser tests use synthetic per-request transport, not an upstream runtime or live model. The historical PR #18 fixture keeps its original Pi input baseline; current tests explicitly check the [new native contract](NATIVE-CODE-CONTRACT.md).

Installed `accept.mjs` also invokes `accept-code-transport.mjs` through the **original SDK dispatcher**, not a replacement provider or a low-level API without native auth resolution. It uses both selected native Responses routes, synthetic `checkAuth`/`getAuth` and fetch seams, original request/header hooks, real restricted cells/native reads, raw CRLF input, invalid/legacy/hook refusal cases and finalized hook feedback. Require 24 synthetic model requests across 12 scenarios, unchanged nested wrappers/ordinary tools, and no remaining scopes. Cleanup restores seams/hooks/model and aggregates body/cleanup failures. This extends acceptance requirements, not unit counts or live-service coverage. Development probes use fresh profiles and an explicit credential-free environment; never inspect active credentials to fix a test seam.

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

`accept-profile.mjs` also runs the source-only `accept-settings.mjs` against the actual extracted SDK/normal extension: Pi's real SettingsList and native theme, synthetic keyboard input, persistent Fast/all-capability changes, reload restoration, filtering, normal/excluded contexts and zero network attempts. The CLI check separately restarts the real process and verifies all four choices and rollback preservation. The recorded frames are genuine component render output, not a capture of the user's terminal or profile. The consolidated Fast/jobs subcommands and nested native jobs view are exercised too. SDK acceptance deliberately verifies compilation/after-shell guest errors and their bounded diagnostics, plus explicit cancellation of a real owned shell through the common command. SDK acceptance also starts two real direct pipe jobs, requires third-scope refusal, runs ordinary read work, and collects exact readiness/completion lines through the original context. The jobs self-expire; readiness remains bounded at 30 × 300 ms, with no production budget increase. The separate `accept-async-jobs.mjs` case holds a real SDK model request open across at least 65 seconds of synthetic other work. A newly owned child completes without another shell poll; acceptance requires protected journal persistence while streaming, no out-of-order UI injection, exactly one terminal report in the next safe model request/history/UI, ordinary read work, late collection through the original ID, exit 7 and zero final native scopes. Its PowerShell fixture uses single-quoted JavaScript strings and explicit `exit $LASTEXITCODE`; READY text must not conceal a failed child. This tests terminal reporting, not incremental streaming, idle automatic turns, live-model behavior or the cause of a historical incident. Manager regressions separately advance only a test-process clock to cover the old 1 ms-after-close loss, long retention, capacity pressure, partial UTF-8 reads, failed reporting and revocation. These expected negative cases must assert their exact failure/observation shape; they are not failed-gate retries or desktop automation.

The installed `accept-quiet-polls.mjs` case starts three new short timers inside one native Code-mode cell while a synthetic model response is in flight. It requires quiet local polls to remain native-accounted but absent from TUI cards and model-facing audits; original output/terminal/error results must remain visible through the actual installed native subscription/handlers/components. It checks unchanged in-flight input, explicit later cell collection and deliberate owned abort with zero remaining scopes. The profile renderer adds fixed-event quiet/terminal frames using the same installed native presentation path; these are UI-only synthetic fixtures, not fabricated execution authority. `accept-local-jobs.mjs` additionally requires the same three-job workflow to render as one four-line native group, with expandable raw details, all ordinary audits still present, unchanged history through expansion and visible abort errors. Five new fixed-event frames exercise compact/expanded groups, history-only audits, nonzero exits and unchanged direct calls. Together with the original two polling and twelve settings contracts these form nineteen exact named frames. The readable exec/wait result increment preserves all nineteen, then adds eight named native frames for running, completed, expanded, failed, draining, terminated, output-loss and unknown-result fallback states: twenty-seven total. Actual installed SDK calls also verify literal human-facing output, running/completed/terminated exec/wait results, compile/after-delegation failures, output-loss visibility and unchanged wire/history through expansion. The original nineteen frames, including the original twelve settings frames, remain separately identifiable and unchanged. These checks use hand-authored synthetic coordinator text; they do not certify a live model's compliance with the new summary guidance. Token/quota usage, user artwork and a live session are not measured or replayed.

These installed checks are separate commands, not extra unit-test counts. Synthetic conversation/auth/HTTP seams must remain labelled synthetic. Genuine SDK/native invocation/process/publication/CLI behavior still runs. Record zero final native active/draining ownership and preserve failed outputs for inspection rather than reusing paths.

Runtime test files run with `--test-concurrency=1` in both the local validator and the runtime package's `npm test`. Independent adversarial process/memory/CPU fixtures must not compete for one another's fixed wall watchdogs. Explicit in-file concurrency/admission cases, every test, and all runtime limits/expected outcomes remain unchanged. Serialization avoids harness-induced contention; it does not prove the cause of an earlier timeout or waive a current failure.

The Windows parent-death fixture also requires its held parent's real `close` event within the existing post-kill deadline. Its native assertions and safety deadlines are unchanged. **Fixture directory cleanup** is not runtime teardown: after successful assertions/close, only `EBUSY` deleting that newly owned temporary directory is retried, at most ten times (2.75 seconds total backoff). No process is relaunched, lock cleared or unknown PID killed; exhaustion and other errors still fail. Failed-body directories are retained, and simultaneous assertion/cleanup errors are both reported rather than hidden by `finally`.

CI selects Node 24 on Windows/Ubuntu, reproduces the Windows helper/bundle twice and runs extracted installed acceptance. Compare its exact-source archive/manifest with local supported-Node reproduction. Required contexts are CI's two test jobs, runtime's two jobs, native host's two jobs, the Windows artifact job, and Publication privacy. All current-head rollup checks must pass before integration; a missing context is not success.

No automated live service check, OAuth refresh probe, account entitlement claim, executable upload or deployment is part of these commands. Local success does not substitute for required hosted checks. Read [acceptance boundaries](FINAL-ACCEPTANCE.md) and [consumer verification/delivery gates](RELEASE-CONTRACT.md). The development privacy policy is repository-only: read root `PUBLICATION.md` from the matching trusted source commit; it is deliberately not a bundle-relative link or an installation prerequisite.
