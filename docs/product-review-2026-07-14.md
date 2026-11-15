# JoeSSH Product And Code Review

Review date: 2026-07-14.

## Executive Assessment

JoeSSH has unusually strong engineering foundations for a beta: real Rust SSH,
PTY, SFTP and forwarding paths; known-host verification; command safety at UI
and native boundaries; opt-in telemetry; extensive unit/E2E/visual coverage;
release evidence, SBOM, checksum, and self-hosted Sync checks.

The main gap is product and release coherence. The project currently looks more
complete in its QA scripts than in its first-run experience and distribution
story.

## Findings

| Priority | Finding                                                                              | Impact                                                                     | Status                                                                                      |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P0       | The workspace `.git` metadata is incomplete                                          | Tags, provenance, clean-tree checks, and releases are not trustworthy      | Must restore into a healthy clone                                                           |
| P0       | Windows/macOS public artifacts are not signed/notarized                              | Installation warnings and release gate failure                             | Signing path documented; credentials still required                                         |
| P0       | Mobile production authentication is not implemented                                  | Build-time public tokens are not safe for a public service                 | Keep native mobile out of public scope                                                      |
| P1       | First-run product surfaces and demo/live boundaries were unclear                     | Low activation and user confusion                                          | Fixed with onboarding and Chinese demo-state copy                                           |
| P1       | Several visible desktop controls had no behavior                                     | Broken trust and misleading UI                                             | Fixed or removed in this review                                                             |
| P1       | Command-palette commands mostly recorded history without acting                      | Core workflow appeared deeper than it was                                  | Fixed for navigation, copy, recording, and help actions                                     |
| P1       | Shared Button variant and default-size classes collided                              | Low-contrast ghost buttons across apps                                     | Fixed in `@atlasterm/ui` with regression coverage                                           |
| P1       | Formal signing and notarization are not yet connected to a multi-OS release workflow | Unsigned validation is repeatable, but public installers still cannot ship | Unsigned three-platform candidate workflow added; signed release remains externally blocked |
| P1       | JSON Sync ledger is a single-node persistence design                                 | Not suitable for a horizontally scaled hosted service                      | Keep for self-hosting; design a managed backend separately                                  |
| P1       | JoeSSH and AtlasTerm identities coexist in package names, keys, and domains          | Publisher and customer trust ambiguity                                     | JoeSSH chosen publicly; compatibility migration documented before 1.0                       |
| P2       | Desktop `main.tsx` combines orchestration, state, commands, and layout               | Increasing change risk and slower feature work                             | Extract controllers before the next major feature set                                       |
| P2       | Business capability UI was mostly a roadmap preview                                  | Users could mistake planned features for purchasable ones                  | Removed from Settings; remaining Team fixtures are explicitly labeled sample data           |

## Changes Made In This Review

- Added an accessible Getting Started dialog that explains Desktop, Web Admin,
  Mobile, demo data, and optional error-report privacy boundaries.
- Auto-opens onboarding on the first native Desktop run and keeps it available
  from the help button.
- Added a real terminal focus/maximize mode with an accessible restore action.
- Wired session copy and command-palette actions to real behavior.
- Wired Inspector runbook actions to command preparation and forwarding.
- Removed dead new-tab, pane-menu, panel-collapse, sidebar navigation, snippet
  add, and plan-management controls.
- Replaced unclear Chinese demo/telemetry wording.
- Fixed the shared Button class collision and added a regression test.
- Made connection presence derive from real native sessions, added dynamic
  de-duplicated terminal tabs, and restored active custom tabs across reloads.
- Bound native Quick Connect to a dedicated temporary profile, preserved
  imported usernames and ports, and fixed copied non-default-port SSH commands.
- Removed the Inspector's artificial loading delay and replaced remaining fake
  live/JIT/latency labels with explicit sample or no-session states.
- Removed nonfunctional Settings toggles and business-tier teaser controls, and
  hid context-menu actions that cannot execute in the current runtime.
- Added display-scaling coverage for 100%, 125%, and 150% equivalents, including
  short-height split terminals, long custom names, non-overlap, and text-fit
  checks; also extended the timeout for the intentionally exhaustive Web Admin
  source-contract scan.
- Added a manual Windows, macOS, and Linux unsigned-candidate workflow. It stages
  platform-specific artifacts with checksums and fail-closed metadata under
  `reports/candidates/`, never marks them release-eligible, and cannot create a
  GitHub Release.
- Completed a real Windows candidate build and fixed two release-only failures:
  the semantic beta now maps to an MSI-compatible numeric WiX version with a
  stable upgrade code, and the former placeholder icon is replaced by a JoeSSH
  platform icon set covering PNG, ICO, and ICNS. Readiness tests guard both
  contracts.
- Added upload-time and standalone candidate verification. Candidate metadata is
  bound to the actual checked-out commit, every file and byte count is covered,
  SHA-256 values are recomputed, and any attempt to mark an unsigned candidate
  release-eligible fails closed.

## Recommended Sequence

1. Restore a healthy Git clone and carry reviewed changes into it.
2. Publish a fully open-source community beta and apply for SignPath Foundation
   Windows signing.
3. Decide whether macOS is in scope; if yes, fund Apple Developer membership
   and automate signing/notarization on a macOS runner.
4. Extend the unsigned multi-OS candidate workflow only after signing identities
   are available: add artifact attestations, platform signatures/notarization,
   SBOMs, and the existing release-evidence verifier to a separate publish gate.
5. Run a small hosted-Sync design-partner pilot; sell managed operations and
   team controls instead of the basic terminal.
6. Extract Desktop command and layout controllers, then implement production
   pairing/OIDC for Mobile.

See [commercialization-and-signing.md](commercialization-and-signing.md) for
the business model and dated signing research, and
[brand-decision.md](brand-decision.md) for the compatibility-safe naming plan.
