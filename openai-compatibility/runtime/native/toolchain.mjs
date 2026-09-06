// Build-time only. Runtime admission never imports or runs the compiler.
import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export const toolchainRoot = fileURLToPath(new URL("../../../.pi/build-tools/", import.meta.url));
export async function toolchainPins() { return JSON.parse(await readFile(new URL("./toolchain.json", import.meta.url), "utf8")); }
export async function treeDigest(root) {
  const files = [];
  async function visit(relative = "") {
    for (const name of (await readdir(join(root, relative))).sort()) {
      const path = relative ? `${relative}/${name}` : name, info = await lstat(join(root, path));
      if (info.isSymbolicLink()) throw new Error("Build inputs cannot be links.");
      if (info.isDirectory()) await visit(path);
      else if (info.isFile()) files.push([path, sha256(await readFile(join(root, path))), info.size]);
      else throw new Error("Non-file build input.");
    }
  }
  await visit(); files.sort((a,b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return sha256(Buffer.from(JSON.stringify(files)));
}
export async function verifyToolchain() {
  const pins = await toolchainPins();
  for (const pin of Object.values(pins.packages)) {
    const root = join(toolchainRoot, pin.directory);
    if (sha256(await readFile(join(root, pin.archive))) !== pin.sha256 || await treeDigest(join(root, "package")) !== pin.treeSha256) throw new Error("Pinned compiler/reference package integrity mismatch.");
  }
  return {
    pins,
    compiler: join(toolchainRoot, pins.packages.compiler.directory, "package", "tasks", "net472", "csc.exe"),
    references: join(toolchainRoot, pins.packages.references.directory, "package", "build", ".NETFramework", "v4.8"),
  };
}
