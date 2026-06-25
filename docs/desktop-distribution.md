# Desktop Distribution

JoeSSH Desktop Public Beta uses Tauri 2 with the public app identifier
`dev.atlasterm.joessh`. The release scripts are intentionally split so CI can
validate the shell without requiring signing credentials, while release machines
can build signed installers.

The public installer metadata contract lives in
`docs/desktop-release-metadata.json`. Public release readiness checks that the
metadata contract stays aligned with `tauri.conf.json`, covers Windows/macOS/Linux
targets, names the publisher/category/copyright, and documents the signing and
notarization evidence variables consumed by `release:desktop:package`.

## Build Commands

```bash
npm run qa:tauri
npm run release:desktop:build
npm run release:desktop:package
npm run release:desktop:verify-evidence
```

`qa:tauri` compiles the Tauri shell with `cargo build --release`. It does not
produce installers. `release:desktop:build` runs `tauri build` from the desktop
workspace and expects platform signing configuration to be available on the
release machine. `release:desktop:package` copies supported Tauri bundle
artifacts into `reports/release/desktop/`, writes `SHA256SUMS.txt`, writes
`release-evidence.json` with each artifact sha256, and writes
`release-evidence-SHA256SUMS.txt` for the evidence file itself from explicit
signing verification inputs. The npm release wrapper is fail-closed for the
public beta and requires Windows, macOS, and Linux artifacts to be present in
the staged bundle input before it writes release evidence.
`release:desktop:checksums` is kept as a compatibility alias for
`release:desktop:package`; it must not generate a desktop checksum manifest from
the raw Tauri bundle directory without release evidence. Public release
readiness also checks
`apps/desktop/src-tauri/capabilities/*.json` and
`apps/desktop/src-tauri/permissions/*.toml` so missing, wildcard, remote-source,
or stale IPC command permissions block the release.

## Desktop Artifact Workflow

Run the manual **Desktop Release Artifacts** GitHub Actions workflow to build
platform bundles on Windows, macOS, and Linux release runners. The default mode
uploads staging bundles only; staging bundles are not public release evidence and
must not be uploaded to a GitHub Release.

When `formal_evidence` is enabled, the workflow fails closed unless platform
verification succeeds first:

- Windows runs `signtool verify /pa /v` against the built installer and stores
  that output as the Windows signature evidence.
- macOS runs `codesign --verify --deep --strict` and `spctl --assess` against
  the built download and stores those outputs as signing and notarization
  evidence.
- The aggregation job downloads all three platform bundles, passes the captured
  verification output into `scripts/package-desktop-release.mjs`, requires
  `windows,macos,linux`, and then runs `release:desktop:verify-evidence`.

If any platform build, signature check, notarization assessment, checksum, or
evidence binding fails, the workflow does not produce
`desktop-release-evidence`.

When the macOS DMG bundler fails, the workflow uploads a
`desktop-macos-dmg-diagnostics` artifact with disk-image state, mounted volumes,
the bundle directory listing, and the generated `bundle_dmg.sh` content. Use
that artifact to distinguish a transient GitHub runner disk-image failure from a
bundle configuration regression before retrying formal evidence.

Formal Desktop evidence requires these GitHub Actions secrets:

- Windows: `ATLASTERM_WINDOWS_CERTIFICATE`,
  `ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD`,
  `ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT`, and
  `ATLASTERM_WINDOWS_TIMESTAMP_URL`.
- macOS: `ATLASTERM_APPLE_CERTIFICATE`,
  `ATLASTERM_APPLE_CERTIFICATE_PASSWORD`, `ATLASTERM_APPLE_ID`,
  `ATLASTERM_APPLE_PASSWORD`, `ATLASTERM_APPLE_TEAM_ID`, and
  `ATLASTERM_KEYCHAIN_PASSWORD`.

The Windows certificate must be a base64-encoded `.pfx`. The macOS certificate
must be a base64-encoded `.p12` with a Developer ID Application identity that can
be imported into the temporary CI keychain.

To set the required GitHub Actions secrets without exposing values in command
arguments or logs, provide the text values as environment variables and the raw
certificate files through `*_FILE` variables, then run:

