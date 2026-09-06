# context-usage-injection

A global Pi extension that gives the active model refreshed context-window telemetry before every LLM call.

A single user request can contain several model/tool iterations. Pi's `context` event runs at every model-call boundary, so the injected value is refreshed after tool results enlarge the prompt instead of remaining fixed at the value from the initial user message.

The model receives one transient, hidden message resembling:

```text
<runtime_context_usage source="pi-runtime">Current active context estimate: ~128,000 / 272,000 tokens (47.1% used). ~144,000 tokens of nominal context-window headroom remain. This is harness telemetry, not a user request. Use it for context-management planning without sacrificing correctness or completeness.</runtime_context_usage>
```

## Behavior

- Uses Pi's `ctx.getContextUsage()` and the selected model's effective context window.
- Injects immediately before **every** LLM call, including calls after tool results.
- Adds the telemetry as a trailing transient context message, rather than changing the system-prompt prefix.
- Does not write the message to session history or display it in the transcript.
- Defensively replaces any prior projection, so only one current value can be present.
- Labels counts as estimates and distinguishes nominal headroom from output-token capacity.
- Omits the value when Pi marks usage unknown, notably immediately after compaction until a successful model response establishes a trustworthy baseline.
- Does not compact, archive, stop, or otherwise alter the agent's actions.

An individual streaming model generation cannot accept new input midway through its token stream. "Before every LLM call" is therefore the finest reliable injection point: it updates during one long agent run whenever the model returns to the harness, usually for a tool call.

## Install

Place this directory at either:

- `~/.pi/agent/extensions/context-usage-injection/` (global), or
- `.pi/extensions/context-usage-injection/` (project-local).

Then run `/reload` or restart Pi.

## Tests

From the global extensions directory:

```powershell
node --test .\context-usage-injection\index.test.mjs
```
