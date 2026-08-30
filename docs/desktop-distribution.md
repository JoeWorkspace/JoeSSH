# Desktop Distribution

JoeSSH Desktop Public Beta uses Tauri 2 with the public app identifier
`dev.atlasterm.joessh`. The repository workflow builds reviewable unsigned
staging bundles. Public installers still require a separate, approved signing
and notarization boundary before they can be distributed.

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
workspace; the current repository workflow invokes it without signing
configuration and treats every output as unsigned. `release:desktop:package`
copies supported Tauri bundle
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

## Current automation status: unsigned staging only

**Automated formal signing is paused.** It remains paused until an
**isolated signing principal** exists outside the repository build job. The
principal must have a separate identity and approval boundary, accept only
hash-bound outputs from an unprivileged builder, and have no ability to check
out or execute repository source.

The manual **Desktop Release Artifacts** workflow in
`.github/workflows/desktop-release-artifacts.yml` retains the
`formal_evidence` input for compatibility. Its first fixed
`ubuntu-24.04` policy job rejects `formal_evidence=true` before checkout with
the stable marker `FORMAL_SIGNING_DISABLED`. With `formal_evidence=false`, the
following fixed Windows, macOS, and Linux matrix generates only:

- `desktop-unsigned-bundle-windows`
- `desktop-unsigned-bundle-macos`
- `desktop-unsigned-bundle-linux`

These are **unsigned staging** artifacts for installation smoke tests and review.
They are not public release artifacts, formal evidence, or inputs that may be
attached to a GitHub Release. The workflow has no protected environment,
`id-token` permission, GitHub signing secret, signing/notarization step, or
formal-evidence aggregation job.

Retired formal configurator and preflight entry points are fail-closed
compatibility guards, not credential inventory or signer setup tools. The only
configuration action creates a local gitignored template with no secret fields;
historical evidence download/verifiers remain for independently produced
external evidence. Running them cannot bypass `FORMAL_SIGNING_DISABLED`, and
the current workflow never creates `desktop-release-evidence` or a
`Package Formal Desktop Evidence` job.

## Desktop Artifact Workflow

Dispatch `Desktop Release Artifacts` only with `formal_evidence=false`. The
policy job validates the disabled-formal boundary and the requested retention
period before the build matrix starts. The matrix uses `windows-2025`,
`macos-15` on arm64, and `ubuntu-24.04` on x86_64. It also pins Node.js
`22.22.2`, npm `10.9.7`, Rust `1.96.0`, every action to a full commit SHA, and
checkout to the dispatched commit with persisted Git credentials disabled.

Each matrix leg:

1. verifies the runner architecture before checkout;
2. installs exact reviewed toolchains and locked npm dependencies;
3. runs `npm run release:desktop:legal-resource` before packaging;
4. runs `npm run release:desktop:build` without signing credentials; and
5. uploads only the platform-specific `desktop-unsigned-bundle-*` artifact,
   including the generated legal-resource sidecars.

There is no formal aggregate job. A workflow success proves only that the
unsigned packages were produced on the reviewed runners; it does not prove
publisher identity, Windows Authenticode, Apple Developer ID signing,
notarization, or suitability for public distribution.

### Required future isolated signing boundary

Automated formal signing may be restored only after a reviewed design provides
all of these independent stages:

1. An unprivileged builder checks out the exact commit, generates legal
   resources, builds unsigned platform bundles, and emits a hash-bound handoff.
2. An isolated signing principal receives only the reviewed artifacts and their
   hashes. It cannot check out source, install repository dependencies, or run
   repository build scripts. Its certificate/notarization credentials require a
   separate approval and are unavailable to the build job.
3. An independent verifier validates Windows signer identity and timestamp,
   macOS Developer ID identity, stapled notarization and Gatekeeper assessment,
   Linux package metadata, checksums, source commit, and signer output before
   formal evidence can be assembled.

Do not re-add `environment`, `id-token`, `secrets.*`, certificate import,
`signtool`, `codesign`, or `notarytool` access to the repository build matrix.
Do not rename unsigned outputs so they resemble formal evidence.

### Offline signing and evidence tools

Repository-managed formal signing automation is disabled. The package exposes
no command that writes GitHub secrets, inventories a signing environment, or
dispatches a formal-signing workflow. Direct use of the retired configurator
without its template-only option, or of the compatibility preflight guard,
fails closed with `FORMAL_SIGNING_DISABLED` before reading local inputs or
calling GitHub.

