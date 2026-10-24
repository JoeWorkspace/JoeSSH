# Expo CLI Zod v3 security backport

Expo CLI's supported dependency still requires `zod 3.25.76`. The official
[collection-validation fix](https://github.com/colinhacks/zod/pull/6652), commit
`a0ebf970f2d752e5f58527cd2942ff48be4f46bd`, was published only in v4. This
project backports its early rejection behavior while retaining the original
v3 identity and API. It does not claim an official fixed v3 release.

## Behavior and boundary

An array exceeding an exact or maximum length, or a set exceeding its maximum
size, now returns an aborted parse result before visiting children or dispatching
their asynchronous validation. The existing v3 size issue, message and path
are retained. Undersized and valid inputs keep their existing behavior. The
change also prevents outer refinements from consuming an incompletely parsed
oversized collection.

Only three logic sites change in `src/v3/types.ts` and its CommonJS/ESM runtime
forms. This follows the upstream upper-bound fix; it does not introduce a global
issue cap, a new Map API, or `abortEarly`. Unbounded schemas remain unbounded.
Callers handling untrusted collections must choose appropriate size constraints.

The original archive also ships old v4 implementations. This distribution
removes those files and exports, retains v3 runtime/types and original license
bytes, and exposes only the Node CommonJS/ESM root, `/v3`, and package metadata.
It is scoped to the actual Expo CLI consumer. Other installed consumers retain
the official fixed Zod `4.6.7` implementation.

## Source and installation verification

`vendor/zod-3.25.76/JOESSH-PATCH.json` records the official archive URL, npm
SHA-512 integrity, SHA-1 and SHA-256, original file inventory, project-derived
patch, all retained hashes and removed exports/files. Its independent metadata
pin and the full tree are checked by `scripts/vendored-zod-contract.mjs`.
Original metadata and the MIT license remain available. Git preserves these
byte-pinned vendor files without line-ending conversion.

The sole scoped override is
`@expo/cli.zod = file:../../../vendor/zod-3.25.76`. The verified npm 10 lock
binds the CLI's nested link to that exact source; no root alias or global v3/v4
substitution is used. Fresh-process CommonJS/ESM consumer resolution and a
different-directory `npm ci` round trip check this relative-path behavior.
Missing or orphaned declarations, alternate v3 copies, changed source, unsafe
paths, incorrect installed resolution and reachable removed exports fail closed.

Rust and legal tooling can verify the source and lock binding without an npm
installation. Those source-only records cannot authorize advisory recognition.
The normal dependency gate separately requires a strictly verified installed
Expo CLI consumer before auditing or recognizing the repaired defect.

## Audits and acceptance

Normal `npm run qa:prod-audit` performs fresh full-workspace and production
audits plus separate official-registry audits of the original Forge and Zod
identities. It preserves the upstream findings. It recognizes
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
only after the installed source, original-identity report and exact advisory
leaf match. Diagnostic fixture flags cannot grant that recognition.

Expo CLI now has two repaired leaves. A separate composition checker can remove
one verified Zod edge from a copy of that CLI finding, then requires the
unchanged Forge checker to validate the remaining graph. The original report
is never rewritten. A missing proof, changed advisory, duplicate edge, extra
parent, unpatched copy or unrelated high finding remains blocking. This is
source remediation verification, not a high-severity exception.

Bounded child-process tests compare the original vulnerable bytes with the
repair without exhausting the host. They cover synchronous/asynchronous child
dispatch, exact/max constraints, undersized/valid inputs, nested schemas,
unions and outer refinements. Actual Expo CLI schema consumers, source/lock
tampering and audit-composition rejection tests are required alongside normal
workspace tests and protected CI. Operator evidence is under
`reports/store-publish-2026-10-24/release/npm-audit-20261025/`.

Replace this backport when Expo supports a reviewed fixed upstream API. Remove
its scoped override, vendor registration and exact finding recognition together;
rerun the complete online audits, actual-consumer checks and release gates,
then regenerate SBOM and license evidence. Never rename the patched identity
to make an advisory disappear.
