# JoeSSH E2E

Playwright acceptance checks for JoeSSH surfaces.

The main suite keeps broad smoke coverage for desktop, Web, and the Expo Web
mobile companion while also including strict i18n gate tests tagged with
`@i18n-strict`. Mobile web E2E uses static Expo web exports served from a local
Node server so Windows localhost/Metro readiness quirks cannot block the rest
of the Playwright suite. The strict tests protect the core localized paths for
Simplified Chinese defaults, English regional selection, and Arabic RTL layout.

## Commands

```powershell
npm install
npm run install:browsers -w @atlasterm/e2e
npm run qa:e2e
npm run qa:e2e:fresh
npm run qa:e2e:visual
npm run qa:e2e:visual:fresh
npm run qa:e2e:web-real-sync:fresh
npm run typecheck -w @atlasterm/e2e
npm run test:web:fresh -w @atlasterm/e2e
npm run test:web:real-sync:fresh -w @atlasterm/e2e
npm run test:i18n-strict -w @atlasterm/e2e
```

The E2E suite starts `apps/web` at `http://127.0.0.1:4200`, a live Web Admin
lane at `http://127.0.0.1:4211`, a mock admin snapshot service at
`http://127.0.0.1:4110/v1/admin/snapshot`, `apps/desktop` at
`http://127.0.0.1:5175`, a mock mobile Sync API service at
`http://127.0.0.1:4111`, and one mobile static web server helper that exports
offline and live `apps/mobile` Expo Web bundles to temporary directories and
serves them at `http://127.0.0.1:8099` and `http://127.0.0.1:8101`. It
validates the admin dashboard, same-origin live
snapshot proxy, desktop workbench panel flows, the mobile companion's 320 px
offline fallback path, and a separate-origin mobile register/presence-push/pull
success path with bearer authorization plus a repeated live refresh that
advances from the last returned pull cursor and reuses the server-assigned
mobile `device_id` for the second registration.

The Web Admin lane also has an isolated config:

```powershell
npm run test:web -w @atlasterm/e2e
npm run test:web:fresh -w @atlasterm/e2e
```

That config starts only the admin snapshot mock and the two Web Admin Vite
servers, so Web-only QA is independent from desktop and mobile startup.

The real Sync Web Admin lane starts the Rust `atlasterm-sync` service with a
temporary JSON ledger, seeds two devices plus one sync change, exposes the real
`/v1/admin/snapshot` behind the same-origin `/api/admin/snapshot` Vite proxy,
and verifies the browser render without sending bearer auth from the page:

```powershell
npm run test:web:real-sync:fresh -w @atlasterm/e2e
```

If a local process already owns one of those ports, keep the default behavior in
CI and override only the blocked local port:

```powershell
$env:ATLASTERM_DESKTOP_PORT='5176'
npm run test -w @atlasterm/e2e -- --project=web-admin-chromium --project=desktop-workbench
```

Available port overrides are `ATLASTERM_WEB_PORT`, `ATLASTERM_WEB_LIVE_PORT`,
`ATLASTERM_WEB_REAL_SYNC_PORT`, `ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT`,
`ATLASTERM_E2E_REAL_SYNC_PORT`, `ATLASTERM_E2E_MOBILE_SYNC_PORT`,
`ATLASTERM_DESKTOP_PORT`, `ATLASTERM_MOBILE_PORT`, and
`ATLASTERM_MOBILE_LIVE_PORT`.

For local QA runs where stale Vite or static mobile web servers may already be running,
use the fresh-port lane instead of managing environment variables by hand:

```powershell
npm run qa:e2e:fresh
npm run test:fresh -w @atlasterm/e2e -- --project=mobile-companion-web --project=mobile-companion-live-web
```

The fresh lane allocates a new port set for every Playwright web server before
starting the suite and clears the ambient `EXPO_PUBLIC_ATLASTERM_SYNC_URL`
override, so the offline mobile companion lane cannot accidentally reuse a
previous live-sync bundle. Explicit `ATLASTERM_*_URL` base-URL overrides still
take precedence for targeted debugging. The fresh lane also raises the
Playwright test timeout for that run only, because fresh Vite servers and static
mobile web exports can spend most of the default 30 seconds compiling before the
browser receives the first page.

To run only the live Web Admin Sync API smoke:

```powershell
$env:ATLASTERM_WEB_LIVE_PORT='4211'
$env:ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT='4110'
npm run test -w @atlasterm/e2e -- --project=web-admin-live-sync-api
```

To run only the real Sync Web Admin smoke:

