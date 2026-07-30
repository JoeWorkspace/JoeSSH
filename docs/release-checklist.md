# JoeSSH Public Beta Release Checklist

This checklist defines the public beta bar for `0.1.0-beta.9`. The first public
release includes Desktop, Web Admin, and the self-hosted Sync Service. Mobile
native apps stay in preflight/device-smoke validation until a later beta.

## Required Before Publishing

- When switching the repository to public, immediately enable GitHub Private
  Vulnerability Reporting, subscribe the maintainer to Security alerts, and
  verify in a signed-out browser that the `Report a vulnerability` form is
  reachable. Do not announce or distribute the release while the private
  reporting route in `SECURITY.md` and both `security.txt` files is unavailable.
- Configure public-repository branch protection or a ruleset for `main` that
  requires the CI release-readiness checks and blocks force pushes and branch
  deletion. While JoeSSH has one maintainer, do not require a separate
  CODEOWNER approval that the maintainer cannot provide.
- Keep repository auto-merge and the
  `JOESSH_DEPENDABOT_AUTO_MERGE_ENABLED` repository variable disabled until
  those `main` protections are active. Enable both only after a test Dependabot
  pull request proves that required checks block the merge until they pass.
- Work from a healthy Git checkout: `git status`, `git diff`, tags, and CI
  metadata must work. Do not publish from a workspace with missing `.git`
  metadata.
- If the planning workspace has damaged `.git` metadata, follow
  `docs/repository-release-handoff.md` and move reviewed changes into a healthy
  checkout before running any release, tag, checksum, or GitHub draft step.
- Confirm the release version is aligned across root package metadata, Desktop,
  Web Admin, Mobile metadata, Tauri, and Sync Service Cargo metadata.
- Update `CHANGELOG.md` with the `0.1.0-beta.9` section.
- Update `docs/release-notes/0.1.0-beta.9.md`; the GitHub Release draft uses
  this versioned notes file, not the release checklist.
- Run `npm run qa:release:public` on a clean release machine. On Windows
  release machines that use the local OpenSSH dogfood fixture, run
  `npm run qa:release:public:fixture`; it starts the fixture, writes Desktop
  real SSH smoke evidence, then runs the full public gate with the same real SSH
  environment.
  The root QA portion uses `npm run qa:e2e:fresh` so release-machine E2E
  starts local web, desktop, mobile companion, and mock services on freshly
  allocated ports instead of reusing stale servers.
- Confirm the release machine has `cargo-audit` installed, then run
  `npm run qa:rust-advisory` or rely on `npm run qa:release:public` to run the
  RustSec advisory gate.
- Run `npm run release:sbom` and retain generated SBOM files under
  `reports/release/`.
- Run `npm run release:sbom:verify`; it verifies CycloneDX SBOM structure,
  Cargo metadata structure, required Rust/Tauri workspace packages, required
  third-party dependency packages, and `reports/release/SBOM-SHA256SUMS.txt`
  coverage for every generated SBOM/metadata file.
- Build release artifacts and generate per-artifact `SHA256` checksum files
  before uploading.
- Run `npm run release:web` and confirm the GitHub Release includes
  `reports/release/web/joessh-web-admin-0.1.0-beta.9.zip`, not only a checksum
  manifest for unpackaged `dist` files. The Web package self-test must keep
  `--output` and `--checksum` writes inside the repository root.
- Run `node scripts/verify-web-release-package.mjs` or rely on
  `npm run release:publish-preflight` to verify the staged Web Admin zip before
  upload. The verifier opens the zip, checks required deployment files and
  `_headers`, confirms the manifest describes the JoeSSH Admin root app, and
  scans packaged text assets for token or high-entropy credential leaks.
- Run `npm run qa:sync-release-package` before the slower packaged Sync smoke
  so stale staged Sync binaries, missing current-platform checksums, or
  accidental deletion of Sync evidence files are caught early.
- Run `npm run qa:sync:release-backup-restore-smoke` before publish preflight
  so the staged Sync release binary has backup/restore evidence recording its
  path, sha256, and checksum manifest.
