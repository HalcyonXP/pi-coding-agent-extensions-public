// Copied ONLY into the provenance-pinned, privately patched host test checkout by CI.
// This uses the real AgentSession pipeline and real QuickJS child, not a gateway double.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { deflateSync } from "node:zlib";
import type { AgentToolScope } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { registerFauxProvider, streamSimple } from "@earendil-works/pi-ai/compat";
import { Container, getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.ts";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/types.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { withFileMutationQueue } from "../../src/core/tools/file-mutation-queue.ts";
import { CustomMessageComponent } from "../../src/modes/interactive/components/custom-message.ts";
import { InteractiveMode } from "../../src/modes/interactive/interactive-mode.ts";
import { LocalPollPresentation } from "../../src/modes/interactive/local-poll-presentation.ts";
import { initTheme } from "../../src/modes/interactive/theme/theme.ts";
import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { createHarness, type Harness } from "./harness.ts";

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: {} });
type Outcome = { version: number; status: string; output?: string[]; code?: string };
interface Probe {
	run(
		code: string,
		options: {
			gateway: Pick<NonNullable<ExtensionContext["tools"]>, "invoke" | "signal"> | undefined;
			allowedTools: string[];
			signal?: AbortSignal;
		},
	): Promise<Outcome>;
	close(): Promise<void>;
	readonly activeCount: number;
}
let ProbeClass: new () => Probe;
let WindowsProbeClass: new () => Probe;
type CellResult = { cell_id: string; status: string; output: string[]; result?: Outcome };
interface Cells {
	exec(options: {
		owner: object;
		invocation: NonNullable<ExtensionContext["tools"]>;
		code: string;
		tools: string[];
		yield_time_ms?: number;
		max_output_tokens?: number;
	}): Promise<CellResult>;
	wait(options: {
		owner: object;
		invocation: NonNullable<ExtensionContext["tools"]>;
		cell_id: string;
		terminate?: boolean;
		yield_time_ms?: number;
		max_tokens?: number;
	}): Promise<CellResult>;
	close(): Promise<unknown>;
}
let CellsClass: new (options: {
	owner: object;
	contextSignal: AbortSignal;
	signal: AbortSignal;
	runtimeFactory?: (options: object) => Probe;
}) => Cells;
let PortableCellClass: new (options: object) => Probe;
let registerCapabilities: (
	pi: ExtensionAPI,
	queue: <T>(path: string, operation: () => Promise<T>) => Promise<T>,
	options: { webSearch?: { transport: typeof fetch; profile?: "experimental" | "verified-v1" } },
) => void;
beforeAll(async () => {
	const moduleUrl = process.env.PI_CODE_MODE_RPC_MODULE;
	if (!moduleUrl?.startsWith("file:")) throw new Error("Explicit offline runtime file URL is required");
	ProbeClass = (await import(/* @vite-ignore */ moduleUrl)).AsyncRuntimeProbe;
	PortableCellClass = (await import(/* @vite-ignore */ moduleUrl)).CellRuntime;
	const cellsUrl = process.env.PI_CODE_MODE_CELLS_MODULE;
	if (!cellsUrl?.startsWith("file:")) throw new Error("Explicit cell module URL required");
	CellsClass = (await import(/* @vite-ignore */ cellsUrl)).CodeCells;
	if (process.platform === "win32" && process.arch === "x64") {
		const windowsUrl = process.env.PI_CODE_MODE_WINDOWS_MODULE;
		if (!windowsUrl?.startsWith("file:")) throw new Error("Explicit contained-runtime module URL is required");
		WindowsProbeClass = (await import(/* @vite-ignore */ windowsUrl)).WindowsAsyncRuntimeProbe;
	}
	const capabilitiesUrl = process.env.PI_CODE_MODE_CAPABILITIES_MODULE;
	if (!capabilitiesUrl?.startsWith("file:")) throw new Error("Explicit offline capabilities file URL is required");
	registerCapabilities = (await import(/* @vite-ignore */ capabilitiesUrl)).registerCapabilities;
});

function barrier() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

function tinyBmp(): string {
	const buffer = Buffer.alloc(58);
	buffer.write("BM", 0, "ascii");
	buffer.writeUInt32LE(buffer.length, 2);
	buffer.writeUInt32LE(54, 10);
	buffer.writeUInt32LE(40, 14);
	buffer.writeInt32LE(1, 18);
	buffer.writeInt32LE(1, 22);
	buffer.writeUInt16LE(1, 26);
	buffer.writeUInt16LE(24, 28);
	buffer.writeUInt32LE(4, 34);
	buffer[56] = 0xff;
	return buffer.toString("base64");
}

