# Dependency Risk Register

This register tracks production and tooling dependency findings and their
reviewed treatment. Recording a finding does not waive a release gate. A
dependency outside the first public runtime path can still block release under
the full-workspace policy below.

The release gate fails closed for every high or critical finding in the full
npm workspace, including development and mobile build tooling. There are no
high-severity exceptions:

```bash
npm run qa:prod-audit
```

The checker runs a full-workspace high-severity audit plus a production-scope
moderate audit. It checks both reports independently, rejects incomplete or
malformed reports, and blocks all high or critical findings regardless of
whether a compatible fix is available. Moderate production findings must also
remain documented here.

## Active Risks

### RustSec Audit

The Rust SSH stack previously pulled `rsa` through the optional `russh/rsa`
feature, which triggered RUSTSEC-2023-0071. Public Beta disables that feature in
`crates/core/Cargo.toml`; password auth and non-RSA private keys remain in
scope, while RSA private-key auth stays out of scope until the upstream timing
side-channel advisory has a safe path.

`npm run qa:rust-advisory:strict` requires complete online RustSec and crates.io
yanked checks for both the root and Tauri lockfiles. Network errors, offline
mode, incomplete reports, or altered audit settings block the gate; cached-only
fallback is not accepted. Cargo metadata checks both workspaces' resolved
sources, and the verified GLib backport also receives a separate audit under its
original registry identity so future advisories remain visible. The narrowly
scoped Tauri maintenance notices and review deadline are recorded in the
[Rust maintenance risk register](rust-maintenance-risk-register.md); they do not
permit vulnerabilities or unverified vendor changes.

