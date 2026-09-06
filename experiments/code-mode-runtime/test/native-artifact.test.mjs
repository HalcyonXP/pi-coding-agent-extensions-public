import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256, verifyArtifact } from "../native/artifact.mjs";

test("native artifact verification rejects missing, mismatched and corrupted builds",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pi-native-integrity-"));
 const paths={manifest:join(dir,"manifest.json"),executable:join(dir,"fixture.bin"),sourceSha256:sha256(Buffer.from("source fixture")),recipeSha256:sha256(Buffer.from("recipe fixture"))};
 const binary=Buffer.from("synthetic integrity bytes; never executed");
 const manifest={version:1,sourceSha256:paths.sourceSha256,recipeSha256:paths.recipeSha256,binarySha256:sha256(binary)};
 try {
  await assert.rejects(verifyArtifact(paths));
  await writeFile(paths.executable,binary);
  await writeFile(paths.manifest,JSON.stringify({...manifest,sourceSha256:"wrong"}));
  await assert.rejects(verifyArtifact(paths),/provenance mismatch/);
  await writeFile(paths.manifest,JSON.stringify({...manifest,recipeSha256:"wrong"}));
  await assert.rejects(verifyArtifact(paths),/provenance mismatch/);
  await writeFile(paths.manifest,JSON.stringify(manifest));
  assert.equal(await verifyArtifact(paths),paths.executable);
  await writeFile(paths.executable,"tampered");
  await assert.rejects(verifyArtifact(paths),/integrity mismatch/);
  await writeFile(paths.manifest,JSON.stringify({...manifest,version:2}));
  await assert.rejects(verifyArtifact(paths),/provenance mismatch/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
