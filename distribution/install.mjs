// Opt-in isolated profile creation/rollback only. No global install/settings/auth edits.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve,isAbsolute,join,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {verifyBundle,sha256,profileLock} from "./lib.mjs";
const bundle=fileURLToPath(new URL("../",import.meta.url)),args=process.argv.slice(2);
assert.ok(args.length===2&&["--create","--rollback"].includes(args[0])&&isAbsolute(args[1]),"Usage: node distribution/install.mjs --create|--rollback <absolute-isolated-profile>");
const profile=resolve(args[1]),relation=relative(bundle,profile);assert.ok(relation.startsWith("..")||isAbsolute(relation),"Profile must be outside the immutable bundle");
const {digest}=await verifyBundle(bundle),receiptPath=join(profile,"openai-profile.json"),settingsPath=join(profile,"settings.json");
if(args[0]==="--create"){
 assert.equal(existsSync(profile),false,"Refusing an existing profile or active settings. Choose a new isolated directory.");
 await mkdir(profile);await mkdir(join(profile,"workspace"));
 const settings=JSON.stringify({extensions:[join(bundle,"extensions","openai-compatibility","index.ts")]},null,2)+"\n";
 await writeFile(join(profile,"settings.before-openai.json"),"{}\n",{flag:"wx"});
 await writeFile(settingsPath,settings,{flag:"wx"});
 await writeFile(receiptPath,JSON.stringify({version:1,bundle:resolve(bundle),bundleDigest:digest,settingsSha256:sha256(Buffer.from(settings)),state:"installed"},null,2)+"\n",{flag:"wx"});
 console.log("Isolated profile created; no credentials copied and no capabilities silently opted in. Imagegen retains official-route default gating.");
}else{
 const receipt=JSON.parse(await readFile(receiptPath,"utf8"));assert.equal(receipt.version,1);assert.equal(receipt.bundle,resolve(bundle));assert.equal(receipt.bundleDigest,digest);assert.equal(receipt.state,"installed");
 const release=profileLock(profile,"rollback");
 const current=await readFile(settingsPath);
 assert.deepEqual(JSON.parse(current.toString()).extensions,[join(bundle,"extensions","openai-compatibility","index.ts")],"Extension configuration changed; preserve and reconcile explicitly.");
 await writeFile(join(profile,"settings.before-openai-rollback.json"),current,{flag:"wx"});
 // Keep the cohesive loader for Fast/footer and upstream model ownership. The
 // launcher applies native exclusions to capabilities on every rolled-back run.
 await writeFile(join(profile,"openai-rollback.json"),JSON.stringify({version:1,previous:receipt,state:"capabilities-disabled",settingsSha256:sha256(current)},null,2)+"\n",{flag:"wx"});
 release();
 console.log("Isolated capabilities disabled by native tool exclusions; Fast/footer retained. Settings/auth/sessions/archives preserved; no unrestricted legacy loader restored.");
}
