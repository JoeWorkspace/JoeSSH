# Changelog

All notable changes to JoeSSH will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Repository release handoff playbook for moving reviewed work from a damaged
  `.git` planning workspace into a healthy checkout before Public Beta tagging,
  checksums, SBOM generation, or GitHub Release drafting.
- Web Admin proxy public-bind operator authentication guard so non-loopback
  proxy deployments fail closed unless a distinct inbound operator token is
  configured and verified before the upstream admin token is injected.

### Changed
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
- The current Public Beta candidate version is `0.1.0-beta.7`, preserving
  `0.1.0-beta.5` as the last pushed candidate while local release evidence is
  refreshed.

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

## [0.1.0] - 2025-01-01

### Added
- Initial release
- Desktop workbench (React + TypeScript + Vite)
- Web admin console
- Mobile companion (React Native + Expo)
- SSH terminal integration
- SFTP file management
- Connection forwarding
- Team collaboration features
- Shared vault
- Sync service (Rust Axum)
- 15 locale internationalization
- Playwright E2E tests
- Lighthouse CI integration
- Bundle size monitoring
- Subresource Integrity
- Service worker with offline support
- Error monitoring package
