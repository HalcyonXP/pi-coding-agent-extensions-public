import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../../",import.meta.url));
const digest=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
export function verifyHostArtifacts() {
 const artifacts=join(root,"host-patches","pi-0.85.1");
 const provenance=JSON.parse(readFileSync(join(artifacts,"provenance.json"),"utf8"));
 assert.equal(provenance.repository,"https://github.com/earendil-works/pi.git");
 assert.equal(provenance.commit,"d981de1229ef899957bbe968bc8dcda02a21f477");
 assert.equal(provenance.tag,"v0.85.1");assert.equal(provenance.npmVersion,"0.85.1");
 assert.equal(provenance.patch,"parent-bound-invocation.patch");assert.equal(provenance.license,"LICENSE.pi");
 const patch=join(artifacts,provenance.patch);
 assert.equal(digest(patch),provenance.patchSha256);assert.equal(digest(join(artifacts,provenance.license)),provenance.licenseSha256);
 const aiPackage=join(root,"openai-compatibility","node_modules","@earendil-works","pi-ai");
 const aiMetadata=JSON.parse(readFileSync(join(aiPackage,"package.json"),"utf8"));
 assert.equal(aiMetadata.name,"@earendil-works/pi-ai");assert.equal(aiMetadata.version,provenance.npmVersion);
 const lock=JSON.parse(readFileSync(join(root,"openai-compatibility","package-lock.json"),"utf8"));
 assert.equal(lock.packages["node_modules/@earendil-works/pi-ai"].integrity,provenance.modelDataNpmIntegrity);
 const data=join(aiPackage,"dist","providers","data"),manifestPath=join(data,".manifest.json");
 assert.equal(digest(manifestPath),provenance.modelDataManifestSha256);
 const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
 assert.deepEqual(readdirSync(data).sort(),[".manifest.json",...Object.keys(manifest.files)].sort());
 for(const [name,sha] of Object.entries(manifest.files)) {assert.match(name,/^[a-z0-9-]+\.json$/);assert.equal(digest(join(data,name)),sha);}
 return {artifacts,provenance,patch,aiPackage};
}
