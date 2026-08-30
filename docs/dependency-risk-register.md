# Dependency Risk Register

This register tracks known production dependency findings that do not block the
Desktop + Web Admin + self-hosted Sync Service Public Beta because they are not
on the first public runtime path or require a breaking platform upgrade.
It also records non-production audit findings that affect local QA or release
tooling so dependency maintenance work is visible before GA.

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

### Remediated Production Runtime Finding

| Package                                  | Severity | Advisory                                          | Runtime Impact                                                                                                                                                                                                                                                      | Public Beta Decision                                          | Follow-up                                                                                         |
| ---------------------------------------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `uuid` via Expo config plugins / `xcode` | Moderate | https://github.com/advisories/GHSA-w5hq-g745-h8pq | The affected package is used by Expo's iOS project-generation toolchain. It is not shipped in the Desktop, Web Admin, or self-hosted Sync runtime paths, and Mobile remains outside the first public release because its pairing and credential flow is incomplete. | Remediated by the tested workspace override to `uuid 11.1.1`. | Keep the override until Expo's supported dependency range resolves to a patched version directly. |

The former npm audit path ran through
`expo`, `@expo/cli`, `@expo/config`, `@expo/config-plugins`,
`@expo/inline-modules`, `@expo/local-build-cache-provider`,
`@expo/metro-config`, `@expo/prebuild-config`, and `xcode` before reaching
`uuid`. The root override now pins the patched `11.1.1` line, and the native
preflight, type checks, unit tests, and lockfile portability gate pass with that
resolution.

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
patched version `3.3.18` across the workspaces.

### Development And QA Toolchain Audit

The July 29 dependency refresh removed the former `js-yaml`,
`@opentelemetry/core`, and Windows development-server `esbuild` findings.
There are currently no additional moderate-or-higher development-only findings
in the full npm audit output.

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
