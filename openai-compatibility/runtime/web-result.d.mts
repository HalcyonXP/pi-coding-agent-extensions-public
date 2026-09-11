export const WEB_TEXT_PREFIX: string;
export const WEB_SOURCES_PREFIX: string;
export type WebVerification = "source-contract-only" | "subscription-smoke-verified-subset";
export function sealWebResult(content: { type: "text"; text: string }[], verification: WebVerification, sourceEvidencePresent: boolean): {
  content: { type: "text"; text: string }[];
  details: { verification: WebVerification; sourceEvidencePresent: boolean; web_result: { version: number; sha256: string } };
};
/** Accepts already native-JSON-admitted data, not guest objects or authority. */
export function webTextProjection(result: unknown): string | undefined;
