import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	prepareWindowsWorker,
	windowsContainmentSupported,
	containmentEnvironment,
	WindowsAsyncRuntimeProbe,
} from "../windows-host.mjs";
import { RuntimeProbe } from "../host.mjs";
import { verifiedExecutable } from "../native/artifact.mjs";
const native = { skip: !windowsContainmentSupported(), timeout: 150_000 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const entry = fileURLToPath(new URL("../worker.mjs", import.meta.url));

async function raw(program, action) {
	const dir = await mkdtemp(join(tmpdir(), "pi-runtime-job-"));
	let lease;
	try {
		const file = join(dir, "fixture.cjs");
		await writeFile(file, program);
		lease = await prepareWindowsWorker(file);
		return await action(lease);
	} finally {
		await lease?.close();
		await rm(dir, { recursive: true, force: true });
	}
}
function collect(child, acknowledge = false) {
	let output = "";
	let expired = false;
	child.stdout.on("data", (chunk) => {
		output += chunk.toString();
		if (acknowledge && output.includes("SPAWN_STARTED")) {
			acknowledge = false;
			child.stdin.end("go");
		}
		if (output.length > 8192) child.kill("SIGKILL");
	});
	child.stderr.resume();
	const timer = setTimeout(() => {
		expired = true;
		child.kill("SIGKILL");
	}, 60_000);
	return new Promise((resolve) =>
		child.once("close", (code) => {
			clearTimeout(timer);
			resolve({ code, output, expired });
		}),
	);
}
async function dead(pid) {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await sleep(25);
	}
	assert.fail("Owned fixture worker survived confirmed parent/supervisor exit");
}
function workerPid(child) {
	return new Promise((resolve, reject) => {
		let output = "";
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Worker handshake timed out"));
		}, 120_000);
		const data = (chunk) => {
			output += chunk.toString();
			if (output.length > 4096) return fail();
			if (output.includes("\n")) {
				try {
					const value = JSON.parse(output.trim());
					assert.ok(Number.isInteger(value.pid) && value.pid > 0);
					cleanup();
					resolve(value.pid);
				} catch {
					fail();
				}
			}
		};
		const fail = () => {
			cleanup();
			reject(new Error("Worker handshake failed"));
		};
		const cleanup = () => {
			clearTimeout(timer);
			child.stdout.off("data", data);
			child.off("close", fail);
		};
		child.stdout.on("data", data);
		child.once("close", fail);
	});
}

test("containment environment excludes auth/debug/home and unknown platforms fail closed", async () => {
	assert.deepEqual(Object.keys(containmentEnvironment()).sort(), [
		"SystemRoot",
		"TEMP",
		"TMP",
	]);
	if (!windowsContainmentSupported())
		await assert.rejects(
			prepareWindowsWorker(entry),
			/no unrestricted fallback/,
		);
	const probe = new WindowsAsyncRuntimeProbe();
	assert.equal((await probe.run("emit('x')")).code, "INVALID_REQUEST");
	await probe.close();
	assert.equal((await probe.run("x")).code, "CLOSED");
});

test(
	"real QuickJS survives the contained byte gate and UTF-8 relay",
	native,
	async () => {
		const lease = await prepareWindowsWorker(entry);
		const probe = new RuntimeProbe({ launch: () => lease.launch() });
		try {
			assert.deepEqual(
				await probe.run('emit("contained 🌿\\u0000");emit(typeof process);'),
				{
					version: 1,
					status: "ok",
					output: ["contained 🌿\u0000", "undefined"],
				},
			);
			assert.throws(() => lease.launch(), /unavailable/);
		} finally {
			await probe.close();
			await lease.close();
		}
	},
);

test(
	"closing an unconsumed prepared lease cannot launch a worker later",
	native,
	async () => {
		const lease = await prepareWindowsWorker(entry);
		await lease.close();
		assert.throws(() => lease.launch(), /unavailable/);
	},
);

test(
	"contained workers cannot create a third job process",
	native,
	async () => {
		await raw(
			`console.log('SPAWN_STARTED');process.stdin.once('data',()=>{const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','console.log("escaped")']);c.stdout.on('data',b=>process.stdout.write(b));c.on('error',()=>console.log('denied'));c.on('close',code=>process.exit(code===0?3:0));});`,
			async (lease) => {
				const result = await collect(lease.launch(), true);
				assert.equal(result.expired, false);
				assert.match(result.output, /SPAWN_STARTED/);
				assert.notEqual(result.code, 3);
				assert.doesNotMatch(result.output, /escaped/);
			},
		);
	},
);

