export interface CellRuntimeStatus {
	available: boolean;
	reason?: string;
}
export function cellRuntimeStatus(): Promise<CellRuntimeStatus>;
