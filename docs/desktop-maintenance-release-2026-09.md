# September 2026 desktop maintenance release

This is the current preparation entry point for `0.1.0-beta.27` / MSIX
`1.1.27.0`. The earlier beta.26 documents and evidence describe a completed
historical source build; they are not qualification evidence for this update.

## Baseline and scope

On 2026-09-11, Microsoft's public catalog for `9NK5LLMF8LHM` and the signed-in
Partner Center package page agreed on `1.1.26.0` x64, Submission 6. The current
package filename was
`JoeSSH_1.1.26.0_x64_01bf0f680001_33630996084_1.msix`. The overview showed
“Start update”, with no pending update, and the package-flight section showed
no flights. This establishes the current submission and source-build lineage;
it does not substitute for hashing the Store-signed download.

The baseline main SHA is `01bf0f680001aae45b5087ef107ecf34c779500c`.
The complete maintenance difference is the reviewed PR against that SHA.
See [candidate notes](release-notes/0.1.0-beta.27.md) for the included behavior
and dependency changes. No unrelated intermediate main commits were present
when this baseline was checked. Recheck main and Partner Center before release.

## Fixed completion sequence

1. Finish the reviewed maintenance commit and all 14 CI jobs, including the
   existing coverage, real SSH, Windows Store runtime, and strict online
   RustSec gates. Retain failed runs as evidence of what was corrected.
2. Merge through the protected-main PR process and require the merged SHA's
   complete CI. Dispatch `Windows Store Source Build` with that exact
   `reviewed_sha` and the existing public Partner Center identity JSON.
   The repository owner must perform the actual `windows-release-stage-b`
   environment review. The agent must not simulate this review or change the
   environment protection.
3. Record the new MSIX, SHA-256, source SHA, run, artifact IDs, and provenance.
   Run the hosted candidate verifier with those inputs. Generate fresh SBOMs
   and notices from this source; reuse no earlier build attestation.
4. Prepare a fresh native verification directory and review the existing
   [native harness](windows-store-native-verification.md) for this candidate.
   Its tracked bundle is pinned to beta.26 and a `1.1.22.0` baseline: it must
   not silently qualify this release. Keep old evidence unchanged; review and
   bind the new candidate, `1.1.26.0` baseline, SDK/toolchain, and harness hashes.
5. Require WACK and clean-install/upgrade/uninstall checks in an isolated
   Windows environment. Exercise 2 and 8 real SSH sessions, hidden output,
   input targeting, SFTP selection/confirmation across switches, forwarding,
   connection deadlines, early PTY exit, long load, and resource cleanup.
   Verify existing data and known-hosts recovery, including Windows PowerShell
   5.1 and a higher-version recovery candidate. Do not install test trust
   certificates into the host's production certificate store.
6. Complete the actual Store upgrade pilot and the acceptance/observation
   matrix in the maintenance plan. Submit only the qualified bytes to Partner
   Center; certification and publication must be confirmed independently.
   Keep GitHub source Releases free of uploaded binaries.

## Evidence limits and recovery

Local source compilation and WebView2 development testing are useful regression
evidence. They do not prove installed Store protocol, data paths, Store signing,
minimum-OS compatibility, long-running resource stability, or actual upgrade
delivery. Record those results separately for the final candidate.

Do not downgrade Store packages to recover. Use the same identity and a new,
higher version, preserving compatibility with existing JSON data. The new
revocation sidecar is auxiliary; recovering it must not erase host-key pins or
accept an unsupported future format. See [recovery instructions](known-hosts-recovery.md).