- Run `npm run release:desktop:package` after collecting signed Tauri bundle
  artifacts so Desktop artifacts are staged under `reports/release/desktop/`
  with `SHA256SUMS.txt`, `release-evidence.json`, and
  `release-evidence-SHA256SUMS.txt`. The public release wrapper requires
  Windows, macOS, and Linux artifacts by default; aggregate platform build
  outputs first, then run the package step once.
- Run `npm run release:verify-checksums` before drafting the GitHub Release so
  stale or incomplete checksum manifests fail before upload. The command
  discovers every staged `reports/release/**/SHA256SUMS.txt` manifest, including
  evidence and smoke-test manifests added after the core Desktop/Web/Sync/SBOM
  outputs.
- Run `npm run release:desktop:verify-evidence` before drafting the GitHub
  Release so unsigned Windows artifacts, unnotarized macOS artifacts, missing
  Linux package evidence, or artifacts absent from
  `reports/release/desktop/release-evidence.json` fail before upload.
  This verifier also recomputes each artifact hash from disk and requires the
  evidence artifact sha256 to match the manifest hash in
  `reports/release/desktop/SHA256SUMS.txt`; it also requires
  `reports/release/desktop/release-evidence-SHA256SUMS.txt` to cover the
  evidence JSON itself. `npm run release:publish-preflight` and the GitHub
  Release draft path run the same verifier with formal source mode, requiring
  `reports/release/desktop/release-evidence-source.json` to be covered by the
  evidence checksum manifest and to bind the evidence to the GitHub workflow run
  and `Package Formal Desktop Evidence` job that produced it.
- When Desktop formal evidence is not yet Go, run
  `npm run release:desktop:evidence-diagnostics -- --repo JoeWorkspace/JoeSSH`
  and keep `reports/handoff/desktop/formal-evidence-unblock-report.json` with
  the release handoff. The report is non-mutating and records missing Desktop
  artifacts/evidence, signing-secret names, workflow visibility, CI annotations,
  remote ref publication, upstream divergence, and the release tag/HEAD
  relationship. It is handoff-only local evidence, not a release upload
  artifact.
- After the Desktop Release Artifacts workflow succeeds, import the
  `desktop-release-evidence` artifact with
  `npm run release:desktop:evidence-download -- --repo JoeWorkspace/JoeSSH --run-id <run-id>`
  so the formal evidence source sidecar records the exact workflow run and
  `Package Formal Desktop Evidence` job.
- Create the annotated release tag only after source QA is green and release
  artifacts are staged. `reports/release/` is generated release evidence and is
  allowed to be present while the source tree outside that directory remains
  clean.
- Run `npm run release:provenance` after the annotated tag exists and staged
  Desktop, Web Admin, Sync, SBOM, and evidence manifests are complete. It writes
  `reports/release/release-provenance.json` plus
  `reports/release/release-provenance-SHA256SUMS.txt`, binding the release tag,
  commit, `git fsck --strict` result, release notes hash, lockfile hashes,
  toolchain versions, and the fixed Public Beta checksum manifest set: SBOM,
  Desktop artifacts, Desktop evidence, Sync binary, Sync backup/restore
  evidence, and Web Admin package. The Desktop evidence manifest must include
  `reports/release/desktop/release-evidence-source.json` before provenance is
  generated. Do not generate provenance from a damaged `.git` planning
  workspace.
- Run `npm run release:provenance:verify` before drafting so stale provenance,
  changed lockfiles, changed release notes, stale manifests, changed artifacts,
  or tag drift fail before upload.
- Run `npm run release:publish-preflight` after Desktop, Web Admin, Sync, and
  SBOM artifacts are present. This is the release-machine gate that verifies all
  staged checksum manifests, the Web Admin release zip contents, Desktop
  signing/notarization evidence, SBOM coverage, release provenance, the healthy
  Git checkout, clean working tree outside `reports/release/`, release tag
  pointing at `HEAD`, GitHub CLI availability/authentication, absence of an
  existing GitHub Release for the same tag, and the GitHub Release draft dry-run
  before upload. The draft dry-run
  rejects any staged file that would be uploaded from `reports/release/` unless that file is
  listed in a `SHA256SUMS.txt` manifest; checksum manifests themselves are the
  only upload files exempt from checksum coverage. Raw Tauri bundle outputs must
  be packaged into `reports/release/desktop/` before drafting and are not upload
  sources.
