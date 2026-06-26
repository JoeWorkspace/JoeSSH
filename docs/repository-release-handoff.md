# Repository Release Handoff Playbook

This playbook is required whenever the current working directory cannot prove
healthy Git checkout metadata. It exists to keep the Public Beta release path
auditable even when a planning workspace has useful file changes but a damaged
`.git` directory.

The rule is simple: do not publish from the damaged workspace. Use the damaged
workspace only as a source of reviewed file content and verification notes.
Tagging, release notes diffs, CI evidence, SBOM generation, checksums, and any
GitHub or local/self-hosted publication preflight must happen from a healthy Git
checkout.

## When To Use This

Use this playbook if any of these commands fail in the release workspace:

```bash
git status --short
git rev-parse --is-inside-work-tree
git fsck --strict
```

For `0.1.0-beta.15`, the first public release target remains Desktop, Web Admin,
and the self-hosted Sync Service. Mobile device smoke stays a strict-release
route, not a blocker for the first Public Beta.

## Recovery Flow

1. Create or locate a healthy clone of the canonical JoeSSH repository.
2. In the damaged workspace, produce a reviewable patch bundle:

   ```bash
   git diff --binary > joessh-release-handoff.patch
   ```

   If Git metadata is too damaged to create a patch, copy only the reviewed
   working files into a separate staging directory and record the file list in
   the handoff notes. Do not copy `.git`.

3. In the healthy checkout, apply the reviewed changes, then run:

   ```bash
   git status --short
   git diff --check
   git fsck --strict
   ```

4. Run the local Public Beta gate in the healthy checkout:

   ```bash
   npm run qa:release:public
   # Windows release machine with local OpenSSH dogfood fixture:
   npm run qa:release:public:fixture
   node scripts/check-public-release-readiness.mjs
   ```

5. Build release artifacts in the healthy checkout or release machine:

   ```bash
   npm run release:web
   npm run release:sync
   npm run release:sbom
   npm run release:sbom:verify
   ```

   For the GitHub workflow path, collect the signed Windows, notarized macOS,
   and Linux package artifacts from the formal workflow, then run:

   ```bash
   npm run release:desktop:package
   ```

   For a local/self-hosted authority, keep the signed artifact directory outside
   the release workspace and do not import it until after the release tag points
   at `HEAD`.

6. Tag only after source QA is green and the healthy checkout is clean outside
   generated release artifacts:

   ```bash
   git status --short -- . ':(exclude)reports/release'
   git tag -a v0.1.0-beta.15 -m "JoeSSH 0.1.0-beta.15"
   ```

   For a local/self-hosted authority, import the external signed artifact
   directory after the tag is created. Generate the request first, generate the
   returned manifest in the signed artifact directory, then preflight the input
   so missing proof files or platform artifacts are caught before staging
   release evidence:

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

   The validate command is the preferred non-mutating final check. It generates
   the returned manifest when missing, reuses an existing manifest unless
   `--force-manifest` is provided, writes intake evidence, and runs import
   preflight before artifacts are copied into `reports/release/desktop`.
   The import command stages Desktop artifacts, writes formal source evidence,
   and verifies the evidence against the tagged healthy checkout. The explicit
   verify command repeats the source-authority and current-Git checks after the
   import has written `reports/release/desktop/`.
   The intake command writes
   `reports/handoff/desktop/formal-artifact-input-report.json` and its checksum
   manifest without copying artifacts into `reports/release/desktop`.
   The request command writes
   `reports/handoff/desktop/formal-artifact-request.json` and
   `formal-artifact-request-SHA256SUMS.txt` so the external signing directory
   can receive the checksum-covered
   `desktop-formal-artifact-handoff-kit-<version>.zip` and use the same proof filenames, generated
   `desktop-formal-artifact-manifest.json`, artifact SHA256 bindings, and
   platform contract as the importer. Verify the handoff kit before sending it
   to the signing machine so the zip, embedded request, checksum manifest,
   release tag commit, and operator command files are bound to the current
   checkout. Windows and macOS proof text must mention
   both the artifact file name and SHA256.

