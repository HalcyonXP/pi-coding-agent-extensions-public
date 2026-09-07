# Isolated Windows build/install guide — 0.3.0-private.1

The filename/version retain a stable non-upstream pre-release label. **This public source publication does not supply a prebuilt release or official upstream Pi binary.** Do not infer release availability from a planned name or substitute an arbitrary development folder. Source acceptance, artifact reproduction, actual installed acceptance and public release delivery are separate gates. A [verified local preview handoff](LOCAL-PREVIEW.md) can be ready for your installation without a public binary release; it requires its own accepted-merge-specific local evidence and must not be advertised as redistribution-cleared.

## Requirements and provenance

Windows x64, existing Node 24 or 25, .NET Framework 4.8, and native Windows PowerShell for deliberate full-OS shell delegation. Code mode additionally requires the exact compatible patched Pi 0.85.1 packages and verified prebuilt helper. No Docker, global SDK replacement, portable/unrestricted fallback or invocation-time download/compiler.

Build only a clean committed snapshot using the [validation/build procedure](VALIDATION.md). Keep each output directory and its sibling `<output>.build-inputs` retention path new. Original host tarballs and the out-of-scope DOOM example are retained there byte-identically, never shipped in the curated runtime archive. Do not copy those inputs into a runtime bundle or run npm installation commands there; its package/lock metadata is retained provenance, not an independently reinstallable workspace. Verify canonical source/patch/catalog/license/lock/compiler/helper provenance, relocated build equality, real tar extraction, both installed acceptance commands and exact-source hosted checks. Record the source commit and its own manifest/archive SHA-256; never reuse another source's digest or review as this one.

If a maintainer later publishes accepted assets, follow the [release contract and pre-execution verification procedure](RELEASE-CONTRACT.md) before extracting or running any downloaded code. Obtain the expected archive/manifest/source/version pins together from independently trusted public acceptance records, not solely from the same unverified download. Hashes provide integrity relative to that trust decision, not a signature, independent approval or protection against hostile installed JavaScript. No automatic executable publication occurs in Actions.

## New isolated profile

Keep the accepted extracted bundle immutable and in place. Choose a new absolute profile path outside it; existing profiles are refused. Example paths are placeholders, not instructions to overwrite an existing installation.

    node C:/Pi-Bundles/reviewed/distribution/install.mjs --create C:/Pi-Profiles/openai-isolated
    node C:/Pi-Bundles/reviewed/distribution/launch.mjs --profile C:/Pi-Profiles/openai-isolated

The launcher verifies the profile's bound absolute bundle path/digest, starts in its workspace and discovers only the explicit cohesive entry. It holds an exclusive lifetime lock until the genuine CLI exits. Additional --extension <path> is an explicit trusted-user choice, not automatic migration of active settings.

Authenticate normally using /login for OpenAI Codex in this **new** profile. No auth is imported. Choose a native official model (for example openai-codex/gpt-6-astra). Eligible-route imagegen starts enabled; Web, Unified exec and Code mode have independent session opt-ins:

    /openai-tools status
    /openai-tools web_search on
    /openai-tools unified_exec on
    /openai-tools code_mode on

Windows Unified exec also requires the verified prebuilt helper. It loads its independent shell Job Object type without invocation-time compilation; this does not add an unrestricted coordinator mode. Missing/corrupt helpers remain unavailable, not a request for the installer/menu to compile or download anything.

In the terminal, `/openai-tools` opens the native-style searchable settings menu; `/fast` opens it focused on Fast. Values and selected-row explanations stay visible while you change settings with Enter/Space. Esc closes without undoing applied changes. Unavailable or rollback-excluded tools stay read-only; their reasons are shown. Route/OAuth/runtime information is passive, not an entitlement probe. Explicit status/on/off commands remain available in every mode.

Those opt-ins reset off on reload/new session. /fast on and /fast status control the separate persistent priority preference. Subscription capability usage, ordinary conversation billing and Fast costs are distinct. User-directed service use is not an automated validation allowance.

## Rollback and side-by-side updates

Exit the CLI before rollback:

    node C:/Pi-Bundles/reviewed/distribution/install.mjs --rollback C:/Pi-Profiles/openai-isolated
    node C:/Pi-Bundles/reviewed/distribution/launch.mjs --profile C:/Pi-Profiles/openai-isolated

Rollback retains the cohesive entry, Fast/footer/native models, preferences/auth/history/originals and adds native exclusions for imagegen, web_search, exec, wait, exec_command and write_stdin. Capability on commands cannot override those exclusions. It does not restore a retired unrestricted loader/model backport or erase history.

Updates use new immutable bundle/profile paths and fresh normal authentication. Do not overwrite a profile, rebind a receipt, import active credentials, replace helpers or clear locks based on apparent PID death. Unknown ownership and changed configurations fail closed and need explicit reconciliation, not force flags.

Restricted guest JavaScript does not sandbox explicitly delegated full-OS commands. Provider changes revoke pending authority but do not erase previously recorded conversation content; start a new session when that history must not cross a provider boundary.
