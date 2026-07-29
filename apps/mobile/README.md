# JoeSSH Mobile

Expo companion app for JoeSSH mobile sync preview and emergency context.

## Commands

```powershell
cd apps/mobile
npm install
npm run start
npm run test
npm run typecheck
npm run smoke:native:preflight
```

Set `EXPO_PUBLIC_ATLASTERM_SYNC_URL=http://127.0.0.1:4100` to point the
mobile preview at the local sync service. Without that endpoint, the app shows
an explicit empty offline state. It does not claim that cached workspace data or
emergency routes exist when none were loaded.

For local preview only, when the sync service is started with
`ATLASTERM_SYNC_AUTH_TOKEN`, set the matching mobile build-time value with
`EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=<token>`. Mobile sync requests then send
`Authorization: Bearer <token>` for the register, presence-push, and pull calls.
Because `EXPO_PUBLIC_*` values are embedded in mobile bundles, public mobile
beta builds must use a pairing, OIDC, or device-scoped credential flow instead
of this shared build-time bearer token path.

The first screen registers the mobile device through `POST /v1/devices/register`,
pushes a small `mobile_presence` checkpoint through `POST /v1/sync/push`, then
pulls preview state from `GET /v1/sync/pull`. The presence push uses the current
device cursor as `base_cursor`, and the preview pull uses that same current
cursor as `since` so remote changes between the old cursor and the push response
are not skipped. After a successful pull, the returned `next_cursor` is retained
for the next refresh from the same device and persisted with its endpoint-scoped
device registration. A generated install UUID is persisted before the first
registration, so an ambiguous registration retry cannot create a fresh device
identity after an app restart. Presence checkpoint IDs and timestamps are also
persisted until acknowledgement, allowing a timeout retry to use the server's
change-ID idempotency instead of writing a duplicate presence event.

Presence checkpoint conflicts and transport failures are treated as non-blocking
status-signal failures; the app still pulls the read-only response from the last
successful cursor and surfaces the checkpoint warning. Pull responses are
device-ID validated and all advertised pages are consumed before the preview is
reported ready. The pull cursor is persisted only after the final page succeeds,
so an interrupted refresh resumes from the last complete checkpoint. The current
client counts pulled change envelopes but does not yet decrypt them into profile,
session, workspace, command, or recovery-route models; those surfaces remain
honestly empty until that product work is implemented.

Service tests cover endpoint selection, optional bearer auth, durable install
and registration identity, retained cursors across runtime restarts, idempotent
presence retries, paginated pulls, response-body timeouts, device-ID validation,
malformed successful register/push/pull responses, offline fallback,
timeout/unauthorized classification, and non-fabricated empty preview data.
Home screen tests cover the idle, registering, ready, offline fallback, and
structured-error UI states for the sync preview flow, including light and dark
OS theme readability, phone and tablet portrait/landscape sizing, large text,
RTL layout, coalesced repeated action events, repeated same-device refreshes
that advance from the last successful pull cursor, retain that cursor after
failed refreshes, and continue preview pulls after non-blocking presence
checkpoint failures.

## Native Smoke Strategy

Expo Web is the automated smoke lane today. Native iOS and Android coverage
should be added as a separate simulator/emulator smoke before it joins the root
QA gate, because it needs stable device runtime capacity.

The first native smoke should verify:

- iOS simulator and Android emulator launch the Expo Router app.
- The home screen renders the sync status panel and register/pull action.
- The no-endpoint offline fallback reaches the offline status, fallback error,
  sync preview, and empty recovery-state hooks after running the preview.
- Light and dark OS appearances keep the status panel and empty-state copy readable.

Recommended tooling is Maestro or Detox driven through the existing `npm run ios`
and `npm run android` scripts, with the Expo Web Playwright project left as the
fast cross-platform browser smoke.

The native readiness preflight validates the Expo app config, mobile runtime
hooks, locale-independent native smoke flow, no-endpoint fallback contract, and
local simulator/emulator tooling. On machines without device tooling it reports
warnings but still checks the app-side readiness contract:

```powershell
npm run smoke:native:preflight
```

Device-capable CI or developer machines should use the strict form so missing
Maestro, Android, or iOS simulator tooling fails the run:

```powershell
npm run smoke:native:devices
```

The first Maestro flow lives at `maestro/native-smoke.yaml` and targets shared
`testID` hooks instead of localized visible copy, so it can run under any device
locale. After tapping the primary action, the flow asserts the offline fallback
status, fallback error panel, preview command surface, and honest empty recovery
state. Set the app id for the runtime being tested before launching it, for
example:

```powershell
$env:ATLASTERM_MAESTRO_APP_ID='com.atlasterm.mobile'
npm run smoke:native:maestro
```

For Expo Go runs, use the Expo Go app id instead of the development-build
identifier above.
