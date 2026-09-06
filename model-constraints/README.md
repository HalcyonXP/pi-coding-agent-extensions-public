# model-constraints

A global Pi extension that appends model-specific architectural constraints to the effective system prompt before every top-level agent run.

## Data sources

- **Input:** the selected model's `input` metadata
- **Output:** Pi's stable text-only coding interface
- **Context window:** the selected model's effective `contextWindow`
- **Knowledge cutoff:** an exact `provider/model-id` entry in `knowledge-cutoffs.json`
- **Current date:** the machine's local calendar date when the run starts, without a time component

Because the block is rebuilt on every run, model changes do not retain stale values and the date advances automatically. The generated block is always appended to the effective system prompt; no `system.md` modification is required.

## Maintaining cutoffs

Only manually verified knowledge cutoffs belong in `knowledge-cutoffs.json`:

```json
{
  "llama-server/Qwen3.8 27B": "September 30, 2025",
  "openai-codex/gpt-5.6-sol": "February 16, 2026"
}
```

Keys are exact and values must be non-empty single-line strings. Run `/reload` after editing the file. Invalid JSON or registry entries prevent the extension from loading visibly rather than allowing incorrect constraints.

When the selected model has no exact entry, the extension still injects its input, output, and context data, renders the cutoff as `not configured for provider/model-id`, and warns once for that model.

Use `/model-constraints` to report the active model, generated values, and cutoff match without sending a message to the model.

## Tests

From the global extensions directory:

```powershell
node --test .\model-constraints\index.test.mjs
```
