import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
export const nativeSource = fileURLToPath(new URL("./WindowsRuntime.cs", import.meta.url));
export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export async function artifactPaths() {
  const sourceSha256 = sha256(await readFile(nativeSource));
  // Composite recipe binds the deterministic compiler/reference pins and their
  // verifier too. Old source/recipe-keyed artifacts remain immutable history.
  const recipe = await Promise.all(["build.mjs", "toolchain.mjs", "toolchain.json"].map(async name => [name, sha256(await readFile(new URL(`./${name}`, import.meta.url)))]));
  const recipeSha256 = sha256(Buffer.from(JSON.stringify(recipe)));
  const key = sha256(Buffer.from(sourceSha256 + recipeSha256));
  const directory = fileURLToPath(new URL(`./bin/${key}/`, import.meta.url));
  return { directory, sourceSha256, recipeSha256, executable: join(directory, "WindowsRuntime.exe"), manifest: join(directory, "manifest.json") };
}
export async function verifiedExecutable() { return verifyArtifact(await artifactPaths()); }
// Shared by the runtime and isolated integrity fixtures. Paths are trusted host data.
export async function verifyArtifact(paths) {
  const manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
  if (manifest.version !== 1 || manifest.sourceSha256 !== paths.sourceSha256 || manifest.recipeSha256 !== paths.recipeSha256 || !/^[a-f0-9]{64}$/.test(manifest.binarySha256)) throw new Error("Native runtime artifact provenance mismatch.");
  const info = await stat(paths.executable);
  if (!info.isFile() || info.size < 1 || info.size > 256 * 1024 || sha256(await readFile(paths.executable)) !== manifest.binarySha256) throw new Error("Native runtime artifact integrity mismatch.");
  return paths.executable;
}
