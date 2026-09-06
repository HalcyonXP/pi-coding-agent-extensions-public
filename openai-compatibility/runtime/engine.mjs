import { LIMITS } from "./protocol.mjs";

// Trusted host loader. Not reachable from the guest and has no alternative engine path.
export async function createEngine() {
  const [{ newQuickJSWASMModuleFromVariant, newVariant }, { default: variant }] = await Promise.all([
    import("quickjs-emscripten-core"), import("@jitl/quickjs-wasmfile-release-sync"),
  ]);
  return newQuickJSWASMModuleFromVariant(newVariant(variant, {
    wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: LIMITS.wasmBytes / 65536 }),
  }));
}
