# Desktop Distribution

Contributor guidance is in [AGENTS.md](../AGENTS.md). The
[unsigned-candidate workflow](../.github/workflows/desktop-candidates.yml) resolves
the requested source ref once in its source gate, then checks out that exact
commit in every platform job. Moving a branch during a build cannot substitute
untested source. Candidate artifacts remain unsigned and are not release proof;
the release evidence and signing requirements below still apply.

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

For unsigned cross-platform installation candidates, manually run the
`Desktop Unsigned Candidates` GitHub Actions workflow. It builds Windows,
macOS, and Linux bundles, stages each platform under
`reports/candidates/desktop/<platform>-unsigned/`, and uploads artifacts named
`joessh-<platform>-unsigned-candidate`. Candidate metadata always records
`releaseEligible: false` and `signingStatus: "unverified"`. These artifacts are
for installation QA only and must never be attached to a public release. The
workflow captures `git rev-parse HEAD`, records that exact checkout in the
metadata, and runs the candidate verifier before upload.

Local staging with `scripts/stage-desktop-candidate.mjs --platform <platform>`
uses the same default output directory. A custom `--output-dir` must be a
strict child of `reports/candidates/desktop`, such as
`reports/candidates/desktop/windows-preview`. Bundle and output paths must remain
inside the repository after path resolution; symbolic links and junctions in
their path components are rejected. The stager accepts an absent or empty output
directory, or replaces files from an existing candidate only after its metadata,
complete file set, sizes, and checksums verify. Extra files, modified artifacts,
or an unrelated directory cause staging to stop without deleting their contents.
Preserve or move those contents before retrying. Staging never recursively
deletes the output directory, and rejects duplicate input filenames before
replacing any existing candidate files.

After downloading and extracting a candidate, verify its self-contained
metadata, complete file set, sizes, and SHA-256 hashes from any directory. Pass
the commit shown by the workflow run to bind the files to the expected source:

```bash
npm run release:desktop:verify-candidate -- \
  --standalone \
  --candidate-dir path/to/joessh-windows-unsigned-candidate \
  --platform windows \
  --source-commit 0123456789abcdef0123456789abcdef01234567
```

Omit `--standalone` on a build machine so the verifier also requires the
candidate version to match the checked-out root package and Tauri metadata.

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

Windows MSI metadata uses `bundle.windows.wix.version: 0.1.0.1` for the public
beta because WiX/MSI cannot encode the semantic prerelease label in
`0.1.0-beta.1`. Increment the fourth MSI field with the beta sequence while
keeping the application version and public artifact version semantic. The WiX
upgrade code is pinned in `tauri.conf.json`; it must stay unchanged across
updates so Windows upgrades the existing JoeSSH installation instead of
creating a second product.

The editable JoeSSH app-icon source is
`apps/desktop/src-tauri/icons/joessh-icon-source.svg`. Regenerate the complete
Tauri platform icon set after changing it with:

```bash
npm exec --workspace @atlasterm/desktop tauri icon -- apps/desktop/src-tauri/icons/joessh-icon-source.svg --output apps/desktop/src-tauri/icons
```

The bundle config must continue to name `icon.png`, `icon.ico`, and `icon.icns`;
public readiness checks both the configuration and the files on disk.

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

### Cost-Aware Signing Decision

- For a fully open-source Windows community build, apply to SignPath Foundation
  first. Its service is free for accepted OSS projects, but its terms disallow
  proprietary components and commercial dual licensing in the signed project.
- Do not treat self-signed Windows certificates as public distribution signing;
  they do not establish trust on user machines or remove normal SmartScreen
  warnings.
- Microsoft Artifact Signing is a paid managed option, but its Public Trust
  identity validation is currently region-limited. A China-based release owner
  is not currently listed as eligible by Microsoft's FAQ.
- A free Apple account is suitable only for development/testing. Public macOS
  downloads need Developer ID signing and notarization, which requires the paid
  Apple Developer Program.
- Use Sigstore/GitHub attestations for Linux and supply-chain provenance, while
  retaining platform-native Windows and macOS signatures.

See [commercialization-and-signing.md](commercialization-and-signing.md) for the
dated vendor findings, official sources, and the recommended community/paid
product boundary.

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
