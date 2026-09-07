# Cohesive Windows prerelease contract

This contract covers the cohesive OpenAI extension, compatible patched Pi host, locked runtime dependencies and verified prebuilt helper in a Windows x64 bundle. It does **not** release every extension in the source repository or announce available binaries. `0.3.0-private.1` is the selected first unsigned technical-preview label, not an existing tag or promise of immediate delivery. Stable private package/host names identify the non-upstream variant; they are not a development destination or visibility claim.

## Scope and remaining gates

Windows x64, existing Node 24/25 and .NET Framework 4.8 remain required. The selected host is the compatible patched Pi 0.85.1, not stock Pi or an official upstream binary. Preserve native models/providers, ordinary tools, Fast/footer, immutable originals and native ownership. Restricted coordinator JavaScript does not sandbox deliberately delegated full-OS commands. No runtime download/compiler, portable or unrestricted fallback.

Source acceptance, reproducible artifact acceptance, release availability and installation delivery are separate states. The [acceptance map](FINAL-ACCEPTANCE.md) defines the supported surface and synthetic-service limitations. Neither green CI nor an AI-assisted self-review is independent approval, a security clearance, an entitlement claim or permission to publish binaries. No automatic issue closure follows from implementing this contract.

The first-party distribution tooling and documentation have scoped Apache-2.0 grants; see `distribution/LICENSE`, `distribution/NOTICE`, and this directory's [LICENSE](LICENSE) and [NOTICE](NOTICE). Existing component/upstream/dependency licenses and required notices are unchanged. This is not a blanket repository license or completed transitive redistribution/advisory review. The selected scope is an unsigned Windows x64 technical preview with the existing label. The [redistribution and release-risk review](REDISTRIBUTION.md) currently blocks binary publication; notice/security review, exact artifact acceptance and the actual delivery plan remain separate gates. The current helper has no embedded Authenticode certificate; do not imply a signed artifact. Introducing signatures changes byte identities and requires its own reviewed provenance/verification design.

## Trust the pins before trusting downloaded code

The canonical source is `HalcyonXP/pi-coding-agent-extensions-public`, repository ID `R_kgDOUQewAQ`. Independently establish that you trust that source and the exact public acceptance record: source commit/tree, reviewed head/base, labelled COMMENTED review, all required checks, actual CI provenance and same-source reproduction. Public account attribution is not anonymous ownership or independent review.

Obtain the **archive SHA-256, detached manifest SHA-256, source commit and release label together** from that trusted source-specific record. Do not infer them from a filename, mutable `latest` link, an unverified checksum shipped beside an archive, or code inside the archive. Hashes from the same compromised delivery channel do not independently authenticate it. If you cannot establish the record's trust and exact association, stop. CI provenance currently expires after 14 days; later release delivery must retain a durable reviewed public record, not depend solely on an expiring artifact URL.

Run the checker only from an independently trusted matching source checkout. It is intentionally source-only, not a bootstrap program to execute from an unverified bundle. Local repository guards are not inherited by a new clone; establish equivalent development safeguards before writes. This read-only checker needs no credentials, dependency installation, network request or bundle import.

## Offline pre-execution sequence

Example absolute paths are placeholders. Obtain the accepted archive and detached `bundle.json` into a new downloads directory without executing them. Fill all four expected values from the trusted acceptance record; the placeholder values below deliberately fail validation.

```powershell
$source = 'REPLACE_WITH_ACCEPTED_40_HEX_SOURCE'
$release = 'REPLACE_WITH_ACCEPTED_VERSION'
$archiveSha = 'REPLACE_WITH_ACCEPTED_ARCHIVE_SHA256'
$manifestSha = 'REPLACE_WITH_ACCEPTED_MANIFEST_SHA256'
$verifyArgs = @(
  '--archive', 'C:/Pi-Downloads/candidate.tar.gz',
  '--manifest', 'C:/Pi-Downloads/bundle.json',
  '--source', $source,
  '--release', $release,
  '--archive-sha256', $archiveSha,
  '--manifest-sha256', $manifestSha
)
node 'C:/Pi-Source/reviewed/distribution/verify-download.mjs' @verifyArgs
if ($LASTEXITCODE -ne 0) { throw 'Download pins did not verify; preserve inputs and stop' }
```

Success is `download-pins-matched-not-installed`. The checker matches both complete byte digests and the detached manifest's version/source/release/Windows/Node identity. It reads only regular leaf files, bounds the archive at 768 MiB and the UTF-8 manifest at 8 MiB, and reports failures without input paths or payloads. It does not establish the pins' authenticity, inspect tar contents, scan vulnerabilities, verify signatures, extract, import bundle code, create a profile or prove service entitlement.

