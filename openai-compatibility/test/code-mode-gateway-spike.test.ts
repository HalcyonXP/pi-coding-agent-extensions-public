import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
// Deliberate, pinned internal import for NEGATIVE feasibility evidence only. Never imported by production code.
import { wrapRegisteredTool } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/wrapper.js";

// A future Pi API addition must trigger review of the blocker, rather than silently leaving it permanent.
type AssertNever<T extends never> = T;
type MissingInvocationAPI = AssertNever<Extract<keyof ExtensionAPI, "invokeTool" | "executeTool">>;
const missingApi: MissingInvocationAPI[] = [];

test("Pi 0.85 bare registered-tool wrapper is not a hook-preserving Code mode gateway", async () => {
	const actions: string[] = [];
	const runner = {
		getActiveTools: () => ["fixture"],
		createContext: () => ({}) as ExtensionContext,
		emitToolCall: async () => { actions.push("approval"); return { block: true, reason: "fixture denies execution" }; },
		emitToolResult: async () => { actions.push("result-policy"); },
	} as unknown as Parameters<typeof wrapRegisteredTool>[1];
	const tool = wrapRegisteredTool({
		sourceInfo: {} as Parameters<typeof wrapRegisteredTool>[0]["sourceInfo"], // metadata is unused by this wrapper
		definition: {
			name: "fixture", label: "Fixture", description: "Harmless offline counter", parameters: Type.Object({ count: Type.Integer() }),
			async execute() { actions.push("handler"); return { content: [{ type: "text", text: "fixture only" }], details: {} }; },
		},
	}, runner);
	await tool.execute("offline", { count: "not an integer" }, undefined, undefined);
	assert.deepEqual(actions, ["handler"], "bare wrapper neither validates the bad argument nor invokes the denying hook");
	assert.deepEqual(missingApi, []);
});
