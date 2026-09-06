import assert from "node:assert/strict";
import test from "node:test";

import todaysDate, {
	appendDateStatement,
	buildDateStatement,
	formatCurrentDate,
} from "./index.ts";

test("formats the local calendar date", () => {
	const date = new Date(2026, 8, 4, 23, 59, 58);
	assert.equal(formatCurrentDate(date), "September 4, 2026");
	assert.equal(buildDateStatement(date), "The date today is September 4, 2026");
	assert.throws(() => formatCurrentDate(new Date(Number.NaN)), /invalid current date/);
});

test("appends the statement to the system prompt", () => {
	assert.equal(
		appendDateStatement("base prompt", "The date today is September 4, 2026"),
		"base prompt\n\nThe date today is September 4, 2026",
	);
});

test("injects today's date before every agent run", async () => {
	let beforeAgentStart;
	todaysDate({
		on(event, handler) {
			if (event === "before_agent_start") beforeAgentStart = handler;
		},
	});

	assert.equal(typeof beforeAgentStart, "function");
	const result = await beforeAgentStart({ systemPrompt: "base prompt" }, {});
	assert.match(
		result.systemPrompt,
		/^base prompt\n\nThe date today is [A-Z][a-z]+ \d{1,2}, \d{4}$/,
	);
});
