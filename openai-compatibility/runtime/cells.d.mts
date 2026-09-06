export interface CellOutcome {
	cell_id: string;
	status: "running" | "draining" | "completed" | "terminated";
	output: string[];
	omitted_output_bytes?: number;
	result?: { version: number; status: string; code?: string };
}
// Types do not establish native authority. Runtime checks require genuine
// invocation/scopes, original context identity and native owned resource drain.
export class CodeCells {
	constructor(options: {
		owner: object;
		contextSignal: AbortSignal;
		signal?: AbortSignal;
	});
	exec(options: {
		owner: object;
		invocation: object;
		code: string;
		tools: string[];
		yield_time_ms?: number;
		max_output_tokens?: number;
	}): Promise<CellOutcome>;
	wait(options: {
		owner: object;
		invocation: object;
		cell_id: string;
		yield_time_ms?: number;
		max_tokens?: number;
		terminate?: boolean;
	}): Promise<CellOutcome>;
	close(): Promise<void>;
}
