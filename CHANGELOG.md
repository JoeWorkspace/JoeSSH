# Changelog

All notable changes to JoeSSH will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0-beta.23] - 2026-08-30

> Maintenance version prepared for a separate Microsoft Store update. This entry
> is not evidence that the new binary has been built, certified, or published.
> The intended GitHub prerelease remains source-only with zero uploaded assets.

### Fixed

- Stop active connections and pending dials when a local port forward closes.
- Preserve SSH exit status after output EOF, and reject command termination
  without a reported status or with an exit signal.
- Preserve leading and trailing spaces in valid remote SFTP entry names while
  continuing to reject blank paths and control characters.
- Remediate dependency findings, verify the official GLib backport by content,
  and require complete online RustSec and yanked checks for both Rust lockfiles
  and the vendored package's original registry identity.
- Isolate Windows Authenticode checks from inherited PowerShell modules and
  compare Git worktree identities correctly across Windows 8.3 path aliases.

### Changed

- Advance application and runtime version metadata to `0.1.0-beta.23`, mapped
  to MSIX `1.1.23.0`; keep beta.20, beta.21, and beta.22 release records intact.
- Put the free Microsoft Store install and first-connection guide near the
  beginning of the README.
- Enabled GitHub's Sponsor button with the repository-owned voluntary-support
  notice as its only custom destination. The link remains separate from product
  checkout and does not claim payment-recipient, small-payment, or payout
  verification; the public warning and both QR asset hashes are CI-locked.

## [0.1.0-beta.22] - 2026-08-11

> Microsoft Store package-language correction. The GitHub prerelease remains
> source-only with zero uploaded assets.

### Fixed

- Bound the MSIX manifest language list to the 15 complete application UI
  locales instead of allowing MSIX Packaging Tool's `en-us` default to reach
  Partner Center unchanged.
- Added a MakeAppx finalization step that proves every non-manifest payload file
  remains byte-identical and rejects a Store candidate with missing, duplicate,
  invalid, or unreviewed package languages.
- Changed unknown system-locale fallback to English while preserving all 15
  explicit language choices.

### Changed

- Advanced runtime and package version surfaces to `0.1.0-beta.22`, mapped to
  Store package version `1.1.22.0`.
- Kept the 80 localized Store listings separate from package UI support: all 80
  may remain discoverable, but only the 15 complete UI locales are declared by
  the package.

## [0.1.0-beta.21] - 2026-08-09

> Microsoft Store replacement candidate. The GitHub `0.1.0-beta.20`
> prerelease remains permanently source-only and unchanged.

### Changed

- Advanced every runtime and package version surface to a distinct Store
  candidate that maps to MSIX version `1.1.21.0`.
- Aligned Mobile Vitest and coverage tooling at `4.1.9` so a clean npm install
  no longer resolves an invalid mixed test-runner pair.
- Require the Store handoff to bind the final protected-main source revision,
  exact Partner Center package identity, and generated MSIX hash instead of
  reusing the older `1.1.12.0` submission as evidence for current code.

### Security

- Preserved the automated accessibility fixes and the explicit no-formal-
  conformance boundary; no paid service, EAA conformance, or manual device
  review claim is introduced by this candidate.

## [0.1.0-beta.20] - 2026-08-09

> Final source-only GitHub prerelease for the current maintenance closeout.
> Public Desktop installers remain blocked on external signing and notarization
> evidence.

### Fixed

- Made the horizontally scrollable Desktop inspector keyboard-focusable at the
  supported 900 × 480 minimum viewport.
- Changed Desktop and Web Admin Axe gates to reject every tested WCAG A/AA
  violation instead of filtering by severity, and locked the minimum viewport
  into the accessibility-readiness contract.
- Removed the Web build's extensionless config import before Vite switches its
  native config loader to the future default.

### Added

- Recorded a bounded agent-assisted accessibility review with explicit
  screen-reader, physical-device, and representative-user limitations.
- Made future paid releases fail closed until EU consumer-market and EAA/local
  accessibility applicability are explicitly reassessed.

## [0.1.0-beta.19] - 2026-08-09

> Source-only GitHub prerelease. Public Desktop installers remain blocked on
> external signing and notarization evidence.

### Fixed

