# Dependency Risk Register

This register tracks known production dependency findings that do not block the
Desktop + Web Admin + self-hosted Sync Service Public Beta because they are not
on the first public runtime path or require a breaking platform upgrade.
It also records non-production audit findings that affect local QA or release
tooling so dependency maintenance work is visible before GA.

The release gate fails closed for critical findings and for every unregistered
high-severity advisory. A high finding can pass only through an exact,
code-reviewed, time-boxed exception for non-public build tooling when no fixed
upstream release exists:

```bash
npm run qa:prod-audit
```

The checker runs a full-workspace high-severity audit plus a production-scope
moderate audit, resolves transitive high-severity paths back to their root
advisories, and rejects incomplete reports, unknown paths, expired exceptions,
or critical findings. Moderate production findings must also remain documented
here.

## Active Risks

### RustSec Audit

The Rust SSH stack previously pulled `rsa` through the optional `russh/rsa`
feature, which triggered RUSTSEC-2023-0071. Public Beta disables that feature in
`crates/core/Cargo.toml`; password auth and non-RSA private keys remain in
scope, while RSA private-key auth stays out of scope until the upstream timing
side-channel advisory has a safe path.

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

### Time-boxed Mobile Build-tooling Exception

| Package                                    | Severity | Advisories                                                                                              | Scope and reachability                                                                                                                                                                                                                                                                                            | Decision                                                                                                                                                                                                                    | Expiry and follow-up                                                                                                                                                              |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image-size` via Expo / React Native Metro | High     | https://github.com/advisories/GHSA-w3rx-r6r6-pgpr and https://github.com/advisories/GHSA-5p2g-fcmc-qvqq | The vulnerable parsers are reached through Metro while inspecting repository-controlled mobile assets. Metro is not shipped in the Desktop, Web Admin, or self-hosted Sync runtime, and the Mobile companion remains outside the first public release. JoeSSH does not accept remote images for Metro processing. | Temporarily accepted because the advisory database reports no patched `image-size` release and npm's proposed force fix downgrades Expo 57 to incompatible Expo 53. This exception does not permit a public Mobile release. | Expires `2026-09-08`. Recheck the npm registry and Expo patch releases weekly and before any release; the automated gate fails after this date or on any different high advisory. |

The affected path currently propagates through `metro`, `metro-config`,
`metro-transform-worker`, `@expo/metro`, `@expo/metro-config`, `@expo/cli`,
`expo`, `@react-native/community-cli-plugin`, `@react-native/metro-config`,
`@react-native/virtualized-lists`, `react-native`,
`react-native-reanimated`, `react-native-worklets`, `@expo/ui`, and
`expo-modules-core`. Those wrapper findings resolve to the two registered
`image-size` advisories above; a new root advisory still blocks the gate.

The automated exception is bound to that exact 16-package affected set, its
current npm `via` graph, the expected direct-package flags (`expo` and
`react-native` only), and the current top-level audit nodes. The lockfile graph
must make every affected package reachable from `apps/mobile` and from no other
workspace or root release/development tooling. A direct `image-size`
dependency, an unknown wrapper, a changed graph or install location, a Desktop
or Web path, or a newly compatible npm fix fails the gate and requires a fresh
review rather than inheriting this exception.

The August 8 audit refresh separately remediated
https://github.com/advisories/GHSA-2v37-7h3g-55p8 by overriding `nanoid` to
patched version `3.3.18` across the workspaces.

### Development And QA Toolchain Audit

The July 29 dependency refresh removed the former `js-yaml`,
`@opentelemetry/core`, and Windows development-server `esbuild` findings.
There are currently no additional moderate-or-higher development-only findings
in the full npm audit output.

## Rules

- Any critical vulnerability blocks release.
- Any high vulnerability on a public runtime path blocks release. A
  non-public build-tooling exception requires an exact advisory allowlist,
  documented reachability, no available compatible patch, and an automated
  expiry date.
- Any moderate production vulnerability must be listed here with advisory URL,
  affected path, runtime impact, and follow-up owner before Public Beta.
- Low severity findings are reviewed during dependency maintenance but do not
  block Public Beta unless they affect credential handling or remote code
  execution surfaces.
- Development and QA toolchain findings do not block Public Beta unless they
  affect release artifact integrity, CI secrets, credential handling, or a
  network-exposed service in the release pipeline.
- If mobile moves into the public release scope, the registered `image-size`
  exception and React Native or Expo moderate findings become release blockers
  unless fixed or proven unreachable in the shipped binary.
