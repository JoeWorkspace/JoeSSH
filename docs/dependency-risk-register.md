# Dependency Risk Register

This register tracks known production dependency findings that do not block the
Desktop + Web Admin + self-hosted Sync Service Public Beta because they are not
on the first public runtime path or require a breaking platform upgrade.
It also records non-production audit findings that affect local QA or release
tooling so dependency maintenance work is visible before GA.

The release gate remains strict for high severity:

```bash
npm audit --audit-level=high
node scripts/check-dependency-risk-register.mjs
```

The checker shells out to `npm audit --omit=dev --audit-level=moderate --json`
to validate production-scope moderate advisories against this register, while
the high-severity gate runs against the full workspace audit output.

## Active Risks

### RustSec Audit

The Rust SSH stack previously pulled `rsa` through the optional `russh/rsa`
feature, which triggered RUSTSEC-2023-0071. Public Beta disables that feature in
`crates/core/Cargo.toml`; password auth and non-RSA private keys remain in
scope, while RSA private-key auth stays out of scope until the upstream timing
side-channel advisory has a safe path.

### Production Runtime Audit

| Package                                  | Severity | Advisory                                          | Runtime Impact                                                                                                                                                                                                                                                      | Public Beta Decision                                                                 | Follow-up                                                                                     |
| ---------------------------------------- | -------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `uuid` via Expo config plugins / `xcode` | Moderate | https://github.com/advisories/GHSA-w5hq-g745-h8pq | The affected package is used by Expo's iOS project-generation toolchain. It is not shipped in the Desktop, Web Admin, or self-hosted Sync runtime paths, and Mobile remains outside the first public release because its pairing and credential flow is incomplete. | Accepted for `0.1.0-beta.10`; does not block Desktop + Web Admin + self-hosted Sync. | Reassess on every Expo patch; remove the exception when Expo/`xcode` accepts `uuid >=11.1.1`. |

Current npm audit reports the affected production dependency chain through
`expo`, `@expo/cli`, `@expo/config`, `@expo/config-plugins`,
`@expo/inline-modules`, `@expo/local-build-cache-provider`,
`@expo/metro-config`, `@expo/prebuild-config`, and `xcode` before reaching
`uuid`. npm's automated fix proposes an incompatible Expo downgrade, so JoeSSH
does not force an unverified major `uuid` replacement into the native project
generator.

### Development And QA Toolchain Audit

The July 29 dependency refresh removed the former `js-yaml`,
`@opentelemetry/core`, and Windows development-server `esbuild` findings.
There are currently no additional moderate-or-higher development-only findings
in the full npm audit output.

## Rules

- Any high or critical production vulnerability blocks release.
- Any moderate production vulnerability must be listed here with advisory URL,
  affected path, runtime impact, and follow-up owner before Public Beta.
- Low severity findings are reviewed during dependency maintenance but do not
  block Public Beta unless they affect credential handling or remote code
  execution surfaces.
- Development and QA toolchain findings do not block Public Beta unless they
  affect release artifact integrity, CI secrets, credential handling, or a
  network-exposed service in the release pipeline.
- If mobile moves into the public release scope, React Native and Expo moderate
  findings become release blockers unless fixed or proven unreachable in the
  shipped binary.
