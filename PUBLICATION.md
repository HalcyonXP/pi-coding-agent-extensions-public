# Public source and metadata policy

## Accepted boundary

The publishing account handle and GitHub's associated platform attribution are public. Required third-party copyright/license names and public upstream provenance remain. This is not anonymous ownership.

Do not include personal mailbox addresses, private account/credential data, machine-specific home paths, private planning/review/service receipts, audit snapshots or generated session artwork. Generic example data and a non-deliverable maintainer identity are not real personal records. Existing third-party notices must not be stripped to claim “no names.”

Maintained commits use **Project Maintainers** with **maintainers@example.invalid**, a reserved non-deliverable example address. GitHub's own noreply bot metadata and the publishing handle paired with its matching GitHub noreply address are permitted for platform-generated objects. A personal mailbox is never permitted by that exception. Default account-derived personal merge metadata is not permitted. Inspect and privacy-check a locally constructed merge before publishing it; require exact reviewed head/base/tree/check pins and an unchanged expected remote base. A merge must preserve ancestry, never rewrite unrelated work.

## Checks and limitations

Before creating PRs, enable GitHub's **Keep my email addresses private** setting and verify its actual effect on newly generated objects. GitHub can create a PR test-merge commit with account-derived author metadata independently of your local commit identity. Changing settings later does not purge old objects: an affected staging repository must remain private while a genuinely fresh destination is prepared.

Run node .github/scripts/check-publication.mjs --remote-refs on a complete clone of the intended repository, plus the checksum-pinned Gitleaks scan. The explicit read-only fetch includes branch/tag refs and PR head/test-merge refs in a reserved local namespace; it does not prune previously observed history. A PR-head-only checkout, even with full ancestry, is not an audit of every platform-created ref. Before changing visibility, also inspect current GitHub content/reviews/Actions metadata and retained referenced objects; the local checker does not enumerate every server-side cache. Keep authenticated API-only credential envelopes out of audit exports. The checker examines all locally available commit metadata and every unique Git blob, not just working-tree files. It rejects non-text payloads, credential-file paths, common credential patterns, non-example personal email outside notices, machine-specific home paths and private project-record identifiers. It does not print matched values, including when a finding occurs in a tracked filename or ref name.

These are layered checks, not proof against every unknown secret format or control over external forks/comments. All new content and GitHub-facing review text still need review. Privacy findings are not instructions to test a discovered credential. Stop publication; keep evidence private and coordinate any necessary remediation.

Private history, old GitHub records and original generated artwork are not part of this source copy. Source and artifact identities are specific to this repository's commits; do not relabel a different source's archive/checksum/review as this one. Routine CI is offline with respect to model/service calls, has read-only repository permissions, and uploads only bounded build provenance, never executables or credentials. Source publication is separate from release/installation acceptance.
