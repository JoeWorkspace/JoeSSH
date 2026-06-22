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

| Package                                        | Severity | Advisory                                          | Runtime Impact                                                                                                                                                  | Public Beta Decision                                                                | Follow-up                                                            |
| ---------------------------------------------- | -------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `js-yaml` via React Native test/coverage chain | Moderate | https://github.com/advisories/GHSA-h67p-54hq-rp68 | Current audit path is introduced through React Native/Babel/Jest tooling for the mobile workspace. Mobile native apps are not part of the first public release. | Accepted for `0.1.0-beta.9`; does not block Desktop + Web Admin + self-hosted Sync. | Reassess during Expo/React Native upgrade before mobile public beta. |

Current npm audit reports the affected production dependency chain through
`react-native`, `babel-jest`, `@jest/transform`, `babel-plugin-istanbul`, and
`@istanbuljs/load-nyc-config` before reaching `js-yaml`.

### Development And QA Toolchain Audit

These findings appear in full `npm audit` output without `--omit=dev`. They do
not ship in the Desktop/Web/Sync runtime artifacts, but they are tracked because
release engineering should not normalize noisy audit output.

| Package                                               | Severity | Advisory                                          | Tooling Impact                                                                                                                                                                            | Public Beta Decision                                                                                                                 | Follow-up                                                                                                                                  |
| ----------------------------------------------------- | -------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `@opentelemetry/core` via `lighthouse`/`@sentry/node` | Moderate | https://github.com/advisories/GHSA-8988-4f7v-96qf | Affects the Lighthouse QA dependency chain used for local audits, not shipped app runtime code. The audit fix currently requires a breaking Lighthouse downgrade/major dependency change. | Accepted for `0.1.0-beta.9`; keep high-severity audit as the blocking gate and isolate Lighthouse usage to trusted local/CI targets. | Recheck after Lighthouse/Sentry/OpenTelemetry publish a compatible patched chain; remove or pin the audit lane if a high severity appears. |
| `esbuild`                                             | Moderate | https://github.com/advisories/GHSA-g7r4-m6w7-qqqr | Affects Windows development server file-read exposure. Public release artifacts are produced by trusted CI/local builds; the dev server must not be exposed to untrusted networks.        | Accepted for `0.1.0-beta.9`; does not affect static Web Admin, desktop installer, or Sync service runtime artifacts.                 | Upgrade Vite/esbuild when the compatible patched esbuild range is available; keep dev server bound to loopback for local development.      |

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
