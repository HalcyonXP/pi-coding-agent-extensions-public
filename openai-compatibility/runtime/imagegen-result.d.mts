type Result = { content: Array<{type:"image";data:string;mimeType:string}|{type:"text";text:string}>; details: object; isError?: boolean };
export function sealImagegenResult<T extends Result>(result: T): T & {details: T["details"] & {imagegen_result?: {version:number;sha256:string}}};
export function normalImagegenProjection(result: unknown): boolean;
