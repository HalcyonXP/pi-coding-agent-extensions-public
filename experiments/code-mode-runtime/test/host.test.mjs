import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { RuntimeProbe, workerEnvironment } from "../host.mjs";
import { LIMITS, parseRequest, parseResponse } from "../protocol.mjs";

const error = (code) => ({ version: 1, status: "error", code });
const wire = (v) => Buffer.from(JSON.stringify(v));
function fixture(source, children = []) {
  return () => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", source], {
      env: workerEnvironment(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    children.push(child);
    return child;
  };
}
function exited(children) {
  for (const child of children) {
    assert.ok(child.exitCode !== null || child.signalCode !== null);
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  }
}

test("protocol rejects unknown fields, versions, shapes and oversized content", () => {
  for (const value of [null, [], {version: 2, code: ""}, {version: 1, code: "", tools: {}}, {version: 1, code: null}]) {
    assert.throws(() => parseRequest(wire(value)));
  }
  assert.deepEqual(parseRequest(wire({version: 1, code: "emit('ok')"})), {version: 1, code: "emit('ok')"});
  for (const value of [null, [], {}, {version: 1, status: "ok", output: [], extra: "private-fixture"},
    {version: 1, status: "error", code: "private-fixture"}, {version: 1, status: "ok", output: [{}]},
    {version: 1, status: "ok", output: Array(LIMITS.outputCount + 1).fill("")},
    {version: 1, status: "ok", output: ["é".repeat(LIMITS.outputBytes)]}]) {
    assert.deepEqual(parseResponse(wire(value)), error("PROTOCOL_ERROR"));
  }
  assert.deepEqual(parseResponse(Buffer.from("{broken")), error("PROTOCOL_ERROR"));
  assert.deepEqual(parseResponse(Buffer.alloc(LIMITS.responseBytes + 1)), error("PROTOCOL_ERROR"));
  assert.throws(() => parseRequest(Buffer.alloc(LIMITS.requestBytes + 1)));
});

test("pre-aborted calls and closed hosts never launch", async () => {
  let launches = 0;
  const probe = new RuntimeProbe({ launch() { launches++; throw Error(); } });
  assert.deepEqual(await probe.run("", { signal: AbortSignal.abort("private-fixture") }), error("CANCELLED"));
  await probe.close();
  assert.deepEqual(await probe.run(""), error("CLOSED"));
  assert.equal(launches, 0);
});

test("cancellation drains a positively-started child before resolving", async () => {
  const children = [];
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  const launch = fixture('process.stderr.write("ready"); setInterval(()=>{},1000);', children);
  const probe = new RuntimeProbe({ launch() {
    const child = launch();
    child.stderr.once("data", ready);
    return child;
  } });
  const controller = new AbortController();
  const pending = probe.run("", { signal: controller.signal });
  await started;
  controller.abort("private-fixture");
  assert.deepEqual(await pending, error("CANCELLED"));
  assert.equal(probe.activeCount, 0);
  exited(children);
  await probe.close();
});

test("concurrency admission is bounded and close drains every owned worker", async () => {
  const children = [];
  const probe = new RuntimeProbe({ launch: fixture('setInterval(()=>{},1000);', children) });
  const pending = Array.from({length: LIMITS.concurrent}, () => probe.run(""));
  assert.equal(probe.activeCount, LIMITS.concurrent);
  assert.deepEqual(await probe.run(""), error("BUSY"));
  await probe.close();
  assert.deepEqual(await Promise.all(pending), pending.map(() => error("CANCELLED")));
  assert.equal(probe.activeCount, 0);
  exited(children);
  await probe.close();
});

test("independent parent watchdog kills a host that ignores engine interrupts", { timeout: 15000 }, async () => {
  const children = [];
  const probe = new RuntimeProbe({ launch: fixture('while(true){}', children) });
  assert.deepEqual(await probe.run(""), error("WALL_LIMIT"));
  exited(children);
  await probe.close();
});

test("host crash and startup failures have no fallback and reveal no stderr", async () => {
  for (const launch of [fixture('process.stderr.write("private-fixture"); process.exit(3);'),
    () => { throw Error("private-fixture"); },
    () => spawn(join(tmpdir(), "nonexistent-runtime-fixture", "missing.exe"), [], {stdio: "pipe"})]) {
    const probe = new RuntimeProbe({ launch });
    assert.deepEqual(await probe.run(""), error("HOST_FAILED"));
    await probe.close();
  }
});

test("malformed, duplicate, oversized and incomplete worker responses fail closed", async () => {
  for (const source of [
    'process.stdout.write("not-json-private-fixture");',
    'process.stdout.write(\'{"version":1,"status":"ok","output":[]}{}\');',
    `process.stdout.write("x".repeat(${LIMITS.responseBytes + 1})); setInterval(()=>{},1000);`,
    'process.stdout.write(\'{"version":1\');',
  ]) {
    const children = [];
    const probe = new RuntimeProbe({ launch: fixture(source, children) });
    assert.deepEqual(await probe.run(""), error("PROTOCOL_ERROR"));
    exited(children);
    await probe.close();
  }
});

test("parent environment secrets and Node preload/debug options are not forwarded", async () => {
  const key = "PI_RUNTIME_TEST_SECRET";
  const before = process.env[key];
  process.env[key] = "private-fixture";
  try {
    const environment = workerEnvironment();
    assert.deepEqual(Object.keys(environment), process.platform === "win32" && process.env.SystemRoot ? ["SystemRoot"] : []);
    const probe = new RuntimeProbe({ launch: fixture('process.stdout.write(JSON.stringify({version:1,status:"ok",output:[typeof process.env.PI_RUNTIME_TEST_SECRET,typeof process.env.NODE_OPTIONS,typeof process.env.HOME]}))') });
    assert.deepEqual(await probe.run(""), {version: 1, status: "ok", output: ["undefined", "undefined", "undefined"]});
    await probe.close();
  } finally {
    if (before === undefined) delete process.env[key]; else process.env[key] = before;
  }
});

test("missing engine in a path with spaces is reported, not replaced by Node eval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi runtime missing engine "));
  try {
    for (const file of ["worker.mjs", "protocol.mjs", "engine.mjs", "evaluator.mjs", "rpc-protocol.mjs", "cell-bootstrap.mjs", "cell-protocol.mjs"]) await cp(new URL(`../../../openai-compatibility/runtime/${file}`, import.meta.url), join(directory, file));
    const probe = new RuntimeProbe({ launch: () => spawn(process.execPath, [join(directory, "worker.mjs")], {
      cwd: directory, env: workerEnvironment(), stdio: "pipe", windowsHide: true,
    }) });
    assert.deepEqual(await probe.run('emit("must not run")'), error("ENGINE_UNAVAILABLE"));
    await probe.close();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
