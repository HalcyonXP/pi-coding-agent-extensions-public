export interface NativeArtifactPaths {
  directory: string;
  sourceSha256: string;
  recipeSha256: string;
  executable: string;
  manifest: string;
}
export const nativeSource: string;
export function sha256(bytes: Uint8Array): string;
export function artifactPaths(): Promise<NativeArtifactPaths>;
export function verifiedExecutable(): Promise<string>;
export function verifyArtifact(paths: NativeArtifactPaths): Promise<string>;
