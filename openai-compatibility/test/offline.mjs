// Every hosted-path test is offline, even if a mock/gate regresses.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
	if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) {
		throw new Error("Unexpected external fetch blocked by offline test transport.");
	}
	return nativeFetch(input, init);
};