- Normalized Markdown whitespace while validating source-release boundaries and
  bound the release contract test to the repository's actual versioned notes.

## [0.1.0-beta.18] - 2026-08-09

> Remote tag-only preflight checkpoint. Its dry run failed before any GitHub
> Release or release asset was created. The tag remains immutable and must not
> receive a Release page or be reused.

### Added

- An EAA-oriented accessibility assessment status, safe barrier-reporting
  form, and WCAG 2.2 target-size and focus-not-obscured release checks without
  making an unverified conformance claim.
- A production UI system across Desktop, Mobile, and Web Admin with responsive
  light/dark themes, accessibility coverage, Windows scaling checks, and
  visual-regression baselines.
- A commit-bound Windows invite pipeline for private Stage A dogfood, including
  immutable handoff evidence and clean-VM promotion checks.
- Separate Microsoft Store NSIS EXE and external-MSIX candidate contracts that
  fail closed on signing, publisher identity, hashes, silent installation, and
  Store-certification claims.
- A built-product Microsoft Store runtime gate that exercises narrow-window,
  light/dark, shortcut, command-palette, hidden-surface, and overflow behavior
  with Playwright in CI and the formal hosted verifier.
- A resumable three-step Desktop first-use guide covering local profile
  creation, explicit host-key verification in Connect, and entry points for
  Terminal, SFTP, and loopback-only forwarding; Help can reopen it at any time.
- An 80-locale Microsoft Store discoverability draft backed by the 15 shipped
  application UI locales; Store listing locales that share a UI pack are kept
  distinct from the app's actual translation coverage.
- Support, privacy, refund, sale, trademark, third-party notice, pricing, and
  funding drafts that keep all unverified seller and checkout data blocked.
- A bilingual voluntary-support page with maintainer-supplied Weixin Pay and
  Alipay QR codes, explicit non-purchase/privacy safeguards, and a fail-closed
  GitHub Sponsor button pending live recipient, payment, platform-rules, and
  payout verification.
- A read-only remote release-control audit for repository visibility, protected
  `main`, vulnerability reporting, release environments, Actions artifacts,
  caches, and externally confirmed billing readiness.
- A redacted full-history Gitleaks gate with exact historical fixture
  fingerprints and tests that reject broader rule or ignore configuration.

### Fixed

- Sync now rejects future base cursors without mutation, records unique device
  registration audit IDs, keeps Mobile response-body reads under the request
  timeout, and reports malformed JSON without echoing response content.
- The dependency audit now limits the temporary `image-size` exception to the
  exact non-public Mobile Expo/Metro graph, while the `nanoid` override resolves
  its high-severity advisory.
- Cross-platform dependency-lock portability, Desktop async interaction races,
  SFTP path and transfer safety, PTY lifecycle behavior, forwarding cleanup,
  Mobile sync behavior, Web Admin localization, and responsive UI states.
- Public vulnerability disclosure links, workflow secret scope, dependency
  auto-merge boundaries, and high-privilege workflow permissions.
- Windows Store automation is now hosted-verification-only: externally produced
  EXE/MSIX bytes require a URL and SHA-256, while build signing, OIDC,
  self-hosted runners, local handoffs, and signing secrets stay outside the
  workflow.

### Changed

- Froze speculative feature development after this closeout; maintenance,
  security, compatibility, accessibility barriers, and bounded community
  contributions continue until documented external-demand thresholds are met.
- Rolled the candidate forward without moving the existing
  `v0.1.0-beta.9` tag.
- Made Windows Desktop the first adoption and revenue-validation lane while
  keeping Community functionality MIT-licensed and keeping paid, hosted, and
  unsupported-platform promises unavailable until their evidence gates pass.
- Prefer a time-boxed Microsoft Store MSIX feasibility spike for the free
  Community build, with public-CA-signed Tauri NSIS retained as the fallback.
- Pinned CI actions to reviewed commit SHAs and disabled persisted checkout
  credentials.

## [0.1.0-beta.9] - 2026-06-23

### Added

- Public Beta dogfood evidence template and verifier covering the top Desktop,
  Web Admin, Sync, rollback, and release-evidence review tasks without allowing
  open P0/P1 findings.
- Internal-only unsigned Desktop staging handoff report that records artifact
  path, SHA256, Git ref, and Windows Authenticode status while keeping unsigned
  builds out of `reports/release`.
