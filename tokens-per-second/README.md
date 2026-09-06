# tokens-per-second

A compact live throughput indicator for Pi:

```text
↑404k ↓46k R8.4M CH97.9% $7.583 (sub) 28.7%/272k | 46.7 tok/s
```

Only the current rate is displayed. It is `0.0 tok/s` while idle, waiting, stalled, or complete.

## Measurement sources

The extension automatically uses the strongest live source currently available:

1. **Provider counter:** an output-token counter that demonstrably increases during streaming.
2. **Observed stream:** text, open thinking, and tool-call deltas converted with Pi's four-characters-per-token heuristic.
3. **Inferred hidden reasoning:** a learned per-model reasoning rate while no observable delta is available.
4. **Idle:** zero.

As soon as an open model emits a `thinking_delta`—including the local llama.cpp/OpenAI-compatible path—the footer switches from inferred reasoning to directly observed throughput. If a provider exposes genuinely incremental output usage, that counter takes priority over character estimation.

The footer uses accent color for provider/observed rates, warning color for inferred hidden reasoning, and dim color for zero. It adds no textual marker.

## Hidden-reasoning learning

Hidden reasoning tokens are normally reported only at response completion. The extension learns a sample from:

```text
final reasoning tokens / time from stream start to first answer or tool output
```

Samples are combined with a bounded EWMA and stored per provider, model, API, and thinking level in:

```text
~/.pi/agent/tokens-per-second-rates.json
```

Consequences:

- A model's first hidden-reasoning response is untrained and remains zero until observable output.
- Later responses can show its learned rate during the hidden phase.
- The value is an inference, not a direct measurement; provider startup/buffering can affect it.
- Open reasoning replaces the inference immediately when its deltas arrive.

## Responsiveness

Observed throughput uses a **500 ms rolling window**, refreshed every **100 ms**. This intentionally exposes some provider/network chunking in exchange for fast feedback. If no observable output arrives for one window after output has begun, the observed value falls to zero.

Completion immediately returns the display to zero rather than retaining a final average.

## Footer integration

The extension publishes through Pi's `setStatus()` API under the `tokens-per-second` key. The local `openai-compatibility` extension owns the shared custom footer, consumes this key inline, and excludes it from Pi's additional extension-status row.

The shared footer remains active even when OpenAI Fast mode is inactive. On narrow terminals, TPS is preserved before model/footer details.

Without that footer integration, Pi's built-in behavior displays extension statuses on another line.

## Commands

```text
/tps                       Report current source, mode, and learned rate
/tps on                    Show the value
/tps off                   Hide the value
/tps toggle                Toggle visibility
/tps mode auto             Enable hidden-reasoning inference (default)
/tps mode observed         Use only provider counters and observable deltas
/tps reset-learning        Delete the current model/thinking-level profile
```

Visibility and mode are process-local. Learned profiles persist.

For isolated testing, `PI_TPS_REASONING_RATES_PATH` can override the profile path.

## Install

Place both local extensions under the same extension scope:

- `tokens-per-second/`
- `openai-compatibility/`

Then run `/reload` or restart Pi.

## Tests

From the extensions directory:

```powershell
node --test .\tokens-per-second\core.test.mjs .\tokens-per-second\index.test.mjs .\tokens-per-second\reasoning-rates.test.mjs
```
