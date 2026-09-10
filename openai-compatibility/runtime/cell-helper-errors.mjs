// Fixed helper observations only: no guest exception text or native authority.
const hints = Object.freeze({
  TEXT_VALUE_UNSUPPORTED: "text() requires a primitive. Use text(JSON.stringify(value)) for arrays/objects, or print individual strings.",
  IMAGE_REFERENCE_REQUIRED: "image() requires a native image reference or PNG image_reference block, not image bytes or a URL.",
  TIMER_CALLBACK_REQUIRED: "setTimeout() requires a function callback, not a command string.",
});
export const CELL_HELPER_ERRORS = Object.freeze(Object.keys(hints));
export function helperFailureHint(code) {
  return typeof code === "string" && Object.hasOwn(hints, code) ? hints[code] : undefined;
}
