# Third-party notices

The request schema and interoperability behavior in this extension were implemented with reference to OpenAI Codex, particularly:

- `codex-rs/ext/image-generation/`
- `codex-rs/codex-api/src/endpoint/images.rs`
- `codex-rs/codex-api/src/images.rs`

Source: <https://github.com/openai/codex>

Reference revision during implementation: `94311d447587411789533c47601fd8bc9d81eb48` (2026-08-28).

OpenAI Codex is licensed under the Apache License 2.0. No OpenAI trademarks or endorsement are claimed. The hosted image-generation backend is not included in this extension and remains governed by OpenAI's applicable service terms and policies.

## Code input grammar

`code-mode-input.ts` includes the Lark grammar from `codex-rs/core/src/tools/code_mode/execute_spec.rs` at OpenAI Codex revision `45305dd229c01e6cb6e122f6559e4f9b805bae6b`, under Apache-2.0 (see this directory's `LICENSE`). Pi's native grammar transport and this project's restricted QuickJS implementation are distinct from Codex's runtime. This newer grammar reference does not replace the image-reference revision above.

Upstream NOTICE, reproduced here; its Ratatui statement describes the upstream project, not additional Ratatui code in this grammar:

> OpenAI Codex
> Copyright 2025 OpenAI
>
> This project includes code derived from [Ratatui](https://github.com/ratatui/ratatui), licensed under the MIT license.
> Copyright (c) 2016-2022 Florian Dehau
> Copyright (c) 2023-2025 The Ratatui Developers
