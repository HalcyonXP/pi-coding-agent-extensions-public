// Fixed observations only. Never inspect guest exceptions, source, tool arguments,
// output text, paths, arbitrary getters or native authority objects.
import { ERROR_CODES } from "./protocol.mjs";
import { exact, RPC_ERRORS, RPC_LIMITS } from "./rpc-protocol.mjs";
export const CELL_PHASES = Object.freeze(["initialize", "compile", "execute", "await"]);
export function validCellDone(value) {
  return exact(value, ["version", "status", "code", "phase"]) && value.version === 1 && value.status === "error"
    && [...ERROR_CODES, ...RPC_ERRORS].includes(value.code) && CELL_PHASES.includes(value.phase);
}
const operation = name => ["exec_command", "write_stdin"].includes(name) ? name : "other";
const boolean = value => typeof value === "boolean" ? value : null;
const exit = value => Number.isInteger(value) && value >= -2147483648 && value <= 4294967295 ? value : null;
export function cellDiagnostics() {
  let attempted = 0, returned = 0, errors = 0, last;
  return {
    begin(name) {
      attempted++;
      const entry = { operation: operation(name), result: "pending", shell: null }; last = entry;
      let accepted = false;
      // Only call with parsed resultJSON: validated plain JSON, never host getters.
      return value => {
        if (accepted) return; accepted = true; returned++; if (value.isError) errors++;
        entry.result = value.isError ? "tool_error" : "returned";
        if (entry.operation === "other") return;
        const d = value.result.details;
        entry.shell = { supervisor_ready: boolean(d?.supervisor_ready), running: boolean(d?.running), exit_code: exit(d?.exit_code), output_observed: typeof d?.output === "string" && d.output.length > 0, termination: typeof d?.termination === "string" && d.termination ? "reported" : "none" };
      };
    },
    snapshot(phase) {
      return { guest_phase: CELL_PHASES.includes(phase) ? phase : "unknown", delegated_calls: attempted, returned_results: returned, tool_errors: errors,
        last_delegation: last ? { ...last, shell: last.shell ? { ...last.shell } : null } : null, effects: "not_determined" };
    },
  };
}
// A trusted runtime factory still cannot smuggle arbitrary fields through CodeCells.
export function copyCellDiagnostics(input) {
  function plain(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const ds = Object.getOwnPropertyDescriptors(value);
    return Object.keys(ds).sort().join(",") === [...keys].sort().join(",") && Object.values(ds).every(d => Object.hasOwn(d, "value"));
  }
  if (!plain(input, ["guest_phase", "delegated_calls", "returned_results", "tool_errors", "last_delegation", "effects"])) return;
  if (![...CELL_PHASES, "unknown"].includes(input.guest_phase) || input.effects !== "not_determined") return;
  if (![input.delegated_calls, input.returned_results, input.tool_errors].every(v => Number.isInteger(v) && v >= 0 && v <= RPC_LIMITS.calls)
    || input.returned_results > input.delegated_calls || input.tool_errors > input.returned_results) return;
  const last = input.last_delegation;
  if ((input.delegated_calls === 0) !== (last === null)) return;
  if (last !== null) {
    if (!plain(last, ["operation", "result", "shell"]) || !["exec_command", "write_stdin", "other"].includes(last.operation) || !["pending", "returned", "tool_error"].includes(last.result)) return;
    const s = last.shell;
    if (s !== null && (!plain(s, ["supervisor_ready", "running", "exit_code", "output_observed", "termination"])
      || ![null, true, false].includes(s.supervisor_ready) || ![null, true, false].includes(s.running)
      || (s.exit_code !== null && exit(s.exit_code) !== s.exit_code) || typeof s.output_observed !== "boolean" || !["none", "reported"].includes(s.termination))) return;
    if ((last.operation === "other" || last.result === "pending") && s !== null) return;
  }
  return { ...input, last_delegation: last ? { ...last, shell: last.shell ? { ...last.shell } : null } : null };
}
