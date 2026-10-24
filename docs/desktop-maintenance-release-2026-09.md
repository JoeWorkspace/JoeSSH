# September 2026 desktop maintenance release

This is the current preparation entry point for `0.1.0-beta.30` / MSIX
`1.1.30.0`. The beta.29 source baseline is
`312811c070790e1bb04bf164214e1db97a3f8825`; this candidate integrates the
terminal, forwarding, dependency and release checks described in the
[beta.30 candidate notes](release-notes/0.1.0-beta.30.md). The earlier beta.29
build and its qualification evidence remain historical. Partner Center's
current submission must be checked again before uploading the new bytes.

The earlier beta.28 package and evidence remain immutable; the
Store rejected its corrected bytes because `1.1.28.0` is already used by the
active Submission 8 draft. The earlier beta.26 documents and evidence describe
a completed historical source build; they are not qualification evidence for
this update.

## Baseline and scope

On 2026-10-24, the live Partner Center overview showed Submission 8 as
published and its read-only Packages page showed `1.1.29.0` x64:
`JoeSSH_1.1.29.0_x64_312811c07079_35947067042_1.msix`, Windows.Desktop
minimum `10.0.17763.0`. The next candidate is `1.1.30.0`; qualify its upgrade
from this current baseline. The Portal record identifies the uploaded package;
it does not replace hashing a Store-signed download or an actual upgrade pilot.

The following September observations are historical:

The last verified Store package at the September inspection was `1.1.27.0`
x64, Submission 7. The package
filename is `JoeSSH_1.1.27.0_x64_803fcef25b78_34593035494_1.msix`. The earlier
2026-09-11 catalog check showed `1.1.26.0` / Submission 6 and is historical. The
previous overview showed
“Start update”, with no pending update, and the package-flight section showed
no flights. This records the historical submission and source-build lineage;
it does not substitute for hashing the Store-signed download.

At the September inspection, the baseline published package was `1.1.27.0`;
Submission 8 retained its previously uploaded `1.1.28.0` package. The historical
beta.29 reissue used the same reviewed behavior with the next package version.
The baseline main SHA for the beta.28 behavior is `803fcef25b7808bd8257fb589373791d75451f58`.
The complete maintenance difference is the reviewed PR against that SHA.
See [beta.29 candidate notes](release-notes/0.1.0-beta.29.md) for the package
identity change and the carried-forward behavior. No unrelated intermediate main commits were present
when this baseline was checked. Recheck main and Partner Center before release.

## Fixed completion sequence

1. Finish the reviewed maintenance commit and all 14 CI jobs, including the
   existing coverage, real SSH, Windows Store runtime, and strict online
   RustSec gates. Retain failed runs as evidence of what was corrected.
2. Merge through the protected-main PR process and require the merged SHA's
   complete CI. Dispatch `Windows Store Source Build` with that exact
   `reviewed_sha` and the existing public Partner Center identity JSON.
   Complete the actual `windows-release-stage-b` environment review under the
   repository owner's authorization. The owner has explicitly delegated the
   approval action for this release to the agent. Record the actual approving
   actor and delegation; do not describe an agent API approval as a physical
   owner click, simulate a review, or change the environment protection.
3. Record the new MSIX, SHA-256, source SHA, run, artifact IDs, and provenance.
   Run the hosted candidate verifier with those inputs. Generate fresh SBOMs
   and notices from this source; reuse no earlier build attestation.
4. Prepare a fresh native verification directory and review the existing
   [native harness](windows-store-native-verification.md) for this candidate.
   Its tracked bundle is pinned to earlier evidence and must not silently qualify
   this release. Keep old evidence unchanged; review and bind the new candidate,
   `1.1.29.0` baseline, SDK/toolchain, and harness hashes.
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