test(
	"OS committed-memory limit covers external buffers beyond the V8 heap",
	native,
	async () => {
		await raw(
			`console.log('MEMORY_STARTED');const buffers=[];try{for(let i=0;i<20;i++)buffers.push(Buffer.alloc(16*1024*1024,1));process.exit(3);}catch{process.exit(17)}`,
			async (lease) => {
				const result = await collect(lease.launch());
				assert.equal(result.expired, false);
				assert.match(result.output, /MEMORY_STARTED/);
				assert.notEqual(
					result.code,
					3,
					"320 MiB external allocation escaped the 256 MiB process limit",
				);
			},
		);
	},
);

test(
	"OS job user-CPU limit terminates a trusted raw fixture beyond QuickJS controls",
	native,
	async () => {
		await raw(
			`console.log('CPU_STARTED');const start=process.cpuUsage();let x=0;do{for(let i=0;i<1_000_000;i++)x=(x+i)|0;}while(process.cpuUsage(start).user<14_000_000);console.log(x);process.exit(3);`,
			async (lease) => {
				const result = await collect(lease.launch());
				assert.equal(result.expired, false);
				assert.match(result.output, /CPU_STARTED/);
				assert.notEqual(result.code, 3, "Job CPU budget was not enforced");
			},
		);
	},
);

test("supervisor cancellation kills its owned worker", native, async () => {
	await raw(
		`console.log(JSON.stringify({pid:process.pid}));setTimeout(()=>process.exit(2),60_000);`,
		async (lease) => {
			const pid = await workerPid(lease.launch());
			await lease.close();
			await dead(pid);
		},
	);
});

test(
	"hard parent death kills the worker through an exact process handle",
	native,
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-runtime-parent-"));
		let parent;
		try {
			const worker = join(dir, "worker.cjs");
			await writeFile(
				worker,
				`console.log(JSON.stringify({pid:process.pid}));setTimeout(()=>process.exit(2),60_000);`,
			);
			const owner = join(dir, "owner.mjs");
			await writeFile(
				owner,
				`import {prepareWindowsWorker} from ${JSON.stringify(new URL("../windows-host.mjs", import.meta.url).href)};const lease=await prepareWindowsWorker(${JSON.stringify(worker)});const child=lease.launch();child.stdout.pipe(process.stdout);child.stderr.resume();`,
			);
			parent = spawn(process.execPath, [owner], {
				env: containmentEnvironment(),
				stdio: "pipe",
				windowsHide: true,
			});
			parent.stderr.resume();
			const pid = await workerPid(parent);
			const exited = new Promise((resolve) => parent.once("close", resolve));
			parent.kill("SIGKILL");
			await exited;
			await dead(pid);
		} finally {
			if (parent?.exitCode === null && parent?.signalCode === null) {
				const exited = new Promise((resolve) => parent.once("close", resolve));
				parent.kill("SIGKILL");
				await exited;
			}
			await rm(dir, { recursive: true, force: true });
		}
	},
);

test(
	"preparation cancellation releases admission and permits subsequent preparation",
	native,
	async () => {
		const controller = new AbortController();
		const pending = prepareWindowsWorker(entry, { signal: controller.signal });
		queueMicrotask(() => controller.abort());
		await assert.rejects(pending, /unavailable/);
		const lease = await prepareWindowsWorker(entry);
		await lease.close();
	},
);

test(
	"prepared plus running workers share the two-slot admission limit",
	native,
	async () => {
		const leases = [];
		try {
			leases.push(await prepareWindowsWorker(entry));
			leases.push(await prepareWindowsWorker(entry));
			await assert.rejects(prepareWindowsWorker(entry), /unavailable/);
		} finally {
			await Promise.all(leases.map((lease) => lease.close()));
		}
		const lease = await prepareWindowsWorker(entry);
		await lease.close();
	},
);

test(
	"mismatched parent creation time fails before worker execution",
	native,
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "pi-runtime-identity-"));
		try {
			const file = join(dir, "fixture.cjs");
			await writeFile(file, "console.log('IDENTITY_BYPASS')");
			const helper = await verifiedExecutable();
			const child = spawn(
				helper,
				[String(process.pid), "1", process.execPath, file],
				{ env: containmentEnvironment(), stdio: "pipe", windowsHide: true },
			);
			const result = await collect(child);
			assert.equal(result.expired, false);
			assert.equal(result.code, 70);
			assert.doesNotMatch(result.output, /IDENTITY_BYPASS/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);

test(
	"CPU monitor includes kernel time rather than only the OS user-time backstop",
	native,
	async () => {
		await raw(
			`console.log('KERNEL_CPU_STARTED');const start=process.cpuUsage();for(;;){const t=process.cpuUsage(start);if(t.user+t.system>=14_000_000)break;}process.exit(3);`,
			async (lease) => {
				const result = await collect(lease.launch());
				assert.equal(result.expired, false);
				assert.match(result.output, /KERNEL_CPU_STARTED/);
				assert.notEqual(
					result.code,
					3,
					"Combined CPU monitor did not stop the kernel-heavy fixture",
				);
			},
		);
	},
);
