# Web admission profiles — Batch B working source

A **Web admission profile** selects the extension's Web argument/schema contract. It is not a Pi installation profile, a capability switch, a credential or service entitlement. This working-source change is not yet accepted in a new installation artifact.

- **`verified-v1` (default):** unchanged narrow search/initial-public-URL-open subset, short/low settings and fixed service model. Historical verification applies only to that subset.
- **`experimental`:** nine bounded families: search/image query, public-URL open/find/screenshot, finance/weather/sports/time. Source-derived DTOs and synthetic native workflows are implemented; they are **not live-verified**. The service model follows the selected conversation model. Unknown remote behavior can fail rather than trigger fallback.

Both profiles preserve native route/auth/permissions, direct-or-protected execution, full source evidence and existing request/response/deadline limits. Four operations maximum are shared across families per request. Click, opaque service-reference ownership/continuation and Web media downloads remain unsupported; source strings/encrypted output never grant authority. Image/screenshot queries still return text/opaque evidence, not downloaded media.

## Saved versus effective

Use the **Web admission profile** row under `/openai-tools`, or:

```text
/openai-tools web-profile status
/openai-tools web-profile experimental
/openai-tools web-profile verified-v1
```

Changing the preference **does not replace the current schema or cancel work**. Reload extensions through Pi, or restart Pi, to apply it. Merely selecting a model, switching sessions or toggling Web does not apply a pending schema change. Status distinguishes the saved and effective values. Web capability activation remains a separate switch with unchanged native checks.

The separate profile-local `openai-compatibility-web.json` is at most4096 UTF-8 bytes with exactly `{version:1,profile:"verified-v1"|"experimental"}`. A missing file defaults without writing. Malformed/unknown-version files are preserved: this extension's Web implementation is unavailable until repair and extension reload, without disabling unrelated tools or Jobs cancellation. Failed saves leave cached selection/effective schema unchanged. Atomic replacement is not cross-process synchronization or a hostile-filesystem sandbox. No credentials, sessions, references, jobs or authority are persisted.

Trusted programmatic compositions without a preference store retain their explicit constructor contract; they do not gain writable settings automatically.

## Evidence and pending gates

Unit tests cover storage, passive commands, schema immutability, a live synthetic request during a preference save, failed/invalid files and native settings keyboard behavior. `native-web-profile` exercised actual extension reload, nine-family grouped workflows, public-URL follow-up, click/opaque-ref refusal and full native evidence under zero guest output on both Responses routes: eight model/six synthetic service requests. Refused Web calls also retain protected native error evidence; zero service calls does not mean zero native records.

The native settings cohort covers seven additional Web preference frames. Compared with accepted PR32's43 primary/wait frames,30 remain exact; nine primary and four wait frames have only reviewed row-count/reload-guidance changes. `validateWebProfileFrameMigration()` rejects other differences; the older migration contract remains separate and unchanged. CLI restart/rollback checks are prepared for the next actual bundle. Full source, hosted CI, review, resulting-master and copied-handoff acceptance remain pending.
