// Fixed helper observations only: no guest exception text or native authority.
const hints = Object.freeze({
  TEXT_VALUE_UNSUPPORTED: "text() requires a primitive. Use text(JSON.stringify(value)) for arrays/objects, or print individual strings.",
  IMAGE_REFERENCE_REQUIRED: "image() requires a native image reference or bounded canonical PNG/JPEG/GIF/WebP inline data. No paths, network URLs or detail hints; byte/canvas limits apply.",
  GENERATED_IMAGE_INPUT_REQUIRED: "generatedImage() requires {image_url: ownedRefOrDataUrl, output_hint?: string}. Image limits apply; hints are at most4096 UTF-8 bytes and not save receipts.",
  TIMER_CALLBACK_REQUIRED: "setTimeout() requires a function callback, not a command string.",
  NOTIFY_VALUE_UNSUPPORTED: "notify() requires exactly one primitive. Serialize arrays/objects explicitly and await native queue acceptance.",
  NOTIFY_INACTIVE: "notify() requires an active native turn. No idle turn was started; do not replay completed work to send a notification.",
  NOTIFY_UNAVAILABLE: "notify() requires the compatible native notification host. No text-output fallback or idle turn was created.",
});
export const CELL_HELPER_ERRORS = Object.freeze(Object.keys(hints));
export function helperFailureHint(code) {
  return typeof code === "string" && Object.hasOwn(hints, code) ? hints[code] : undefined;
}
