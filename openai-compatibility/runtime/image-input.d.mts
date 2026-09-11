export const INLINE_IMAGE_BYTES: number;
export const INLINE_IMAGE_LABEL: string;
export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export type ValidImageInput = { data: string; mimeType: ImageMime; bytes: number };
export function createImageInput(): (value: unknown, maxBytes?: number, requireCanvas?: boolean) => ValidImageInput | undefined;
export const imageInput: ReturnType<typeof createImageInput>;
export const IMAGE_INPUT_SOURCE: string;
