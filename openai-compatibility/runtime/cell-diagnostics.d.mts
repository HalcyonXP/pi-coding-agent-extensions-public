export interface CellDiagnostics {
 guest_phase: "initialize" | "compile" | "execute" | "await" | "unknown";
 delegated_calls: number;
 returned_results: number;
 tool_errors: number;
 last_delegation: null | {
  operation: "exec_command" | "write_stdin" | "other";
  result: "pending" | "returned" | "tool_error";
  shell: null | {supervisor_ready: boolean | null; running: boolean | null; exit_code: number | null; output_observed: boolean; termination: "reported" | "none"};
 };
 effects: "not_determined";
}
export function copyCellDiagnostics(value: unknown): CellDiagnostics | undefined;