- Repository release handoff playbook for moving reviewed work from a damaged
  `.git` planning workspace into a healthy checkout before Public Beta tagging,
  checksums, SBOM generation, or GitHub Release drafting.
- Web Admin proxy public-bind operator authentication guard so non-loopback
  proxy deployments fail closed unless a distinct inbound operator token is
  configured and verified before the upstream admin token is injected.

### Fixed

- Desktop host-key probing now ignores stale results when the connection form
  changes mid-probe.
- Desktop SFTP listing, download, and overwrite flows now pin the directory
  context so slow listings or pending overwrite confirmations cannot target the
  wrong folder.
- Tauri SFTP IPC now rejects unsafe remote paths with traversal, control
  characters, bidi controls, or backslashes before reaching the SFTP backend.
- Desktop port-forward runtime cleanup now stops active native forwards when
  the backend session changes and ignores stale start results.
- Invalid Desktop connection-import files now surface an error toast instead of
  silently reporting zero imported connections.

### Changed

- Release readiness now requires the dogfood verifier, native SFTP path guard,
  forward lifecycle cleanup evidence, and unsigned-staging handoff guard.
- Public release readiness now requires the repository handoff playbook and
  blocks stale fixed test-count or absolute coverage claims in the changelog.
- Desktop known-host Settings actions now require confirmation before removing
  one host key or clearing all stored host keys, and failed updates surface as
  errors instead of being silently treated as success.
- Desktop interactive PTY sessions now resize the existing remote PTY when the
  terminal container changes size, show open/closed/error state, retain exit
  codes, and offer reconnect without rebuilding the xterm instance.
- Pull request checklist wording now references the test gate without a fixed
  test count.

## [0.1.0-beta.8] - 2026-06-23

### Fixed

- Public Beta release notes now include the Sync Service and SHA256 evidence
  language required by the release readiness gate.

### Changed

- Rolled the Public Beta candidate forward from `0.1.0-beta.7` to
  `0.1.0-beta.8` without moving the already-published beta7 tag.

## [0.1.0-beta.7] - 2026-06-23

### Added

- Desktop formal evidence diagnostics for the Public Beta release handoff,
  including tag/HEAD state, remote ref publication, staged artifact coverage,
  signing secret names, workflow visibility, CI runs, and check-run annotations.
- Desktop formal evidence preflight now validates that the requested release
  ref resolves to the current healthy checkout `HEAD` and is published to the
  canonical remote before it can dispatch the formal evidence workflow.

### Changed

- Public Beta release docs now treat Desktop diagnostics and signing-secret
  templates as handoff-only local artifacts, separate from the final
  `reports/release/` upload tree.
- The beta7 candidate preserved `0.1.0-beta.5` as the last pushed candidate
  while local release evidence was refreshed.

## [0.1.0-beta.5] - 2026-06-22

### Added

- Fixture-backed Public Beta release gate wrapper so release machines can run
  the full `qa:release:public` command under a local OpenSSH dogfood fixture
  while still writing real Desktop SSH smoke evidence first.

## [0.1.0-beta.4] - 2026-06-22

### Added

- Public Beta release gate with release QA, Rust workspace checks, Tauri shell
  build check, production audit risk register validation, self-hosted Sync
  smoke, and visual QA.
- Desktop distribution guide covering Tauri bundle metadata, signing,
  notarization, Linux artifacts, checksums, and GitHub Release drafts.
- Web Admin static deployment guide for `_headers`, CSP, admin snapshot URL,
  bearer token configuration, cache behavior, and rollback.
- Sync Service self-hosting guide with Dockerfile, systemd example, required
  tokens, CORS, storage, rate limit, and JSON ledger single-process limits.
- Public Beta privacy note requiring opt-in telemetry and forbidding collection
  of SSH hosts, usernames, commands, paths, file names, keys, tokens, and
  terminal output.
- Dependency risk register for documented moderate production audit findings
  that do not block the Desktop + Web Admin + self-hosted Sync Public Beta.

### Added

