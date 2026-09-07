# Pi Coding Agent Extensions

Extensions for Pi Coding Agent, including a cohesive OpenAI compatibility layer, context/model annotations, extension controls, date injection and token-rate display.

**Public source, not an installation-ready upstream Pi release.** This repository starts with fresh history and public-facing documentation; it does not publish private development records or reuse their review/build receipts as acceptance for this source. Look at the exact commit's checks and review, not an unqualified historical “passed” claim. No prebuilt release is promised here.

## Components

- [OpenAI compatibility](openai-compatibility/README.md): native-model Fast preference/shared footer, subscription-backed imagegen and opt-in Web, Unified exec and Code mode.
- [Context usage](context-usage-injection/README.md), [model constraints](model-constraints/README.md), [today's date](todays-date/README.md), [token rates](tokens-per-second/README.md), and [extension manager](extension-manager/README.md).
- Standalone source extensions: llama-live-ctx.ts, skills-config.ts and speak.ts. Loading installed JavaScript is a trusted-user choice; review configuration/permissions before use.
- [Patched host](host-patches/pi-0.85.1/README.md), [restricted runtime](openai-compatibility/runtime/README.md), and [Windows bundle tooling](distribution/README.md).
- codex-imagegen is a retired notice-only loader; it does not register a second imagegen tool.

## Start here

1. [Vocabulary and architecture](docs/openai-integration/README.md).
2. [Supported surface, deviations and acceptance boundaries](docs/openai-integration/FINAL-ACCEPTANCE.md).
3. [Offline validation](docs/openai-integration/VALIDATION.md).
4. [Isolated build/install/update/rollback](docs/openai-integration/PRIVATE-RELEASE.md).
5. [Redistribution and release-risk review](docs/openai-integration/REDISTRIBUTION.md): current binary-release blockers, selected unsigned Windows preview and exact remaining gates.
6. [Public-history privacy policy](PUBLICATION.md).

Use existing Node 24 or 25. Windows x64/.NET Framework 4.8 and a verified patched host/helper are required for production Code mode. Portable tests are not a production runtime fallback. Never copy this checkout over an active installation or import its credentials automatically.

## Notices

Component-specific licenses remain in place: the OpenAI compatibility layer and runtime fixtures carry Apache-2.0 licenses. The original first-party [distribution tooling](distribution/LICENSE) and [integration/release documentation](docs/openai-integration/LICENSE) are also Apache-2.0, with their scope recorded in the adjacent NOTICE files. Pi, QuickJS and build inputs retain their applicable upstream notices. See openai-compatibility/THIRD_PARTY_NOTICES.md and the LICENSE files beside the affected components. These scoped grants do not license otherwise unlicensed components, relicense third-party work, or claim OpenAI/Pi endorsement.