The only retained configurator action creates an offline, local, gitignored,
non-secret handoff template:

```bash
npm run release:desktop:secret-template
```

It writes
`reports/handoff/desktop/external-signer-input-template.env`. Never source,
import, upload, copy, or pass this file to GitHub, and never put certificates,
passwords, tokens, private keys, or signing identities in it. Any future formal
release requires separate approval and an externally managed isolated signer
whose credential store is outside this repository and every GitHub
environment.

Use the non-mutating diagnostics command to record the current No-Go state:

```bash
npm run release:desktop:evidence-diagnostics -- --repo JoeWorkspace/JoeSSH
```

It writes
`reports/handoff/desktop/formal-evidence-unblock-report.json` with release-ref,
artifact, workflow visibility, disabled-boundary, and CI status. This is a
handoff report, not a public release artifact.

The download and verification tools retain only the historical/external
evidence contract for an artifact named `desktop-release-evidence`, a successful
`Package Formal Desktop Evidence` job, and these files:

- `reports/release/desktop/release-evidence-source.json`
- `reports/release/desktop/release-evidence-SHA256SUMS.txt`

Their presence supports independent review of already-produced external
evidence. It does not provide a runnable signing, credential, or workflow chain.

The current workflow cannot satisfy that contract. Use those tools only after an
isolated signing pipeline has been separately reviewed and has produced
equivalent hash-bound evidence.

## Signing And Platform Rules

- Windows: public installers must be code signed before upload.
- macOS: public downloads must be signed and notarized before upload; the
  notarization record is part of release evidence.
- Linux: publish at least one AppImage, deb, or rpm artifact and document runtime
  dependencies in release notes.
- Every uploaded desktop artifact must appear in
  `reports/release/desktop/SHA256SUMS.txt`.
- Every uploaded desktop artifact must also appear in
  `reports/release/desktop/release-evidence.json`.
- Every release evidence entry must record the artifact sha256, and that value
  must match both the manifest hash in `SHA256SUMS.txt` and the actual file
  hash recomputed from disk by `release:desktop:verify-evidence`.
- `reports/release/desktop/release-evidence-SHA256SUMS.txt` must cover
  `reports/release/desktop/release-evidence.json` and
  `reports/release/desktop/release-evidence-source.json` before upload.
- `reports/release/desktop/release-evidence-source.json` must come from
  `npm run release:desktop:evidence-download`; publish preflight and release
  draft verification require it to bind formal evidence to the GitHub workflow
  run that produced it.
- Windows evidence must record `signed: true` and a non-empty
  `signatureVerification` result that mentions the artifact path, file name, or
  artifact sha256.
- macOS evidence must record `signed: true`, `notarized: true`, non-empty
  `signatureVerification`, and non-empty `notarizationVerification` results
  that mention the artifact path, file name, or artifact sha256.
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
FULL_RELEASE_VERSION="<DISTINCT_UNUSED_VERSION_AFTER_BETA_23>" # replace before running
git tag -a "v${FULL_RELEASE_VERSION}" -m "JoeSSH ${FULL_RELEASE_VERSION}"
npm run release:provenance
npm run release:provenance:verify
npm run release:publish-preflight
npm run release:desktop:draft
```

`0.1.0-beta.20` and beta.21 are permanent zero-asset source prereleases, and
beta.22 keeps the same GitHub zero-asset boundary while reserving its binary
solely for Partner Center. The beta.23 MSIX `1.1.23.0` attempt is superseded.
The beta.24 maintenance candidate preserves the boundary with a new MSIX
`1.1.24.0`. None of these versions may use this full-release flow. Bump every
version surface first and use a distinct unused version after beta.24.
The publish preflight verifies all Desktop/Web/Sync checksum manifests, Desktop
signing/notarization evidence, SBOM coverage, release provenance, a healthy Git
checkout, a clean working tree outside `reports/release/`, a release tag that
points at `HEAD`, GitHub CLI availability/authentication, no existing GitHub
Release for the same tag, and the GitHub Release draft dry-run. The draft
command then requires `docs/release-notes/<FULL_RELEASE_VERSION>.md`, staged release artifacts under
`reports/release/`, fresh checksums, and complete desktop release evidence whose
artifact sha256 values match the checksum manifest and actual files, with
`release-evidence-SHA256SUMS.txt` binding the evidence JSON itself. Raw Tauri bundle outputs are inputs to
`release:desktop:package`; they are not GitHub Release upload sources.
