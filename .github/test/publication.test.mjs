import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {identityAllowed,inspectText,inspectPath,checkRepository,publicationRefspecs} from "../scripts/check-publication.mjs";
const mailbox=()=>"reader"+"@"+"private"+".test";
const home=()=>"C:"+"/"+"Users"+"/"+"fixture"+"/work";

test("maintained identity is explicit, not inherited from account defaults",()=>{
 assert.ok(identityAllowed("Project Maintainers","maintainers@example.invalid"));
 assert.ok(identityAllowed("GitHub","noreply@github.com"));
 assert.equal(identityAllowed("Project Maintainers",mailbox()),false);
 assert.equal(identityAllowed("Different author","maintainers@example.invalid"),false);
});
test("publishing-handle exception requires its own GitHub noreply identity, never a mailbox",()=>{
 assert.ok(identityAllowed("HalcyonXP","HalcyonXP@users.noreply.github.com"));
 assert.ok(identityAllowed("HalcyonXP","123+HalcyonXP@users.noreply.github.com"));
 assert.equal(identityAllowed("HalcyonXP",mailbox()),false);
 assert.equal(identityAllowed("HalcyonXP","another@users.noreply.github.com"),false);
 assert.equal(identityAllowed("Different author","HalcyonXP@users.noreply.github.com"),false);
});
test("remote audit includes PR merge refs in an isolated local namespace and restricts origin",()=>{
 const refs=publicationRefspecs("https://github.com/HalcyonXP/pi-coding-agent-extensions-public.git");
 assert.deepEqual(refs,["+refs/heads/*:refs/publication/heads/*","+refs/tags/*:refs/publication/tags/*","+refs/pull/*/head:refs/publication/pull/*/head","+refs/pull/*/merge:refs/publication/pull/*/merge"]);
 for(const value of ["https://github.com/other/repo.git","file:///example",["git","github.com:other/repo.git"].join("@"),"https://github.com/HalcyonXP/pi-coding-agent-extensions-public.git?extra"]){assert.throws(()=>publicationRefspecs(value));}
});
test("personal mailbox and machine-home references are blocked without matched values",()=>{
 assert.deepEqual(inspectText(mailbox(),"README.md"),["non-example-email"]);
 assert.deepEqual(inspectText(home(),"README.md"),["machine-home-path"]);
 assert.deepEqual(inspectText("maintainers@example.invalid","README.md"),[]);
});
test("required attribution permits third-party email but never credential material",()=>{
 assert.deepEqual(inspectText(mailbox(),"runtime/LICENSE.quickjs"),[]);
 assert.ok(inspectText("sk-proj-"+"X".repeat(40),"runtime/LICENSE.quickjs").includes("credential-shape"));
});
test("common key, JWT and private-key shapes are rejected",()=>{
 for(const text of ["ghp_"+"A".repeat(40),"sk-proj-"+"A".repeat(48),"-----BEGIN "+"PRIVATE KEY-----","eyJ"+"A".repeat(15)+"."+"B".repeat(16)+".CC"]){assert.ok(inspectText(text,"source.ts").length);}
});
test("negative example URL fixture is distinct from deployed credentialed configuration",()=>{
 const value="https://user:secret@example.com";
 assert.deepEqual(inspectText(value,"test/urls.test.ts"),[]);
 assert.ok(inspectText(value,"config.ts").includes("credentialed-url"));
});
test("private payload paths, links and submodules cannot become source payload",()=>{
 for(const path of [".pi/report.json","config/auth.json",".env","nested/.env.local","id_rsa","key.pem"]){assert.ok(inspectPath(path).length);}
 for(const mode of ["120000","160000"]){assert.ok(inspectPath("source",mode).length);}
 assert.deepEqual(inspectPath("runtime/source.mjs"),[]);
});
function repository(fn){
 const root=mkdtempSync(join(tmpdir(),"publication-fixture-"));mkdirSync(join(root,"hooks"));
 const git=(args,identity={})=>execFileSync("git",["-c","core.hooksPath="+join(root,"hooks"),"-c","commit.gpgSign=false",...args],{cwd:root,encoding:"utf8",stdio:["pipe","pipe","pipe"],env:{...process.env,GIT_AUTHOR_NAME:"Project Maintainers",GIT_AUTHOR_EMAIL:"maintainers@example.invalid",GIT_COMMITTER_NAME:"Project Maintainers",GIT_COMMITTER_EMAIL:"maintainers@example.invalid",...identity}});
 try{git(["init","--initial-branch=master"]);fn(root,git);}finally{rmSync(root,{recursive:true,force:true});}
}
function rejected(fn){const prior=console.error;let output="";console.error=x=>{output+=x;};try{assert.throws(fn,/privacy check failed/);assert.ok(!output.includes(mailbox()));assert.ok(!output.includes(home()));return output;}finally{console.error=prior;}}
test("all-history check catches a deleted identifying file",()=>repository((root,git)=>{
 writeFileSync(join(root,"note.txt"),mailbox());git(["add","note.txt"]);git(["commit","-m","Fixture input"]);
 git(["rm","note.txt"]);git(["commit","-m","Remove fixture input"]);
 assert.match(rejected(()=>checkRepository(root)),/non-example-email/);
}));
test("finding locations cannot echo a mailbox in a tracked filename",()=>repository((root,git)=>{
 const path=mailbox()+".txt";writeFileSync(join(root,path),"public content");git(["add",path]);git(["commit","-m","Fixture input"]);
 assert.match(rejected(()=>checkRepository(root)),/redacted-location/);
}));
test("metadata check catches a non-public author on otherwise clean content",()=>repository((root,git)=>{
 writeFileSync(join(root,"note.txt"),"public source");git(["add","note.txt"]);git(["commit","-m","Fixture input"],{GIT_AUTHOR_EMAIL:mailbox()});
 assert.match(rejected(()=>checkRepository(root)),/non-public-author-identity/);
}));
test("staged check includes unpublished content and rejects binary payload",()=>repository((root,git)=>{
 writeFileSync(join(root,"note.txt"),"public source");git(["add","note.txt"]);git(["commit","-m","Fixture input"]);
 assert.equal(checkRepository(root).commits,1);
 writeFileSync(join(root,"image.bin"),Buffer.from([0,1,2]));git(["add","image.bin"]);
 assert.match(rejected(()=>checkRepository(root,{staged:true})),/non-text-payload/);
}));
