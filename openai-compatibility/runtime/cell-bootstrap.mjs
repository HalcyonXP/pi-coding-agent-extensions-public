// Trusted bootstrap source evaluated INSIDE QuickJS. No host object enters the VM.
export const CELL_BOOTSTRAP = `(operation, control, namesJSON, metadataJSON = null) => {
  const stringify = JSON.stringify, parse = JSON.parse, define = Object.defineProperty;
  // Unhandled helper failures are classified by opaque identity, never by reading
  // guest-controlled message/stack/code properties. Captured methods resist mutation.
  const errors = new WeakMap(), getError = WeakMap.prototype.get.bind(errors), setError = WeakMap.prototype.set.bind(errors);
  const ErrorClass = Error, classify = error => getError(error) ?? null;
  const reject = (code, message) => { const error = new ErrorClass(message); setError(error, code); throw error; };
  const isImageRef = RegExp.prototype.test.bind(/^img_[a-f0-9-]{36}$/);
  const then = Function.prototype.call.bind(Promise.prototype.then);
  define(globalThis, "TOOL_NAMES", {value: Object.freeze(parse(namesJSON))});
  if (metadataJSON !== null) define(globalThis, "ALL_TOOLS", {value: Object.freeze(parse(metadataJSON).map(row => Object.freeze(row)))});
  define(globalThis, "text", {value: value => {
    if (typeof value === "string") return emit(value);
    if (value === undefined) return emit("undefined");
    if (value === null || typeof value === "number" || typeof value === "boolean") return emit(stringify(value));
    reject("TEXT_VALUE_UNSUPPORTED", "text requires a primitive; serialize objects explicitly");
  }});
  define(globalThis, "store", {value: (key, value) => { parse(operation(stringify({kind:"store",key,value}))); }});
  define(globalThis, "load", {value: key => { const v=parse(operation(stringify({kind:"load",key}))); return v.found ? v.value : undefined; }});
  define(globalThis, "image", {value: value => {
    // Native projected image blocks carry references, not guest-provided bytes.
    const ref = typeof value === "string" ? value
      : value !== null && typeof value === "object" && value.type === "image_reference" && value.mimeType === "image/png" ? value.ref : undefined;
    if (typeof ref !== "string" || !isImageRef(ref)) reject("IMAGE_REFERENCE_REQUIRED", "image requires a native image reference or image_reference block");
    return parse(operation(stringify({kind:"image",ref})));
  }});
  define(globalThis, "evidence", {value: (ref, offset=0, length=8192) => parse(operation(stringify({kind:"evidence",ref,offset,length})))});
  define(globalThis, "yield_control", {value: () => control("yield")});
  define(globalThis, "exit", {value: () => { control("exit"); throw Error("Cell exit"); }});
  let nextTimer=0;
  const timers=new Map();
  define(globalThis, "setTimeout", {value: (callback, ms=0, ...args) => {
    if(typeof callback !== "function") reject("TIMER_CALLBACK_REQUIRED", "Timer callback required");
    const id=++nextTimer; timers.set(id,true);
    then(operation(stringify({kind:"sleep",ms,timer:id})), () => {
      try { if(timers.delete(id)) callback(...args); }
      catch(error) { control("timerError", classify(error) ?? "EXECUTION_FAILED"); }
    });
    return id;
  }});
  define(globalThis, "clearTimeout", {value: id => { if(timers.delete(id)) operation(stringify({kind:"cancel",timer:id})); }});
  return classify;
}`;