- Service worker update notification with `sw-update-available` custom event and auto-reload on controller change
- Periodic service worker update checks (every 60 minutes) for both desktop and web apps
- Offline page `aria-live="polite"` region for screen reader announcements when connection restores
- Offline page `focus-visible` styles for keyboard navigation
- Offline page `prefers-reduced-motion` support to disable transitions
- RFC 9116 `security.txt` in `.well-known/` for responsible vulnerability disclosure
- `<meta name="color-scheme" content="dark light">` for native dark mode form controls and scrollbars
- `scrollbar-color` CSS custom properties for themed scrollbars in both desktop and web apps
- CSP directive `object-src 'none'` to block plugin content injection
- CSP directive `upgrade-insecure-requests` to auto-upgrade HTTP to HTTPS
- `setTag()` in error-monitor now accepts `string | number` values for numeric context (retry counts, latencies)
- Custom `404.html` error page for web app with consistent dark theme design
- `humans.txt` credits file in both desktop and web public directories
- Twitter Card meta tags (`twitter:card`, `twitter:title`, `twitter:description`) for social sharing
- PWA shortcuts for Team Access, Port Forwarding, and Settings in desktop manifest

### Fixed

- Removed stale `/sitemap.xml` reference from web `robots.txt` (no sitemap existed)
- i18n check script (`scripts/check-i18n.cjs`) now reads from separate locale files instead of the monolithic `index.ts`

### Changed

- ARCHITECTURE.md with system design, data flow, security layers, sync protocol, and testing strategy
- Documentation section in README linking all project docs
- Cross-reference from CONTRIBUTING.md to ARCHITECTURE.md
- Automated accessibility E2E tests with @axe-core/playwright (WCAG 2.0/2.1 AA)
- Comprehensive CONTRIBUTING.md with development workflow, code style, and commit conventions
- Enhanced SECURITY.md with security headers verification details
- CHANGELOG.md for tracking changes
- i18n manual chunk splitting in both desktop and web vite configs
- Security headers verification script (scripts/check-security-headers.mjs)
- Security headers check in CI pipeline
- Build artifact upload in CI for debugging
- PWA shortcuts for quick actions (Quick Connect, SFTP, Team, Devices, Audit)
- PWA manifest `id` field for stable app identification
- Breadcrumb support in error monitor for debugging context
- `visibilitychange` listener in error monitor to flush on tab hide
- Dependabot auto-merge workflow for minor/patch updates
- Service worker cache size limits (100 entries max) to prevent unbounded growth
- Stale-while-revalidate strategy for static assets in service workers
- Keyboard shortcuts overlay now has proper dialog ARIA role, modal, and label
- Error monitor health report API (`getHealthReport()`) for monitoring dashboards
- Error monitor web vitals API (`getWebVitals()`) for performance dashboards
- SFTP panel file list `role="list"`, `aria-label`, and per-file `aria-label` for screen readers across all 15 locales
- Sync service rate limiting via `tower::limit::RateLimitLayer` (configurable with `ATLASTERM_SYNC_RATE_LIMIT`, default 100 req/s)
- E2E accessibility tests for settings panel and team access panel
- Exported `HealthReport`, `WebVitalsReport`, `ErrorGroup`, and `WebVitalEntry` types for consumer dashboards
- CI Rust job with `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`
- CI i18n release gate (`qa:i18n-release`) in build job
- CI sync API docs contract check (`qa:sync-api-docs`) in build job
- `aria-label` on icon-only buttons in GroupManagerModal (4 new i18n keys across 15 locales)
- `aria-current` on current group item in ContextMenu
- `aria-label` and `role="search"` on TerminalPane search bar
- `aria-hidden="true"` on decorative icons in StatusBar, Sidebar, CommandPalette
- `role="contentinfo"` on StatusBar footer
- Sidebar `<section>` changed to `<nav>` with `aria-label`
- `aria-label` on CommandPalette search input
- `accessibilityRole` and `accessibilityLabel` on mobile InfoTile
- `aria-atomic="true"` on ToastContainer for complete screen reader announcements
- `aria-label` on Sidebar `<aside>` landmark
- `aria-hidden` on decorative ChevronRight/ChevronDown/Folder/Lock icons in Sidebar
- `aria-hidden` on keyboard shortcut hints in Sidebar
- `aria-label` on mobile LanguageOption combining label and sublabel
- `aria-label` on Sidebar search input
- `aria-hidden` on decorative icons in ContextMenu (TerminalSquare, Settings, Copy, ClipboardCheck, Folder, ChevronRight, Trash2)
- `role="tablist"` and `role="tab"` with `aria-selected` on terminal tabbar
- `aria-hidden` on terminal tab icons (TerminalSquare, X)
- `aria-hidden` on decorative icons in panels.tsx (Gauge, Braces, Network, Play, Zap, FileUp, DownloadCloud, Folder, FileDown)
- `aria-label` on GroupManagerModal new group name and editing group name inputs
- `aria-hidden` on decorative icons in GroupManagerModal (Boxes, Plus, Folder, Settings, Trash2, ClipboardCheck, X)
- `aria-hidden` on decorative icons in ShortcutsOverlay (Command)
- `aria-hidden` on decorative icons in TerminalPane (Monitor, Search)
- `aria-hidden` on decorative icons in ToastContainer (Play, ShieldCheck, Bell)
- `aria-hidden` on command palette item icons in main.tsx (TerminalSquare, SplitSquareHorizontal, FileUp, ShieldCheck, Copy, X, Video, HardDrive, Network, Command)
- Updated README with the current QA gate summary, consolidated Security section, added CI Rust/i18n-release/sync-api-docs
- Updated ARCHITECTURE.md CI section with Rust job, i18n release gate, sync API docs check

