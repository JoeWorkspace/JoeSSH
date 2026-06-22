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

Before triggering formal evidence, verify that the repository has the required
secret names and that the workflow is available:

```bash
npm run release:desktop:evidence-preflight -- --repo JoeWorkspace/JoeSSH
npm run release:desktop:evidence-workflow -- --repo JoeWorkspace/JoeSSH --ref v0.1.0-beta.1
```

The preflight checks GitHub CLI authentication, lists repository secret names
without reading secret values, verifies `.github/workflows/desktop-release-artifacts.yml`,
and only dispatches the workflow when all required signing and notarization
secret names exist.

After the formal workflow succeeds, import the `desktop-release-evidence`
artifact from that run into the release workspace:

```bash
npm run release:desktop:evidence-download -- --repo JoeWorkspace/JoeSSH --run-id <run-id>
```

The download step refuses ambiguous run selection, requires the run to match the
current release tag commit, requires the `Package Formal Desktop Evidence` job
to have passed, refuses expired artifacts, writes only under
`reports/release/desktop/`, and immediately runs
`release:desktop:verify-evidence`.

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
  `reports/release/desktop/release-evidence.json` before upload.
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
git tag -a v0.1.0-beta.1 -m "JoeSSH 0.1.0-beta.1"
npm run release:provenance
npm run release:provenance:verify
npm run release:publish-preflight
npm run release:desktop:draft
```

The publish preflight verifies all Desktop/Web/Sync checksum manifests, Desktop
signing/notarization evidence, SBOM coverage, release provenance, a healthy Git
checkout, a clean working tree outside `reports/release/`, a release tag that
points at `HEAD`, GitHub CLI availability/authentication, no existing GitHub
Release for the same tag, and the GitHub Release draft dry-run. The draft
command then requires `docs/release-notes/0.1.0-beta.1.md`, staged release artifacts under
`reports/release/`, fresh checksums, and complete desktop release evidence whose
artifact sha256 values match the checksum manifest and actual files, with
`release-evidence-SHA256SUMS.txt` binding the evidence JSON itself. Raw Tauri bundle outputs are inputs to
`release:desktop:package`; they are not GitHub Release upload sources.
