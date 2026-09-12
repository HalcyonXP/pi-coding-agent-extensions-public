# Web admission profiles

A **Web admission profile** selects the extension's Web argument/schema contract. It is not a Pi installation profile, a capability switch, a credential or service entitlement. PR #33 accepted the bounded context-free profiles through separate source/master/copied-handoff gates. The new conversation-disclosure profile below is working-source C development, not new-artifact acceptance.

- **`verified-v1` (default):** unchanged narrow search/initial-public-URL-open subset, short/low settings and fixed service model. Historical verification applies only to that subset.
- **`experimental`:** nine bounded families: search/image query, public-URL open/find/screenshot, finance/weather/sports/time. Source-derived DTOs and synthetic native workflows are implemented; they are **not live-verified**. The service model follows the selected conversation model. Unknown remote behavior can fail rather than trigger fallback.

- **`experimental-context` (explicit disclosure opt-in):** the experimental families plus bounded recent native user/assistant text. Requires a matched native host and reload/restart; unavailable finalized context refuses before authentication, without raw-history or context-free fallback. Literal conversation text is not secret-scrubbed.

All profiles preserve native route/auth/permissions, direct-or-protected execution, full source evidence and existing request/response/deadline limits. `verified-v1` and `experimental` remain context-free and never request the native history snapshot. Four operations maximum are shared across families per request. Click, opaque service-reference ownership/continuation and Web media downloads remain unsupported; source strings/encrypted output never grant authority. Image/screenshot queries still return text/opaque evidence, not downloaded media.

## Saved versus effective

Use the **Web admission profile** row under `/openai-tools`, or:

```text
/openai-tools web-profile status
/openai-tools web-profile experimental
/openai-tools web-profile experimental-context
/openai-tools web-profile verified-v1
```

Changing the preference **does not replace the current schema or cancel work**. Reload extensions through Pi, or restart Pi, to apply it. Merely selecting a model, switching sessions or toggling Web does not apply a pending schema change. Status distinguishes the saved and effective values. Web capability activation remains a separate switch with unchanged native checks.

The separate profile-local `openai-compatibility-web.json` is at most4096 UTF-8 bytes with exactly `{version:1,profile:"verified-v1"|"experimental"|"experimental-context"}`. A missing file defaults without writing. Malformed/unknown-version files are preserved: this extension's Web implementation is unavailable until repair and extension reload, without disabling unrelated tools or Jobs cancellation. Failed saves leave cached selection/effective schema unchanged. Atomic replacement is not cross-process synchronization or a hostile-filesystem sandbox. No credentials, sessions, references, jobs or authority are persisted.

Trusted programmatic compositions without a preference store retain their explicit constructor contract; they do not gain writable settings automatically.

## Explicit conversation disclosure

Only a current native invocation can read the ephemeral text snapshot. Capture follows native compaction and final context hooks, before custom/protected messages are converted into model roles. Confirmation observes the native serialized Responses request and requires successful stream completion. Payload-hook objects alone are insufficient: getters or `toJSON` can change serialization. The observer neither replaces native auth/fetch/cache/retry/compression nor serializes the payload again. Incomplete WebSocket cache deltas refuse; no cached ancestry is reconstructed. Matching text establishes consistency, not scope authority.

Native capture is bounded to512 messages,128 aggregate blocks and65536 UTF-8 text bytes; serialized request observation is limited to2MiB characters and bytes. The Web DTO includes up to the last two user turns and intervening assistant text, ending at the latest user. A shared4000-byte assistant **prefix** budget and8192-byte serialized input ceiling apply, including DTO overhead. Users are not silently truncated. Images, reasoning, custom/protected messages, IDs and metadata are not selected; literal text may still contain sensitive material. These byte/prefix restrictions are not upstream approximate-token/middle-truncation parity.

The complete request is frozen before subscription authentication and remains subject to the16KiB request limit. Empty approved history is distinct from unavailable context. Missing, asynchronous, revoked, unsupported or oversized context fails closed; the model cannot supply its own `input` argument. Nothing restores jobs, references or native invocation authority from history.

## Evidence and pending gates

Unit tests cover storage, passive commands, schema immutability, a live synthetic request during a preference save, failed/invalid files and native settings keyboard behavior. `native-web-profile` exercised actual extension reload, nine-family grouped workflows, public-URL follow-up, click/opaque-ref refusal and full native evidence under zero guest output on both Responses routes: eight model/six synthetic service requests. Refused Web calls also retain protected native error evidence; zero service calls does not mean zero native records.

The native settings cohort covers seven additional Web preference frames. Compared with accepted PR32's43 primary/wait frames,30 remain exact; nine primary and four wait frames have only reviewed row-count/reload-guidance changes. `validateWebProfileFrameMigration()` rejects other differences; the older migration contract remains separate and unchanged. PR #33 completed its separate CLI/restart/rollback and source/master/copied gates. C's new disclosure choice requires deliberate updated settings-frame preservation, matched packages and its own full acceptance; predecessor receipts do not certify it.