- Confirm `npm run qa:prod-audit` is clean: high-severity audit findings must
  be absent, and accepted moderate findings must be recorded in
  `docs/dependency-risk-register.md` with their runtime scope and follow-up.
- Confirm Public Beta telemetry remains opt-in: app shells must not install
  error-report transport unless `*_ATLASTERM_TELEMETRY_OPT_IN` is explicitly
  enabled after user consent.
- Confirm runtime telemetry disable remains release-gated: error-monitor must
  expose a runtime off/consent-revocation path that clears queued reports,
  short-circuits new transport, and revokes installed listeners/timers through
  install cleanup; Desktop and Web Admin shells must have matching runtime
  consent tests.

## Desktop Artifact Checks

- Windows public downloads must be signed before upload.
- macOS public downloads must be notarized before upload.
- Linux downloads must include at least one AppImage, deb, or rpm artifact.
- `reports/release/desktop/SHA256SUMS.txt` must include every uploaded desktop
  artifact.
- `reports/release/desktop/release-evidence.json` must include every uploaded
  desktop artifact and record Windows signing, macOS signing/notarization, and
  Linux package-type evidence.
- Each Desktop evidence entry must record the artifact sha256. The value must
  match both the manifest hash and the actual file hash, and Windows/macOS
  signing or notarization text must mention the artifact path, file name, or
  artifact sha256.
- `reports/release/desktop/release-evidence-SHA256SUMS.txt` must cover the
  release evidence file itself and
  `reports/release/desktop/release-evidence-source.json`.
- Install on a clean machine and verify Connect, unknown-host fingerprint
  confirmation before authentication, changed-host-key blocking, per-host known
  host removal, exec, PTY, SFTP list/read/write, port forwarding, and
  disconnect.
- Confirm the automated Desktop real SSH dogfood job passes in CI:
  `npm run qa:desktop:real-ssh-smoke` must run with
  `JOESSH_REAL_SSH_SMOKE=1` against a loopback OpenSSH fixture and cover
  host-key probe, pinned trust, password authentication, exec, PTY, SFTP
  list/download/upload/overwrite, local forwarding, and forward shutdown.
- Public Beta release-machine QA must use
  `npm run qa:desktop:real-ssh-smoke:required` through
  `npm run qa:release:public`; missing `JOESSH_REAL_SSH_*` fixture variables are
  a No-Go and must not be counted as a skipped dogfood pass.
- The fixture must provide exactly one auth source:
  `JOESSH_REAL_SSH_PASSWORD`, `JOESSH_REAL_SSH_PRIVATE_KEY_PEM`, or
  `JOESSH_REAL_SSH_PRIVATE_KEY_PATH`; optional command overrides may adapt the
  exec/PTTY markers to POSIX or Windows OpenSSH shells.
- On Windows release machines, `npm run qa:desktop:real-ssh-smoke:fixture`
  starts a temporary local OpenSSH fixture, runs the required real SSH smoke,
  and writes `reports/smoke/desktop/real-ssh-smoke.json` plus its checksum
  manifest for dogfood evidence.

## Web And Sync Checks

- Web Admin static output must pass SRI, security-header, bundle-size, and
  Lighthouse gates. Run `npm run qa:lighthouse` on the release machine; it
  rebuilds Web Admin, serves `apps/web/dist` with deployment headers, audits an
  explicit `?adminSnapshot=fixture` route for deterministic performance and
  accessibility evidence, enforces Lighthouse thresholds, fails on Lighthouse
  run warnings, and writes `reports/lighthouse/web-admin.json`. The live
  same-origin proxy path remains covered by
  `npm run qa:web-admin-sync-topology-release-smoke`.
- Web Admin same-origin admin snapshot proxy smoke must pass with
  `npm run qa:web-admin-proxy-smoke`; browser bundles must not receive admin
  snapshot bearer tokens, and the proxy must reject oversized upstream snapshot
  bodies through its configured byte cap before forwarding.
