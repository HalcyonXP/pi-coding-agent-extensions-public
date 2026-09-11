import { createHash, randomUUID } from "node:crypto";
import { boundedJSON, resultJSON } from "./rpc-protocol.mjs";
import { webTextProjection } from "./web-result.mjs";

export const EVIDENCE_LIMITS = Object.freeze({ resultBytes: 16 * 1024 * 1024, retainedBytes: 32 * 1024 * 1024, imageBytes: 8 * 1024 * 1024, records: 64, images: 16, lifetimeMs: 360_000, viewChars: 8192 });
const hash = text => createHash("sha256").update(text).digest("hex");
const unavailable = () => new Error("PROTECTED_EVIDENCE_UNAVAILABLE");
// Native-context memory, never arbitrary filesystem paths or a guest-owned receipt.
// Every finalized descendant is observed before release by the genuine host scope.
export class CellEvidence {
  #signal; #closed = false; #records = new Map(); #images = new Map(); #keys = new Map(); #bytes = 0;
  constructor(signal) {
    if (!(signal instanceof AbortSignal)) throw unavailable();
    this.#signal = signal;
    signal.addEventListener("abort", this.#revoke, {once:true});
    if (signal.aborted) this.close();
  }
  #revoke = () => this.close();
  #assert() { if (this.#closed || this.#signal.aborted) throw unavailable(); }
  #prune() {
    this.#assert();
    const now = performance.now();
    for (const [ref, record] of this.#records) if (record.expires <= now) {
      this.#records.delete(ref); if (this.#keys.get(record.key) === record) this.#keys.delete(record.key); this.#bytes -= record.bytes;
      for (const image of record.images) this.#images.delete(image.ref);
    }
  }
  async capture(scope, event) {
    this.#prune(); scope.signal.throwIfAborted();
    if (event.scopeId !== scope.id || typeof scope.publishEvidence !== "function") throw unavailable();
    const json = boundedJSON(event.result, EVIDENCE_LIMITS.resultBytes, "TOOL_RESULT_LIMIT");
    const result = JSON.parse(json), content = result.content;
    if (!Array.isArray(content)) throw unavailable();
    // Ordinary text can still be filtered by the coordinator. Images and retrieved
    // source evidence cannot, even when an intermediate native tool discards them.
    if (!content.some(block => block.type === "image") && event.toolName !== "web_search" && !result.details?.sourceEvidencePresent) {
      // Native classification is outside the result/guest namespace. Still check the
      // no-op shape here; absent/unknown metadata and all meaningful evidence stay visible.
      const details = result.details;
      if (event.quietLocalPoll === true && event.toolName === "write_stdin" && event.isError === false
        && details?.running === true && details.exit_code === null && details.output === "" && details.truncated_bytes === 0
        && Object.keys(details).every(key => ["session_id", "output", "exit_code", "running", "supervisor_ready", "truncated_bytes"].includes(key))
        && content.length === 1 && content[0].type === "text" && content[0].text === JSON.stringify(details)) {
        this.#assert(); scope.signal.throwIfAborted(); return;
      }
      await scope.publishEvidence({content:[{type:"text",text:`Code mode: ${event.toolName} ${event.isError ? "failed" : "returned"}.`}], details:{toolName:event.toolName,toolCallId:event.toolCallId,isError:event.isError,auditOnly:true}});
      this.#assert(); return;
    }
    const key = hash(json + String(event.isError));
    const bytes = Buffer.byteLength(json);
    if (this.#records.size >= EVIDENCE_LIMITS.records || this.#bytes + bytes > EVIDENCE_LIMITS.retainedBytes) throw unavailable();
    const images = [];
    for (const block of result.content) if (block.type === "image") {
      if (typeof block.data !== "string" || block.mimeType !== "image/png" || !/^[A-Za-z0-9+/]+={0,2}$/.test(block.data)) throw unavailable();
      const data = Buffer.from(block.data, "base64");
      if (!data.length || data.length > EVIDENCE_LIMITS.imageBytes || data.toString("base64") !== block.data || data.subarray(0,8).toString("hex") !== "89504e470d0a1a0a") throw unavailable();
      images.push({ref: `img_${randomUUID()}`, data:block.data, mimeType:block.mimeType, bytes:data.length});
    }
    if (this.#images.size + images.length > EVIDENCE_LIMITS.images) throw unavailable();
    const ref = `ev_${randomUUID()}`;
    // Reserve before async publication. Failed/ambiguous native journaling retains
    // scope admission; do not hand the guest references without its journal receipt.
    let imageIndex = 0;
    const view = {...result,content:result.content.map(block => block.type !== "image" ? block : {type:"image_reference",ref:images[imageIndex++].ref,mimeType:"image/png"})};
    const webText = event.toolName === "web_search" && event.isError === false && webTextProjection(result) !== undefined;
    const record = {ref,key,json:JSON.stringify(view),bytes,images,webText,expires:performance.now()+EVIDENCE_LIMITS.lifetimeMs,ready:false};
    this.#records.set(ref,record); this.#bytes += bytes;
    for (const image of images) this.#images.set(image.ref,{image,record});
    try {
      await scope.publishEvidence({content:result.content, details:{toolName:event.toolName,toolCallId:event.toolCallId,isError:event.isError, evidence_ref:ref, image_refs:images.map(image=>image.ref), finalized:result.details}});
      this.#assert(); scope.signal.throwIfAborted();
      record.ready = true; this.#keys.set(key,record);
    } catch { throw unavailable(); }
  }
  project(outcome) {
    this.#prune();
    const json = boundedJSON(outcome.result, EVIDENCE_LIMITS.resultBytes, "TOOL_RESULT_LIMIT");
    const record = this.#keys.get(hash(json + String(outcome.isError)));
    if (!record?.ready) {
      if (outcome.result.content.some(block => block.type === "image") || outcome.result.details?.sourceEvidencePresent) throw unavailable();
      return outcome; // ordinary results retain the atomic RPC cap
    }
    let n = 0;
    const result = {...JSON.parse(json), content:outcome.result.content.map(block => block.type !== "image" ? block : {
      type:"image_reference", ref:record.images[n].ref, mimeType:"image/png", bytes:record.images[n++].bytes,
    }), protected_evidence:{ref:record.ref, journaled:true, format:"finalized-result-json", ...(record.webText ? {projection:"web-text-v1"} : {})}};
    const projected = {isError:outcome.isError,result};
    try { resultJSON(projected); return projected; }
    catch {
      // Explicit projection, not silent flattening: the complete finalized source
      // is already in native presentation/history. Bounded views remain available.
      return {isError:outcome.isError,result:{content:[{type:"text",text:"Intact finalized evidence was journaled outside Code mode output. Use evidence(ref, offset, length) for bounded JSON views."}], protected_evidence:{ref:record.ref,journaled:true,format:"finalized-result-json",projected:true,characters:record.json.length}, image_refs:record.images.map(image=>image.ref)}};
    }
  }
  resolveImage(ref) {
    this.#prune(); const value = this.#images.get(ref);
    if (!value?.record.ready) throw unavailable();
    return {type:"image",data:value.image.data,mimeType:value.image.mimeType};
  }
  async apply(operation, scope) {
    this.#prune(); scope.signal.throwIfAborted();
    if (operation.kind === "image") {
      const image = this.resolveImage(operation.ref);
      await scope.publishEvidence({content:[image],details:{image_ref:operation.ref,repeated:true}});
      this.#assert(); return {published:true};
    }
    const record = this.#records.get(operation.ref);
    if (!record?.ready) throw unavailable();
    return {text:record.json.slice(operation.offset,operation.offset+operation.length),characters:record.json.length};
  }
  close() {
    this.#closed=true; this.#signal.removeEventListener("abort",this.#revoke);
    this.#records.clear(); this.#images.clear(); this.#keys.clear(); this.#bytes=0;
  }
}
