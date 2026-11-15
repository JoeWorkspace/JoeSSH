# Public Beta RC Evidence Plan

This plan freezes the current `0.1.0-beta.16` release reality and gives the
operator sequence for the next `0.1.0-beta.17` candidate. It is a local evidence
runbook, not a release declaration. Do not mutate `reports/` while editing this
document, and do not use GitHub from this local planning path.

## Current Reality

- The default `full` profile is **No-Go**. It still requires formal Desktop
  release evidence for all public Desktop downloads: signed Windows artifacts,
  signed and notarized macOS artifacts, Linux package evidence,
  `reports/release/desktop/SHA256SUMS.txt`,
  `reports/release/desktop/release-evidence.json`, and a covered
  `reports/release/desktop/release-evidence-source.json` bound to the authority
  that produced the evidence.
- An unsigned Desktop build, unsigned staging report, or local handoff checksum
  does not satisfy the `full` profile. If a Desktop artifact is public, the
  `full` profile remains No-Go until formal Desktop evidence verifies.
- The `desktop-local-unsigned` profile may continue toward a local Go for beta
  staging and dogfood. It is local authority only, must not use GitHub
  publication, and must not put Desktop artifacts or unsigned Desktop handoff
  reports under `reports/release/desktop/`.
- For `desktop-local-unsigned`, Web Admin, Sync, SBOM, local authority,
  provenance, publish preflight, rollback, dogfood, and RC audit evidence are
  still release evidence. The Desktop input is only
  `reports/handoff/desktop/unsigned-staging-report-SHA256SUMS.txt`.
- Evidence is version and tag bound. After the beta17 version bump and tag move,
  regenerate evidence for `0.1.0-beta.17`; do not reuse beta16 release evidence
  except as the previous-release input for rollback rehearsal.

## Beta17 Preconditions

Before running the beta17 evidence sequence:

1. Work from a healthy checkout where `git status --short`,
   `git rev-parse --is-inside-work-tree`, and `git fsck --strict` are usable.
2. Align package, Tauri, Mobile, Cargo, changelog, and release notes metadata to
   `0.1.0-beta.17`.
3. Keep source clean outside generated release evidence before tagging.
4. Create `v0.1.0-beta.17` only after source QA is green.
5. Keep the previous Web Admin release root and previous Web Admin zip available
   for rollback rehearsal.

## Desktop Local Unsigned Sequence

Use this sequence after the beta17 bump when the goal is a local
`desktop-local-unsigned` Go. It is intentionally ordered so prereq RC audit is
written before operator dogfood, then the final RC audit can include dogfood.

1. Run the local unsigned public gate on the release machine:

   ```bash
   npm run qa:release:public:desktop-local-unsigned:local
   ```

   This is the long gate. It builds unsigned Desktop staging, records and
   verifies `reports/handoff/desktop/unsigned-staging-report.json`, generates
   Web/Sync/SBOM evidence, runs packaged Sync backup/restore release evidence,
   runs Web Admin release checks, runs visual E2E, and runs public readiness.

2. Rehearse Web Admin rollback against the previous release package:

   ```bash
   npm run release:web-admin-rollback-smoke -- --previous-root <previous-release-root> --previous <previous-release-root>/reports/release/web/joessh-web-admin-<previous-version>.zip
   ```

   This must write `reports/release/web/rollback-smoke.json` and
   `reports/release/web/rollback-smoke-SHA256SUMS.txt`.

3. Generate local release authority evidence. Prefer executing the allowed gate
   from this command when the release machine has not already captured it:

   ```bash
   npm run release:local-authority -- --release-profile desktop-local-unsigned --gate-command "npm run qa:release:public:desktop-local-unsigned:local" --target "<operator-confirmed local target>"
   ```

   If the gate already ran under an external runner and produced an auditable
   log, wrap that exact log instead of rerunning the long gate:

   ```bash
   npm run release:local-authority -- --release-profile desktop-local-unsigned --gate-command "npm run qa:release:public:desktop-local-unsigned:local" --gate-log <gate-log> --reuse-gate-log --target "<operator-confirmed local target>"
   ```

4. Generate and verify profile-bound provenance, then run local publish
   preflight:

   ```bash
   npm run release:provenance:local:desktop-local-unsigned
   npm run release:provenance:verify:local:desktop-local-unsigned
   npm run release:publish-preflight:local:desktop-local-unsigned
   ```

