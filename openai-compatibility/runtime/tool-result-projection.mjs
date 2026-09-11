// Copyright 2026 Project Maintainers
// SPDX-License-Identifier: Apache-2.0
// Evaluated inside QuickJS before guest code. No native object or authority enters.
export const TOOL_RESULT_PROJECTION = `(() => {
  const keys = Object.keys, own = Object.hasOwn, array = Array.isArray, create = Object.create;
  const integer = Number.isSafeInteger, stringify = JSON.stringify;
  const times = new WeakMap(), remember = WeakMap.prototype.set.bind(times), time = WeakMap.prototype.get.bind(times);
  const object = value => value !== null && typeof value === "object" && !array(value);
  const shape = (value, required, optional = []) => {
    if (!object(value)) return false;
    for (let i = 0; i < required.length; i++) if (!own(value, required[i])) return false;
    const names = keys(value);
    for (let i = 0; i < names.length; i++) {
      let found = false;
      for (let j = 0; j < required.length; j++) if (names[i] === required[j]) found = true;
      for (let j = 0; j < optional.length; j++) if (names[i] === optional[j]) found = true;
      if (!found) return false;
    }
    return true;
  };
  const session = n => integer(n) && n > 0 && n <= 2147483647;
  return {
    remember(value, elapsed) { if (object(value) && integer(elapsed) && elapsed >= 0) remember(value, elapsed); },
    project(name, value) {
      // Unknown, hook-modified, error, loss, unready and terminated results keep
      // their complete wrapper. Projection is data presentation, never evidence.
      if (name !== "exec_command" && name !== "write_stdin" && name !== "web_search" && name !== "imagegen") return value;
      const elapsed = object(value) ? time(value) : undefined;
      if (!integer(elapsed) || !shape(value, ["result", "isError"]) || value.isError !== false) return value;
      const r = value.result;
      if (name === "imagegen") {
        if (!shape(r,["content","details","protected_evidence"],["isError"]) || own(r,"isError") && r.isError!==false) return value;
        const p=r.protected_evidence,d=r.details;
        if (!shape(p,["ref","journaled","format","projection"]) || typeof p.ref!=="string" || p.journaled!==true || p.format!=="finalized-result-json" || p.projection!=="imagegen-v1") return value;
        if (!shape(d,["status","operation","canonicalPath","imagegen_result"],["destinationPath","background","quality","size"]) || d.status!=="completed" || d.operation!=="generate" && d.operation!=="edit" || typeof d.canonicalPath!=="string" || own(d,"destinationPath") && typeof d.destinationPath!=="string") return value;
        if (!shape(d.imagegen_result,["version","sha256"]) || d.imagegen_result.version!==1 || typeof d.imagegen_result.sha256!=="string") return value;
        if (!array(r.content) || r.content.length!==2 || !shape(r.content[0],["type","ref","mimeType","bytes"]) || r.content[0].type!=="image_reference" || r.content[0].mimeType!=="image/png" || typeof r.content[0].ref!=="string" || !integer(r.content[0].bytes) || r.content[0].bytes<=0 || !shape(r.content[1],["type","text"]) || r.content[1].type!=="text" || typeof r.content[1].text!=="string") return value;
        return {image_url:r.content[0].ref,output_hint:own(d,"destinationPath")?d.destinationPath:d.canonicalPath};
      }
      if (name === "web_search") {
        // Only native CellEvidence can add this presentation hint, after checking
        // the finalized content stamp and publishing the complete source evidence.
        // It is not a service reference, permission or bypass of RPC admission.
        if (!shape(r, ["content", "details", "protected_evidence"], ["isError"]) || (own(r, "isError") && r.isError !== false)) return value;
        const p = r.protected_evidence, d = r.details;
        if (!shape(p, ["ref", "journaled", "format", "projection"]) || typeof p.ref !== "string"
          || p.journaled !== true || p.format !== "finalized-result-json" || p.projection !== "web-text-v1") return value;
        if (!shape(d, ["verification", "sourceEvidencePresent", "web_result"])
          || (d.verification !== "source-contract-only" && d.verification !== "subscription-smoke-verified-subset")
          || typeof d.sourceEvidencePresent !== "boolean" || !shape(d.web_result, ["version", "sha256"])
          || d.web_result.version !== 1 || typeof d.web_result.sha256 !== "string") return value;
        if (!array(r.content) || r.content.length !== (d.sourceEvidencePresent ? 2 : 1)) return value;
        let text = "";
        for (let i = 0; i < r.content.length; i++) {
          const block = r.content[i];
          if (!shape(block, ["type", "text"]) || block.type !== "text" || typeof block.text !== "string") return value;
          text += (i === 0 ? "" : "\\n\\n") + block.text;
        }
        return text;
      }
      if (!shape(r, ["content", "details"], ["isError"]) || (own(r, "isError") && r.isError !== false)) return value;
      const d = r.details;
      if (!shape(d, ["output", "exit_code", "running", "truncated_bytes"], ["session_id", "supervisor_ready"])) return value;
      if (typeof d.output !== "string" || typeof d.running !== "boolean" || d.truncated_bytes !== 0) return value;
      if (own(d, "supervisor_ready") && d.supervisor_ready !== true) return value;
      if (own(d, "session_id") && !session(d.session_id)) return value;
      if (d.exit_code !== null && (!integer(d.exit_code) || d.exit_code < -2147483648 || d.exit_code > 2147483647)) return value;
      if (d.running ? (d.exit_code !== null || !own(d, "session_id")) : d.exit_code === null) return value;
      const scalarCopy = create(null), fields = keys(d);
      for (let i = 0; i < fields.length; i++) scalarCopy[fields[i]] = d[fields[i]];
      if (!array(r.content) || r.content.length !== 1 || !shape(r.content[0], ["type", "text"]) || r.content[0].type !== "text" || r.content[0].text !== stringify(scalarCopy)) return value;
      const projected = {wall_time_seconds: elapsed / 1000, output: d.output};
      if (d.exit_code !== null) projected.exit_code = d.exit_code;
      if (own(d, "session_id")) projected.session_id = d.session_id;
      return projected;
    }
  };
})()`;
