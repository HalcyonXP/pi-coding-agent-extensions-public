import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Format the machine's current local calendar date without a time component. */
export function formatCurrentDate(date: Date = new Date()): string {
	if (Number.isNaN(date.getTime())) {
		throw new Error("todays-date: invalid current date");
	}

	return new Intl.DateTimeFormat("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	}).format(date);
}

export function buildDateStatement(date: Date = new Date()): string {
	return `The date today is ${formatCurrentDate(date)}`;
}

export function appendDateStatement(systemPrompt: string, statement: string): string {
	return `${systemPrompt}\n\n${statement}`;
}

export default function todaysDate(pi: ExtensionAPI): void {
	pi.on("before_agent_start", (event) => ({
		systemPrompt: appendDateStatement(event.systemPrompt, buildDateStatement()),
	}));
}