```powershell
$env:ATLASTERM_WEB_REAL_SYNC_PORT='4212'
$env:ATLASTERM_E2E_REAL_SYNC_PORT='4112'
npm run test:web:real-sync -w @atlasterm/e2e
```

To run only the mobile companion smoke:

```powershell
$env:ATLASTERM_MOBILE_PORT='8099'
npm run test -w @atlasterm/e2e -- --project=mobile-companion-web
```

To run only the live mobile sync smoke:

```powershell
$env:ATLASTERM_MOBILE_LIVE_PORT='8101'
$env:ATLASTERM_E2E_MOBILE_SYNC_PORT='4111'
npm run test -w @atlasterm/e2e -- --project=mobile-companion-live-web
```

## Scripted Visual QA

The visual lane uses `playwright.visual.config.ts` so it starts only the Web
Admin, desktop, and mobile web servers needed for screenshot comparison. It
captures Web Admin desktop/mobile, desktop workbench wide/narrow, and mobile
companion web baselines for Simplified Chinese and English paths:

```powershell
npm run qa:e2e:visual
npm run qa:e2e:visual:fresh
```

Use the fresh variant when local Vite or static mobile web servers may be stale. The
mobile companion screenshot masks the horizontally scrollable language selector
after verifying the selected locale, while the rest of every page remains under
pixel comparison and overflow checks.

## Internationalization Coverage

- Default-path checks run with `zh-CN` browser locale and require `html[lang=zh-CN]`.
- Regional-path checks run with `en-US` browser locale and require `html[lang=en]`.
- Common-market smoke checks render both desktop and Web shells under `zh-CN`,
  `zh-TW`, `en-US`, `ja-JP`, `ko-KR`, `de-DE`, `fr-FR`, `es-ES`, `pt-BR`,
  `ru-RU`, `id-ID`, `vi-VN`, `th-TH`, `hi-IN`, and `ar-SA`, with
  `html[dir=rtl]` enforced for Arabic.
- Strict i18n checks require visible Simplified Chinese and English core copy,
  reject mixed Chinese on the English path, and verify desktop terminal panes
  remain `dir=ltr` inside RTL app chrome.
- Web Admin live snapshot smoke runs a small mock Sync API-compatible
  `/v1/admin/snapshot` endpoint behind the same-origin `/api/admin/snapshot`
  Vite proxy, verifies the browser request has no bearer authorization, and
  proves server-side proxy auth by loading the protected mock snapshot.
- Web Admin real Sync smoke runs the Rust Sync Service with durable temporary
  JSON ledger storage, seeds live device/change state through `/v1` APIs, then
  verifies the browser renders the real `/v1/admin/snapshot` projection through
  the same-origin `/api/admin/snapshot` proxy without page-side bearer auth.
- Mobile companion smoke serves static Expo Web exports at a 320 px viewport, verifies the
  intentional no-endpoint offline sync preview, checks dark OS status-surface
  colors, sanity-checks Arabic launch without document-level horizontal
  overflow, and separately verifies a live register/presence-push/pull preview
  with bearer authorization against a separate-origin mock Sync API. The live
  smoke repeats the refresh to prove the second registration reuses the assigned
  `device_id`, that the second push and pull use the prior pull `next_cursor`
  instead of restarting at `0`, and that browser requests do not stay on the
  Expo Web app origin.
- Full translation completeness remains a release gate in `docs/qa-checklist.md`.

## Native Mobile Follow-Up

The automated root E2E lane is intentionally Expo Web only. Native iOS simulator
and Android emulator launch coverage has a preflight and first Maestro flow, but
it should stay separate from root `npm run qa` until CI has stable device
capacity.

Use `npm run qa:mobile:native-preflight` from the repo root to validate the
native app config, shared smoke hooks, locale-independent Maestro flow, and host
tooling readiness. On machines without device tooling it reports warnings.
Device-capable runners can use
`npm run smoke:native:devices -w @atlasterm/mobile` to fail when Maestro,
Android, or iOS simulator tooling is missing.

The first executable flow is `apps/mobile/maestro/native-smoke.yaml`. Set
`ATLASTERM_MAESTRO_APP_ID` to the development-build or Expo Go app id, launch
the app through the existing `ios` or `android` scripts, and run
`npm run smoke:native:maestro -w @atlasterm/mobile`. The flow asserts the sync
status panel and register/pull action are reachable, then runs the no-endpoint
offline fallback path. It targets stable native `testID` hooks rather than
localized visible text, and verifies the offline status, fallback error, preview
surface, and both recovery route rows after the primary action.