```bash
export ATLASTERM_WINDOWS_CERTIFICATE_FILE=/secure/path/windows.pfx
export ATLASTERM_APPLE_CERTIFICATE_FILE=/secure/path/developer-id-application.p12
# Export the remaining password, thumbprint, timestamp, Apple ID, app password,
# team ID, and keychain password variables listed above.
npm run release:desktop:configure-secrets -- --repo JoeWorkspace/JoeSSH
```

`release:desktop:configure-secrets` accepts either each exact secret name or a
matching `*_FILE` variable. Certificate files are base64-encoded locally before
being sent to GitHub. Text `*_FILE` inputs have one trailing newline removed so
secrets copied from password manager files do not accidentally include the file
line ending. The script verifies the resulting secret names with the formal
evidence preflight before it exits.

Before triggering formal evidence, verify that the repository has the required
secret names and that the workflow is available:

```bash
npm run release:desktop:evidence-preflight -- --repo JoeWorkspace/JoeSSH
npm run release:desktop:evidence-workflow -- --repo JoeWorkspace/JoeSSH --ref v0.1.0-beta.11
```

The preflight checks GitHub CLI authentication, lists repository secret names
without reading secret values, verifies `.github/workflows/desktop-release-artifacts.yml`,
requires the requested release ref to resolve to the current healthy checkout
`HEAD`, requires that ref to be published to the canonical remote, and only
dispatches the workflow when all required signing and notarization secret names
exist.

When the release is still No-Go, generate a repeatable unblock report instead
of hand-assembling status notes:

```bash
npm run release:desktop:evidence-diagnostics -- --repo JoeWorkspace/JoeSSH
```

The diagnostics command writes
`reports/handoff/desktop/formal-evidence-unblock-report.json` without mutating
GitHub. It records the release tag/HEAD relationship, remote ref publication,
upstream divergence, staged Desktop artifacts, Windows Authenticode status when
available, formal evidence/source-sidecar coverage, missing signing secrets,
Desktop workflow visibility, latest workflow runs, and CI failure annotations
such as account billing/spending-limit messages. The report is handoff-only and
must not be copied into the final `reports/release/` upload tree.

After the formal workflow succeeds, import the `desktop-release-evidence`
artifact from that run into the release workspace:

```bash
npm run release:desktop:evidence-download -- --repo JoeWorkspace/JoeSSH --run-id <run-id>
```

The download step refuses ambiguous run selection, requires the run to match the
current release tag commit, requires the `Package Formal Desktop Evidence` job
to have passed, refuses expired artifacts, writes only under
`reports/release/desktop/`, and immediately runs
`release:desktop:verify-evidence` in formal source mode. It also writes
`reports/release/desktop/release-evidence-source.json`, recording the repository,
release ref, workflow run id, workflow id, run head SHA, and formal evidence job
status, then covers that sidecar in
`reports/release/desktop/release-evidence-SHA256SUMS.txt`. When a workflow run
fails before evidence can be imported, it includes failed job names and GitHub
check-run annotations, such as account billing/spending-limit failures, in the
error output.

## Local Or Self-Hosted Evidence

GitHub Actions is not mandatory for Public Beta publication. It is one supported
release authority. A controlled local or self-hosted release machine may produce
the same formal Desktop evidence when GitHub Actions billing, runner access, or
repository policy blocks workflow execution.

For this path, use the local diagnostics alias so the report focuses on missing
Desktop artifacts and local source evidence instead of GitHub remote refs,
secrets, or workflow runs:

```bash
npm run release:desktop:evidence-diagnostics:local
```

Local/self-hosted Desktop evidence still has the same artifact bar:

- Windows artifacts must be signed and include signature verification text.
- macOS artifacts must be signed, notarized, and include both verification
  outputs.
- Linux artifacts must record the package type.
- `reports/release/desktop/SHA256SUMS.txt` must cover every Desktop artifact.
- `reports/release/desktop/release-evidence.json` and
  `reports/release/desktop/release-evidence-source.json` must both be covered by
  `reports/release/desktop/release-evidence-SHA256SUMS.txt`.

For a local/self-hosted source sidecar, create the annotated release tag for the
healthy checkout, then collect signed and notarized platform artifacts into one
input directory outside the release workspace:

- `JoeSSH_<version>_*.exe`, `.msi`, or `.msix` for Windows.
- `JoeSSH_<version>_*.dmg`, `.pkg`, or `.app.tar.gz` for macOS.
- `JoeSSH_<version>_*.AppImage`, `.deb`, or `.rpm` for Linux.
- `windows-signature-verification.txt` for Windows signature verification.
- `macos-signature-verification.txt` for macOS code-sign verification.
- `macos-notarization-verification.txt` for macOS notarization verification.
- `desktop-formal-artifact-manifest.json` binding returned artifacts to the
  request, release tag commit, artifact SHA256 values, and source authority.

