# Offline runtime regression fixtures

These entry points and tests consume the single [cohesive internal runtime](../../openai-compatibility/runtime/README.md). This directory is not a Pi extension, production dispatcher or independent engine package. Do not add it to Pi's extension settings.

From the repository root, install openai-compatibility dependencies with npm ci --ignore-scripts --prefix openai-compatibility. On Windows explicitly prepare pinned compiler inputs and build the verified helper first. Then run node --test --test-concurrency=1 experiments/code-mode-runtime/test/*.test.mjs. Genuine AgentSession/QuickJS integration additionally needs the prepared native host and .github/scripts/test-code-mode-rpc.mjs --rpc; see [validation](../../docs/openai-integration/VALIDATION.md).

Portable RuntimeProbe/AsyncRuntimeProbe and trusted launcher injection are synthetic test infrastructure only. Their five-second probe profile is not the longer production cell profile and cannot select a fallback production runtime. Production lifecycle, protected evidence and shell ownership are also exercised by the genuine native integration fixture.

[Apache-2.0](LICENSE) covers the local fixture code; [QuickJS MIT notices](LICENSE.quickjs) remain. No Codex/Rust/V8 implementation or binary is copied here. Dependency integrity and tests are not a formal security audit. Do not run unrestricted live-provider upstream suites.
