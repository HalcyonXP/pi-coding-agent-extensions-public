import { IMAGE_INPUT_SOURCE } from "./image-input.mjs";
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
  const inlineImage = ${IMAGE_INPUT_SOURCE}, create = Object.create, has = Object.hasOwn;
  const imageMime = RegExp.prototype.test.bind(/^image\\/(png|jpeg|gif|webp)$/);
  const ownKeys = Reflect.ownKeys, descriptor = Object.getOwnPropertyDescriptor;
  const charCode = Function.prototype.call.bind(String.prototype.charCodeAt);
  const hintFits = value => {
    if (typeof value !== "string" || value.length > 4096) return false;
    let bytes=0;
    for(let i=0;i<value.length;i++){const n=charCode(value,i);if(n<128)bytes++;else if(n<2048)bytes+=2;else if(n>=55296&&n<=56319&&i+1<value.length&&charCode(value,i+1)>=56320&&charCode(value,i+1)<=57343){bytes+=4;i++;}else bytes+=3;}
    return bytes<=4096;
  };
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
  define(globalThis, "image", {value: (value, ...extra) => {
    if (extra.length || value !== null && typeof value === "object" && (has(value,"detail") || has(value,"_meta"))) reject("IMAGE_REFERENCE_REQUIRED", "image detail hints are unsupported");
    // Reference forwarding uses native originals; inline inputs are separate, bounded data.
    const ref = typeof value === "string" && isImageRef(value) ? value
      : value !== null && typeof value === "object" && value.type === "image_reference" && typeof value.mimeType === "string" && imageMime(value.mimeType) ? value.ref : undefined;
    const payload=create(null);
    if (typeof ref === "string" && isImageRef(ref)) { payload.kind="image";payload.ref=ref; }
    else {
      const input=inlineImage(value);
      if (!input) reject("IMAGE_REFERENCE_REQUIRED", "image requires an owned reference or bounded canonical inline image");
      payload.kind="image-inline";payload.data=input.data;payload.mimeType=input.mimeType;
    }
    return parse(operation(stringify(payload)));
  }});
  define(globalThis, "generatedImage", {value: (value, ...extra) => {
    const invalid = () => reject("GENERATED_IMAGE_INPUT_REQUIRED", "generatedImage requires an image_url and optional bounded string output_hint");
    if(extra.length || value===null || typeof value!=="object") invalid();
    const fields=ownKeys(value);
    if(fields.length<1||fields.length>2) invalid();
    for(let i=0;i<fields.length;i++)if(fields[i]!=="image_url"&&fields[i]!=="output_hint")invalid();
    const url=descriptor(value,"image_url"),hint=descriptor(value,"output_hint");
    if(!url||!has(url,"value")||typeof url.value!=="string"||hint&&(!has(hint,"value")||!hintFits(hint.value)))invalid();
    const payload=create(null);
    if(isImageRef(url.value)){payload.kind="generated-image";payload.ref=url.value;}
    else{const input=inlineImage(url.value);if(!input)invalid();payload.kind="generated-image-inline";payload.data=input.data;payload.mimeType=input.mimeType;}
    if(hint)payload.output_hint=hint.value;
    return parse(operation(stringify(payload)));
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
