// Trusted bootstrap source evaluated INSIDE QuickJS. No host object enters the VM.
export const CELL_BOOTSTRAP = `(operation, control, namesJSON) => {
  const stringify = JSON.stringify, parse = JSON.parse, define = Object.defineProperty;
  define(globalThis, "TOOL_NAMES", {value: Object.freeze(parse(namesJSON))});
  define(globalThis, "text", {value: value => {
    if (typeof value === "string") return emit(value);
    if (value === undefined) return emit("undefined");
    if (value === null || typeof value === "number" || typeof value === "boolean") return emit(stringify(value));
    throw Error("text requires a primitive; serialize objects explicitly");
  }});
  define(globalThis, "store", {value: (key, value) => { parse(operation(stringify({kind:"store",key,value}))); }});
  define(globalThis, "load", {value: key => { const v=parse(operation(stringify({kind:"load",key}))); return v.found ? v.value : undefined; }});
  define(globalThis, "image", {value: ref => parse(operation(stringify({kind:"image",ref})))});
  define(globalThis, "evidence", {value: (ref, offset=0, length=8192) => parse(operation(stringify({kind:"evidence",ref,offset,length})))});
  define(globalThis, "yield_control", {value: () => control("yield")});
  define(globalThis, "exit", {value: () => { control("exit"); throw Error("Cell exit"); }});
  let nextTimer=0;
  const timers=new Map();
  define(globalThis, "setTimeout", {value: (callback, ms=0, ...args) => {
    if(typeof callback !== "function") throw Error("Timer callback required");
    const id=++nextTimer; timers.set(id,true);
    operation(stringify({kind:"sleep",ms,timer:id})).then(() => { if(timers.delete(id)) callback(...args); });
    return id;
  }});
  define(globalThis, "clearTimeout", {value: id => { if(timers.delete(id)) operation(stringify({kind:"cancel",timer:id})); }});
}`;
