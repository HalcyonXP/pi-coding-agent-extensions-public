# Code image inputs — Batch B working source

This is development source, not a newly accepted installation or full Codex media parity. The pinned unified `image` helper accepts inline data URLs and image blocks. Pi now implements those bounded input forms through native protected publication, while retaining native reference forwarding. No image service, downloader, filesystem access or provider implementation is added to QuickJS.

## Inputs and limits

`image(value)` accepts exactly one argument:

- An existing context-owned `img_...` reference or projected `image_reference` block.
- `data:image/png;base64,...` (also exact `image/jpeg`, `image/gif`, `image/webp`).
- `{image_url: dataUrl}`.
- `{type:"image",data:canonicalBase64,mimeType:...}`.

Inline bytes are limited to **32,768 decoded bytes per operation**. Strings/blocks must use canonical padded base64 with matching declared MIME and container signature. No whitespace, percent decoding, remote URLs, paths, unknown inline fields, `detail`, `_meta` or extra arguments. Inline container headers additionally require one frame, at most **4096 per declared canvas edge** and **4,194,304 declared pixels**, with bounded chunk/segment traversal (128). Truncated/trailing containers, APNG/multiple-frame GIF/animated WebP and unsupported JPEG marker layouts are refused. These are explicit Pi restrictions: declared-canvas/container checks are **not** full pixel/CRC/entropy decoding or a codec sandbox. Native descendant images retain their historical signature gate; only the new inline path selects the stricter canvas checks. Current source-backed native tests separately decode their synthetic one-pixel fixtures, not arbitrary product inputs.

The original 64KiB argument, 256KiB aggregate argument, 64-operation, frame/wire and QuickJS limits still apply. Full native descendant images retain their existing 8MiB/image, 16-image and 32MiB total evidence retention ceilings; extending reference MIME support does not raise those limits. Invalid or oversized inline input is refused before publication. HTTP(S) input is never fetched.

## Native publication and provenance

Inline bytes are **guest-provided content**, not a finalized descendant tool result or proof that a generator ran or a file was saved. Native messages explicitly label that distinction; reference repetition keeps the label. Native `imagegen` descendants continue to carry their own finalized tool identity and actual canonical paths.

The bridge reserves the same bounded evidence/image storage used by descendant results, publishes the complete image and provenance label through the real owning scope, and only after successful publication returns `{published:true,ref,evidence_ref}`. No descendant ToolCall ID is invented. A failed or cancelled publication cannot return usable references, and ambiguous reservations are not silently reclaimed for reuse. Zero guest text budget cannot suppress this native evidence.

`image(ref)` forwards the stored original bytes and actual MIME, not bytes supplied by a reference-shaped object. Native descendant PNG/JPEG/GIF/WebP blocks now retain their format through projected references, bounded evidence views and forwarding. These are lookup values, not native authority: foreign, expired or context-revoked references fail; existing same-context monotonic expiry and reset semantics remain. Protected evidence views contain references, not base64 image payloads.

```javascript
const shown = image({image_url: smallCanonicalDataUrl});
// No second generation or fetch is required to show the same image again.
image(shown.ref);
const edited = await nativeTools.imagegen({
  prompt: "Describe the requested edit precisely",
  referenced_image_refs: [shown.ref]
});
// Inspect errors/warnings; imagegen still requires current native authority/auth.
if (!edited.isError) image(edited.result.content[0]);
else text(JSON.stringify(edited));
```

`imagegen` retains its separate immutable canonical PNG and optional safe-copy contract. Inline publication itself does not promise a filesystem artifact. Audio, legacy detail hints and Web media download/owned-reference workflows remain open. The generated-image helper and imagegen presentation below are separate additions, not aliases to `text()`.

## Generated-image helper and imagegen guest projection

