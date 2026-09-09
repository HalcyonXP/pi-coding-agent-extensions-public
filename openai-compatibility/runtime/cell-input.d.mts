export function validYield(value: unknown): boolean;
export function validTokens(value: unknown): boolean;
export function execInput(source: string, options?: { yield_time_ms?: number; max_output_tokens?: number }): { code: string; yieldMs: number; tokens: number };
export function budgetOutput(output: string[], tokens: number): { output: string[]; omitted_output_bytes?: number };