Generate a checksum-covered request before handing the job to external signing
machines, generate the returned manifest in the signed artifact directory, then
import the returned directory through the formal evidence wrapper:

```bash
npm run release:desktop:formal-artifacts:request -- --source-authority local
npm run release:desktop:formal-artifacts:kit -- --source-authority local
npm run release:desktop:formal-artifacts:kit:verify -- --source-authority local
npm run release:desktop:formal-artifacts:manifest -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:intake -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:preflight -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:formal-artifacts:import -- --input-dir <signed-artifact-dir> --source-authority local
npm run release:desktop:verify-evidence -- --require-source --require-current-git-source --require-source-authority local
```

The request command writes
`reports/handoff/desktop/formal-artifact-request.json` plus
`formal-artifact-request-SHA256SUMS.txt`, binding the release tag, Git commit,
required platforms, accepted artifact extensions, proof file names, proof text
rules, returned manifest contract, and the exact manifest/intake/preflight/import
commands. The kit command writes
`reports/handoff/desktop/desktop-formal-artifact-handoff-kit-<version>.zip` and
its SHA256 manifest so a signing machine receives the request, checksum,
operator commands, and returned-directory contract as one artifact. Verify the
kit before handoff so stale request JSON, stale source commits, broken checksum
coverage, or missing operator commands cannot leave the release machine. The manifest command hashes every Desktop artifact in
`<signed-artifact-dir>`, binds it to the current request ID and tagged source
commit, and refuses to overwrite an existing manifest unless `--force` is
explicit.

Use `--source-authority self-hosted` when the directory was produced by a
controlled self-hosted release runner. The wrapper rejects input directories
inside the release workspace, stale artifact versions, missing required
platforms, and missing proof files, and then runs `release:desktop:verify-evidence`
in formal local/self-hosted source mode. After import, rerun
`npm run release:desktop:verify-evidence -- --require-source
--require-current-git-source --require-source-authority local` or use
`self-hosted` for that authority so the staged evidence is bound to the current
tagged checkout and the authority that produced it. It writes
`reports/release/desktop/release-evidence-source.json` with
`sourceAuthority: "local"` or `"self-hosted"`, `sourceVersion: 1`,
`artifactName: "desktop-release-evidence"`, the release ref, the release tag
commit, a `source` object that records `gitCommit`, `releaseTagCommit`,
`cleanTreeExcluding: "reports/release"`, and `gitFsckStrict: true`, plus a
`formalEvidenceJob` object named `Package Formal Desktop Evidence` with
`status: "completed"`, `conclusion: "success"`, the packaging command, and
`artifactRoot: "reports/release/desktop"`.

The intake command is non-mutating handoff evidence. It writes
`reports/handoff/desktop/formal-artifact-input-report.json` plus
`formal-artifact-input-report-SHA256SUMS.txt`, listing detected platform
artifacts, proof files, missing platforms, stale versions, and proof text that
does not bind to both an artifact file name and SHA256 or does not show a
successful verification.

Generate the local publication authority with an allowed public release gate:

```bash
npm run release:local-authority -- --gate-command "npm run qa:release:public:fixture" --target "<operator-confirmed target>"
npm run release:provenance:local
npm run release:provenance:verify:local
npm run release:publish-preflight:local
npm run release:rc-audit:report -- --release-authority local --skip-github
```

`npm run release:local-authority` runs the selected gate and writes
profile-bound authority evidence and gate logs, for example
`reports/release/local-release-authority.full.json`,
`reports/release/local-release-authority.full-SHA256SUMS.txt`, and
`reports/release/local-release-authority/qa-release-public.full.log`. It also
updates the legacy `reports/release/local-release-authority.json` alias for old
handoffs, but verifiers prefer the profile-bound file. If a gate already ran
under an external runner, add `--gate-log <path> --reuse-gate-log` to wrap that
specific log without rerunning.

The local preflight still requires a healthy Git checkout, the release tag at
`HEAD`, clean source outside `reports/release/`, Desktop/Web/Sync artifacts,
SBOM, checksums, provenance, and formal Desktop source evidence. It only
replaces GitHub CLI release checks with profile-bound local authority
verification.

