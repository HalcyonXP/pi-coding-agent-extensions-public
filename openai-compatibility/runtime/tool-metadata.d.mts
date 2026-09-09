export interface ToolMetadata { name: string; description: string }
export const TOOL_METADATA_LIMITS: Readonly<{ descriptionBytes: number; totalBytes: number }>;
export function toolMetadataJSON(names: string[], metadata: unknown): string;
export function snapshotToolMetadata(names: string[], definitions: unknown): ToolMetadata[];
export function cellStartFrame(code: string, names: string[], metadata?: ToolMetadata[]): { type: string; code: string; tools: string[]; toolMetadata?: ToolMetadata[] };
