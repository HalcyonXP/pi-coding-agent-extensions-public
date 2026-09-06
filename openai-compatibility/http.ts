/** Bound waiting even when an injected transport/stream ignores AbortSignal. Underlying work may finish later. */
export function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return promise;
	return new Promise<T>((resolve, reject) => {
		const cleanup = () => signal.removeEventListener("abort", abort);
		const abort = () => { cleanup(); reject(new Error("Operation cancelled.")); };
		signal.addEventListener("abort", abort, { once: true });
		promise.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
		if (signal.aborted) abort();
	});
}

/** Read incrementally: slicing response.text() afterwards does not bound allocation. */
export async function readBoundedJson(response: Response, maxBytes: number, signal?: AbortSignal): Promise<unknown> {
	const size = Number(response.headers.get("content-length"));
	if (Number.isFinite(size) && size > maxBytes) {
		void response.body?.cancel().catch(() => {});
		throw new Error("Service response exceeded the byte limit.");
	}
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Service returned an empty response.");
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		while (true) {
			signal?.throwIfAborted();
			const chunk = await withAbort(reader.read(), signal);
			if (chunk.done) break;
			bytes += chunk.value.byteLength;
			if (bytes > maxBytes) throw new Error("Service response exceeded the byte limit.");
			chunks.push(chunk.value);
		}
		try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
		catch { throw new Error("Service returned invalid JSON."); }
	} finally {
		void reader.cancel().catch(() => {});
		reader.releaseLock();
	}
}

export function assertServiceBaseUrl(actual: string, expected: string, mockFetch?: typeof fetch): void {
	if (actual === expected) return;
	// Test-only injection: both loopback URL and an explicit test transport are required.
	const url = new URL(actual);
	if (mockFetch && url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname)
		&& !url.username && !url.password && !url.search && !url.hash) return;
	throw new Error("Untrusted service endpoint rejected before authentication.");
}

export class SubscriptionAuthError extends Error {}
