export const RPC_LIMITS: Readonly<{
	calls: number;
	concurrent: number;
	argumentBytes: number;
	resultBytes: number;
	totalArgumentBytes: number;
	totalResultBytes: number;
	frameBytes: number;
	wireBytes: number;
	frames: number;
	tools: number;
	depth: number;
	nodes: number;
}>;
export function validToolName(name: unknown): name is string;
export function resultJSON(value: unknown): string;