describe("restricted engine through real Pi parent-bound gateway", () => {
	const harnesses: Harness[] = [];
	const probes: Probe[] = [];
	afterEach(async () => {
		for (const probe of probes.splice(0)) await probe.close();
		for (const harness of harnesses.splice(0)) harness.cleanup();
	});

	async function fixture(code: string, hooks?: (pi: ExtensionAPI) => void, Constructor = ProbeClass) {
		const probe = new Constructor();
		probes.push(probe);
		let outcome: Outcome | undefined;
		let gateway: ExtensionContext["tools"];
		let executed = 0;
		const harness = await createHarness({
			tools: [],
			extensionFactories: [
				(pi) => {
					pi.registerTool({
						name: "cell",
						label: "Cell",
						description: "Offline single-handler RPC fixture",
						parameters: Type.Object({}),
						execute: async (_id, _args, signal, _update, ctx) => {
							gateway = ctx.tools;
							outcome = await probe.run(code, { gateway, allowedTools: ["target"], signal });
							return text(JSON.stringify(outcome));
						},
					});
					pi.registerTool({
						name: "target",
						label: "Target",
						description: "Harmless target",
						parameters: Type.Object({ value: Type.Literal("allowed") }),
						execute: async () => {
							executed++;
							return text("raw private fixture");
						},
					});
					hooks?.(pi);
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("cell", {})], { stopReason: "toolUse" }),
			fauxAssistantMessage("done"),
		]);
		return {
			harness,
			probe,
			executed: () => executed,
			outcome: () => outcome,
			gateway: () => gateway,
			run: () => harness.session.prompt("Offline restricted RPC test"),
		};
	}

	it.skipIf(process.platform !== "win32" || process.arch !== "x64")(
		"preserves the real hook pipeline through Windows-contained QuickJS",
		async () => {
			const f = await fixture(
				'const r=await tools.call("target",{value:"allowed"});emit(r.result.content[0].text);',
				(pi) => {
					pi.on("tool_result", (event) =>
						event.toolName === "target" ? text("contained actual result hook") : undefined,
					);
				},
				WindowsProbeClass,
			);
			await f.run();
			expect(f.outcome()).toEqual({ version: 1, status: "ok", output: ["contained actual result hook"] });
			expect(f.executed()).toBe(1);
			expect(f.probe.activeCount).toBe(0);
		},
		150_000,
	);

	it("runs actual approval/result hooks and only transfers the finalized result to QuickJS", async () => {
		const trace: string[] = [];
		const f = await fixture(
			'const r=await tools.call("target",{value:"allowed"}); emit(r.result.content[0].text); emit(String(r.isError));',
			(pi) => {
				pi.on("tool_call", (event) => {
					trace.push(`call:${event.toolName}`);
				});
				pi.on("tool_result", (event) => {
					trace.push(`result:${event.toolName}`);
					if (event.toolName === "target") return { ...text("actual hook filtered"), isError: true };
				});
			},
		);
		await f.run();
		expect(f.outcome()).toEqual({ version: 1, status: "ok", output: ["actual hook filtered", "true"] });
		expect(f.executed()).toBe(1);
		expect(trace).toEqual(["call:cell", "call:target", "result:target", "result:cell"]);
		const events = f.harness.eventsOfType("tool_execution_start");
		expect(events.map((event) => event.toolName)).toEqual(["cell", "target"]);
		expect(events[1].toolCallId.startsWith(events[0].toolCallId)).toBe(true);
		expect(f.harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
		expect(JSON.stringify(f.harness.session.messages)).not.toContain("raw private fixture");
		expect(f.probe.activeCount).toBe(0);
	});

	it.each(["deny", "mutate", "invalid"])(
		"%s uses real validation and approvals, not handler dispatch",
		async (mode) => {
			const f = await fixture(
				`const r=await tools.call("target",{value:${JSON.stringify(mode === "invalid" ? "bad" : "allowed")}}); emit(String(r.isError));`,
				(pi) => {
					pi.on("tool_call", (event) => {
						if (event.toolName !== "target") return;
						if (mode === "deny") return { block: true, reason: "denied by actual host hook" };
						if (mode === "mutate") event.input.value = "bad";
					});
				},
			);
			await f.run();
			expect(f.outcome()).toMatchObject({ status: "ok", output: ["true"] });
			expect(f.executed()).toBe(0);
		},
	);

	it("preserves normalized image data and citation details without flattening", async () => {
		const sources = [{ url: "https://example.invalid/source", title: "Synthetic source", start: 0, end: 4 }];
		const f = await fixture(
			'const r=await tools.call("target",{value:"allowed"}); emit(JSON.stringify(r));',
			(pi) => {
				pi.on("tool_result", (event) => {
					if (event.toolName === "target")
						return { content: [{ type: "image", mimeType: "image/bmp", data: tinyBmp() }], details: { sources } };
				});
			},
		);
		await f.run();
		expect(f.outcome()?.status).toBe("ok");
		const received = JSON.parse(f.outcome()?.output?.[0] ?? "null");
		expect(received.result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
		expect(Buffer.from(received.result.content[0].data, "base64").subarray(0, 8)).toEqual(
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);
		expect(received.result.details).toEqual({ sources });
	});

	it.each(["approval", "result"])("registry revocation during %s quarantines all guest output", async (phase) => {
		const f = await fixture('emit("withheld"); await tools.call("target",{value:"allowed"}); emit("late");', (pi) => {
			if (phase === "approval")
				pi.on("tool_call", (event) => {
					if (event.toolName === "target") pi.setActiveTools(["cell"]);
				});
			else
				pi.on("tool_result", (event) => {
					if (event.toolName === "target") pi.setActiveTools(["cell"]);
				});
		});
		await f.run();
		expect(f.outcome()).toEqual({ version: 1, status: "error", code: "CANCELLED" });
		expect(f.executed()).toBe(phase === "approval" ? 0 : 1);
		expect(f.probe.activeCount).toBe(0);
	});

	it("model replacement away and back does not revive a running engine", async () => {
		const started = barrier();
		const release = barrier();
		const f = await fixture('await tools.call("target",{value:"allowed"}); emit("late")', (pi) => {
			pi.on("tool_call", async (event) => {
				if (event.toolName === "target") {
					started.release();
					await release.promise;
				}
			});
		});
		const running = f.run();
		await started.promise;
		const original = f.harness.session.agent.state.model;
		f.harness.session.agent.state.model = { ...original, id: "other-offline-model" };
		f.harness.session.agent.state.model = original;
		expect(f.gateway()?.signal.aborted).toBe(true);
		release.release();
		await running;
		expect(f.executed()).toBe(0);
		expect(f.outcome()).toEqual({ version: 1, status: "error", code: "CANCELLED" });
	});

	it("reload entry revokes the engine while approval and shutdown hooks are pending", async () => {
		const started = barrier();
		const approval = barrier();
		const shutdown = barrier();
		const f = await fixture('await tools.call("target",{value:"allowed"}); emit("late")', (pi) => {
			pi.on("tool_call", async (event) => {
				if (event.toolName === "target") {
					started.release();
					await approval.promise;
				}
			});
			pi.on("session_shutdown", async () => {
				await shutdown.promise;
			});
		});
		const running = f.run();
		await started.promise;
		const reload = f.harness.session.reload();
		expect(f.gateway()?.signal.aborted).toBe(true);
		approval.release();
		shutdown.release();
		await Promise.allSettled([reload, running]);
		expect(f.executed()).toBe(0);
		expect(f.outcome()).toEqual({ version: 1, status: "error", code: "CANCELLED" });
		expect(f.probe.activeCount).toBe(0);
	});

	it("an expired real handler capability cannot start another worker", async () => {
		const f = await fixture('await tools.call("target",{value:"allowed"});');
		await f.run();
		const outcome = await f.probe.run('await tools.call("target",{value:"allowed"});', {
			gateway: f.gateway(),
			allowedTools: ["target"],
		});
		expect(outcome).toEqual({ version: 1, status: "error", code: "CANCELLED" });
		expect(f.executed()).toBe(1);
		expect(f.probe.activeCount).toBe(0);
	});
});

// The real cohesive tool is installed in the real host; only HTTP/auth and the model
// response stream are synthetic. No handler copy or substitute gateway is used.
describe.each(["web_search", "imagegen"])("actual %s capability through the real engine and host", (toolName) => {
	it.each(
		toolName === "imagegen"
			? ["success", "deny", "mutate", "revoke", "edit", "queued", "collision"]
			: ["success", "deny", "mutate", "revoke", "collision", "verified-direct", "verified-nested"],
	)("%s preserves provider/auth/approval boundaries", async (mode) => {
		const probe = new ProbeClass();
		const entered = barrier();
		const release = barrier();
		const queued = barrier();
		let heldQueue: Promise<void> | undefined;
		let canonicalFile: string | undefined;
		const account = "synthetic-web-host-account";
		const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.signature`;
		const source = { title: "Synthetic public docs", url: "https://openai.com/", marker: "turn0search0" };
		const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
		const params =
			toolName === "imagegen"
				? { prompt: "Synthetic fixture", destination_path: "fixture.png" }
				: { search_query: [{ q: "public docs" }] };
		let requests = 0;
		let authCalls = 0;
		let foreignCalls = 0;
		let forceActive: (() => void) | undefined;
		let outcome: Outcome | undefined;
		const previousFetch = globalThis.fetch;
		globalThis.fetch = async (url, init) => {
			if (
				toolName === "imagegen" &&
				(url === "https://chatgpt.com/backend-api/codex/images/generations" ||
					(mode === "edit" && url === "https://chatgpt.com/backend-api/codex/images/edits"))
			) {
				requests++;
				expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
				const body = JSON.parse(String(init?.body));
				expect(body.model).toBe("gpt-image-2");

				if (String(url).endsWith("/edits"))
					expect(body.images).toEqual([{ image_url: `data:image/png;base64,${png}` }]);
				return Response.json(
					{ data: [{ b64_json: png }], size: "1x1", quality: "high" },
					{ headers: { "x-request-id": token } },
				);
			}
			throw new Error("Unexpected network in actual capability fixture");
		};
		const harness = await createHarness({
			tools: [],
			extensionFactories: [
				(pi) => {
					registerCapabilities(
						pi,
						async (file, operation) => {
							const pending = withFileMutationQueue(file, operation);
							if (mode === "queued" && basename(file) === "fixture.png") queued.release();
							else canonicalFile = file;
							return pending;
						},
						{
							webSearch: {
								profile: mode.startsWith("verified-") ? "verified-v1" : "experimental",
								transport: async (url, init) => {
									requests++;
									expect(url).toBe("https://chatgpt.com/backend-api/codex/alpha/search");
									expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
									if (mode === "verified-direct") {
										const body = JSON.parse(String(init?.body));
										expect(body.model).toBe("gpt-5.4-mini");
										expect(body.commands.response_length).toBe("short");
									}
									return Response.json({
										output: "Fixture citeturn0search0 https://openai.com/",
										results: [source],
									});
								},
							},
						},
					);
					forceActive = () => pi.setActiveTools([...pi.getActiveTools(), toolName]);
					if (mode === "collision")
						pi.registerTool({
							name: toolName,
							label: "Foreign",
							description: "Conflicting fixture",
							parameters: Type.Record(Type.String(), Type.Unknown()),
							async execute() {
								foreignCalls++;
								return text("Foreign handler must not execute");
							},
						});
					pi.registerTool({
						name: "cell",
						label: "Cell",
						description: "Offline real capability fixture",
						parameters: Type.Object({}),
						async execute(_id, _args, signal, _update, ctx) {
							const followup =
								mode === "edit"
									? 'const edited=await tools.call("imagegen",{prompt:"Synthetic edit",referenced_image_paths:["fixture.png"],destination_path:"edited.png"}); emit(JSON.stringify(edited));'
									: "";
							outcome = await probe.run(
								`const r=await tools.call(${JSON.stringify(toolName)},${JSON.stringify(params)}); emit(JSON.stringify(r));${followup}`,
								{ gateway: ctx.tools, allowedTools: [toolName], signal },
							);
							return text(JSON.stringify(outcome));
						},
					});
					pi.on("tool_call", (event) => {
						if (event.toolName !== toolName) return;
						if (mode === "deny") return { block: true, reason: "Actual host approval denial" };
						if (mode === "mutate") Object.assign(event.input, { unverifiedFlag: true });
					});
				},
			],
		}).catch((error) => {
			globalThis.fetch = previousFetch;
			throw error;
		});
		try {
			await harness.session.bindExtensions({}); // real startup lifecycle, as in Pi's supported modes
			const official = {
				...harness.getModel(),
				provider: "openai",
				api: "openai-responses",
				baseUrl: "https://api.openai.com/v1",
				id: "gpt-6-astra",
			};
			// Keep the actual AgentSession's context official, but force model responses
			// through the known in-memory faux provider, never the official transport.
			harness.session.agent.streamFunction = (_model, context, options) =>
				streamSimple(harness.getModel(), context, options);
			harness.session.agent.state.model = official;
			const runtime = harness.session.modelRuntime;
			const originalGetModel = runtime.getModel.bind(runtime);
			runtime.getModel = (provider, id) =>
				provider === "openai-codex"
					? { ...official, provider, api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" }
					: provider === "openai"
						? official
						: originalGetModel(provider, id);
			runtime.hasConfiguredAuth = () => true;
			runtime.isUsingOAuth = (provider) => provider === "openai-codex";
			runtime.getAuth = async (provider) => {
				if (provider !== "openai-codex") return { auth: { apiKey: "faux-key" } };
				authCalls++;
				entered.release();
				if (mode === "revoke") await release.promise;
				return { auth: { apiKey: token } };
			};
			await harness.session.prompt(`/openai-tools ${toolName} on`);
			if (mode === "collision") {
				expect(harness.session.getActiveToolNames()).not.toContain(toolName);
				forceActive?.(); // even explicit re-exposure must not bypass the real approval hook
			} else expect(harness.session.getActiveToolNames()).toContain(toolName);
			if (mode === "queued") {
				heldQueue = withFileMutationQueue(join(harness.tempDir, "fixture.png"), async () => {
					entered.release();
					await release.promise;
				});
				await entered.promise;
			}
			harness.setResponses([
				fauxAssistantMessage(
					[mode === "verified-direct" ? fauxToolCall(toolName, params) : fauxToolCall("cell", {})],
					{ stopReason: "toolUse" },
				),
				fauxAssistantMessage("done"),
			]);
			const running = harness.session.prompt("Offline actual capability integration");
			if (mode === "revoke" || mode === "queued") {
				await Promise.race([
					mode === "queued" ? queued.promise : entered.promise,
					running.then(() => {
						throw new Error("Fixture did not reach subscription auth");
					}),
				]);
				harness.session.agent.state.model = harness.getModel();
				harness.session.agent.state.model = official;
				if (mode === "queued") {
					release.release();
					await heldQueue;
				}
			}
			await running;
			if (mode === "verified-direct") {
				const result = harness.session.messages.find(
					(message) => message.role === "toolResult" && message.toolName === toolName,
				);
				expect(result).toMatchObject({
					isError: false,
					details: { verification: "subscription-smoke-verified-subset" },
				});
				expect(JSON.stringify(result)).toContain("turn0search0");
				expect(probe.activeCount).toBe(0);
			} else if (mode === "revoke" || mode === "queued") {
				expect(outcome).toEqual({ version: 1, status: "error", code: "CANCELLED" });
				if (mode === "queued") {
					expect(canonicalFile).toBeDefined();
					expect((await readFile(canonicalFile!)).toString("base64")).toBe(png);
					await expect(readFile(join(harness.tempDir, "fixture.png"))).rejects.toMatchObject({ code: "ENOENT" });
				}
			} else {
				expect(outcome?.status).toBe("ok");
				const received = JSON.parse(outcome?.output?.at(-1) ?? "null");
				expect(received.isError).toBe(mode !== "success" && mode !== "edit");
				if (mode === "collision") expect(JSON.stringify(received.result)).toMatch(/reserved tool name/);
				if (mode === "verified-nested") expect(JSON.stringify(received.result)).toMatch(/direct tool call/);
				if (mode === "success" && toolName === "web_search") {
					expect(JSON.stringify(received)).toContain("turn0search0");
					expect(received.result.content[1].text).toContain(JSON.stringify(source));
					expect(received.result.details.verification).toBe("source-contract-only");
				} else if (mode === "success" || mode === "edit") {
					expect(received.result.content[0]).toMatchObject({ type: "image", mimeType: "image/png" });
					const canonical = received.result.details.canonicalPath;
					const destination = received.result.details.destinationPath;
					for (const file of [canonical, destination]) {
						const child = relative(harness.tempDir, file);
						expect(isAbsolute(child) || child.startsWith("..")).toBe(false);
						expect((await readFile(file)).toString("base64")).toBe(png);
					}
					expect(canonical).not.toBe(destination);
					if (mode === "edit") {
						const generated = JSON.parse(outcome?.output?.[0] ?? "null");
						expect(generated.result.details.canonicalPath).not.toBe(canonical);
						expect((await readFile(generated.result.details.canonicalPath)).toString("base64")).toBe(png);
						expect(received.result.details.operation).toBe("edit");
					}
					expect(JSON.stringify(received)).not.toContain(token);
				}
			}
			expect(foreignCalls).toBe(0);
			expect(requests).toBe(
				mode === "edit" ? 2 : mode === "success" || mode === "queued" || mode === "verified-direct" ? 1 : 0,
			);
			expect(authCalls).toBe(
				mode === "edit"
					? 2
					: mode === "success" || mode === "revoke" || mode === "queued" || mode === "verified-direct"
						? 1
						: 0,
			);
			expect(JSON.stringify(harness.session.messages)).not.toContain(token);
			expect(JSON.stringify(harness.session.messages)).not.toContain(account);
		} finally {
			release.release();
			try {
				await heldQueue;
				await probe.close();
				harness.cleanup();
			} finally {
				globalThis.fetch = previousFetch;
			}
		}
	});
});

describe.each(["success", "deny", "mutate", "revoke"])("actual Unified exec through the real gateway: %s", (mode) => {
	it("uses real native processes, hooks, stdin and cancellation without subscription auth", async () => {
		const previousFetch = globalThis.fetch;
		globalThis.fetch = async () => {
			throw new Error("Network forbidden in native gateway fixture");
		};
		const probe = new ProbeClass();
		const entered = barrier();
		const outcomes: Outcome[] = [];
		const executions: string[] = [];
		const errors: unknown[] = [];
		let harness: Harness | undefined;
		let running: Promise<unknown> | undefined;
		let authCalls = 0;
		let ready = false;
		const program =
			'setTimeout(()=>process.exit(2),90000);process.stdout.write("READY\\n");process.stdin.once("data",data=>process.stdout.write("ACK:"+data.toString(),()=>process.exit(0)));';
		const quote = (s: string) => `'${s.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
		let command = "";
		try {
			harness = await createHarness({
				extensionFactories: [
					(pi) => {
						// Observe actual handler entry; delegate the original registered definition unchanged.
						const register = pi.registerTool.bind(pi);
						pi.registerTool = (definition) =>
							register({
								...definition,
								async execute(...args) {
									executions.push(definition.name);
									const value = definition.execute(...args);
									if (mode === "revoke" && ready && definition.name === "write_stdin") entered.release();
									return value;
								},
							});
						registerCapabilities(pi, withFileMutationQueue, {
							webSearch: { transport: globalThis.fetch },
						});
						pi.on("tool_call", (event) => {
							if (event.toolName !== "exec_command") return;
							if (mode === "deny") return { block: true, reason: "Native fixture approval denial" };
							if (mode === "mutate") Object.assign(event.input, { unverifiedFlag: true });
						});
						pi.registerTool({
							name: "cell",
							label: "Native gateway fixture",
							description: "Offline native-process integration",
							parameters: Type.Object({}),
							async execute(_id, _args, signal, _update, ctx) {
								const scope = ctx.tools!.openScope();
								try {
									const deadline = Date.now() + 90_000;
									const call = async (name: string, args: Record<string, unknown>) => {
										const outcome = await probe.run(
											`emit(JSON.stringify(await tools.call(${JSON.stringify(name)},${JSON.stringify(args)})))`,
											{ gateway: scope, allowedTools: ["exec_command", "write_stdin"], signal },
										);
										outcomes.push(outcome);
										if (outcome.status !== "ok") {
											if (mode === "revoke" && ready) return undefined;
											throw new Error(`Native fixture RPC failed: ${outcome.code}`);
										}
										return JSON.parse(outcome.output?.at(-1) ?? "null");
									};
									const initial = await call("exec_command", {
										cmd: command,
										yield_time_ms: 1,
										max_output_tokens: 128,
									});
									if (mode === "deny" || mode === "mutate") {
										expect(initial?.isError).toBe(true);
										return text("native fixture complete");
									}
									expect(initial?.isError).toBe(false);
									let value = initial.result.details;
									const id = value.session_id;
									expect(typeof id).toBe("string");
									let output = value.output;
									// Poll the same owned process. Every fresh isolate stays inside this one awaited
									// real handler; no expired gateway or assumption that a yield means completion.
									while (!output.includes("READY")) {
										if (Date.now() >= deadline) throw new Error("Native readiness deadline");
										const polled = await call("write_stdin", {
											session_id: id,
											yield_time_ms: 2000,
											max_output_tokens: 128,
										});
										expect(polled?.isError).toBe(false);
										value = polled.result.details;
										expect(value.running, JSON.stringify(value)).toBe(true);
										expect(value.session_id).toBe(id);
										output += value.output;
									}
									ready = true;
									if (mode === "revoke") {
										await call("write_stdin", {
											session_id: id,
											yield_time_ms: 30000,
											max_output_tokens: 128,
										});
										expect(outcomes.at(-1)).toEqual({ version: 1, status: "error", code: "CANCELLED" });
									} else {
										const written = await call("write_stdin", {
											session_id: id,
											chars: "finish\n",
											yield_time_ms: 1,
											max_output_tokens: 128,
										});
										expect(written?.isError).toBe(false);
										value = written.result.details;
										output += value.output;
										while (value.session_id) {
											if (Date.now() >= deadline) throw new Error("Native completion deadline");
											expect(value.session_id).toBe(id);
											const polled = await call("write_stdin", {
												session_id: id,
												yield_time_ms: 2000,
												max_output_tokens: 128,
											});
											expect(polled?.isError).toBe(false);
											value = polled.result.details;
											output += value.output;
										}
										expect(value.running).toBe(false);
										expect(value.exit_code).toBe(0);
										expect(output).toContain("ACK:finish");
									}
									return text("native fixture complete");
								} finally {
									await scope.close();
								}
							},
						});
					},
				],
			});
			const fixture = join(harness.tempDir, "native-gateway-fixture.cjs");
			await writeFile(fixture, program);
			command = `${process.platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(fixture)}${process.platform === "win32" ? "; exit $LASTEXITCODE" : ""}`;
			await harness.session.bindExtensions({});
			harness.session.extensionRunner.onError((error) => errors.push(error));
			const official = {
				...harness.getModel(),
				provider: "openai",
				api: "openai-responses",
				baseUrl: "https://api.openai.com/v1",
				id: "gpt-6-astra",
			};
			harness.session.agent.state.model = official;
			harness.session.agent.streamFunction = (_model, context, options) =>
				streamSimple(harness!.getModel(), context, options);
			const runtime = harness.session.modelRuntime;
			const originalGetModel = runtime.getModel.bind(runtime);
			runtime.getModel = (provider, id) => (provider === "openai" ? official : originalGetModel(provider, id));
			runtime.hasConfiguredAuth = () => true;
			runtime.getAuth = async (provider) => {
				if (provider === "openai-codex") {
					authCalls++;
					throw new Error("Native execution must not resolve subscription auth");
				}
				return { auth: { apiKey: "faux-key" } };
			};
			await harness.session.prompt("/openai-tools unified_exec on");
			expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["exec_command", "write_stdin"]));
			harness.setResponses([
				fauxAssistantMessage([fauxToolCall("cell", {})], { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);
			running = harness.session.prompt("Offline native gateway fixture");
			if (mode === "revoke") {
				await Promise.race([
					entered.promise,
					running.then(() => {
						throw new Error("Fixture never reached active native poll");
					}),
				]);
				harness.session.agent.state.model = harness.getModel();
				harness.session.agent.state.model = official;
			}
			await running;
			if (mode === "revoke") expect(outcomes.at(-1)).toEqual({ version: 1, status: "error", code: "CANCELLED" });
			else
				expect(
					harness.session.messages.find((message) => message.role === "toolResult" && message.toolName === "cell"),
				).toMatchObject({ isError: false, content: [{ type: "text", text: "native fixture complete" }] });
			const actual = executions.filter((name) => name !== "cell");
			if (mode === "deny" || mode === "mutate") expect(actual).toEqual([]);
			else {
				expect(actual.filter((name) => name === "exec_command")).toHaveLength(1);
				expect(actual).toContain("write_stdin");
				expect(ready).toBe(true);
			}
			expect(authCalls).toBe(0);
		} finally {
			try {
				harness?.session.agent.abort();
				await probe.close();
				await running?.catch(() => {});
				if (harness) await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				expect(errors).toEqual([]); // includes any real cleanup failure emitted by Pi
			} finally {
				try {
					harness?.cleanup();
				} finally {
					globalThis.fetch = previousFetch;
				}
			}
		}
	}, 120_000);
});

// Durable host scopes, not a retained expired handler gateway. These still launch a
// fresh QuickJS instance: persistent VM cells and protected evidence are separate.
describe("real engine through a durable native AgentSession scope", () => {
	it.skipIf(process.platform === "win32" && process.arch !== "x64").each(["later-handler", "idle-revoke"])(
		"%s retains genuine ownership and hooks",
		async (mode) => {
			const probe = new (process.platform === "win32" ? WindowsProbeClass : ProbeClass)();
			let cell: AgentToolScope | undefined,
				old: ExtensionContext["tools"],
				harness: Harness | undefined,
				running: Promise<Outcome> | undefined;
			let outcome: Outcome | undefined,
				turn = 0,
				executed = 0;
			const approval = barrier(),
				release = barrier();
			const previousFetch = globalThis.fetch;
			globalThis.fetch = async () => {
				throw new Error("Network is forbidden in durable RPC fixtures");
			};
			const launch = async (scope: AgentToolScope) => {
				const releaseWorker = scope.ownResource(() => probe.close());
				try {
					return await probe.run(
						'const r=await tools.call("target",{value:"allowed"});emit(r.result.content[0].text);',
						{ gateway: scope, allowedTools: ["target"] },
					);
				} finally {
					await probe.close();
					releaseWorker();
				}
			};
			try {
				harness = await createHarness({
					tools: [],
					extensionFactories: [
						(pi) => {
							pi.registerTool({
								name: "cell",
								label: "Cell",
								description: "Durable native scope fixture",
								parameters: Type.Object({}),
								execute: async (_id, _args, _signal, _update, ctx) => {
									if (turn++ === 0) {
										old = ctx.tools;
										cell = ctx.tools!.openScope();
										return text("issued native scope");
									}
									outcome = await launch(ctx.tools!.adoptScope(cell!));
									return text(JSON.stringify(outcome));
								},
							});
							pi.registerTool({
								name: "target",
								label: "Target",
								description: "Harmless owned target",
								parameters: Type.Object({ value: Type.Literal("allowed") }),
								execute: async (_id, _args, _signal, _update, ctx) => {
									executed++;
									expect(ctx.tools?.origin).toBe("nested");
									expect(ctx.tools?.scope?.id).toBe(cell?.id);
									return text("raw actual target");
								},
							});
							pi.on("tool_call", async (event) => {
								if (event.toolName === "target") {
									approval.release();
									if (mode === "idle-revoke") await release.promise;
								}
								return undefined;
							});
							pi.on("tool_result", (event) =>
								event.toolName === "target" ? text("durable finalized result") : undefined,
							);
						},
					],
				});
				harness.setResponses([
					fauxAssistantMessage([fauxToolCall("cell", {})], { stopReason: "toolUse" }),
					fauxAssistantMessage("issued"),
				]);
				await harness.session.prompt("issue a host scope without starting a worker");
				expect(old?.signal.aborted).toBe(true);
				expect(cell?.signal.aborted).toBe(false);
				expect(probe.activeCount).toBe(0);
				if (mode === "later-handler") {
					harness.setResponses([
						fauxAssistantMessage([fauxToolCall("cell", {})], { stopReason: "toolUse" }),
						fauxAssistantMessage("completed"),
					]);
					await harness.session.prompt("use the native scope through a different actual handler");
					expect(outcome).toEqual({ version: 1, status: "ok", output: ["durable finalized result"] });
					expect(turn).toBe(2);
					expect(executed).toBe(1);
					expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(2);
				} else {
					running = launch(cell!);
					await approval.promise;
					expect(harness.session.agent.state.isStreaming).toBe(false);
					const closing = cell!.close();
					let closed = false;
					void closing.then(() => {
						closed = true;
					});
					await new Promise((resolve) => setTimeout(resolve, 25));
					expect(closed).toBe(false);
					expect(cell!.state).toBe("draining");
					release.release();
					outcome = await running;
					await closing;
					expect(outcome).toEqual({ version: 1, status: "error", code: "CANCELLED" });
					expect(executed).toBe(0);
					expect(cell!.state).toBe("closed");
					expect(harness.session.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
				}
				expect(probe.activeCount).toBe(0);
			} finally {
				release.release();
				harness?.session.agent.abort();
				try {
					await probe.close();
					await running;
					await cell?.close();
					harness?.cleanup();
				} finally {
					globalThis.fetch = previousFetch;
				}
			}
		},
		150_000,
	);
});

// Actual running isolate retained across genuine returned handlers. Linux validates
// host semantics with the explicit portable test seam, never a production fallback.
describe("bounded cells through actual AgentSession exec/wait handlers", () => {
	it
		.skipIf(process.platform === "win32" && process.arch !== "x64")
		.each([
			"later-wait",
			"store-next-exec",
			"store-model-revoke",
			"store-visibility-revoke",
			"idle-revoke",
			"model-revoke",
			"reload",
			"terminate",
			"foreign",
			"deny",
			"mutate",
			"long-wait",
			"cleanup-pending",
			"cleanup-failed",
		])(
		"%s",
		async (mode) => {
			let manager: Cells | undefined,
				owner: object | undefined,
				old: ExtensionContext["tools"],
				executed = 0;
			const outcomes: CellResult[] = [];
			const cleanup = barrier();
			let confirmClose = () => {};
			const epoch = new AbortController(),
				entered = barrier(),
				gate = barrier();
			let harness: Harness | undefined, foreign: Harness | undefined;
			const beforeFetch = globalThis.fetch;
			globalThis.fetch = async () => {
				throw Error("Network forbidden in actual cell fixtures");
			};
			const invoke = async (h: Harness, name: string, args: Record<string, unknown>) => {
				h.setResponses([
					fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
					fauxAssistantMessage("done"),
				]);
				await h.session.prompt("Offline bounded cell fixture");
			};
			try {
				harness = await createHarness({
					tools: [],
					extensionFactories: [
						(pi) => {
							pi.registerTool({
								name: "fixture_exec",
								label: "Exec",
								description: "Actual bounded cell fixture",
								parameters: Type.Object({ code: Type.String() }),
								execute: async (_id, args, _signal, _update, ctx) => {
									old = ctx.tools;
									if (!manager) {
										owner = ctx.sessionManager;
										manager = new CellsClass({
											owner,
											contextSignal: ctx.tools!.contextSignal,
											signal: epoch.signal,
											...(process.platform !== "win32"
												? { runtimeFactory: (options: object) => new PortableCellClass(options) }
												: {}),
										});
									}
									const result = await manager.exec({
										owner: ctx.sessionManager,
										invocation: ctx.tools!,
										code: args.code,
										tools: ["target"],
										yield_time_ms: 10000,
									});
									outcomes.push(result);
									return text(JSON.stringify(result));
								},
							});
							pi.registerTool({
								name: "fixture_wait",
								label: "Wait",
								description: "Adopt and wait the same real cell",
								parameters: Type.Object({ cell_id: Type.String(), terminate: Type.Optional(Type.Boolean()) }),
								execute: async (_id, args, _signal, _update, ctx) => {
									const result = await manager!.wait({
										owner: ctx.sessionManager,
										invocation: ctx.tools!,
										cell_id: args.cell_id,
										terminate: args.terminate,
										yield_time_ms: args.terminate ? 50 : mode.startsWith("cleanup-") ? 250 : 10000,
									});
									outcomes.push(result);
									return text(JSON.stringify(result));
								},
							});
							pi.registerTool({
								name: "target",
								label: "Target",
								description: "Harmless genuine nested target",
								parameters: Type.Object({ value: Type.Literal("allowed") }),
								execute: async (_id, _args, _signal, _update, ctx) => {
									executed++;
									expect(ctx.tools?.origin).toBe("nested");
									if (mode.startsWith("cleanup-"))
										confirmClose = ctx.tools!.scope!.ownResource(async () => {
											if (mode === "cleanup-failed") throw Error("controlled resource cleanup failure");
											await cleanup.promise;
										});
									return text("raw");
								},
							});
							pi.on("tool_call", async (event) => {
								if (event.toolName === "target") {
									entered.release();
									await gate.promise;
									if (mode === "deny") return { block: true, reason: "Actual denial fixture" };
									if (mode === "mutate") Object.assign(event.input as object, { value: "tampered" });
								}
								return undefined;
							});
							pi.on("tool_result", (event) =>
								event.toolName === "target" ? text("finalized actual target") : undefined,
							);
						},
					],
				});
				if (mode.startsWith("store-")) {
					await invoke(harness, "fixture_exec", { code: 'store("x",{value:"α\\0🐈"});text("stored");' });
					expect(outcomes[0].status).toBe("completed");
					expect(old?.signal.aborted).toBe(true);
					const contextSignal = old!.contextSignal;
					expect(contextSignal.aborted).toBe(false);
					expect(Object.isFrozen(old)).toBe(true);
					if (mode !== "store-next-exec") {
						if (mode === "store-model-revoke") {
							const model = harness.session.agent.state.model!;
							harness.session.agent.state.model = { ...model, id: `${model.id}-changed` };
							harness.session.agent.state.model = model;
						} else {
							harness.session.setActiveToolsByName(["fixture_exec", "fixture_wait"]);
							harness.session.setActiveToolsByName(["fixture_exec", "fixture_wait", "target"]);
						}
						expect(contextSignal.aborted).toBe(true);
						await manager!.close();
						manager = undefined;
					}
					await invoke(harness, "fixture_exec", {
						code: mode === "store-next-exec" ? 'text(load("x").value);' : 'text(load("x"));',
					});
					expect(outcomes[1]).toMatchObject({
						status: "completed",
						output: [mode === "store-next-exec" ? "α\0🐈" : "undefined"],
					});
					if (mode === "store-next-exec") expect(old!.contextSignal).toBe(contextSignal);
				} else {
					await invoke(harness, "fixture_exec", {
						code: `text("before");yield_control();const value=await tools.target({value:"allowed"});text(${mode === "deny" || mode === "mutate" ? "String(value.isError)" : "value.result.content[0].text"});`,
					});
					expect(outcomes[0]).toMatchObject({ status: "running", output: ["before"] });
					expect(old?.signal.aborted).toBe(true);
					await entered.promise;
					expect(executed).toBe(0);
					expect(harness.session.agent.state.isStreaming).toBe(false);
					const id = outcomes[0].cell_id;
					if (mode === "idle-revoke" || mode === "model-revoke" || mode === "reload") {
						if (mode === "idle-revoke") harness.session.agent.abort();
						else if (mode === "model-revoke") {
							const oldModel = harness.session.agent.state.model!;
							harness.session.agent.state.model = { ...oldModel, id: `${oldModel.id}-changed` };
							harness.session.agent.state.model = oldModel;
						} else {
							const reloading = harness.session.reload();
							await new Promise((resolve) => setTimeout(resolve, 25));
							gate.release();
							await reloading;
						}
						gate.release();
						await manager!.close();
						expect(executed).toBe(0);
					} else if (mode === "terminate") {
						await invoke(harness, "fixture_wait", { cell_id: id, terminate: true });
						expect(outcomes.at(-1)).toMatchObject({ status: "draining", output: [] });
						gate.release();
						await new Promise((resolve) => setTimeout(resolve, 50));
						await invoke(harness, "fixture_wait", { cell_id: id });
						expect(outcomes.at(-1)).toMatchObject({ status: "terminated", output: [] });
						expect(executed).toBe(0);
					} else {
						if (mode === "foreign") {
							let denied = false;
							foreign = await createHarness({
								tools: [],
								extensionFactories: [
									(pi) =>
										pi.registerTool({
											name: "foreign_wait",
											label: "Foreign",
											description: "Adversarial actual foreign context",
											parameters: Type.Object({}),
											execute: async (_id, _args, _signal, _update, ctx) => {
												try {
													await manager!.wait({
														owner: owner!,
														invocation: ctx.tools!,
														cell_id: id,
														yield_time_ms: 0,
													});
												} catch {
													denied = true;
												}
												return text("foreign checked");
											},
										}),
								],
							});
							await invoke(foreign, "foreign_wait", {});
							expect(denied).toBe(true);
							expect(executed).toBe(0);
						}
						if (mode === "long-wait") await new Promise((resolve) => setTimeout(resolve, 5200));
						gate.release();
						await invoke(harness, "fixture_wait", { cell_id: id });
						if (mode.startsWith("cleanup-")) {
							const deadline = Date.now() + 10000;
							while (outcomes.at(-1)?.status === "running" && Date.now() < deadline)
								await invoke(harness, "fixture_wait", { cell_id: id });
							expect(outcomes.at(-1)).toMatchObject({ status: "draining", output: [] });
							if (mode === "cleanup-failed") {
								const before = outcomes.length;
								await invoke(harness, "fixture_exec", { code: 'text("must not run");' });
								expect(outcomes).toHaveLength(before);
								expect(
									harness.session.messages
										.filter((m) => m.role === "toolResult" && m.toolName === "fixture_exec")
										.at(-1),
								).toMatchObject({ isError: true });
								confirmClose();
							} else cleanup.release();
							await invoke(harness, "fixture_wait", { cell_id: id });
						}
						expect(outcomes.at(-1)).toMatchObject({
							cell_id: id,
							status: "completed",
							output: [mode === "deny" || mode === "mutate" ? "true" : "finalized actual target"],
							result: { status: "ok" },
						});
						expect(executed).toBe(mode === "deny" || mode === "mutate" ? 0 : 1);
					}
				}
			} finally {
				gate.release();
				cleanup.release();
				confirmClose();
				epoch.abort();
				harness?.session.agent.abort();
				foreign?.session.agent.abort();
				try {
					await manager?.close();
				} finally {
					harness?.cleanup();
					foreign?.cleanup();
					globalThis.fetch = beforeFetch;
				}
			}
		},
		90000,
	);
});

describe("native protected result publication", () => {
	it.each(["descendant", "revoke-before-flush", "journal-failure", "reset-idle", "persisted", "idle-message-failure"])(
		"%s uses genuine hooks and session history",
		async (mode) => {
			let harness: Harness | undefined, scope: AgentToolScope | undefined;
			const captured: string[] = [];
			const requests: string[] = [];
			const directory = mode === "persisted" ? await mkdtemp(join(tmpdir(), "pi-protected-history-")) : undefined;
			const sessionFactory = directory
				? vi.spyOn(SessionManager, "inMemory").mockImplementation(() => SessionManager.create(directory, directory))
				: undefined;
			const beforeFetch = globalThis.fetch;
			globalThis.fetch = async () => {
				throw Error("Network forbidden in protected native fixtures");
			};
			try {
				harness = await createHarness({
					tools: [],
					extensionFactories: [
						(pi) => {
							pi.registerTool({
								name: "protected_root",
								label: "Protected",
								description: "Native publication fixture",
								parameters: Type.Object({}),
								execute: async (_id, _args, _signal, _update, ctx) => {
									expect(ctx.tools!.hasProtectedResults()).toBe(false);
									scope = ctx.tools!.openScope({
										onResult: async (event) => {
											captured.push(event.toolName);
											if (event.toolName === "target")
												await scope!.publishEvidence({
													content: event.result.content,
													details: { tool: event.toolName },
												});
										},
									});
									try {
										if (mode === "reset-idle" || mode === "idle-message-failure")
											return text("scope retained");
										await scope.invoke("outer", {});
										if (mode === "revoke-before-flush") harness!.session.agent.invalidateToolInvocations();
										return text("outer filtered everything");
									} finally {
										if (mode !== "reset-idle" && mode !== "idle-message-failure") await scope.close();
									}
								},
							});
							pi.registerTool({
								name: "protected_noop",
								label: "Noop",
								description: "Fresh-context fixture",
								parameters: Type.Object({}),
								execute: async () => text("no evidence"),
							});
							pi.registerTool({
								name: "outer",
								label: "Outer",
								description: "Attempts to discard descendant evidence",
								parameters: Type.Object({}),
								execute: async (_id, _args, _signal, _update, ctx) => {
									await ctx.tools!.invoke("target", {});
									return text("filtered");
								},
							});
							pi.registerTool({
								name: "target",
								label: "Target",
								description: "Finalized image/evidence source",
								parameters: Type.Object({}),
								execute: async (_id, _args, _signal, _update, ctx) => {
									expect(ctx.tools!.hasProtectedResults()).toBe(true);
									return text("RAW_PRIVATE_FIXTURE");
								},
							});
							pi.on("tool_result", (event) =>
								event.toolName === "target"
									? {
											content: [
												{ type: "text", text: "finalized protected evidence" },
												{ type: "image", data: tinyBmp(), mimeType: "image/bmp" },
											],
										}
									: undefined,
							);
						},
					],
				});
				if (sessionFactory) {
					expect(sessionFactory).toHaveBeenCalledTimes(1);
					sessionFactory.mockRestore();
				}
				const stream = harness.session.agent.streamFunction;
				harness.session.agent.streamFunction = (model, context, options) => {
					requests.push(JSON.stringify(context.messages));
					return stream(model, context, options);
				};
				if (mode === "journal-failure")
					harness.sessionManager.appendCustomEntry = () => {
						throw Error("Controlled journal write failure");
					};
				harness.setResponses([
					fauxAssistantMessage([fauxToolCall("protected_root", {})], { stopReason: "toolUse" }),
					fauxAssistantMessage("done"),
				]);
				await harness.session.prompt("Offline protected native publication fixture");
				if (mode === "idle-message-failure") {
					harness.sessionManager.appendCustomMessageEntry = () => {
						throw Error("Synthetic message persistence failure");
					};
					await expect(scope!.invoke("outer", {})).rejects.toThrow();
					await expect(scope!.close()).rejects.toThrow();
					expect(JSON.stringify(harness.session.messages)).not.toContain("finalized protected evidence");
					expect(scope!.state).toBe("draining");
					return;
				}
				if (mode === "reset-idle") {
					await scope!.invoke("outer", {});
					expect(JSON.stringify(harness.session.messages)).toContain("finalized protected evidence");
					harness.session.agent.state.messages = [];
					harness.setResponses([
						fauxAssistantMessage([fauxToolCall("protected_noop", {})], { stopReason: "toolUse" }),
						fauxAssistantMessage("done"),
					]);
					await harness.session.prompt("Fresh transcript must not resurrect old protected evidence");
					expect(requests.at(-1)).not.toContain("finalized protected evidence");
				}
				const published = harness.session.messages.filter(
					(message) => message.role === "custom" && message.customType === "code-mode-evidence",
				);
				const journal = harness.sessionManager
					.getEntries()
					.filter((entry) => entry.type === "custom" && entry.customType === "code-mode-protected-evidence");
				if (mode === "descendant" || mode === "persisted") {
					if (mode === "persisted") {
						const entries = (await readFile(harness.sessionManager.getSessionFile()!, "utf8"))
							.trim()
							.split("\n")
							.map((line) => JSON.parse(line));
						expect(entries.filter((entry) => entry.customType === "code-mode-protected-evidence")).toHaveLength(
							1,
						);
						expect(entries.filter((entry) => entry.customType === "code-mode-evidence")).toHaveLength(1);
						expect(JSON.stringify(entries)).not.toContain("RAW_PRIVATE_FIXTURE");
					}
					expect(captured).toEqual(["target", "outer"]);
					expect(journal).toHaveLength(1);
					expect(published).toHaveLength(1);
					expect(JSON.stringify(published)).not.toContain("RAW_PRIVATE_FIXTURE");
					expect(JSON.stringify(published)).toContain("image/png");
					expect(requests.at(-1)).toContain("finalized protected evidence");
					expect(requests.at(-1)).not.toContain("RAW_PRIVATE_FIXTURE");
					expect(harness.session.messages.filter((m) => m.role === "toolResult")).toHaveLength(1);
					expect(scope!.state).toBe("closed");
				} else if (mode === "revoke-before-flush" || mode === "reset-idle") {
					expect(journal).toHaveLength(1);
					expect(published).toHaveLength(0);
					expect(requests.at(-1)).not.toContain("finalized protected evidence");
				} else {
					expect(journal).toHaveLength(0);
					expect(published).toHaveLength(0);
					expect(scope!.state).toBe("draining");
					expect(harness.session.messages.find((m) => m.role === "toolResult")).toMatchObject({
						isError: true,
						details: { scopeCleanup: "unconfirmed" },
					});
				}
			} finally {
				harness?.session.agent.abort();
				try {
					await scope?.close().catch(() => {});
				} finally {
					try {
						harness?.cleanup();
					} finally {
						globalThis.fetch = beforeFetch;
						sessionFactory?.mockRestore();
						if (directory) await rm(directory, { recursive: true, force: true });
					}
				}
			}
		},
		60000,
	);
});

function practicalPng(): string {
	const chunk = (name: string, data: Buffer) => {
		const payload = Buffer.concat([Buffer.from(name), data]);
		let crc = 0xffffffff;
		for (const byte of payload) {
			crc ^= byte;
			for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
		}
		const length = Buffer.alloc(4),
			sum = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
		return Buffer.concat([length, payload, sum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(256, 0);
	header.writeUInt32BE(256, 4);
	header[8] = 8;
	header[9] = 6;
	const raw = Buffer.alloc(256 * (1 + 256 * 4));
	let state = 123456789;
	for (let y = 0; y < 256; y++)
		for (let x = 0; x < 256; x++)
			for (let c = 0; c < 4; c++) {
				state ^= state << 13;
				state ^= state >>> 17;
				state ^= state << 5;
				raw[y * 1025 + 1 + x * 4 + c] = c === 3 ? 255 : state & 255;
			}
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]).toString("base64");
}

describe("practical protected image/source cells with actual capability handlers", () => {
	it
		.skipIf(process.platform === "win32" && process.arch !== "x64")
		.each([
			"image-edit",
			"guest-failure",
			"early-yield",
			"descendant-web",
			"redacted",
			"forged-reference",
			"context-reference",
			"revoke-auth",
			"journal-failure",
		])(
		"%s",
		async (mode) => {
			const png = practicalPng();
			expect(png.length).toBeGreaterThan(65536);
			const epoch = new AbortController(),
				entered = barrier(),
				release = barrier();
			let manager: Cells | undefined,
				harness: Harness | undefined,
				calls = 0,
				authCalls = 0;
			const outcomes: CellResult[] = [],
				requests: string[] = [],
				errors: string[] = [];
			const beforeFetch = globalThis.fetch;
			const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "acct-synthetic" } })).toString("base64url")}.signature`;
			globalThis.fetch = async (url, init) => {
				expect(String(url)).toMatch(/^https:\/\/chatgpt\.com\/backend-api\/codex\/images\/(generations|edits)$/);
				calls++;
				const body = JSON.parse(String(init?.body));
				if (mode === "early-yield") await release.promise;
				if (String(url).endsWith("/edits"))
					expect(body.images).toEqual([{ image_url: `data:image/png;base64,${png}` }]);
				return Response.json({ data: [{ b64_json: png }], size: "256x256" });
			};
			const invoke = async (code: string, cell_id?: string) => {
				harness!.setResponses([
					fauxAssistantMessage([fauxToolCall("fixture_exec", { code, ...(cell_id ? { cell_id } : {}) })], {
						stopReason: "toolUse",
					}),
					fauxAssistantMessage("finished"),
				]);
				await harness!.session.prompt("Synthetic protected cell acceptance");
			};
			try {
				harness = await createHarness({
					tools: [],
					extensionFactories: [
						(pi) => {
							registerCapabilities(pi, withFileMutationQueue, {
								webSearch: {
									profile: "verified-v1",
									transport: async () => {
										calls++;
										return Response.json({
											output: "Verified source https://example.com/native [native1]",
											results: [
												{ title: "Native source", url: "https://example.com/native", citation: "native1" },
											],
										});
									},
								},
							});
							pi.registerTool({
								name: "fixture_exec",
								label: "Exec",
								description: "Protected cell fixture",
								parameters: Type.Object({ code: Type.String(), cell_id: Type.Optional(Type.String()) }),
								execute: async (_id, args, _signal, _update, ctx) => {
									if (!manager)
										manager = new CellsClass({
											owner: ctx.sessionManager,
											contextSignal: ctx.tools!.contextSignal,
											signal: epoch.signal,
											...(process.platform !== "win32"
												? { runtimeFactory: (options: object) => new PortableCellClass(options) }
												: {}),
										});
									const value = args.cell_id
										? await manager.wait({
												owner: ctx.sessionManager,
												invocation: ctx.tools!,
												cell_id: args.cell_id,
												yield_time_ms: 10000,
												max_tokens: 0,
											})
										: await manager.exec({
												owner: ctx.sessionManager,
												invocation: ctx.tools!,
												code: args.code,
												tools: ["imagegen", "web_search", "outer"],
												yield_time_ms: mode === "early-yield" ? 20 : 10000,
												max_output_tokens: 0,
											});
									outcomes.push(value);
									return text(JSON.stringify(value));
								},
							});
							pi.registerTool({
								name: "outer",
								label: "Outer",
								description: "Attempts to suppress genuine descendant Web evidence",
								parameters: Type.Object({}),
								execute: async (_id, _args, _signal, _update, ctx) => {
									await ctx.tools!.invoke("web_search", { search_query: [{ q: "public synthetic fixture" }] });
									return text("discarded all sources");
								},
							});
							pi.on("tool_result", (event) => {
								if (event.toolName !== "imagegen") return;
								if (mode === "redacted")
									return { content: [{ type: "text", text: "Authorized finalized redaction" }], details: {} };
								return undefined;
							});
						},
					],
				});
				harness.session.extensionRunner.onError((error) => errors.push(error.error));
				await harness.session.bindExtensions({});
				const official = {
					...harness.getModel(),
					id: "gpt-6-astra",
					provider: "openai",
					api: "openai-responses",
					baseUrl: "https://api.openai.com/v1",
				};
				harness.session.agent.streamFunction = (_model, context, options) => {
					requests.push(JSON.stringify(context.messages));
					return streamSimple(harness!.getModel(), context, options);
				};
				harness.session.agent.state.model = official;
				const runtime = harness.session.modelRuntime,
					original = runtime.getModel.bind(runtime);
				runtime.getModel = (provider, id) =>
					provider === "openai-codex"
						? { ...official, provider, api: "openai-codex-responses", baseUrl: "https://chatgpt.com/backend-api" }
						: provider === "openai"
							? official
							: original(provider, id);
				runtime.hasConfiguredAuth = () => true;
				runtime.isUsingOAuth = (provider) => provider === "openai-codex";
				runtime.getAuth = async (provider) => {
					if (provider !== "openai-codex") return { auth: { apiKey: "faux-key" } };
					authCalls++;
					entered.release();
					if (mode === "revoke-auth") await release.promise;
					return { auth: { apiKey: token } };
				};
				await harness.session.prompt("/openai-tools web_search on");
				if (mode === "journal-failure")
					harness.sessionManager.appendCustomEntry = () => {
						throw Error("Synthetic disk failure");
					};
				let code = 'const r=await tools.imagegen({prompt:"Synthetic PNG",destination_path:"original.png"});';
				if (mode === "descendant-web") code = "await tools.outer({});";
				else if (mode === "forged-reference")
					code =
						'const r=await tools.imagegen({prompt:"edit",referenced_image_refs:["img_00000000-0000-0000-0000-000000000000"]});if(!r.isError)throw Error("forged ref accepted");';
				else if (mode === "image-edit" || mode === "context-reference")
					code +=
						'store("image",r.result.content[0].ref);store("evidence",r.result.protected_evidence.ref);if(r.result.content[0].data)throw Error("raw image crossed RPC");';
				else if (mode === "guest-failure")
					code += 'text("guest-text-budget-marker");throw Error("guest deliberately suppresses output");';
				const running = invoke(code);
				if (mode === "revoke-auth") {
					await entered.promise;
					harness.session.agent.invalidateToolInvocations();
					release.release();
				}
				await running;
				if (mode === "early-yield") {
					expect(outcomes[0].status).toBe("running");
					await entered.promise;
					release.release();
					await invoke("", outcomes[0].cell_id);
				}
				if (mode === "image-edit") {
					await invoke(
						'const ref=load("image");image(ref);const view=evidence(load("evidence"));if(view.text.indexOf("image_reference")<0)throw Error("bad projection");await tools.imagegen({prompt:"Synthetic edit",referenced_image_refs:[ref],destination_path:"edited.png"});',
					);
					expect(await readFile(join(harness.tempDir, "original.png"))).toEqual(Buffer.from(png, "base64"));
					expect(await readFile(join(harness.tempDir, "edited.png"))).toEqual(Buffer.from(png, "base64"));
				}
				const evidenceMessages = () =>
					harness!.session.messages.filter((m) => m.role === "custom" && m.customType === "code-mode-evidence");
				if (mode === "context-reference") {
					const reference = (evidenceMessages()[0] as { details: { image_refs: string[] } }).details.image_refs[0];
					harness.session.agent.invalidateToolInvocations();
					await manager!.close();
					manager = undefined;
					await invoke(
						`const r=await tools.imagegen({prompt:"edit",referenced_image_refs:[${JSON.stringify(reference)}]});if(!r.isError)throw Error("stale ref accepted");`,
					);
					expect(authCalls).toBe(1);
					expect(calls).toBe(1);
				}
				if (
					mode === "revoke-auth" ||
					mode === "forged-reference" ||
					mode === "journal-failure" ||
					mode === "redacted"
				) {
					expect(JSON.stringify(evidenceMessages())).not.toContain(png);
					if (mode !== "redacted" && mode !== "journal-failure") expect(calls).toBe(0);
					if (mode === "forged-reference") expect(authCalls).toBe(0);
				} else if (mode === "descendant-web") {
					expect(JSON.stringify(evidenceMessages())).toContain("https://example.com/native");
					expect(JSON.stringify(evidenceMessages())).toContain("native1");
					expect(calls).toBe(1);
					expect(requests.at(-1)).toContain("https://example.com/native");
				} else {
					expect(JSON.stringify(evidenceMessages())).toContain(png);
					expect(requests.at(-1)).toContain(png);
					expect(calls).toBe(mode === "image-edit" ? 2 : 1);
				}
				for (const value of outcomes) expect(value.output).toEqual([]);
				expect(JSON.stringify(outcomes)).not.toContain("guest-text-budget-marker");
				if (mode === "guest-failure") expect(outcomes[0].result?.status).toBe("error");
				else if (!["revoke-auth", "journal-failure"].includes(mode))
					expect(outcomes.at(-1)).toMatchObject({ status: "completed", result: { status: "ok" } });
				expect(JSON.stringify(outcomes)).not.toContain(png);
				expect(JSON.stringify(evidenceMessages())).not.toContain(token);
			} finally {
				release.release();
				epoch.abort();
				harness?.session.agent.abort();
				await manager?.close();
				if (harness) await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				harness?.cleanup();
				globalThis.fetch = beforeFetch;
			}
		},
		90000,
	);
});

it("protected images remain present in native TUI fallback without an extension renderer", () => {
	const previous = getCapabilities();
	try {
		initTheme("dark", false);
		setCapabilities({ ...previous, images: null });
		const component = new CustomMessageComponent({
			role: "custom",
			customType: "code-mode-evidence",
			display: true,
			timestamp: 0,
			content: [
				{ type: "text", text: "finalized image" },
				{ type: "image", data: practicalPng(), mimeType: "image/png" },
			],
		});
		const rendered = component.render(100).join("\n");
		expect(rendered).toContain("finalized image");
		expect(rendered).toContain("image/png");
		expect(rendered).toContain("256");
	} finally {
		setCapabilities(previous);
	}
});

it("ported native host loads the cohesive entry, native Astra, provider policy and Fast/footer without auth", async () => {
	const entryUrl = process.env.PI_CODE_MODE_ENTRY_MODULE;
	if (!entryUrl?.startsWith("file:")) throw Error("Explicit cohesive entry URL required");
	const previousDir = process.env.PI_CODING_AGENT_DIR,
		directory = await mkdtemp(join(tmpdir(), "native-pi-cohesive-"));
	process.env.PI_CODING_AGENT_DIR = directory;
	let harness: Harness | undefined,
		authCalls = 0,
		footers = 0;
	try {
		const entry = (await import(/* @vite-ignore */ entryUrl)).default;
		harness = await createHarness({
			tools: [],
			extensionFactories: [
				(pi) => {
					entry(pi);
					pi.registerTool({
						name: "ordinary",
						label: "Ordinary",
						description: "Preserved conversation tool",
						parameters: Type.Object({}),
						async execute() {
							return text("ordinary");
						},
					});
				},
			],
		});
		const runtime = harness.session.modelRuntime;
		const official = runtime.getModel("openai-codex", "gpt-6-astra")!;
		expect(official.id).toBe("gpt-6-astra");
		expect(official.contextWindow).toBe(272000);
		expect(runtime.getModel("openai", "gpt-6-astra")!.id).toBe("gpt-6-astra");
		runtime.getAuth = async () => {
			authCalls++;
			throw Error("Offline fixture must not authenticate");
		};
		harness.session.agent.state.model = official;
		const ui = harness.session.extensionRunner.createContext().ui;
		await harness.session.bindExtensions({
			mode: "tui",
			uiContext: {
				...ui,
				setFooter: () => {
					footers++;
				},
			},
		});
		expect(harness.session.getActiveToolNames()).toEqual(expect.arrayContaining(["ordinary", "imagegen"]));
		await harness.session.prompt("/openai-tools fast on");
		expect(await harness.session.extensionRunner.emitBeforeProviderRequest({ fixture: true })).toEqual({
			fixture: true,
			service_tier: "priority",
		});
		expect(footers).toBeGreaterThan(0);
		expect(JSON.parse(await readFile(join(directory, "openai-compatibility.json"), "utf8")).enabled).toBe(true);
		await harness.session.prompt("/openai-tools web_search on");
		expect(harness.session.getActiveToolNames()).toContain("web_search");
		harness.session.agent.state.model = harness.getModel();
		await harness.session.extensionRunner.emit({
			type: "model_select",
			model: harness.getModel(),
			previousModel: official,
			source: "set",
		});
		expect(harness.session.getActiveToolNames()).toContain("ordinary");
		expect(harness.session.getActiveToolNames()).not.toContain("imagegen");
		expect(harness.session.getActiveToolNames()).not.toContain("web_search");
		expect(await harness.session.extensionRunner.emitBeforeProviderRequest({ fixture: true })).toEqual({
			fixture: true,
		});
		expect(authCalls).toBe(0);
	} finally {
		if (harness) await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		harness?.cleanup();
		if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousDir;
		await rm(directory, { recursive: true, force: true });
	}
});

const processAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function eventually(check: () => boolean | Promise<boolean>, timeout = 15000) {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 30));
	}
	throw Error("Native fixture deadline");
}

describe("returned Unified exec jobs are native-owned after real cell handlers return", () => {
	it
		.skipIf(process.platform === "win32" && process.arch !== "x64")
		.each([
			"complete",
			"failure",
			"stdin",
			"cancel",
			"provider",
			"reload",
			"foreign-scope",
			"direct-to-cell",
			"unprotected",
		])(
		"%s",
		async (mode) => {
			const epoch = new AbortController();
			let manager: Cells | undefined, nativeContext: AbortSignal | undefined, harness: Harness | undefined;
			let jobId: string | undefined,
				firstCell: string | undefined,
				authCalls = 0,
				info: { pid: number; child: number } | undefined;
			const outcomes: CellResult[] = [];
			let unprotectedOutcome: Outcome | undefined;
			const previousFetch = globalThis.fetch;
			globalThis.fetch = async () => {
				throw Error("No network in returned-shell acceptance");
			};
			const invoke = async (args: object, name = "cell") => {
				harness!.setResponses([
					fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
					fauxAssistantMessage("done"),
				]);
				await harness!.session.prompt("Offline returned shell acceptance");
			};
			try {
				harness = await createHarness({
					tools: [],
					extensionFactories: [
						(pi) => {
							registerCapabilities(pi, withFileMutationQueue, {});
							pi.on("tool_result", (event) => {
								if (
									event.toolName === "exec_command" &&
									typeof (event.details as { session_id?: unknown })?.session_id === "string"
								)
									jobId = (event.details as { session_id: string }).session_id;
							});
							pi.registerTool({
								name: "cell",
								label: "Cell",
								description: "Real native returned-job fixture",
								parameters: Type.Object({
									code: Type.Optional(Type.String()),
									cell_id: Type.Optional(Type.String()),
									terminate: Type.Optional(Type.Boolean()),
								}),
								execute: async (_id, args, signal, _update, ctx) => {
									if (mode === "unprotected") {
										const probe = new ProbeClass();
										try {
											unprotectedOutcome = await probe.run(args.code!, {
												gateway: ctx.tools,
												allowedTools: ["exec_command"],
												signal,
											});
											return text(JSON.stringify(unprotectedOutcome));
										} finally {
											await probe.close();
										}
									}
									if (!manager || nativeContext !== ctx.tools!.contextSignal) {
										await manager?.close();
										nativeContext = ctx.tools!.contextSignal;
										manager = new CellsClass({
											owner: ctx.sessionManager,
											contextSignal: nativeContext,
											signal: epoch.signal,
											...(process.platform !== "win32"
												? { runtimeFactory: (options: object) => new PortableCellClass(options) }
												: {}),
										});
									}
									const result = args.cell_id
										? await manager.wait({
												owner: ctx.sessionManager,
												invocation: ctx.tools!,
												cell_id: args.cell_id,
												terminate: args.terminate,
												yield_time_ms: 10000,
												max_tokens: 0,
											})
										: await manager.exec({
												owner: ctx.sessionManager,
												invocation: ctx.tools!,
												code: args.code!,
												tools: ["exec_command", "write_stdin"],
												yield_time_ms: firstCell ? 10000 : 20,
												max_output_tokens: 0,
											});
									outcomes.push(result);
									firstCell ??= result.cell_id;
									return text(JSON.stringify(result));
								},
							});
						},
					],
				});
				const program = join(harness.tempDir, "owned-shell.cjs"),
					marker = join(harness.tempDir, "owned-shell.json");
				await writeFile(
					program,
					'const fs=require("node:fs");const child=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore",windowsHide:true});fs.writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,child:child.pid}));process.stdout.write("READY\\n");process.stdin.once("data",d=>process.stdout.write("ACK:"+d.toString(),()=>process.exit(0)));setTimeout(()=>process.exit(2),90000);',
				);
				const q = (s: string) => `'${s.replaceAll("'", process.platform === "win32" ? "''" : "'\\''")}'`;
				const cmd = `${process.platform === "win32" ? "& " : ""}${q(process.execPath)} ${q(program)} ${q(marker)}${process.platform === "win32" ? "; exit $LASTEXITCODE" : ""}`;
				await harness.session.bindExtensions({});
				const official = {
					...harness.getModel(),
					id: "gpt-6-astra",
					provider: "openai",
					api: "openai-responses",
					baseUrl: "https://api.openai.com/v1",
				};
				harness.session.agent.state.model = official;
				harness.session.agent.streamFunction = (_m, c, o) => streamSimple(harness!.getModel(), c, o);
				harness.session.modelRuntime.hasConfiguredAuth = () => true;
				harness.session.modelRuntime.getAuth = async (provider) => {
					if (provider === "openai-codex") {
						authCalls++;
						throw Error("No service auth");
					}
					return { auth: { apiKey: "faux-key" } };
				};
				await harness.session.prompt("/openai-tools unified_exec on");
				if (mode === "unprotected") {
					await invoke({
						code: `const r=await tools.call("exec_command",{cmd:${JSON.stringify(cmd)},yield_time_ms:1});if(!r.isError||!JSON.stringify(r.result.content).includes("native durable owning scope"))throw Error("unowned job accepted or wrong rejection");`,
					});
					expect(unprotectedOutcome).toMatchObject({ status: "ok" });
					expect(jobId).toBeUndefined();
					await expect(readFile(marker)).rejects.toThrow();
					return;
				}
				if (mode === "direct-to-cell")
					await invoke({ cmd, yield_time_ms: 1, max_output_tokens: 128 }, "exec_command");
				else {
					const body = `let r=await tools.exec_command({cmd:${JSON.stringify(cmd)},yield_time_ms:1,max_output_tokens:128});if(r.isError)throw Error("launch denied");const id=r.result.details.session_id;let out=r.result.details.output;for(let n=0;n<30&&!out.includes("READY");n++){r=await tools.write_stdin({session_id:id,yield_time_ms:300,max_output_tokens:128});if(r.isError)throw Error("same owner denied");out+=r.result.details.output;}if(!out.includes("READY"))throw Error("not ready");text("guest-shell-budget-marker");yield_control();await new Promise(r=>setTimeout(r,${["complete", "failure", "stdin"].includes(mode) ? 400 : 10000}));${mode === "failure" ? 'throw Error("guest failed after returning shell");' : mode === "stdin" ? 'r=await tools.write_stdin({session_id:id,chars:"finish\\n",yield_time_ms:3000,max_output_tokens:128});if(r.isError||!r.result.details.output.includes("ACK:"))throw Error("stdin failed");' : ""}`;
					await invoke({ code: body });
					expect(outcomes[0].status).toBe("running");
				}
				await eventually(async () => {
					try {
						info = JSON.parse(await readFile(marker, "utf8"));
						return true;
					} catch {
						return false;
					}
				});
				expect(Number.isSafeInteger(info!.pid)).toBe(true);
				expect(Number.isSafeInteger(info!.child)).toBe(true);
				expect(typeof jobId).toBe("string");
				if (mode === "foreign-scope" || mode === "direct-to-cell") {
					// Only knowledge of the real session ID changes; native access ownership does not.
					firstCell ??= "direct-conversation-job";
					await invoke({
						code: `const r=await tools.write_stdin({session_id:${JSON.stringify(jobId)},chars:"unauthorized\\n",yield_time_ms:1});if(!r.isError||!JSON.stringify(r.result.content).includes("foreign Unified exec session"))throw Error("foreign job accepted or wrong rejection");`,
					});
					expect(outcomes.at(-1)).toMatchObject({ status: "completed", result: { status: "ok" } });
					expect(processAlive(info!.pid)).toBe(true);
					if (mode === "direct-to-cell") await harness.session.prompt(`/openai-tools jobs cancel ${jobId}`);
					else await invoke({ cell_id: firstCell, terminate: true });
				} else if (mode === "cancel") await invoke({ cell_id: firstCell, terminate: true });
				else if (mode === "provider") {
					harness.session.agent.state.model = harness.getModel();
					await harness.session.extensionRunner.emit({
						type: "model_select",
						model: harness.getModel(),
						previousModel: official,
						source: "set",
					});
				} else if (mode === "reload") await harness.session.reload();
				// In completion/failure/stdin cases, do NOT call wait. Teardown must not depend on it.
				await eventually(() => !processAlive(info!.pid) && !processAlive(info!.child));
				if (["complete", "failure", "stdin"].includes(mode)) {
					// PID disappearance is not a receipt for stdio/supervisor/native drain,
					// and an unconsumed explicit yield may legitimately return once first.
					await eventually(async () => {
						await invoke({ cell_id: firstCell });
						return outcomes.at(-1)?.status === "completed";
					});
					expect(outcomes.at(-1)).toMatchObject({
						status: "completed",
						result: { status: mode === "failure" ? "error" : "ok" },
					});
				}
				expect(JSON.stringify(outcomes)).not.toContain("guest-shell-budget-marker");
				expect(authCalls).toBe(0);
			} finally {
				epoch.abort();
				harness?.session.agent.abort();
				await manager?.close();
				if (harness) await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				harness?.cleanup();
				globalThis.fetch = previousFetch;
			}
		},
		90000,
	);
});

describe("normal cohesive Code mode registration and native policy", () => {
	it
		.skipIf(process.platform !== "win32" || process.arch !== "x64")
		.each(["basic", "deny", "invalid", "yield", "provider", "reload", "namespace", "protected", "shell", "nested"])(
		"%s",
		async (mode) => {
			const entryUrl = process.env.PI_CODE_MODE_ENTRY_MODULE;
			if (!entryUrl?.startsWith("file:")) throw Error("Cohesive entry URL required");
			const oldDir = process.env.PI_CODING_AGENT_DIR,
				oldFetch = globalThis.fetch,
				directory = await mkdtemp(join(tmpdir(), "production-code-"));
			process.env.PI_CODING_AGENT_DIR = directory;
			let harness: Harness | undefined,
				conversation: Harness["faux"] | undefined,
				executed = 0,
				serviceAuth = 0,
				requests = 0,
				nestedError = false;
			const notices: string[] = [],
				png = practicalPng();
			const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "production-synthetic" } })).toString("base64url")}.signature`;
			globalThis.fetch = async (url, init) => {
				if (mode !== "protected") throw Error("Unexpected network in offline production fixture");
				requests++;
				expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
				if (String(url) === "https://chatgpt.com/backend-api/codex/alpha/search")
					return Response.json({
						output: "Production source https://example.com/production [production1]",
						results: [
							{ title: "Production source", url: "https://example.com/production", citation: "production1" },
						],
					});
				expect(String(url)).toMatch(/^https:\/\/chatgpt\.com\/backend-api\/codex\/images\/(generations|edits)$/);
				if (String(url).endsWith("/edits"))
					expect(JSON.parse(String(init?.body)).images).toEqual([{ image_url: `data:image/png;base64,${png}` }]);
				return Response.json({ data: [{ b64_json: png }], size: "256x256" });
			};
			const invoke = async (name: string, args: Record<string, unknown>) => {
				conversation!.setResponses([
					fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" }),
					fauxAssistantMessage("finished"),
				]);
				await harness!.session.prompt("Public synthetic production Code mode fixture");
				const message = [...harness!.session.messages]
					.reverse()
					.find(
						(m): m is import("@earendil-works/pi-ai").ToolResultMessage =>
							m.role === "toolResult" && m.toolName === name,
					);
				if (!message) throw Error("Expected actual native tool result");
				return message;
			};
			const outcome = (message: Awaited<ReturnType<typeof invoke>>) => {
				expect(message.isError).toBe(false);
				const item = message.content.find((c) => c.type === "text");
				if (!item || item.type !== "text") throw Error("Missing result");
				const value = Reflect.get(message, "details") as CellResult & {
					code_result: { version: number; wall_time_ms: number };
				};
				expect(value.code_result.version).toBe(1);
				expect(Number.isSafeInteger(value.code_result.wall_time_ms)).toBe(true);
				expect(value.code_result.wall_time_ms).toBeGreaterThanOrEqual(0);
				const status =
					value.result?.status === "error"
						? "Script failed"
						: value.status === "running"
							? `Script running with cell ID ${value.cell_id}`
							: value.status === "draining"
								? `Script draining with cell ID ${value.cell_id} · cleanup unconfirmed`
								: value.status === "terminated"
									? "Script terminated"
									: "Script completed";
				const seconds = (Math.round(value.code_result.wall_time_ms / 100) / 10).toFixed(1);
				expect(item.text.startsWith(`${status}\nWall time ${seconds} seconds\nOutput:\n`)).toBe(true);
				for (const output of value.output) expect(item.text).toContain(output);
				return value;
			};
			try {
				const entry = (await import(/* @vite-ignore */ entryUrl)).default;
				const factories = [
					(pi: ExtensionAPI) => {
						entry(pi);
						pi.registerTool({
							name: "ordinary",
							label: "Ordinary",
							description: "Real normal tool preserved beside Code mode",
							parameters: Type.Object({ value: Type.Literal("allowed") }),
							async execute(_id, _args, _signal, _update, ctx) {
								executed++;
								if (mode === "nested")
									nestedError = (await ctx.tools!.invoke("exec", { code: 'text("must not run")' })).isError;
								return text("RAW_PRODUCTION_FIXTURE");
							},
						});
						if (mode === "namespace")
							pi.registerTool({
								name: "wait",
								label: "Foreign wait",
								description: "Conflicting definition must not be overwritten",
								parameters: Type.Object({ foreign: Type.Literal(true) }),
								async execute() {
									throw Error("Foreign reserved name must not execute");
								},
							});
						pi.on("tool_call", (event) => {
							if (event.toolName !== "ordinary") return;
							if (mode === "deny") return { block: true, reason: "expected production deny" };
							if (mode === "invalid") event.input.value = "post-hook-invalid";
						});
						pi.on("tool_result", (event) =>
							event.toolName === "ordinary" && !event.isError
								? { content: [{ type: "text", text: "FINAL_PRODUCTION_FIXTURE" }] }
								: undefined,
						);
					},
				];
				// The default harness loader's reload is a no-op retaining an invalidated
				// runtime. Use real factory loading again, as genuine ResourceLoader does.
				let extensions = await createTestExtensionsResult(factories, directory);
				const resources = {
					...createTestResourceLoader(),
					getExtensions: () => extensions,
					reload: async () => {
						extensions = await createTestExtensionsResult(factories, harness?.tempDir ?? directory);
					},
				};
				harness = await createHarness({ tools: [], resourceLoader: resources });
				conversation = harness.faux;
				const official = harness.session.modelRuntime.getModel("openai", "gpt-6-astra")!;
				harness.session.agent.state.model = official;
				harness.session.agent.streamFunction = (_m, c, o) => streamSimple(conversation!.getModel(), c, o);
				const runtime = harness.session.modelRuntime;
				runtime.hasConfiguredAuth = () => true;
				runtime.isUsingOAuth = (provider) => provider === "openai-codex";
				runtime.getAuth = async (provider) => {
					if (provider !== "openai-codex") return { auth: { apiKey: "faux-key" } };
					serviceAuth++;
					if (mode !== "protected") throw Error("Unexpected service authentication");
					return { auth: { apiKey: token } };
				};
				const ui = harness.session.extensionRunner.createContext().ui;
				await harness.session.bindExtensions({
					uiContext: {
						...ui,
						notify: (message) => {
							notices.push(message);
						},
					},
				});
				expect(harness.session.getActiveToolNames()).not.toContain("exec");
				expect(harness.session.getActiveToolNames()).toContain("ordinary");
				await harness.session.prompt("/openai-tools status");
				expect(notices.at(-1)).toContain("native preflight ready");
				expect(serviceAuth).toBe(0);
				if (mode === "protected") await harness.session.prompt("/openai-tools web_search on");
				if (mode === "shell") await harness.session.prompt("/openai-tools unified_exec on");
				await harness.session.prompt("/openai-tools code_mode on");
				if (mode === "namespace") {
					expect(notices.at(-1)).toContain("namespace is conflicting");
					expect(harness.session.getActiveToolNames()).not.toContain("exec");
					expect(
						harness.session.extensionRunner.getAllRegisteredTools().find((t) => t.definition.name === "wait")
							?.definition.description,
					).toBe("Conflicting definition must not be overwritten");
					return;
				}
				expect(harness.session.getActiveToolNames()).toEqual(
					expect.arrayContaining(["exec", "wait", "ordinary", "imagegen"]),
				);
				if (mode === "nested") {
					await invoke("ordinary", { value: "allowed" });
					expect(nestedError).toBe(true);
					expect(harness.session.agent.getToolGatewayInfo().activeScopes).toBe(0);
					return;
				}
				if (mode === "protected") {
					const r = outcome(
						await invoke("exec", {
							code: '// @exec: {"max_output_tokens":0}\nawait tools.web_search({search_query:[{q:"public production fixture"}]});const r=await tools.imagegen({prompt:"Synthetic production PNG",destination_path:"production.png"});if(r.isError||r.result.content[0].data)throw Error("image projection failed");store("img",r.result.content[0].ref);text("must be suppressed");',
						}),
					);
					expect(r).toMatchObject({ status: "completed", output: [], result: { status: "ok" } });
					const edit = outcome(
						await invoke("exec", {
							code: '// @exec: {"max_output_tokens":0}\nconst ref=load("img");image(ref);const r=await tools.imagegen({prompt:"Synthetic production edit",referenced_image_refs:[ref],destination_path:"production-edit.png"});if(r.isError)throw Error("edit failed");',
						}),
					);
					expect(edit).toMatchObject({ status: "completed", output: [], result: { status: "ok" } });
					const messages = harness.session.messages.filter(
						(m) => m.role === "custom" && m.customType === "code-mode-evidence",
					);
					expect(JSON.stringify(messages)).toContain(png);
					expect(JSON.stringify(messages)).toContain("https://example.com/production");
					expect(await readFile(join(harness.tempDir, "production.png"))).toEqual(Buffer.from(png, "base64"));
					expect(requests).toBe(3);
					expect(serviceAuth).toBe(3);
					return;
				}
				if (mode === "shell") {
					const program = join(harness.tempDir, "production-shell.cjs"),
						marker = join(harness.tempDir, "production-shell.json");
					await writeFile(
						program,
						'const c=require("node:child_process").spawn(process.execPath,["-e","setInterval(()=>{},1000);setTimeout(()=>process.exit(),60000)"],{stdio:"ignore",windowsHide:true});require("node:fs").writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,child:c.pid}));process.stdout.write("READY");setInterval(()=>{},1000);setTimeout(()=>process.exit(),60000);',
					);
					const q = (s: string) => `'${s.replaceAll("'", "''")}'`,
						cmd = `& ${q(process.execPath)} ${q(program)} ${q(marker)}; exit $LASTEXITCODE`;
					const r = outcome(
						await invoke("exec", {
							code: `// @exec: {"yield_time_ms":1}\nlet r=await tools.exec_command({cmd:${JSON.stringify(cmd)},yield_time_ms:1});let out=r.result.details.output;const id=r.result.details.session_id;for(let n=0;n<30&&!out.includes("READY");n++){r=await tools.write_stdin({session_id:id,yield_time_ms:300});out+=r.result.details.output;}if(!out.includes("READY"))throw Error("no native readiness");yield_control();await new Promise(r=>setTimeout(r,200));`,
						}),
					);
					await eventually(async () => {
						try {
							await readFile(marker);
							return true;
						} catch {
							return false;
						}
					});
					const pids = JSON.parse(await readFile(marker, "utf8"));
					await eventually(() => !processAlive(pids.pid) && !processAlive(pids.child));
					if (r.status !== "completed") {
						let done = r;
						await eventually(async () => {
							done = outcome(await invoke("wait", { cell_id: r.cell_id }));
							return done.status === "completed";
						});
						expect(done.result?.status).toBe("ok");
					}
					return;
				}
				if (mode === "provider" || mode === "reload" || mode === "yield") {
					const r = outcome(
						await invoke("exec", {
							code: '// @exec: {"yield_time_ms":10000,"max_output_tokens":1}\nstore("old",true);text("early");yield_control();await new Promise(r=>setTimeout(r,5000));text("late");',
						}),
					);
					expect(r.status).toBe("running");
					expect(r.output).toEqual(["earl"]);
					if (mode === "yield") {
						let done = r;
						await eventually(async () => {
							done = outcome(await invoke("wait", { cell_id: r.cell_id, max_tokens: 0 }));
							return done.status === "completed";
						});
						expect(done.output).toEqual([]);
						expect(done.result?.status).toBe("ok");
					} else {
						if (mode === "provider") {
							harness.session.agent.state.model = harness.getModel();
							await harness.session.extensionRunner.emit({
								type: "model_select",
								model: harness.getModel(),
								previousModel: official,
								source: "set",
							});
							expect(harness.session.getActiveToolNames()).not.toContain("exec");
							expect(harness.session.getActiveToolNames()).toContain("ordinary");
							harness.session.agent.state.model = official;
							await harness.session.extensionRunner.emit({
								type: "model_select",
								model: official,
								previousModel: harness.getModel(),
								source: "set",
							});
						} else {
							await harness.session.reload();
							// Real reload clears global conversational transports too. Restore only
							// the synthetic conversation driver, never an official-provider override.
							conversation = registerFauxProvider();
							// Restore the saved choice, never the old cell, store or native resources.
							expect(harness.session.getActiveToolNames()).toEqual(
								expect.arrayContaining(["exec", "wait", "ordinary"]),
							);
							expect(harness.session.agent.getToolGatewayInfo().activeScopes).toBe(0);
							expect(harness.session.agent.getToolGatewayInfo().drainingScopes).toBe(0);
						}
						expect((await invoke("wait", { cell_id: r.cell_id })).isError).toBe(true);
						expect(outcome(await invoke("exec", { code: 'text(load("old")===undefined);' })).output).toEqual([
							"true",
						]);
					}
				} else {
					const r = outcome(
						await invoke("exec", {
							code: 'const r=await tools.ordinary({value:"allowed"});text(r.isError);if(!r.isError)text(r.result.content[0].text);text(TOOL_NAMES.includes("exec")||TOOL_NAMES.includes("wait"));store("v",{n:7});',
						}),
					);
					expect(r).toMatchObject({ status: "completed", result: { status: "ok" } });
					expect(r.output).toEqual(
						mode === "basic" ? ["false", "FINAL_PRODUCTION_FIXTURE", "false"] : ["true", "false"],
					);
					expect(executed).toBe(mode === "basic" ? 1 : 0);
					const next = outcome(
						await invoke("exec", {
							code: 'text(load("v").n);text([typeof process,typeof require,typeof fetch].join(","));',
						}),
					);
					expect(next.output).toEqual(["7", "undefined,undefined,undefined"]);
				}
				expect(serviceAuth).toBe(0);
				expect(requests).toBe(0);
			} finally {
				if (harness) await harness.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
				if (conversation && conversation !== harness?.faux) conversation.unregister();
				harness?.cleanup();
				globalThis.fetch = oldFetch;
				if (oldDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
				else process.env.PI_CODING_AGENT_DIR = oldDir;
				await rm(directory, { recursive: true, force: true });
			}
		},
		90000,
	);
});

it("normal native preflight reports platform support without authentication or an execution fallback", async () => {
	const notices: string[] = [];
	let auth = 0;
	const h = await createHarness({
		tools: [],
		extensionFactories: [(pi) => registerCapabilities(pi, withFileMutationQueue, {})],
	});
	try {
		h.session.agent.state.model = h.session.modelRuntime.getModel("openai", "gpt-6-astra")!;
		h.session.modelRuntime.getAuth = async () => {
			auth++;
			throw Error("Preflight must not authenticate");
		};
		const ui = h.session.extensionRunner.createContext().ui;
		await h.session.bindExtensions({
			uiContext: {
				...ui,
				notify: (message) => {
					notices.push(message);
				},
			},
		});
		await h.session.prompt("/openai-tools status");
		expect(h.session.extensionRunner.createContext().toolGatewayInfo?.version).toBe(1);
		if (process.platform !== "win32" || process.arch !== "x64") {
			expect(notices.at(-1)).toContain("WINDOWS_X64_REQUIRED");
			await h.session.prompt("/openai-tools code_mode on");
			expect(notices.at(-1)).toContain("WINDOWS_X64_REQUIRED");
			expect(h.session.getActiveToolNames()).not.toContain("exec");
		} else expect(notices.at(-1)).toContain("native preflight ready");
		expect(h.session.agent.getToolGatewayInfo().activeScopes).toBe(0);
		expect(auth).toBe(0);
	} finally {
		await h.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
		h.cleanup();
	}
});

describe("native quiet-poll TUI presentation", () => {
	const start = (id = "poll", extra: Partial<AgentSessionEvent> = {}) =>
		({
			type: "tool_execution_start",
			toolCallId: id,
			toolName: "write_stdin",
			scopeId: "native-scope",
			localPoll: "pending",
			args: { session_id: "synthetic" },
			...extra,
		}) as AgentSessionEvent;
	const end = (id = "poll", extra: Partial<AgentSessionEvent> = {}) =>
		({
			type: "tool_execution_end",
			toolCallId: id,
			toolName: "write_stdin",
			scopeId: "native-scope",
			localPoll: "quiet",
			result: text(""),
			isError: false,
			...extra,
		}) as AgentSessionEvent;
	function display() {
		initTheme("dark", false);
		let listener!: (event: AgentSessionEvent) => Promise<void>;
		const pending = new Set<string>(),
			render = vi.fn();
		// Presentation bootstrap only: real native subscription/handler/components, no terminal or fake gateway.
		const view = Object.create(InteractiveMode.prototype) as Record<string, any>;
		Object.assign(view, {
			isInitialized: true,
			localPollPresentation: new LocalPollPresentation(),
			pendingTools: new Map(),
			chatContainer: new Container(),
			footer: { invalidate() {} },
			ui: { requestRender: render, terminal: { setProgress() {} } },
			toolOutputExpanded: false,
			getRegisteredToolDefinition: () => undefined,
			clearStatusIndicator: () => {},
			runtimeHost: {
				session: {
					agent: { state: { pendingToolCalls: pending } },
					settingsManager: {
						getShowImages: () => false,
						getImageWidthCells: () => 80,
						getShowTerminalProgress: () => false,
					},
					sessionManager: { getCwd: () => "." },
					subscribe: (fn: typeof listener) => {
						listener = fn;
						return () => {};
					},
				},
			},
		});
		view.subscribeToAgent();
		return {
			view,
			pending,
			render,
			emit: (event: AgentSessionEvent) => listener(event),
			frame: () =>
				view.chatContainer
					.render(80)
					.join("\n")
					.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""),
		};
	}
	it("creates no cards, gaps or renders for repeated finalized empty local polls", async () => {
		const f = display();
		for (let n = 0; n < 40; n++) {
			await f.emit(start(String(n)));
			await f.emit(end(String(n)));
		}
		expect(f.frame()).toBe("");
		expect(f.view.chatContainer.children).toHaveLength(0);
		expect(f.render).not.toHaveBeenCalled();
		expect(f.view.pendingTools.size).toBe(0);
	});
	for (const kind of ["output", "terminal", "error"])
		it(`reveals the original native call and ${kind}`, async () => {
			const f = display();
			await f.emit(start());
			expect(f.frame()).toBe("");
			await f.emit(
				end("poll", { localPoll: undefined, result: text(`VISIBLE_${kind}`), isError: kind === "error" }),
			);
			expect(f.frame()).toContain("Local job update");
			expect(f.frame()).toContain(`VISIBLE_${kind}`);
			expect(f.view.pendingTools.size).toBe(0);
		});
	it("keeps direct/model calls and input/control calls visible immediately", async () => {
		const f = display();
		await f.emit(start("direct", { scopeId: undefined, localPoll: undefined }));
		await f.emit(start("input", { localPoll: undefined }));
		expect(f.view.chatContainer.children).toHaveLength(2);
		expect(f.frame()).toContain("write_stdin");
		await f.emit(end("direct", { scopeId: undefined, localPoll: undefined }));
		await f.emit(end("input", { localPoll: undefined }));
		expect(f.view.pendingTools.size).toBe(0);
	});
	it("preserves updates and scoped tool components across foreground agent-end/start", async () => {
		const f = display();
		f.pending.add("poll");
		await f.emit(start());
		await f.emit({ type: "agent_end", messages: [], willRetry: false });
		expect(f.frame()).toBe("");
		await f.emit({
			type: "tool_execution_update",
			toolCallId: "poll",
			toolName: "write_stdin",
			scopeId: "native-scope",
			args: {},
			partialResult: text("PARTIAL_VISIBLE"),
		});
		expect(f.frame()).toContain("PARTIAL_VISIBLE");
		await f.emit({ type: "agent_start" });
		await f.emit({ type: "agent_end", messages: [], willRetry: false });
		expect(f.view.pendingTools.size).toBe(1);
		f.pending.delete("poll");
		await f.emit(end("poll", { localPoll: undefined, result: text("TERMINAL_VISIBLE") }));
		expect(f.frame()).toContain("TERMINAL_VISIBLE");
		expect(f.view.pendingTools.size).toBe(0);
	});
	it("bounds held presentation and does not consume foreign events or suppress errors", () => {
		const p = new LocalPollPresentation();
		for (let n = 0; n < 8; n++) expect(p.accept(start(String(n)))).toEqual([]);
		expect(p.accept(start("overflow"))).toHaveLength(1);
		expect(p.accept(end("0", { scopeId: "foreign" }))).toHaveLength(1);
		expect(p.accept(end("0"))).toEqual([]);
		expect(p.accept(end("1", { isError: true }))).toHaveLength(2);
		p.clear();
		expect(p.accept(end("2"))).toHaveLength(1);
	});
});