The October 24 release CI detected
[RUSTSEC-2026-0387](https://github.com/RustSec/advisory-db/blob/main/crates/crypto-bigint/RUSTSEC-2026-0387.md)
in `crypto-bigint 0.7.5` in both Rust lockfiles. The affected arithmetic can
vary with secret inputs; downstream exploitability depends on the algorithm,
compiler, CPU and observable side channel. The October 24 remediation moved both
graphs to the official `0.7.6` patch with the
[upstream constant-time fixes](https://github.com/RustCrypto/crypto-bigint/pull/1365).
Its required `ctutils` dependency advanced from `0.4.4` to `0.4.5`.

On October 27, source CI rejected `0.7.6` because upstream had yanked it,
along with `0.7.7` and `0.7.8`, after a
[breaking correction to the `NonZero<T>` multiplication trait implementation](https://github.com/RustCrypto/crypto-bigint/pull/1373).
Both source lockfiles now resolve the official, non-yanked `0.7.10` release
and its required `ctutils 0.4.6`. The manifests and remaining resolved packages
are unchanged. The
[upstream changelog](https://github.com/RustCrypto/crypto-bigint/blob/master/CHANGELOG.md)
records the intervening arithmetic fixes and the compatibility change; matching
semver constraints alone do not establish compatibility.
Keep the original failed CI and require complete online audits and locked
compilation/tests of the updated graphs. No advisory is ignored or downgraded.
This source update does not change previously built candidates or the current
Store installation package; a new application package requires fresh release
validation.

### Remediated Production Runtime Findings

| Package                                                 | Severity | Advisory                                          | Runtime Impact                                                                                                                                                                                                                                                            | Public Beta Decision                                                                                                                                               | Follow-up                                                                                                                                            |
| ------------------------------------------------------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `uuid` via Expo config plugins / `xcode`                | Moderate | https://github.com/advisories/GHSA-w5hq-g745-h8pq | The affected package is used by Expo's iOS project-generation toolchain. It is not shipped in the Desktop, Web Admin, or self-hosted Sync runtime paths, and Mobile remains outside the first public release because its pairing and credential flow is incomplete.       | Remediated by the tested workspace override to `uuid 11.1.1`.                                                                                                      | Keep the override until Expo's supported dependency range resolves to a patched version directly.                                                    |
| `decode-uri-component` via Expo Router / `query-string` | Moderate | https://github.com/advisories/GHSA-vcc3-ghjq-m6fr | Mobile deep-link and URL query parsing can reach the affected decoder and could spend excessive CPU on malformed percent-encoded input. The package is not in the Microsoft Store Desktop binary, but the repository treats the Mobile production graph as release-gated. | Remediated with the official `0.5.0` linear-time decoder plus a hash-bound CommonJS compatibility entry for Expo Router's current `query-string 7.1.3` dependency. | Remove the compatibility entry when Expo Router supports `query-string 9.5.0` or later; keep the byte, lockfile, route, and audit checks until then. |

The former npm audit path ran through
`expo`, `@expo/cli`, `@expo/config`, `@expo/config-plugins`,
`@expo/inline-modules`, `@expo/local-build-cache-provider`,
`@expo/metro-config`, `@expo/prebuild-config`, and `xcode` before reaching
`uuid`. The root override now pins the patched `11.1.1` line, and the native
preflight, type checks, unit tests, and lockfile portability gate pass with that
resolution.

The decoder finding entered the GitHub Advisory Database on 2026-08-31. A bare
override to `decode-uri-component 0.5.0` is not compatible because the patched
release is ESM-only while `query-string 7.1.3` calls it through CommonJS. A
major override to `query-string 9.5.0` also breaks Expo Router 57 because its
compiled code expects top-level `parse` and `stringify` exports. The vendored
package therefore preserves the official `0.5.0` ESM implementation byte for
byte and exposes the same function through a derived CommonJS entry. CI pins
the npm archive identity, every vendored file, the one-line source transform,
the lockfile override, direct query parsing, Expo Router route parsing, and a
malformed-input timeout. The production npm audit is required to remain clean.

### Remediated Mobile Build-tooling Finding

The `image-size` findings
[GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) and
[GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
affected image parsing in the Expo / React Native Metro toolchain. The
2026-08-30 dependency refresh removes this dependency rather than relying on
the former time-boxed exception.

[Metro 0.84.5](https://github.com/react/metro/releases/tag/v0.84.5) replaces
`image-size` with its own supported-format parsers. The
[upstream fix](https://github.com/react/metro/pull/1860) adds bounds and
forward-progress checks for malformed inputs. `image-size` itself still has
no patched release in the advisory database; it is no longer part of the
resolved workspace dependency graph.

The lockfile updates `@expo/metro` to `56.0.2` and the Metro package family to
`0.84.5`, within the existing Expo and React Native dependency ranges. No Expo
downgrade, new override, or advisory exemption is used. The high-severity
exception code and its expiry have been removed, so reintroducing these or
any other high-severity findings blocks the audit gate.

The August 8 audit refresh separately remediated
https://github.com/advisories/GHSA-2v37-7h3g-55p8 by overriding `nanoid` to
patched version `3.3.18` across the workspaces. The October 23 refresh advances
that override to `3.3.20`, which also satisfies the patched PostCSS dependency.

### Development And QA Toolchain Audit

The July 29 dependency refresh removed the former `js-yaml`,
`@opentelemetry/core`, and Windows development-server `esbuild` findings.
The October 23 refresh updates Vite to `8.2.4`, Vitest and its coverage provider
to `4.1.12`, and compatible transitive packages including `shell-quote 1.12.0`,
`brace-expansion 5.0.12`, `compression 1.8.2`, `source-map-js 1.2.2`, and
`@expo/metro-file-map 57.0.4`. The root and Tauri Cargo lockfiles also advance
`ctutils` to `0.4.4` for RUSTSEC-2026-0385. These updates add no audit waiver.

The next release CI found two newly updated npm advisories. Happy DOM's
[import-alias code injection](https://github.com/advisories/GHSA-834v-8h66-3h79)
is fixed by the official `21.0.4` release. This required a major update from
`20.11.1`; Node 22 remains supported. Its safer defaults for external CSS and
iframe loading remain enabled. All 1,188 workspace unit tests pass with those
defaults, and lint passes.

[Zod collection-validation resource exhaustion](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
is fixed in the official v4 line from `4.6.6`. The compatible graph now resolves
Zod v4 to `4.6.7`. Puppeteer advances within major 25 to `25.13.0`, whose
Chromium BiDi dependency supports that fixed v4 line; actual CDP and BiDi
launch/page/close smoke checks pass. Expo CLI still requires Zod `3.25.76`.
Updating the outer Zod package to v4 does not fix its byte-preserved v3
subpath, and substituting the v4 API is not a compatible repair. That remaining
v3 finding is repaired by the project-maintained
[Expo CLI Zod v3 backport](zod-v3-backport.md), retaining the original identity.
Normal online audits verify its exact source and original registry report;
the separate composition checker requires both repaired leaves before
recognizing the shared Expo parent. Raw reports still contain five high paths
for these two repaired defects. Retain the failed CI and original reports;
fresh protected CI and candidate qualification remain required for release.

### October 23 Audit And Backport Review

The final full-workspace and production npm reports at 14:26 UTC both contain
four high findings, with zero critical or moderate findings. These are the
`node-forge`, `@expo/code-signing-certificates`, `@expo/cli`, and `expo` paths
to one remaining advisory, not four independent bugs. Earlier reports had
20 high entries before npm incorporated the braces advisory withdrawal.
These counts describe the original-identity audit snapshot. The later Node-only
backport below remediates the exact defect in installed source; raw npm
findings remain visible and must be regenerated before any release decision.

| Package            | Advisory and affected path                                                                                                                                                                   | Decision and follow-up                                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `node-forge 1.4.0` | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): malformed RSA PKCS#1 v1.5 DigestInfo verification, via Expo CLI and code-signing-certificates.                     | Remediated in installed Node-only source by a pinned, independently reviewed project backport of unmerged PR 1159. Original 1.4.0 identity remains audited; unknown findings, altered source and unpatched copies fail closed. Owner: release maintainer. See the backport contract below. |
| `braces 3.0.3`     | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) was withdrawn on October 23. npm still reported it at 14:12 UTC, but both final audit reports at 14:26 UTC omit it. | Closed by upstream withdrawal propagation, with no package fork, severity change or exception. Keep the initial and final reports as evidence.                                                                                                                                             |

The [Node-only backport contract](node-forge-backport.md) records the original
archive, exact patch and full tree hashes, actual Expo/OpenSSL interoperability,
original-identity live audit, four precisely checked propagated package paths,
and removal requirements. This is a project-maintained fix; upstream has not
published a fixed release. No generic high-severity exemption was added.

The earlier npm remediation proposal downgraded Expo to `44.0.6` and React Native to
`0.72.17`; it is not a compatible fix for this project's Expo 57 / React Native
0.86 application. These downgrades have not been applied. The intended
Microsoft Store MSIX path uses Microsoft signing after certification and does
not require the operator's own Windows certificate or Apple credentials.
The unresolved dependency gate and the Store candidate qualification remain
required; see [the Store release process](windows-store-release.md).

## Rules

- Any high or critical vulnerability in the full npm workspace blocks release,
  including development, QA, and mobile build-tooling paths. There are no
  high-severity exceptions.
- Any moderate production vulnerability must be listed here with advisory URL,
  affected path, runtime impact, and follow-up owner before Public Beta.
- Low severity findings are reviewed during dependency maintenance but do not
  block Public Beta unless they affect credential handling or remote code
  execution surfaces.
- Moderate development and QA toolchain findings must also be assessed for
  release artifact integrity, CI secrets, credential handling, and
  network-exposed services in the release pipeline.
- If mobile moves into the public release scope, any registered React Native
  or Expo moderate findings require a fresh runtime-reachability review.