### Changed

- Desktop service worker navigation fallback now includes root page fallback (matches web SW behavior)
- Raised coverage thresholds to the checked-in release gates across all metrics
- Raised Lighthouse thresholds: performance 0.95, accessibility 1.0, best-practices 1.0, SEO 0.95
- Promoted all ESLint rules to error level for production code
- Updated README with a coverage-gate badge, security section, and contributing guidelines
- Moved check_i18n.js to scripts/check-i18n.cjs for consistent project structure
- Expanded Permissions-Policy from 4 to 8 directives (camera, microphone, geolocation, payment, usb, magnetometer, gyroscope, accelerometer)
- CI workflow now uses `permissions: contents: read` for least-privilege security
- Service workers use stale-while-revalidate for better UX (serve cache immediately, update in background)
- Updated ARCHITECTURE.md CI section to include Rust job, i18n release gate, and sync API docs check
- Updated ARCHITECTURE.md testing summary to reference the current QA gates

### Fixed

- i18n check script (`scripts/check-i18n.cjs`) now reads from separate locale files instead of the monolithic `index.ts`
- CONTRIBUTING.md referenced `en.json` instead of `en.ts` for locale file path
- Removed unused imports in test files (panels.test.tsx, assertCompleteTranslations.test.ts, index.test.ts)
- Fixed non-null assertions in test files with optional chaining
- Enabled releaseReadiness.test.ts unconditionally (was gated behind release mode)
- Added `/* v8 ignore next */` annotation for adminData.ts default parameter ternary
- Fixed SegmentedControl generic type inference with explicit type parameter in desktop main.tsx
- Added `@ts-expect-error` for Vite `sri` option missing from BuildOptions types
- Fixed web vite.config.ts URL type compatibility with `toString()` conversion
- Fixed ErrorGroup type mismatch (expanded internal storage to include message, stack, firstSeen)
- Removed dead code `message ?? ''` in error monitor to restore the branch coverage gate
- Fixed duplicate "### Changed" section in CHANGELOG.md

### Security

- Added X-Content-Type-Options meta tag verification
- Added Referrer-Policy meta tag verification
- Added Permissions-Policy header verification
- Added Content-Security-Policy header verification
- All security headers verified in CI pipeline

## Pre-release prototype baseline - 2025-01-01

> This was a repository scaffold, not a tagged `v0.1.0` production release.
> Team collaboration, shared vault, Mobile, and Web Admin entries below
> described prototype surfaces rather than a hosted or commercially supported
> product.

### Added

- Initial repository prototype
- Desktop workbench shell (React + TypeScript + Vite)
- Web Admin snapshot prototype
- Mobile companion preview (React Native + Expo)
- SSH terminal, SFTP, and connection-forwarding prototypes
- Team collaboration and shared-vault demo surfaces
- Sync service prototype (Rust Axum)
- 15 locale internationalization
- Playwright E2E tests
- Lighthouse CI integration
- Bundle size monitoring
- Subresource Integrity
- Service worker with offline support
- Error monitoring package
