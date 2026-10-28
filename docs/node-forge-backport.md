# Node-only node-forge distribution

JoeSSH uses a Node-only distribution derived from the integrity-verified
upstream `node-forge@1.4.2` npm archive. This replaces the former 1.4.0 RSA
security backport; the 1.4.2 release incorporates upstream security fixes.
The distribution is not a byte-identical copy of the registry package: it
omits seven browser/Flash artifacts, restricts exports to Node entry points,
removes development-only package metadata, and changes one PKCS#12 alias to
semantically equivalent bracket-property notation for secret-scan compatibility.
It also removes the previously reviewed duplicate password-derived README seed
example while preserving the secure random seed example.
The original metadata and dual-license text are retained. Full per-file source
and modified hashes are pinned by an independent metadata digest in
`vendored-node-forge-contract.mjs`. Dist and Flash paths remain unavailable.

The [upstream 1.4.0 to 1.4.2 comparison](https://github.com/digitalbazaar/forge/compare/v1.4.0...v1.4.2)
includes changes for RSA DER verification, ASN.1 resource limits, PEM parsing,
X.509, TLS, PKCS#12 iterations, GCM authentication tags, CBC/ECB padding,
prototype pollution and JSBN inversion. These are upstream changes, not a claim
that JoeSSH has independently verified every security advisory. Invalid GCM tag lengths, PKCS#12 key-derivation iteration counts below one,
and zero MAC iterations are rejected. The 1.4.2 MAC parser treats ASN.1 INTEGER
bytes as unsigned; a negative-encoded value can be interpreted as a positive
count, so rejection of all negative MAC iteration encodings is not claimed. PEM Buffer support
is restored in 1.4.2. Callers relying on previously accepted invalid inputs may
need changes.

Upstream commit references in that comparison identify these advisory IDs:

- RSA: GHSA-2g46-22mc-6gwp, GHSA-6qrw-m8cv-hcxf; the prior npm finding was GHSA-86w9-cpqp-85rv.
- ASN.1 and PEM: GHSA-rhr8-3pm8-cq29, GHSA-7wch-p9px-956x, GHSA-4642-5mcj-2rqw.
- TLS: GHSA-hqq3-7jhf-c5jx, GHSA-8hrf-8g6f-7xwp, GHSA-525v-9gp9-w22h.
- PKCS#12 and X.509: GHSA-jc66-7q78-782g, GHSA-5x38-2vff-x55p, GHSA-h46v-rmh6-fq4f, GHSA-9wg5-mj3p-v49q.
- GCM, CBC/ECB, cookies and CA store: GHSA-5cwg-6vw7-rj6p, GHSA-2vgq-wchc-25w7, GHSA-6wvx-3r32-xmcg, GHSA-4487-j8r4-4g2f.
- JSBN: GHSA-h6cr-wjv9-3cpp, GHSA-5m6q-g25r-mvwx.

These labels document the upstream release notes, not independent exploitation
or separate tests of each advisory. A static search found no PKCS#12 calls in
JoeSSH app/package source, the Expo certificate package or its CLI code-signing
entry; it cannot exclude dynamic or indirect call paths.

The upstream `_parseAllDigestBytes=false` and `_skipPaddingChecks` options are
testing escape hatches, not safe product verification settings. Do not enable
them in product or release tooling; the Expo consumers use the default strict
verification path.

`npm run qa:prod-audit` checks the reviewed tree and metadata, root dependency,
override and lock binding, duplicate identities, and installed root and Expo
consumer resolution. A separate fresh audit of the official registry identity
must contain zero findings, including low severity; it never exempts a forge
advisory. Full and production reports are also evaluated without modification.
The separate Zod backport requires its verified source and an exact reviewed
Expo advisory graph, including its independently low-severity deepmerge edge.
Unrecognized high or critical findings and changes to the reviewed graph block
the gate. Independent lower-severity findings follow the existing risk policy.

The regression suite exercises synthetic RSA signatures and malformed DER,
exponents 3 and 65537, SHA-256/384/512, PSS/NONE, Expo certificate, CSR and
manifest consumers, PEM string/Buffer inputs, PKCS#12 and GCM behavior. Keys are
synthetic. Fresh CI, SBOM, license and release qualification remain required.

The historical 1.4.0 release review remains in the October 23 evidence and risk
register. The two narrowly scoped historical secret-scan fingerprints remain
unchanged; they do not authorize new findings or broad exclusions.