- Web Admin browser bundles must pass `npm run qa:web-admin-bundle-token-scan`
  before release; this rebuilds Web Admin and rejects legacy admin snapshot auth
  env names, JoeSSH token environment variable names, bearer token literals,
  sentinel token values, and high-entropy credential literals in `apps/web/dist`.
- Web Admin + self-hosted Sync release topology smoke must pass with
  `npm run qa:web-admin-sync-topology-release-smoke`; it serves release-like Web
  Admin `dist`, packages and verifies the staged Sync release binary, routes
  `/api/admin/snapshot` through the production Node proxy, and verifies real
  Sync admin auth, scoped CORS, empty snapshot, populated snapshot after real
  register/push API writes, browser Authorization replacement, and bad
  admin-token error handling.
- Web Admin admin snapshot proxy must remain loopback-bound unless an
  authenticating reverse proxy is explicitly placed in front of it with
  `ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1`.
- Sync self-hosting smoke must pass against a real local service:
  `npm run qa:sync:self-hosted-smoke`.
- Sync release package hygiene must pass before packaged-service smoke:
  `npm run qa:sync-release-package`.
- Sync release-package smoke must pass against the packaged binary:
  `npm run qa:sync:release-smoke`.
- Sync packaged backup/restore smoke must pass and bind evidence to the staged
  release binary path, sha256, and checksum manifest:
  `npm run qa:sync:release-backup-restore-smoke`.
- The non-packaged `npm run qa:sync:backup-restore-smoke` is a local service
  drill and must not overwrite or replace packaged release evidence.
- Sync config guard smoke must pass:
  `npm run qa:sync:config-guard-smoke`.
- Sync local backup/restore smoke must pass and produce operational drill
  evidence without being treated as the packaged release binary evidence:
  `reports/smoke/sync/backup-restore-smoke.json` plus
  `reports/smoke/sync/backup-restore-smoke-SHA256SUMS.txt`:
  `npm run qa:sync:backup-restore-smoke`.
- Deployment docs must mention `_headers`, CSP, admin snapshot URL, bearer token
  configuration, cache behavior, and rollback.
- Sync deployments must set unique sync/admin tokens, CORS origins, storage path,
  rate limit, pull page limit, and JSON ledger quotas.
- Sync operators must confirm the JSON ledger backup RPO and RTO for the target
  host before exposing a self-hosted deployment.
- Sync JSON ledgers must be on `schema_version: 1`; legacy v0 ledgers without a
  version field may migrate forward, but future schema versions must fail
  startup before release traffic is routed.
- Sync JSON ledgers must be protected by `ledger.lock`; do not run multiple
  service instances against one ledger path.

## Release Draft And Rollback

- Create the GitHub Release as a draft first with `npm run release:desktop:draft`.
  The draft script requires Desktop, Web Admin, and Sync `SHA256SUMS.txt`
  manifests, a clean Git working tree outside `reports/release/`, a
  `v0.1.0-beta.9` tag pointing at `HEAD`, authenticated GitHub CLI state, no
  existing GitHub Release with that tag, the versioned release notes file, and verifies all
  staged `reports/release/**/SHA256SUMS.txt` files before invoking
  `gh release create`.
- `npm run release:publish-preflight` must pass before
  `npm run release:desktop:draft`; it wraps the real checksum verifier, Desktop
  release evidence verifier, SBOM verifier, and draft dry-run so missing
  artifacts or stale artifact sha256 bindings or signing evidence do not
  masquerade as release readiness.
- The draft script also supports `--dry-run` for release-machine preflight and
  CI fixture tests; dry-run still verifies required manifests and hashes without
  requiring GitHub CLI access.
- The draft script verifies desktop release evidence before invoking GitHub CLI,
  so a draft cannot be created from unchecked platform artifacts.
- The draft script also verifies release SBOM files and
  `reports/release/SBOM-SHA256SUMS.txt`, so Rust/Tauri dependency inventory
  artifacts include third-party packages and are present before upload.
- Attach installers, Web Admin static package if used, Sync Service package,
  SBOM, and the relevant `SHA256SUMS.txt` files.
- Verify downloads from the draft by checksum before publishing.
- Rollback means unpublishing the broken draft/release and restoring the prior
  signed artifacts and deployment bundle. Keep the previous release artifact
  checksums visible until the new release has soaked successfully.
