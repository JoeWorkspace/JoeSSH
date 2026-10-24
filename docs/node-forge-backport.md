# Node-only node-forge backport

JoeSSH uses a project-maintained backport for the Expo build tools' RSA
verification path. It retains the published identity `node-forge@1.4.0`.
Upstream [PR 1159](https://github.com/digitalbazaar/forge/pull/1159) at
`db05494352dd3c9a5a07c5270333dcc78866cad2` was open and unmerged at review;
this is not an upstream `1.4.1` release.

## Source and behavior

The original archive is bound by npm SHA-512 integrity, SHA-1 and SHA-256.
Only `lib/rsa.js` receives the pinned upstream change. The verifier compares
the recovered DigestInfo with its canonical DER encoding, rejecting extra
elements, payload-bearing NULL parameters, non-minimal lengths and trailing
data in the default strict verification path. This follows the DER encoding
and comparison requirements in [RFC 8017](https://www.rfc-editor.org/rfc/rfc8017#section-9.2).
Valid SHA parameter forms and unrelated PSS/NONE behavior remain covered.

The package is deliberately Node-only. Old prebuilt `dist` JavaScript, source
maps and Flash files are absent, and conditional exports reject those paths.
Apart from the RSA fix and the exact PKCS#12 alias spelling adjustment below,
runtime source and the original dual-license text remain byte-identical.
Package-development scripts and dependencies are omitted. Original metadata
is preserved in `package.original.json`; source, patch, removed files and every
retained file hash are recorded in `JOESSH-PATCH.json`.

Unsupported `_parseAllDigestBytes=false` and `_skipPaddingChecks` options are
upstream testing escape hatches, not safe product verification settings. Expo's
real consumers use the default strict path. Do not enable those options in
product or release tooling.

## Required verification

`npm run qa:prod-audit` verifies the complete vendor tree, the independently
pinned metadata digest, root dependency/override and lock binding, absence of
duplicate package identities, and actual installed resolution from root and
Expo. A missing direct declaration cannot disable verification when a vendor
directory, override, alternate declaration or locked identity remains.

It then performs three fresh audits against the official npm registry: full
workspace, production scope, and an isolated lock containing the original
published `node-forge@1.4.0` identity and archive integrity. Transport failures,
invalid JSON/counts/status, changed upstream findings and unknown advisories
block the gate.

npm still reports the original advisory and propagates it to three Expo parent
packages. The checker retains these reports and recognizes the exact
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
finding only after the installed patched source and original-identity audit
have passed. Its exact four dependency paths, nodes and advisory structure are
checked. An additional advisory, different source/severity, unpatched nested
copy or altered tree remains blocking. This is verification of the source
remediation, not permission to ship an unpatched high finding.

The later [Zod v3 backport](zod-v3-backport.md) repairs a separate Expo CLI
dependency. The Forge matcher still rejects that additional edge. A separate
composition step may remove exactly one independently source-verified Zod
edge from a copy of the CLI report before applying the unchanged Forge graph
check. Both original-identity online audits must pass first. This does not
expand the Forge advisory allowance or alter the retained raw reports.

Fixture audit flags are diagnostic inputs and do not perform the original
registry network audit. They cannot satisfy release acceptance; CI uses the
normal `qa:prod-audit` entry point without fixture flags.

The registered tests cover malformed DER, exponent 3 and 65537, Node/OpenSSL
signing and verification, optional SHA parameters, PSS/NONE, and real Expo
certificate, CSR and manifest signing consumers. They resolve the actual
installed package without require interception. All keys and certificates are
temporary synthetic fixtures. Full upstream release approval and a private-key-
free exploit demonstration are not claimed.

## Evidence and retirement

Review evidence is under `reports/store-publish-2026-10-23/`: the dependency
lane preserves the original archive and negative control; the independent
release review records 203 synthetic cryptographic and source checks. The
recorded candidate has 54 files, metadata SHA-256
`fe2b1bf06499efd7b3a970a122dcd64ee8d17ec8586454aa15892b5e33b4b127`,
and patched RSA source SHA-256
`c7b72e7ef41f4fc0e5228dce3e37851e9ca064c789365d5e392c25d1c5f6e710`.
Fresh CI results and current SBOM/license evidence remain required for release.

The full-history secret scan identified two false positives in byte-preserved
upstream files: a function-reference assignment in `lib/pkcs12.js:1078` and a
documented seed example in `README.md:877`. Both match the integrity-verified
registry archive and contain no JoeSSH credential. Only their exact
`27ba8c3e6bd08361267b3765a4cc439e98174622` commit/file/rule/line fingerprints
are recorded in `.gitleaksignore`; no vendor path or detector is excluded.
The updated ignore bytes are pinned in the CI and release checks. Future
changes still require scanning and review.

The protected branch requires linear history. To keep a squash merge from
reintroducing those non-secret matches under a new commit ID, the distribution
uses bracket-property notation for the same PKCS#12 function alias and removes
the duplicate password-derived ED25519 seed example, retaining the secure random
32-byte seed example. These two files have independently pinned original and
adjusted hashes in `sourceAdjustments`; no other source change is permitted.
Normalized AST, export names and function identity match, and 96 PKCS#12
derivation cases produce the same bytes. The 54-file distribution scans without
findings under the unchanged default rules. The older exact historical
fingerprints remain for the already introduced commits. Use a squash merge;
rebasing the earlier commits would create new historical matches.

When upstream publishes a reviewed fixed version, replace the backport,
remove the override and registration together, rerun these interoperability
tests and the full release gates, and regenerate SBOMs and license materials.
Do not change the recorded identity to make the registry advisory disappear.