5. Generate the prereq RC audit. The command may still write a final No-Go audit
   at this point because dogfood is not complete yet; the important output for
   the next step is
   `reports/release/public-beta-rc-prereq-audit.local.desktop-local-unsigned.json`.

   ```bash
   npm run release:rc-audit:report:desktop-local-unsigned
   ```

   Continue only if the prereq audit decision is `go` and has no blockers.

6. Create, complete, and verify the desktop-local-unsigned dogfood evidence:

   ```bash
   npm run release:dogfood-template:desktop-local-unsigned
   # Complete reports/dogfood/public-beta/latest.local.desktop-local-unsigned.json.
   npm run qa:public-beta-dogfood:desktop-local-unsigned
   ```

   The completed dogfood evidence must pass all 10 task IDs, include non-secret
   evidence paths, and contain no open P0/P1 findings.

7. Run the final profile-specific RC audit:

   ```bash
   npm run release:rc-audit:report:desktop-local-unsigned
   ```

   `desktop-local-unsigned` is Go only when
   `reports/release/public-beta-rc-audit.local.desktop-local-unsigned.json`
   says `decision: "go"` and lists no blockers.

## Rollback Evidence

Rollback evidence has two separate meanings and both are required for the local
RC decision:

- Web Admin rollback is the package rollback rehearsal:

  ```bash
  npm run release:web-admin-rollback-smoke -- --previous-root <previous-release-root> --previous <previous-release-root>/reports/release/web/joessh-web-admin-<previous-version>.zip
  ```

- Sync rollback is the packaged backup/restore release evidence. The long local
  unsigned gate runs it, but it can be rerun directly when refreshing only Sync
  release evidence:

  ```bash
  npm run qa:sync:release-backup-restore-smoke
  ```

  The verifier requires `reports/release/sync/backup-restore-smoke.json` to bind
  to the staged packaged Sync binary path, sha256, and checksum manifest.

## Full Profile Unblock Path

The `full` profile remains No-Go until formal Desktop evidence exists. For local
planning, the non-mutating diagnostic is:

```bash
npm run release:desktop:evidence-diagnostics:local
```

To turn `full` into a possible Go without GitHub, a controlled local or
self-hosted signing authority must return a signed artifact directory outside
the release workspace, then the release machine must run:

```bash
npm run release:desktop:formal-artifacts:request -- --source-authority local
npm run release:desktop:formal-artifacts:kit -- --source-authority local
npm run release:desktop:formal-artifacts:kit:verify -- --source-authority local
npm run release:desktop:formal-artifacts:manifest -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:intake -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:preflight -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:validate -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:import -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:verify-evidence -- --require-source --require-current-git-source --require-source-authority local
```

Only after that verifier passes may the `full` local authority sequence proceed:

```bash
npm run release:local-authority -- --gate-command "npm run qa:release:public:fixture" --target "<operator-confirmed target>"
npm run release:provenance:local
npm run release:provenance:verify:local
npm run release:publish-preflight:local
npm run release:rc-audit:report -- --release-authority local --skip-github
```

If any signed Desktop artifact, notarization proof, Linux package, Desktop
checksum, evidence JSON, source sidecar, Web rollback evidence, Sync
backup/restore evidence, provenance, publish preflight, dogfood, or final RC
audit check is missing or stale, `full` remains No-Go.

## Go / No-Go Rules

`full` profile Go requires all of the following:

- Formal signed Desktop evidence for Windows, macOS, and Linux verifies.
- Web Admin release package and Web rollback evidence verify.
- Packaged Sync release and packaged Sync backup/restore evidence verify.
- SBOM, release checksums, provenance, local authority or GitHub authority, and
  publish preflight verify against the beta17 tag.
- Public Beta dogfood passes with no open P0/P1 findings.
- Final RC audit says `decision: "go"` with no blockers.

`desktop-local-unsigned` Go is narrower:

- It is local authority only.
- The unsigned Desktop report and checksum remain under `reports/handoff/`.
- `reports/release/desktop/` contains no public Desktop artifacts.
- Web Admin, Sync, SBOM, local authority, provenance, publish preflight,
  rollback, dogfood, and final RC audit all pass for the
  `desktop-local-unsigned` profile.

Any open P0/P1 finding, stale version/tag binding, missing rollback evidence,
missing dogfood evidence, dirty source outside allowed generated evidence, or
public Desktop artifact without formal signing evidence is No-Go.
