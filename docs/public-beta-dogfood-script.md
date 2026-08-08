# JoeSSH Public Beta Dogfood Script

This script is the repeatable operator dogfood path for `0.1.0-beta.19`.
It is for internal dogfood and release-candidate evidence, not a substitute for
signed Desktop formal release evidence.

Unsigned Desktop staging installers may be used for this dogfood only when the
runner records that the build is unsigned and keeps it out of public release
artifacts. Public GitHub Release publishing still requires signed Windows
artifacts, signed and notarized macOS artifacts, Linux package evidence,
checksums, SBOM, provenance, and `release:publish-preflight`.
Because `0.1.0-beta.19` is permanently source-only, those artifacts may be
published only under a later distinct unused version; they must never be added
to the beta.19 GitHub Release.

For unsigned Desktop staging, record the handoff boundary before dogfood:

```powershell
npm run release:desktop:unsigned-staging-report
```

This writes `reports/handoff/desktop/unsigned-staging-report.json` with the
artifact path, SHA256, Git ref, and Windows Authenticode status. The report is
internal handoff evidence only and must not be copied into `reports/release`.

## Evidence File

Before starting, write a template:

```powershell
npm run release:dogfood-template
```

Fill the generated JSON and save the completed run as:

```text
reports/dogfood/public-beta/latest.json
```

Verify it with:

```powershell
npm run qa:public-beta-dogfood
```

Do not paste SSH hosts, usernames, commands containing secrets, file names that
identify customer data, private keys, tokens, terminal output, or screenshots
with secrets into the evidence file.

## Top 10 Tasks

1. `desktop-install-launch`
   Install or launch the Desktop candidate from a clean profile. Record whether
   the build is signed formal evidence or unsigned internal staging, and link
   the unsigned staging report when applicable.
2. `desktop-connection-host-key`
   Create or select a connection, probe the unknown-host fingerprint, confirm
   the visible host key, and verify changed host keys are blocked.
3. `desktop-pty-session`
   Open a PTY session, run a harmless marker command, resize the terminal, close
   it, and reconnect without losing the visible session state.
4. `desktop-command-safety`
   Attempt a blocked command pattern and confirm the safety status is visible
   without closing the terminal.
5. `desktop-sftp-transfer`
   SFTP list, download, upload, overwrite with confirmation, and verify unsafe
   entry names or oversized transfers are rejected.
6. `desktop-forwarding`
   Start a local port forward, pass loopback traffic, stop it, and confirm
   duplicate start or stop actions are ignored while pending.
7. `web-admin-live-sync`
   Open Web Admin against live Sync, verify the snapshot status, refresh
   metadata, fixture mode indicator, and explicit fixture toggle behavior.
8. `sync-device-flow`
   Register a device, push, pull, and confirm the admin snapshot reflects the
   expected device and record state without exposing tokens.
9. `sync-backup-restore-rollback`
   Run backup/restore smoke and rehearse rollback from the current ledger backup
   or previous packaged release bundle.
10. `release-evidence-review`
    Review Web, Sync, SBOM, checksum, RC audit, and No-Go issue evidence. Confirm
    no P0/P1 finding remains open and no unsigned Desktop artifact is treated as
    public release evidence.

## Severity Rules

P0 findings block every wider release: data loss, credential leak, unsafe command
execution, broken release provenance, broken rollback, or a public bundle secret.

P1 findings block Public Beta RC: core workflow dead end, inaccessible critical
action, flaky release gate, misleading status, or hard-to-recover Sync failure.

P2 findings are polish or secondary-workflow issues. Record them, but do not let
them hide P0/P1 work.

## Completion Bar

The dogfood run is complete only when all 10 task IDs are `passed`, each task has
non-secret evidence, and the findings list has no open P0 or P1 item.
