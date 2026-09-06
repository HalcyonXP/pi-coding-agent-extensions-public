import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface ReasoningRateProfile {
	rate: number;
	samples: number;
	updatedAt: string;
}

interface ReasoningRateState {
	version: 1;
	profiles: Record<string, ReasoningRateProfile>;
}

const STATE_VERSION = 1;
const MAX_PROFILES = 64;
const MIN_PLAUSIBLE_RATE = 0.1;
const MAX_PLAUSIBLE_RATE = 5_000;
const EWMA_ALPHA = 0.25;

export function getDefaultReasoningRatesPath(): string {
	const override = process.env.PI_TPS_REASONING_RATES_PATH?.trim();
	return override || join(homedir(), ".pi", "agent", "tokens-per-second-rates.json");
}

function emptyState(): ReasoningRateState {
	return { version: STATE_VERSION, profiles: {} };
}

function validProfile(value: unknown): value is ReasoningRateProfile {
	if (typeof value !== "object" || value === null) return false;
	const profile = value as Partial<ReasoningRateProfile>;
	return (
		typeof profile.rate === "number" &&
		Number.isFinite(profile.rate) &&
		profile.rate >= MIN_PLAUSIBLE_RATE &&
		profile.rate <= MAX_PLAUSIBLE_RATE &&
		typeof profile.samples === "number" &&
		Number.isInteger(profile.samples) &&
		profile.samples > 0 &&
		typeof profile.updatedAt === "string" &&
		Number.isFinite(Date.parse(profile.updatedAt))
	);
}

function readState(path: string): ReasoningRateState {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (typeof value !== "object" || value === null) return emptyState();
		const candidate = value as Partial<ReasoningRateState>;
		if (candidate.version !== STATE_VERSION || typeof candidate.profiles !== "object" || candidate.profiles === null) {
			return emptyState();
		}

		const profiles: Record<string, ReasoningRateProfile> = {};
		for (const [key, profile] of Object.entries(candidate.profiles)) {
			if (validProfile(profile)) profiles[key] = profile;
		}
		return { version: STATE_VERSION, profiles };
	} catch {
		return emptyState();
	}
}

function pruneProfiles(profiles: Record<string, ReasoningRateProfile>): void {
	const sorted = Object.entries(profiles)
		.sort(([, left], [, right]) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
	for (const [key] of sorted.slice(MAX_PROFILES)) delete profiles[key];
}

function writeState(path: string, state: ReasoningRateState): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
	try {
		writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
			encoding: "utf8",
			mode: 0o600,
		});
		renameSync(temporaryPath, path);
	} finally {
		rmSync(temporaryPath, { force: true });
	}
}

/** Persistent, bounded EWMA profiles keyed by provider/model/thinking level. */
export class ReasoningRateProfiles {
	private readonly path: string;

	constructor(path = getDefaultReasoningRatesPath()) {
		this.path = path;
	}

	get(key: string | undefined): ReasoningRateProfile | undefined {
		if (!key) return undefined;
		return readState(this.path).profiles[key];
	}

	observe(key: string | undefined, sampleRate: number): ReasoningRateProfile | undefined {
		if (
			!key ||
			!Number.isFinite(sampleRate) ||
			sampleRate < MIN_PLAUSIBLE_RATE ||
			sampleRate > MAX_PLAUSIBLE_RATE
		) {
			return undefined;
		}

		const state = readState(this.path);
		const previous = state.profiles[key];
		const boundedSample = previous
			? Math.min(Math.max(sampleRate, previous.rate / 4), previous.rate * 4)
			: sampleRate;
		const rate = previous
			? previous.rate * (1 - EWMA_ALPHA) + boundedSample * EWMA_ALPHA
			: boundedSample;
		const profile: ReasoningRateProfile = {
			rate,
			samples: Math.min((previous?.samples ?? 0) + 1, Number.MAX_SAFE_INTEGER),
			updatedAt: new Date().toISOString(),
		};
		state.profiles[key] = profile;
		pruneProfiles(state.profiles);
		writeState(this.path, state);
		return profile;
	}

	remove(key: string | undefined): boolean {
		if (!key) return false;
		const state = readState(this.path);
		if (!(key in state.profiles)) return false;
		delete state.profiles[key];
		writeState(this.path, state);
		return true;
	}
}