### Desktop Local Unsigned Profile

`desktop-local-unsigned` is local authority only. It is for local Desktop beta
staging and dogfood when Desktop signing is unavailable; it does not require
GitHub, does not require Desktop signing, and must not create public Desktop
release artifacts.

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

The unsigned Desktop staging report and checksum live only in
`reports/handoff/desktop/unsigned-staging-report.json` and
`reports/handoff/desktop/unsigned-staging-report-SHA256SUMS.txt`. Do not copy
them, or the unsigned Desktop build they describe, into
`reports/release/desktop/`, and do not attach them as public release artifacts.
Web Admin, Sync, SBOM, local authority, provenance, and publish-preflight
evidence still may be generated locally; the Desktop side of provenance binds
the handoff checksum instead of formal signed Desktop release evidence. The RC
audit report is profile-specific, for example
`reports/release/public-beta-rc-audit.local.desktop-local-unsigned.json`.

### Web/Sync-only Public Beta Profile

If a Public Beta candidate intentionally excludes public Desktop downloads, use
the explicit `web-sync-only` profile instead of weakening Desktop signing rules.
Desktop installers may remain in internal dogfood or handoff evidence under
`reports/handoff/desktop/`, but no Desktop artifact may be staged under
`reports/release/desktop/`.

```bash
npm run release:desktop:exclude-public
npm run release:local-authority -- --gate-command "npm run qa:release:public:web-sync-only:local" --target "<operator-confirmed target>"
npm run release:provenance:local:web-sync-only
npm run release:provenance:verify:local:web-sync-only
npm run release:publish-preflight:local:web-sync-only
npm run release:rc-audit:report -- --release-authority local --release-profile web-sync-only --skip-github
```

`release:desktop:exclude-public` writes
`reports/release/desktop-exclusion.json` plus
`reports/release/desktop-exclusion-SHA256SUMS.txt`. The verifier fails if
`reports/release/desktop/` contains any Desktop package. If a Desktop download
is added later, the candidate must return to the `full` profile and satisfy the
formal signed Desktop evidence gate.

## Signing And Platform Rules

- Windows: public installers must be code signed before upload.
- macOS: public downloads must be signed and notarized before upload; the
  notarization record is part of release evidence.
- Linux: publish at least one AppImage, deb, or rpm artifact and document runtime
  dependencies in release notes.
- The `full` profile still requires real signed Desktop artifacts and formal
  Desktop evidence. `desktop-local-unsigned` is only allowed because its Desktop
  build stays in local handoff evidence and is not a public release artifact.
- Every uploaded desktop artifact must appear in
  `reports/release/desktop/SHA256SUMS.txt`.
- Every uploaded desktop artifact must also appear in
  `reports/release/desktop/release-evidence.json`.
- Every release evidence entry must record the artifact sha256, and that value
  must match the returned `desktop-formal-artifact-manifest.json`, the manifest hash in
  `SHA256SUMS.txt`, and the actual file hash recomputed from disk by
  `release:desktop:verify-evidence`.
- `reports/release/desktop/release-evidence-SHA256SUMS.txt` must cover
  `reports/release/desktop/release-evidence.json` and
  `reports/release/desktop/release-evidence-source.json` before upload.
- `reports/release/desktop/release-evidence-source.json` must come from either
  `npm run release:desktop:evidence-download` for GitHub workflow evidence or a
  controlled local/self-hosted release machine sidecar. Publish preflight
  requires it to bind formal evidence to the exact authority that produced it.
- Windows evidence must record `signed: true` and a non-empty
  `signatureVerification` result. Local/self-hosted publication requires that
  proof to mention both the artifact file name and artifact sha256.
- macOS evidence must record `signed: true`, `notarized: true`, non-empty
  `signatureVerification`, and non-empty `notarizationVerification` results
  that mention both the artifact file name and artifact sha256 for
  local/self-hosted publication.
- Linux evidence must record the shipped `packageType`, such as `AppImage`,
  `deb`, or `rpm`.
- `release:desktop:package` requires
  `ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION` or
  `--windows-signature-verification` for Windows artifacts,
  `ATLASTERM_DESKTOP_MACOS_SIGNATURE_VERIFICATION` or
  `--macos-signature-verification` for macOS signing evidence, and
  `ATLASTERM_DESKTOP_MACOS_NOTARIZATION_VERIFICATION` or
  `--macos-notarization-verification` for macOS notarization evidence.

