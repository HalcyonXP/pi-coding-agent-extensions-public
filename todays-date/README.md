# Today's Date

A global Pi extension that appends the machine's current local calendar date to the effective system prompt before every top-level agent run.

It injects exactly this statement, with the date recalculated for each run:

```text
The date today is September 4, 2026
```

The extension includes no command or model-specific behavior.

## Test

From the global extensions directory:

```powershell
node --test .\todays-date\index.test.mjs
```
