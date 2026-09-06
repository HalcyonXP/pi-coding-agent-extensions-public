import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
import {resolve} from "node:path";

const root=fileURLToPath(new URL("../../",import.meta.url));
const exampleEmail=value=>/@(?:example\.(?:com|org|net)|[a-z0-9.-]+\.invalid|users\.noreply\.github\.com)$/i.test(value)||value==="noreply@github.com";
const attribution=path=>/(?:^|\/)(?:LICENSE(?:\.[^/]*)?|THIRD_PARTY_NOTICES\.md)$/.test(path);
export function identityAllowed(name,email){
 return (name==="Project Maintainers"&&email==="maintainers@example.invalid")||
  (name==="HalcyonXP"&&/^(?:\d+\+)?HalcyonXP@users\.noreply\.github\.com$/i.test(email))||
  (name==="GitHub"&&email==="noreply@github.com")||
  (name==="github-actions[bot]"&&email==="41898282+github-actions[bot]@users.noreply.github.com");
}
export function publicationRefspecs(remote){
 if(!/^https:\/\/github\.com\/HalcyonXP\/pi-coding-agent-extensions-public(?:\.git)?$/.test(remote))throw Error("Publication ref audit requires the exact intended HTTPS repository");
 // Read-only remote access, reserved local namespace, no pruning of previously observed history.
 return ["heads/*","tags/*","pull/*/head","pull/*/merge"].map(ref=>`+refs/${ref}:refs/publication/${ref}`);
}
export function inspectText(text,path){
 const errors=[];
 const add=(rule,expression)=>{if(expression.test(text))errors.push(rule);};
 add("credential-shape",/\b(?:sk-(?:(?:proj|svcacct|ant-api\d+)-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{12,})\b/);
 add("private-key",/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/);
 add("jwt-shape",/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\b/);
 add("machine-home-path",/(?:[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|\/(?:home|Users)\/[^/\s"'<>]+)/);
 add("private-project-record",/\b(?:PVT|PVTI|PVTSSF)_[A-Za-z0-9_-]{12,}\b/);
 if(!attribution(path))for(const match of text.matchAll(/\b[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}\b/g)){
  if(!exampleEmail(match[0]))errors.push("non-example-email");
 }
 for(const match of text.matchAll(/https?:\/\/[^\s/"'<>]+:[^\s/"'<>]+@[^\s/"'<>]+/g)){
  const fixture=/(?:^|\/)test\/|\.test\.[cm]?[jt]s$/.test(path)&&/@(?:[a-z0-9.-]+\.)?example\.(?:com|org|net)$/.test(match[0]);
  if(!fixture)errors.push("credentialed-url");
 }
 return [...new Set(errors)];
}
export function inspectPath(path,mode="100644"){
 const errors=[...inspectText(path,"path")];
 if(!["100644","100755"].includes(mode))errors.push("non-regular-git-entry");
 if(path.startsWith("/")||path.includes("\\")||path.split("/").some(p=>!p||p==="..")||/[\x00-\x1f:]/.test(path))errors.push("unsafe-path");
 if(/(?:^|\/)(?:\.pi|node_modules|\.env(?:\.[^/]*)?|auth\.json|credentials\.json|id_rsa|id_ed25519)(?:\/|$)|\.(?:pem|p12|pfx)$/i.test(path))errors.push("private-payload-path");
 return errors;
}
export function checkRepository(directory=root,{staged=false,remoteRefs=false}={}){
 const git=(args,encoding="utf8")=>execFileSync("git",args,{cwd:directory,encoding,maxBuffer:64*1024*1024,stdio:["pipe","pipe","pipe"]});
 if(git(["rev-parse","--is-shallow-repository"]).trim()!=="false")throw Error("Publication check requires complete available history");
 if(remoteRefs)git(["fetch","--no-tags","--no-write-fetch-head","origin",...publicationRefspecs(git(["remote","get-url","origin"]).trim())]);
 const commits=git(["rev-list","--all"]).trim().split("\n").filter(Boolean),trees=new Set(),blobs=new Map(),problems=[];
 const report=(location,rules)=>{const safe=inspectText(location,"report-location").length?`[redacted-location:${createHash("sha256").update(location).digest("hex").slice(0,12)}]`:location;for(const rule of rules)problems.push({location:safe,rule});};
 for(const ref of git(["for-each-ref","--format=%(refname)"]).trim().split("\n").filter(Boolean))report(ref,inspectText(ref,"reference-name"));
 for(const commit of commits){
  const value=git(["cat-file","commit",commit]);const split=value.indexOf("\n\n"),header=value.slice(0,split),message=value.slice(split+2);
  const tree=header.match(/^tree ([a-f0-9]{40})$/m)?.[1];if(!tree)throw Error("Invalid commit tree");trees.add(tree);
  for(const role of ["author","committer"]){const identity=header.match(new RegExp(`^${role} (.+) <([^>]+)> \\d+ [+-]\\d{4}$`,"m"));if(!identity||!identityAllowed(identity[1],identity[2]))report(commit,[`non-public-${role}-identity`]);}
  report(commit,inspectText(message,"commit-message"));
 }
 if(staged)trees.add(git(["write-tree"]).trim());
 for(const tree of trees)for(const entry of git(["ls-tree","-rz",tree]).split("\0").filter(Boolean)){
  const match=entry.match(/^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/);if(!match)throw Error("Invalid tree entry");
  const [,mode,type,oid,path]=match;report(path,inspectPath(path,mode));if(type!=="blob"){report(path,["non-blob-entry"]);continue;}
  if(!blobs.has(oid))blobs.set(oid,new Set());blobs.get(oid).add(path);
 }
 if(blobs.size>20_000)throw Error("Publication blob count bound");
 let bytes=0;
 for(const [oid,paths] of blobs){const blob=git(["cat-file","blob",oid],"buffer");bytes+=blob.length;if(blob.length>16*1024*1024||bytes>128*1024*1024)throw Error("Publication allocation bound");
  let text;try{text=new TextDecoder("utf-8",{fatal:true}).decode(blob);if(blob.includes(0))throw Error("binary");}catch{for(const path of paths)report(path,["non-text-payload-requires-separate-review"]);continue;}
  for(const path of paths)report(path,inspectText(text,path));
 }
 if(problems.length){console.error(JSON.stringify({publication:"blocked",findings:problems},null,2));throw Error("Publication privacy check failed; matched values withheld");}
 return {publication:"checked",commits:commits.length,trees:trees.size,blobs:blobs.size,bytes,staged,remoteRefs};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const args=process.argv.slice(2);if(args.length>1||(args.length&&!["--staged","--remote-refs"].includes(args[0])))throw Error("Usage: node check-publication.mjs [--staged|--remote-refs]");
 console.log(JSON.stringify(checkRepository(root,{staged:args[0]==="--staged",remoteRefs:args[0]==="--remote-refs"})));
}
