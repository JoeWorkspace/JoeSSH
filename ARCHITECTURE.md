# JoeSSH Architecture

JoeSSH is a local-first remote workbench monorepo. This document covers the system design, data flow, and key architectural decisions.

## System Overview

```text
+-------------------------------------------------------------------+
|                          JoeSSH Monorepo                          |
|                                                                   |
|  +----------+  +----------+  +----------+  +-------------------+  |
|  | Desktop  |  |   Web    |  | Mobile   |  |   Sync Service    |  |
|  |  Vite    |  |  Vite    |  | Expo     |  |   Rust / Axum     |  |
|  +----+-----+  +----+-----+  +----+-----+  +---------+---------+  |
|       |             |             |                  |            |
|       +-------------+-------------+------------------+            |
|                     |             |                               |
|             +-------+-------------+-------+                       |
|             |        Shared Packages       |                       |
|             |  @atlasterm/i18n             |                       |
|             |  @atlasterm/ui               |                       |
|             |  @atlasterm/error-monitor    |                       |
|             +------------------------------+                       |
|                                                                   |
|             +------------------------------+                       |
|             |    Rust Core (crates/core)   |                       |
|             |  connection, sftp, vault     |                       |
|             |  sync, security, forwarding  |                       |
|             +------------------------------+                       |
+-------------------------------------------------------------------+
```

## Monorepo Structure

```text
atlasterm/
|-- apps/
|   |-- desktop/     React + TypeScript + Vite workbench, Tauri-ready
|   |-- mobile/      React Native + Expo companion for iOS, Android, and web
|   `-- web/         Team admin console built with Vite
|-- crates/
|   `-- core/        Rust domain interfaces for SSH, SFTP, sync, vault, and safety
|-- packages/
|   |-- error-monitor/  Browser error reporting with beacon transport
|   |-- i18n/           Translation catalogs and locale formatting
|   `-- ui/             Shared design tokens and primitives
|-- services/
|   `-- sync/        Rust Axum sync service with JSON-backed ledger storage
|-- tests/
|   `-- e2e/         Playwright acceptance suite
`-- scripts/         QA, release, audit, packaging, and smoke-test gates
```

## Workspace Commands

| Scope   | Dev                   | QA                   |
| ------- | --------------------- | -------------------- |
| Desktop | `npm run dev:desktop` | `npm run qa:desktop` |
| Web     | `npm run dev:web`     | `npm run qa:web`     |
| Mobile  | `npm run dev:mobile`  | `npm run qa:mobile`  |
| Rust    | (none)                | `npm run qa:rust`    |
| Full    | `npm run dev`         | `npm run qa`         |

## Data Flow

### Sync Protocol

The sync service in `services/sync` exposes a cursor-based change ledger.

```text
Client A                      Sync Service                     Client B
   |                                |                              |
   | POST /v1/devices/register      |                              |
   |------------------------------->|                              |
   | device_id, cursor              |                              |
   |<-------------------------------|                              |
   |                                |                              |
   | POST /v1/sync/push             |                              |
   | base_cursor + changes          |                              |
   |------------------------------->|                              |
   | accepted, new cursor           |                              |
   |<-------------------------------|                              |
   |                                | GET /v1/sync/pull            |
   |                                | device_id, since             |
   |                                |<-----------------------------|
   |                                | changes + next_cursor        |
   |                                |----------------------------->|
```

Key properties:

- Idempotent push: `changes[].id` can be replayed safely.
- Conflict detection: stale-base pushes report entity conflicts.
- Device exclusion: pull responses exclude the requester's own changes.
- Cursor stability: `next_cursor` stays stable when no new changes exist.

### Desktop Workbench

```text
+-------------------------+  +------------------------------------+
| Sidebar                 |  | Terminal Zone                      |
| Connection list         |  | Tab bar                            |
| Search and tag filters  |  | +--------------------------------+ |
| Favorites and groups    |  | | Terminal pane                  | |
| Language selector       |  | | - Command history              | |
|                         |  | | - Safety preflight             | |
| Command palette         |  | | - Structured line IDs          | |
| SFTP panel              |  | +--------------------------------+ |
| Settings                |  | Command input                     |
| Team access             |  | Context pane: vault, audit, SSH   |
+-------------------------+  +------------------------------------+
```

### Mobile Companion

The Expo app contains a sync client that:

1. Registers the device through `POST /v1/devices/register`.
2. Pushes mobile presence checkpoints through `POST /v1/sync/push`.
3. Pulls preview data through `GET /v1/sync/pull`.
4. Falls back to offline mode when no endpoint is configured.
5. Reuses server-assigned `device_id` values when an Expo install ID is not UUID-shaped.