`generatedImage({image_url,output_hint?})` publishes an image and optional **unverified output hint** together through native protected evidence. `image_url` accepts a canonical inline data URL under the same byte/container/canvas limits, or an existing owned `img_...` reference (a Pi adaptation). No HTTP/path fetch, generation or save occurs. `output_hint`, if present, must be a string of at most4096 UTF-8 bytes; empty strings remain explicit. Extra arguments/fields and accessors are refused. Guest-inline provenance remains visible when those images are forwarded. The fixed `GENERATED_IMAGE_INPUT_REQUIRED` diagnostic never echoes private arguments or inspects arbitrary exception properties.

Working-source default `tools.imagegen` / `projectedTools.imagegen` now returns `{image_url,output_hint}` for recognized normal results. **`image_url` is an owned Pi reference, not upstream's inline data URL**: original image bytes remain outside the unchanged64KiB RPC boundary. `output_hint` selects a successful destination copy or the canonical path. The actual native result retains image bytes, all text and canonical/copy metadata; the tool still saves its immutable original before returning. `details.imagegen_result` is a consistency checksum, not a signature/authority. Only a matching finalized shape/checksum and successful native publication can add the `imagegen-v1` presentation hint.

Errors, post-hook changes, unknown fields, failed optional copies, unstamped results and oversized evidence views keep their full wrapper. The default return change requires an explicit caller migration:

```javascript
const r = await tools.imagegen({prompt: "Describe the requested image"});
if (Object.hasOwn(r, "image_url")) generatedImage(r);
else text(JSON.stringify(r)); // Never conceal warning/error/recovery details.
```

Choose `nativeTools.imagegen` **on the original call** for raw metadata. Do not generate again just to recover raw information or a failed destination copy. Current installed acceptance fixtures that inspect raw metadata now select that namespace; historical scripts/bundles are unchanged. Guest hints remain unverified even when supplied from a recognized projection, because callers can edit them and they never confer filesystem authority.

## Verification

`runtime/image-input.mjs` shares captured-intrinsic validation between the guest bootstrap and native operation/evidence admission. Unit and semantic/contained-worker tests cover all input forms, MIME/padding/size/field refusal, publication ordering, failed/cancelled/foreign/revoked/expired references, shared image quota, source labels and the unchanged aggregate RPC budget.

`distribution/media-input-scenarios.mjs` is reusable development scenario code, not yet an installed-artifact gate. With an independently accepted workspace-local SDK, `native-media` exercises both native Responses routes: four actual one-pixel formats, inline→reference forwarding, GIF-reference editing with immutable PNG recovery and zero guest text, URL/MIME refusal and foreign/revoked reference refusal. Synthetic fixtures are encoded/decoded with the bundled Photon dependency in the isolated profile, never user artwork. The corrected original cohort passed20 synthetic model/two synthetic service requests/ten scenarios, with no live calls, auto-compaction enabled, seams restored and zero final scopes. A separate `native-media-canvas` incremental cohort passed four model requests/two scenarios/zero service requests, proving oversized declared canvases are refused by both native routes without image publication. The current combined media set also includes generated-helper cases (36 model/two service requests/18 scenarios); that revised combined set has not yet run as a whole or qualified an artifact. Failed earlier harness assertions remain retained; no product limits were relaxed.

The image failure code remains `IMAGE_REFERENCE_REQUIRED`; its fixed corrective hint now describes inline inputs. The independent current-output acceptance formatter changes with that hint. Historical bundles, messages and receipts are not rewritten. Separate `native-generated-image` development passed12 model requests/six scenarios/zero service calls for inline/native-read reference forwarding, protected hints under zero guest output and invalid input. `native-imagegen-projection` passed16 model/eight synthetic image-service requests/eight scenarios: default projection, explicit raw access, native-hook warning fallback and optional-copy collision recovery on both routes, preserving all actual canonical originals and competing files. These are source-on-accepted-SDK checks, not new-artifact acceptance or live parity. Full Batch B source/hosted/master/copied acceptance remains pending.
