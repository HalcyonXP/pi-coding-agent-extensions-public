import { windowsContainmentSupported } from "./windows-host.mjs";
import { verifiedExecutable } from "./native/artifact.mjs";
// Passive preflight only. No process, scope, compiler, engine or authentication.
// Actual launch independently repeats native artifact and OS admission checks.
export async function cellRuntimeStatus() {
  if (!windowsContainmentSupported()) return {available:false,reason:"WINDOWS_X64_REQUIRED"};
  if (![24,25].includes(Number(process.versions.node.split(".")[0]))) return {available:false,reason:"NODE_24_OR_25_REQUIRED"};
  try { await verifiedExecutable(); }
  catch(error) { return {available:false,reason:error?.code === "ENOENT" ? "NATIVE_ARTIFACT_MISSING" : "NATIVE_ARTIFACT_INVALID_OR_UNREADABLE"}; }
  return {available:true};
}