Public mobile release builds must not set `EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN`; `EXPO_PUBLIC_*` values are embedded in the app bundle, so `npm run qa:mobile-public-env` blocks that configuration before release.

## Security Architecture

### Defense In Depth

| Layer              | Mechanism                                                                                   | Scope             |
| ------------------ | ------------------------------------------------------------------------------------------- | ----------------- |
| CSP                | `default-src 'self'`, `frame-ancestors 'none'`                                              | Web and Desktop   |
| Permissions-Policy | Camera, mic, geolocation, payment, USB, magnetometer, gyroscope, and accelerometer disabled | Web and Desktop   |
| SRI                | SHA-384 hashes on built JS and CSS                                                          | Production builds |
| Service Worker     | Static-only caching; API requests bypass cache                                              | Web and Desktop   |
| Bearer Auth        | Constant-time token comparison                                                              | Sync service      |
| CORS               | Explicit origin allowlist; no wildcard origins                                              | Sync service      |
| Input Validation   | Request payload validation                                                                  | Sync service      |

### Security Headers

Automated by `scripts/check-security-headers.mjs` and CI through `qa:security-headers`:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`

### Dependency Audit

Public release gates run `npm run qa:prod-audit`, which combines `npm audit --audit-level=high` with the documented dependency risk register check.

## Internationalization

The i18n package ships locale metadata, translation catalogs, and formatting helpers.

| Tier     | Locales                                        |
| -------- | ---------------------------------------------- |
| Core     | `zh-CN`, `en`                                  |
| Full     | `zh-TW`, `ja`, `ko`, `de`, `fr`, `es`, `pt-BR` |
| Extended | `ru`, `id`, `vi`, `th`, `hi`, `ar`             |

- Arabic uses right-to-left document direction when active.
- Missing translations fall back to English during development and are blocked by release QA.
- Locale-aware helpers cover dates, numbers, file sizes, latency, and relative time.
- Mojibake checks scan advertised locale names and shipped translations.

## Error Monitoring

`@atlasterm/error-monitor` provides:

- Unhandled error and promise rejection capture.
- Breadcrumb capture with bounded history.
- Error deduplication and rate limiting.
- Beacon transport with fetch fallback.
- Web Vitals reporting.
- Runtime disable controls for Public Beta privacy commitments.

## Testing Strategy

| Layer         | Tool                                 | Coverage                                       |
| ------------- | ------------------------------------ | ---------------------------------------------- |
| Unit          | Vitest and Node test runner          | App packages and release tooling               |
| Mobile        | Vitest and React Native test helpers | Sync client, locale state, offline behavior    |
| E2E           | Playwright                           | Desktop workbench, Web Admin, mobile companion |
| Accessibility | Playwright accessibility checks      | WCAG-focused browser assertions                |
| Security      | `npm run qa:prod-audit`              | High and critical dependency risk gate         |
| Bundle        | size-limit                           | 250 KB per chunk budget                        |
| Lighthouse    | `scripts/lighthouse-audit.mjs`       | Web Admin release-machine evidence             |

## Performance Budgets

| Metric                    | Budget      | Enforcement             |
| ------------------------- | ----------- | ----------------------- |
| Chunk size                | 250 KB gzip | `qa:bundle-size` and CI |
| Lighthouse performance    | >= 0.95     | CI Lighthouse job       |
| Lighthouse accessibility  | >= 1.0      | CI Lighthouse job       |
| Lighthouse best practices | >= 1.0      | CI Lighthouse job       |
| LCP                       | <= 2500 ms  | Web Vitals tracking     |
| FID                       | <= 100 ms   | Web Vitals tracking     |
| CLS                       | <= 0.1      | Web Vitals tracking     |
| INP                       | <= 200 ms   | Web Vitals tracking     |

## CI/CD Pipeline

```text
Lint ----+
         +--> Build --> E2E
Typecheck+
         +--> Audit
         +--> Lighthouse
         +--> Rust
         +--> Mobile
         +--> Public release readiness
```

- Runs on push, pull request, and weekday schedule at 03:23 UTC Monday through Friday.
- Cancels in-progress runs for the same ref.
- Uses least-privilege `permissions: contents: read`.
- Uploads Playwright reports on failure with 7-day retention.
- Uploads Lighthouse reports with 30-day retention.
- Build jobs include bundle size, SRI, security headers, i18n release checks, and sync API documentation checks.
- Public release readiness includes SBOM verification, Web Admin proxy and token scans, Sync release smokes, mobile public environment checks, release provenance, and final readiness validation.