7. Generate provenance, run publish preflight, and draft or stage publication:

   ```bash
   npm run release:verify-checksums
   npm run release:provenance
   npm run release:provenance:verify
   npm run release:publish-preflight
   npm run release:desktop:draft
   ```

   For a local/self-hosted publication authority, replace the provenance and
   preflight commands with:

   ```bash
   npm run release:local-authority -- --gate-command "npm run qa:release:public:fixture" --target "<operator-confirmed target>"
   npm run release:provenance:local
   npm run release:provenance:verify:local
   npm run release:publish-preflight:local
   npm run release:rc-audit:report -- --release-authority local --skip-github
   ```

   `npm run release:local-authority` executes the selected public release gate
   and writes profile-bound authority evidence and logs, for example
   `reports/release/local-release-authority.full.json`,
   `reports/release/local-release-authority.full-SHA256SUMS.txt`, and
   `reports/release/local-release-authority/qa-release-public.full.log`. It also
   updates the legacy `reports/release/local-release-authority.json` alias for
   older handoffs, but verifiers prefer the profile-bound file. Only add
   `--gate-log <path> --reuse-gate-log` when that exact log was captured
   externally and must be wrapped after the fact.

   If the release scope is Web Admin + Sync only, first generate explicit
   Desktop exclusion evidence and use the `web-sync-only` variants:

   ```bash
   npm run release:desktop:exclude-public
   npm run release:local-authority -- --gate-command "npm run qa:release:public:web-sync-only:local" --target "<operator-confirmed target>"
   npm run release:provenance:local:web-sync-only
   npm run release:provenance:verify:local:web-sync-only
   npm run release:publish-preflight:local:web-sync-only
   npm run release:rc-audit:report -- --release-authority local --release-profile web-sync-only --skip-github
   ```

   This profile writes `reports/release/desktop-exclusion.json` and
   `reports/release/desktop-exclusion-SHA256SUMS.txt`. It is only valid when
   `reports/release/desktop/` contains no Desktop artifacts; unsigned Desktop
   staging remains handoff-only evidence.

   If the scope is local unsigned Desktop beta staging, use the
   `desktop-local-unsigned` profile. It is local authority only, requires no
   GitHub release or Desktop signing, and keeps the Desktop staging report and
   checksum under `reports/handoff/desktop/`:

   ```bash
   npm run release:desktop:build
   npm run release:desktop:unsigned-staging-report
   npm run release:desktop:unsigned-staging:verify
   npm run release:local-authority -- --release-profile desktop-local-unsigned --gate-command "npm run qa:release:public:desktop-local-unsigned:local" --target "<operator-confirmed local target>"
   npm run release:provenance:local:desktop-local-unsigned
   npm run release:provenance:verify:local:desktop-local-unsigned
   npm run release:publish-preflight:local:desktop-local-unsigned
   npm run release:rc-audit:report:desktop-local-unsigned
   ```

   This profile must not place Desktop artifacts, unsigned staging reports, or
   unsigned staging checksums under `reports/release/desktop/`. Web Admin, Sync,
   SBOM, local authority, provenance, and publish-preflight evidence still
   remain local release evidence under `reports/release/`; the Desktop evidence
   input is `reports/handoff/desktop/unsigned-staging-report-SHA256SUMS.txt`.
   The RC audit output is profile-specific, for example
   `reports/release/public-beta-rc-audit.local.desktop-local-unsigned.json`.

## Acceptance Evidence

Keep these outputs with the release handoff notes:

- `git status --short -- . ':(exclude)reports/release'` from the healthy
  checkout before tagging.
- `git fsck --strict` from the healthy checkout.
- `npm run qa:release:public` result.
- `npm run qa:release:public:fixture` result when the release machine is using
  the local OpenSSH dogfood fixture to supply `JOESSH_REAL_SSH_*` evidence.
- `npm run qa:release:public:web-sync-only:local` result when the release scope
  intentionally excludes public Desktop downloads.
- `npm run qa:release:public:desktop-local-unsigned:local` result when the
  release scope is local unsigned Desktop beta staging.
- `node scripts/check-public-release-readiness.mjs` result without
  `--allow-unhealthy-git`.
- For GitHub publication: `gh --version`, `gh auth status`, and the
  `gh release view v0.1.0-beta.15` not-found check from
  `npm run release:publish-preflight`.
- For local/self-hosted publication:
  `reports/release/local-release-authority.<profile>.json`,
  `reports/release/local-release-authority.<profile>-SHA256SUMS.txt`, and
  `npm run release:publish-preflight:local` plus
  `npm run release:rc-audit:report -- --release-authority local --skip-github`
  output.
- For `web-sync-only` publication:
  `reports/release/desktop-exclusion.json`,
  `reports/release/desktop-exclusion-SHA256SUMS.txt`,
  `npm run release:publish-preflight:local:web-sync-only`, and
  `npm run release:rc-audit:report -- --release-authority local --release-profile web-sync-only --skip-github`
  output.
- For `desktop-local-unsigned` local authority:
  `reports/handoff/desktop/unsigned-staging-report.json`,
  `reports/handoff/desktop/unsigned-staging-report-SHA256SUMS.txt`,
  `npm run release:publish-preflight:local:desktop-local-unsigned`, and
  `reports/release/public-beta-rc-audit.local.desktop-local-unsigned.json`.
- `reports/release/**/SHA256SUMS.txt`.
- For the `full` profile or any public Desktop download:
  `reports/release/desktop/release-evidence.json`,
  `reports/release/desktop/release-evidence-source.json`, and
  `reports/release/desktop/release-evidence-SHA256SUMS.txt`.
- `reports/handoff/desktop/formal-evidence-unblock-report.json` while the
  candidate is No-Go on Desktop formal evidence. This handoff-only diagnostic
  report is not a release upload artifact.
- `reports/release/SBOM-SHA256SUMS.txt`.
- `reports/release/release-provenance.json`.
- `reports/release/release-provenance-SHA256SUMS.txt`.
- GitHub Release draft URL or local/self-hosted publication target identifier,
  plus the tag commit SHA.

## Failure Rules

- If `git status --short` is not empty at draft time, stop.
- If `git fsck --strict` fails, stop.
- If `node scripts/check-public-release-readiness.mjs` requires
  `--allow-unhealthy-git` in the healthy checkout, stop.
- If a release artifact is not listed in a `SHA256SUMS.txt` manifest, stop.
- If release provenance does not verify against the tag, lockfiles, release
  notes, staged manifests, and artifacts, stop.
- If Windows signing, macOS signing/notarization, or Linux package evidence is
  missing for a public Desktop artifact, stop.
