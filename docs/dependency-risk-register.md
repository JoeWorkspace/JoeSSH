# Dependency Risk Register

This register records unresolved dependency findings and their owners. Recording
a finding is not a release waiver. The full npm workspace audit must pass its
high-severity gate, and both Rust lockfiles must pass an audit that denies
warnings. Mobile or development-only paths do not bypass those gates.

```bash
npm run qa:prod-audit
npm run qa:rust-advisory
```

The register checker separately checks production-scope moderate-or-higher
package entries against this document. Passing that checker confirms documentation
coverage only; it does not mean the vulnerability audit passed.

## Audit snapshot: 2026-10-23

After the initial compatible updates, the full npm audit reported 22 affected
package entries (19 high, 3 moderate), down from 68 (37 high, 30 moderate,
1 critical). The subsequent lint-staged 17.6.0 upgrade removes its braces path;
the full and production audits now both report 21 entries (18 high, 3 moderate,
no critical). These are propagated
package entries, not distinct advisories: three advisories remain.

The initial evidence is in `reports/remediation-2026-10-23/npm-audit-final.json`
and `npm-audit-production-final.json`. Follow-up evidence and upstream fix
research are in `reports/release-remediation-2026-10-23/npm/`. Rerun audits for any later release; this
snapshot does not establish release readiness.

## Unresolved npm findings

| Origin | Advisory | Impact and decision | Owner and next action |
| --- | --- | --- | --- |
| `braces` 3.0.3, high | https://github.com/advisories/GHSA-vfj7-8cjw-p6xm | Deeply nested patterns can exhaust the stack. Present in Metro file matching. The lint-staged path was removed by upgrading to 17.6.0. No patched upstream release was available at review. The high-severity release gate remains blocked. | Repository/mobile maintainers: adopt a patched braces or supported parent chain, then rerun tooling and mobile checks. |
| `node-forge` 1.4.0, high | https://github.com/advisories/GHSA-86w9-cpqp-85rv | RSA signature verification accepts malformed DigestAlgorithm nesting. Reached through Expo code-signing tools. No patched upstream release was available at review. This is not the Rust SSH implementation, but the full npm gate remains blocked. | Mobile/release maintainers: update Expo's certificate chain after the upstream fix; do not substitute unreviewed cryptographic code. |
| `decode-uri-component` 0.2.2, moderate | https://github.com/advisories/GHSA-vcc3-ghjq-m6fr | Malformed encoded input can cause excessive decoding work through mobile routing. Version 0.5.0 fixes it but changes to ESM; overriding query-string 7's CommonJS dependency breaks decoding. No risk waiver is introduced here. | Mobile maintainers: upgrade Expo and Router together to a supported chain without the old decoder, then validate routes and real native devices. |

The production audit propagates the braces finding through `micromatch`,
`metro-file-map`, `metro`, `metro-config`, `metro-transform-worker`,
`@expo/metro`, `@expo/metro-config`, `@react-native/metro-config`,
`@react-native/community-cli-plugin`, `react-native`,
`@react-native/virtualized-lists`, `react-native-reanimated`, and
`react-native-worklets`. Expo findings also include `@expo/cli`,
`@expo/code-signing-certificates`, and `expo`. The decoder path is
`expo-router` -> `query-string` -> `decode-uri-component`.

The full audit no longer reports `lint-staged`. Its upgrade requires Node
22.22.1 or newer and Git 2.32 or newer; Prettier 3.9.10 is now an explicit
development dependency because the existing commit-hook configuration invokes
it. Isolated Git hook tests cover formatting, lint failures, partial staging,
unrelated modifications, and rollback.

The `--omit=dev` label
does not prove every affected package ships in a desktop artifact: Expo declares
build and development tools as production dependencies. Reachability must be
assessed for each release artifact rather than assumed from labels.

Metro 0.84.5 removes the affected `image-size` dependency within the current
React Native/Expo ranges. See the [official Metro release](https://github.com/react/metro/releases/tag/v0.84.5).
The isolated decoder compatibility reproduction is retained under
`reports/remediation-2026-10-23/dependency-compatibility/`.

The canonical mainline inspected on 2026-10-23 already contains a separately
validated decoder 0.5.0 vendor package with a CommonJS compatibility entry and
source-integrity checks. That is another integration option; the raw ESM
override failure does not establish that a compatible fix is impossible.
This historical workspace has not adopted that vendor contract. Reconcile it
against mainline and rerun its integrity, routing, lockfile, and artifact checks
before claiming the decoder finding is resolved here.

## RustSec

The root workspace lock passes the freshly fetched 2026-10-23 RustSec database
after updating `ctutils` to 0.4.4, `chacha20` to 0.10.2, and `der` to 0.8.2.
The Tauri lock additionally updates compatible dependencies including `anyhow`,
`crypto-bigint`, `plist`/`quick-xml`, and `tauri-utils`, removing the old `unic`
chain. No advisory ignore or warning suppression was added.

The complete Tauri lock still fails `--deny warnings` for two Linux GTK chain
findings, even though neither appears in the Windows target dependency tree:

| Package | Advisory | Decision and follow-up |
| --- | --- | --- |
| `glib` 0.18.5 | https://rustsec.org/advisories/RUSTSEC-2024-0429.html | Unsound Iterator and DoubleEndedIterator implementations. The fixed glib line is outside Tauri's GTK 0.18 dependency range. Desktop/release maintainers must adopt a supported Tauri/GTK upgrade; cross-platform release remains blocked. |
| `proc-macro-error` 1.0.4 | https://rustsec.org/advisories/RUSTSEC-2024-0370.html | Unmaintained dependency in the same GTK chain. Update through the supported framework chain; keep warnings denied. |

Evidence: `rustsec-fresh-audit-after.log`, `tauri-rustsec-final.log`, and
`tauri-windows-*-tree.log` under `reports/remediation-2026-10-23/`.
The official advisory database checkout used for local evidence is at commit
`f7b2f6bc663452200bbe639ebb75e0c762b3422b`. Local audits used that freshly
fetched database without disabling yanked-package checks.

Canonical mainline also has a verified GLib backport and a separate audit of
the original registry identity. Its maintenance policy was still within its
2026-11-28 review date at inspection. These are relevant reconciliation
sources, not evidence that this workspace has the backport or passes its
unchanged `cargo audit --deny warnings` gate. See the investigation and
mainline comparison under `reports/release-remediation-2026-10-23/rust/`.

The Rust SSH `russh/rsa` feature remains disabled for RUSTSEC-2023-0071.
Password auth and supported non-RSA private keys remain in scope; RSA private-key
auth requires a safe upstream path before reintroduction.

## Rules

- High or critical findings in the full npm audit block release.
- Both Rust lockfiles must pass `cargo audit --deny warnings`.
- Moderate production findings need an advisory URL, affected path, impact,
  decision, and follow-up owner. Documentation does not waive another gate.
- Preserve lockfile reproducibility and supported peer ranges. Do not use forced
  downgrades, incompatible overrides, or audit ignores just to get a green result.
- Signed packages, provenance, real SSH/device tests, and a clean canonical
  release checkout remain separate acceptance requirements.
