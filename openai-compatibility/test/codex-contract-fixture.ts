// First-party source-inspection fixture validation, not an upstream runtime emulator.
import assert from "node:assert/strict";
export const CODEX_CONTRACT_COMMIT = "45305dd229c01e6cb6e122f6559e4f9b805bae6b";
export function parseCodexContractFacts(bytes: Uint8Array) {
	assert.ok(bytes.byteLength > 0 && bytes.byteLength <= 64 * 1024, "Contract fixture byte limit");
	const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
	assert.deepEqual(Object.keys(value).sort(), ["version", "target", "basis", "claimedParity", "piBaseline", "sourceFiles", "unified", "code", "web", "image", "pi", "unresolved"].sort());
	assert.equal(value.version, 1);
	assert.equal(value.target.repository, "openai/codex");
	assert.equal(value.target.commit, CODEX_CONTRACT_COMMIT);
	assert.equal(value.target.license, "Apache-2.0");
	assert.equal(value.target.licensePath, "LICENSE");
	assert.equal(value.target.noticePath, "NOTICE");
	assert.equal(value.basis, "source-inspection-not-upstream-execution");
	assert.equal(value.claimedParity, false);
	assert.match(value.piBaseline, /^[a-f0-9]{40}$/);
	assert.ok(Array.isArray(value.sourceFiles) && value.sourceFiles.length === 42);
	const paths = new Set<string>();
	for (const file of value.sourceFiles) {
		assert.deepEqual(Object.keys(file).sort(), ["bytes", "path", "sha256"]);
		assert.equal(typeof file.path, "string");
		assert.ok(file.path.length < 240 && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(file.path));
		assert.ok(!file.path.split("/").some((part: string) => part === "." || part === ".."));
		assert.ok(!paths.has(file.path)); paths.add(file.path);
		assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 2 * 1024 * 1024);
		assert.match(file.sha256, /^[a-f0-9]{64}$/);
	}
	assert.ok(paths.has("LICENSE") && paths.has("NOTICE"));
	for (const surface of [value.unified, value.code, value.web, value.image]) {
		assert.ok(Array.isArray(surface.references) && surface.references.length > 0);
		assert.equal(new Set(surface.references).size, surface.references.length);
		for (const path of surface.references) assert.ok(paths.has(path), "Unpinned source anchor");
	}
	assert.equal(value.unified.outputSchemaSerializedToResponses, false);
	assert.equal(value.unified.directOutput, "text-header-and-bounded-output");
	assert.equal(value.unified.codeOutput, "structured-object");
	assert.equal(value.unified.codeResultWrappedInPiResult, false);
	assert.equal(value.unified.writeProperties.session_id, "number");
	assert.equal(value.unified.parsedIntegerTypes.session_id, "i32");
	assert.equal(value.code.execKind, "custom-grammar");
	assert.equal(value.code.grammarSyntax, "lark");
	assert.equal(value.code.runtimeImplementationAudited, false);
	assert.equal(value.code.notifyOrderingAudited, false);
	assert.equal(value.web.hosted.functionParametersExposedByClient, false);
	assert.equal(value.web.hostedServiceBehaviorVerified, false);
	assert.equal(value.image.binaryAndHostedServiceBehaviorVerified, false);
	assert.equal(value.pi.nestedOutput, "native-result-isError-wrapper");
	assert.equal(value.pi.codeRenderer, "tui-only-wire-unchanged");
	assert.ok(Array.isArray(value.unresolved) && value.unresolved.length >= 8);
	return value;
}