## Security Review Items

- Review the Tauri IPC surface before each public release: SSH connect/exec,
  pre-auth host-key probe, known-host list/remove/clear, SFTP list/read/write,
  port-forward start/stop, PTY open/write/resize/close, disconnect, and
  connection test.
- Review `apps/desktop/src-tauri/capabilities/main.json` before each public
  release. It must target only the local `main` window and list explicit
  `allow-*` permissions for every command in `tauri::generate_handler![...]`.
- Review `apps/desktop/src-tauri/permissions/app-commands.toml` with the
  capability file so each listed `allow-*` permission maps to the intended Rust
  command.
- Confirm Tauri CSP remains limited to self resources plus IPC.
- Confirm no remote URL source is granted local-system capability permissions.
- Confirm one-shot `ssh_exec` output remains capped at 1 MiB in the core SSH
  read loop, with Tauri returning a stable output-limit error rather than
  unbounded stdout.
- Confirm native Tauri `ssh_exec` runs the core command-safety blocklist before
  resolving the session, so a renderer or WebView compromise cannot bypass the
  local terminal safety preflight for block-level destructive commands.
- Confirm native Tauri `pty_write` applies the same line-level command-safety
  blocklist before forwarding submitted PTY input, including commands pasted or
  sent through direct renderer IPC. The xterm status bar must surface native
  `PTY_COMMAND_BLOCKED` rejections as an assertive visible alert while keeping
  the PTY session open for the next safe command.
- Confirm unknown hosts require a visible fingerprint confirmation before
  authentication, changed host keys are blocked, and confirmed fingerprints are
  persisted by the Tauri side in app data before reconnect. Renderer
  localStorage must not be authoritative for known-host pins.
- Confirm Settings can list native known-host pins with first/last seen metadata
  and remove a single stale host key without clearing every saved pin.
- Confirm SFTP upload/download warnings, the 25 MiB bounded SFTP transfer
  safety limit, and command-safety blocking at both UI and native IPC layers
  remain in the release notes and QA evidence. Downloads must enforce the cap
  before and during the remote read; uploads must reject oversized payloads
  before writing. Directory-listing entry names must be treated as untrusted
  single path segments and rejected for navigation or transfer if they are
  blank, `.`/`..`, contain POSIX/Windows separators, or contain control or
  Unicode format characters.

## Draft Release

After installers and checksums are present, run:

```bash
git tag -a v0.1.0-beta.11 -m "JoeSSH 0.1.0-beta.11"
npm run release:provenance
npm run release:provenance:verify
npm run release:publish-preflight
npm run release:desktop:draft
```

For local/self-hosted full-profile publication with formal Desktop evidence,
replace the final three commands with:

```bash
npm run release:local-authority -- --gate-command "npm run qa:release:public:fixture" --target "<operator-confirmed target>"
npm run release:provenance:local
npm run release:provenance:verify:local
npm run release:publish-preflight:local
npm run release:rc-audit:report -- --release-authority local --skip-github
```

The publish preflight verifies all Desktop/Web/Sync checksum manifests, Desktop
signing/notarization evidence for `full`, SBOM coverage, release provenance, a
healthy Git checkout, a clean working tree outside `reports/release/`, and a
release tag that points at `HEAD`. GitHub authority additionally checks GitHub
CLI availability/authentication, no existing GitHub Release for the same tag,
and the GitHub Release draft dry-run. Local/self-hosted authority additionally
checks `reports/release/local-release-authority.<profile>.json` with the legacy
`reports/release/local-release-authority.json` alias kept only for old handoffs. For
`desktop-local-unsigned`, use the earlier
`release:publish-preflight:local:desktop-local-unsigned` command set instead of
GitHub draft creation; unsigned Desktop builds must stay outside
`reports/release/`. The draft command then
requires `docs/release-notes/0.1.0-beta.11.md`, staged release artifacts under
`reports/release/`, fresh checksums, and complete desktop release evidence whose
artifact sha256 values match the checksum manifest and actual files, with
`release-evidence-SHA256SUMS.txt` binding the evidence JSON itself. Raw Tauri bundle outputs are inputs to
`release:desktop:package`; they are not GitHub Release upload sources.
