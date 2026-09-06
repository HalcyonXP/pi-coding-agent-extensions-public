# Isolated Windows build/install guide — 0.3.0-private.1

The filename/version retain a stable non-upstream pre-release label. **This public source publication does not supply a prebuilt release or official upstream Pi binary.** Do not infer release availability from a planned name or substitute an arbitrary development folder. Source acceptance, artifact reproduction, actual installed acceptance and release delivery are separate gates.

## Requirements and provenance

Windows x64, existing Node 24 or 25, .NET Framework 4.8, and native Windows PowerShell for deliberate full-OS shell delegation. Code mode additionally requires the exact compatible patched Pi 0.85.1 packages and verified prebuilt helper. No Docker, global SDK replacement, portable/unrestricted fallback or invocation-time download/compiler.

Build only a clean committed snapshot using the [validation/build procedure](VALIDATION.md). Keep each output directory new; verify canonical source/patch/catalog/license/lock/compiler/helper provenance, relocated build equality, real tar extraction, both installed acceptance commands and exact-source hosted checks. Record the source commit and its own manifest/archive SHA-256; never reuse another source's digest or review as this one.

If a maintainer later publishes accepted assets, verify archive/hash/manifest/source/receipt association and downloaded bytes before use. Hashes provide integrity, not independent approval or authenticity against hostile installed JavaScript. No automatic executable publication occurs in Actions.

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

Those opt-ins reset off on reload/new session. /fast on and /fast status control the separate persistent priority preference. Subscription capability usage, ordinary conversation billing and Fast costs are distinct. User-directed service use is not an automated validation allowance.

## Rollback and side-by-side updates

Exit the CLI before rollback:

    node C:/Pi-Bundles/reviewed/distribution/install.mjs --rollback C:/Pi-Profiles/openai-isolated
    node C:/Pi-Bundles/reviewed/distribution/launch.mjs --profile C:/Pi-Profiles/openai-isolated

Rollback retains the cohesive entry, Fast/footer/native models, preferences/auth/history/originals and adds native exclusions for imagegen, web_search, exec, wait, exec_command and write_stdin. Capability on commands cannot override those exclusions. It does not restore a retired unrestricted loader/model backport or erase history.

Updates use new immutable bundle/profile paths and fresh normal authentication. Do not overwrite a profile, rebind a receipt, import active credentials, replace helpers or clear locks based on apparent PID death. Unknown ownership and changed configurations fail closed and need explicit reconciliation, not force flags.

Restricted guest JavaScript does not sandbox explicitly delegated full-OS commands. Provider changes revoke pending authority but do not erase previously recorded conversation content; start a new session when that history must not cross a provider boundary.
