import { LIMITS, failure, parseRequest } from "./protocol.mjs";
import { evaluate } from "./evaluator.mjs";

async function main() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > LIMITS.requestBytes) return failure("INVALID_REQUEST");
    chunks.push(chunk);
  }
  let request;
  try {
    request = parseRequest(Buffer.concat(chunks, bytes));
  } catch {
    return failure("INVALID_REQUEST");
  }
  return evaluate(request.code);
}

let result;
try {
  result = await main();
} catch {
  result = failure("HOST_FAILED");
}
// Natural exit avoids racing Node's Wasm/stdio teardown. Stop reading oversized stdin;
// the independent parent watchdog still owns a worker that fails to exit.
process.stdin.destroy();
process.stdout.end(JSON.stringify(result));