Keep the verified files immutable and under trusted local ownership. A later replacement invalidates the result; this is not a filesystem sandbox or continuous tamper protection. Then extract with the existing system tar into a **new** directory and compare the internal manifest before running any extracted JavaScript:

```powershell
$bundle = 'C:/Pi-Bundles/new reviewed bundle'
if (Test-Path -LiteralPath $bundle) { throw 'Choose a new extraction path' }
New-Item -ItemType Directory -Path $bundle | Out-Null
# Only the exact archive whose trusted digest matched above is eligible.
tar -xzf 'C:/Pi-Downloads/candidate.tar.gz' -C $bundle
if ($LASTEXITCODE -ne 0) { throw 'Extraction failed; retain evidence and stop' }
if ((Get-FileHash -LiteralPath "$bundle/bundle.json" -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifestSha.ToLowerInvariant()) {
  throw 'Internal manifest differs from accepted detached manifest; stop'
}
```

No unknown archive becomes safe merely because this example uses tar; exact trusted archive identity and the source's packaging/installed acceptance are prerequisites. The installer and launcher subsequently check the full manifested tree and profile binding. Follow the [new-profile and rollback guide](PRIVATE-RELEASE.md) only after verification and an explicit installation decision. Never overwrite an existing profile, import active credentials, change global SDK/PATH/settings or recycle an unconfirmed lock by PID lookup. A later user's normal login in a chosen new profile is not an automated test allowance.

Maintainer acceptance remains two independent supported-Node builds, actual Node 24 CI comparison, real extraction including spaces, and both `distribution/accept.mjs` and `distribution/accept-profile.mjs` from matching trusted source. Those synthetic-service installed checks are not extra unit-test counts or live-service permission. The full build/acceptance scripts and development-only root `PUBLICATION.md` remain in matching source, not in the runtime archive.

## Durable public release record — required fields, not a release receipt

Before any future release, freeze a reviewed sanitized record with these associations. This table defines requirements; it contains no accepted asset identity and is not itself authorization.

| Association | Required content |
| --- | --- |
| Repository/source | Canonical repository name and ID, exact final source commit/tree, immutable tag target if separately authorized |
| Review/integration | Reviewed head/base, COMMENTED AI-assisted review ID and limitations, current-head check contexts/run IDs, guarded ancestry-preserving integration and explicit closure scope |
| Build inputs | Host/upstream/patch/catalog/license pins, locked dependencies, compiler/reference/helper provenance, supported Node versions and scoped notices; no private tool paths or credentials |
| Accepted assets | Exact bounded allowlist of archive/checksum/manifest filenames, byte lengths and SHA-256 values; manifest source/release identity; no profiles, private receipts or generated user artwork |
| Reproduction/installed evidence | Actual source-specific CI artifact association, two matching local builds and CI comparison, real extraction and SDK/profile/Fast/rollback acceptance; label synthetic service seams and preserve failures privately |
| Trust/signing | How expected pins are obtained from trusted acceptance records; explicit unsigned status or a separately reviewed signature scheme and verification instructions; no implied endorsement or independent approval |
| Delivery result | Only after authorization: exact release/tag/asset identifiers, upload and fresh download association, downloaded-byte verification and isolated acceptance. Do not predeclare success |

Do not upload raw local receipts to satisfy this table: review a bounded public summary, retain necessary public provenance, and preserve private evidence separately. A source, document, version, notice or toolchain change requires new commit-bearing artifact evidence; equal runtime code does not make old archive hashes interchangeable.

## Future execution boundary

Publishing/tagging (including draft releases), asset replacement, signing/account operations and installation rollout need separate explicit authorization and a tested, narrowly scoped repository/head/tag/asset-pinned plan. Standing maintainer delegation can supply authorization for in-scope project decisions and delivery; it does not replace the frozen exact plan, remove unresolved release blockers or authorize signing/account changes outside the selected unsigned preview. The current delegation stops short of replacing the user's active installation or importing credentials. Existing local wrappers intentionally refuse release/tag mutations; their refusal is not permission to substitute unguarded commands or weaken guards. Do not reuse completed one-shot integration plans. No executable upload or automatic deployment is added to Actions by this contract.

An authorized delivery must verify actual uploaded/downloaded bytes in new paths before recording availability. New isolated installation paths must be explicitly chosen afterward; active replacement, automatic credential migration, private development and live-service probe replay remain excluded. Keep readiness/delivery tracking open until its selected gates are actually satisfied or explicitly revised.
