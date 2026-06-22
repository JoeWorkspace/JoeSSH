# JoeSSH Sync API

Base URL for local development: `http://127.0.0.1:4100`.

Device-specific sync endpoints require prior registration. Requests for unknown
devices return `404 Not Found` with `code: "unknown_device"`.

`GET /healthz` is public for process probes. Device registration, push, and
pull routes can be protected by setting `ATLASTERM_SYNC_AUTH_TOKEN`; when
configured, sync clients must send:

```http
Authorization: Bearer <token>
```

Missing credentials return `401 Unauthorized` with
`code: "missing_authorization"`. Rejected credentials return `403 Forbidden`
with `code: "invalid_authorization"`. Malformed bearer credentials are rejected
with the same `invalid_authorization` code. CORS preflight requests bypass sync
authorization so browsers can discover allowed methods and headers.

When `ATLASTERM_SYNC_AUTH_TOKEN` is unset, device registration, push, and pull
routes are unauthenticated. To avoid accidentally exposing an open service, the
process refuses to start if `ATLASTERM_SYNC_BIND` resolves to a non-loopback
address while no auth token is configured; bind to a loopback address or set a
token. Environment-provided sync, admin, and metrics bearer tokens must be at least 32
characters, must not contain whitespace or control characters, and must be
distinct; invalid token configuration fails startup. Non-loopback binds also
require `ATLASTERM_SYNC_METRICS_TOKEN` metrics auth and durable JSON ledger
storage with `ATLASTERM_SYNC_STORAGE_PATH`, and reject permissive CORS in favor
of scoped `ATLASTERM_SYNC_CORS_ORIGINS`; otherwise startup fails even when
sync/admin bearer tokens are configured. `ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1`
is an explicit short-lived evaluation escape hatch and is not a supported
Public Beta self-hosted deployment mode.

`GET /metrics` returns Prometheus text metrics. It is unauthenticated only when
no `ATLASTERM_SYNC_METRICS_TOKEN` is configured, which is intended for loopback
scrapers. When the metrics token is configured, callers must send
`Authorization: Bearer <metrics-token>`; missing credentials return
`401 Unauthorized`, `code: "missing_authorization"`, and wrong credentials
return `403 Forbidden`, `code: "metrics_forbidden"`.

The admin dashboard endpoint `GET /v1/admin/snapshot` requires a dedicated
credential via `ATLASTERM_SYNC_ADMIN_TOKEN`, distinct from
`ATLASTERM_SYNC_AUTH_TOKEN`. The regular sync token is never accepted for this
route (`403 Forbidden`, `code: "admin_forbidden"`), and the admin token does not
grant access to the other sync routes. If `ATLASTERM_SYNC_ADMIN_TOKEN` is unset
or matches the sync token, the admin route fails closed with `403 Forbidden`,
`code: "admin_token_required"`.

Browser callers should set `ATLASTERM_SYNC_CORS_ORIGINS` to a comma-separated
HTTP(S) origin allowlist before deployment, for example:

```powershell
$env:ATLASTERM_SYNC_CORS_ORIGINS='https://admin.atlasterm.example'
```

If the allowlist is unset, the service does not emit browser CORS allow-origin
headers. For local browser development only, set
`ATLASTERM_SYNC_CORS_PERMISSIVE=1` to allow any origin explicitly on loopback
binds. Non-loopback binds reject permissive CORS at startup; use
`ATLASTERM_SYNC_CORS_ORIGINS` with exact HTTP(S) origins for deployed browser
callers. Do not combine permissive CORS with `ATLASTERM_SYNC_CORS_ORIGINS`;
ambiguous CORS modes fail startup. When an origin allowlist is configured, it
allows `GET`, `POST`, and `OPTIONS` with the `Authorization` and `Content-Type`
request headers.

By default the service keeps its sync ledger in process memory. Set
`ATLASTERM_SYNC_RATE_LIMIT` to configure the per-second request rate limit
(default: 100 requests/second). Requests exceeding the limit receive a
`429 Too Many Requests` response. Invalid rate-limit values fail startup; set
`0` only when an upstream proxy enforces rate limiting. Set
`ATLASTERM_SYNC_STORAGE_PATH` to a JSON file path to load and persist registered
devices, processed change IDs, accepted changes, and the latest cursor across
service restarts. New ledgers write `schema_version: 1`; ledgers without
`schema_version` are treated as legacy v0 and migrated in memory, while ledgers
with a future `schema_version` fail startup instead of being rewritten by an old
binary. When JSON storage is enabled, the service also holds a `ledger.lock`
single-writer guard so a second service instance cannot open the same ledger at
the same time. Register and push mutations are written through a temporary file
and backup replacement before the request is acknowledged. During startup, the
service prefers the primary ledger, recovers from a valid `.bak` ledger when the
primary file is missing or unreadable, and can recover a complete `.tmp` ledger
only when neither the primary nor backup ledger is present.

Self-hosted operators can bound JSON ledger growth with
`ATLASTERM_SYNC_MAX_PUSH_CHANGES` (default: 256 changes per push),
`ATLASTERM_SYNC_MAX_PULL_CHANGES` (default: 512 scanned ledger entries per pull),
`ATLASTERM_SYNC_MAX_STORED_CHANGES` (default: 100000 stored changes), and
`ATLASTERM_SYNC_MAX_LEDGER_BYTES` (default: 67108864 bytes). Invalid or zero
values fail startup. Requests that exceed a configured ledger quota return
`413 Payload Too Large` with `code: "ledger_quota_exceeded"` and roll back any
in-memory mutation; existing over-quota ledgers fail startup before serving
traffic. These limits protect the Public Beta JSON ledger from accidental DoS,
but they are not a substitute for a database backend when multi-writer,
clustered, or long-retention deployments are required.

The JSON ledger keeps accepted `changes` as complete sync history so
`GET /v1/sync/pull?since=0` and slow devices can still rebuild state from the
beginning through paginated replay. The separate `audit_log` field is bounded operational history for
recent registration-style events used by Web Admin; old audit log entries are
compacted before persistence, while accepted changes are not compacted.

## Health And Readiness

`GET /healthz`

Status: `200 OK`

```json
{
  "ok": true,
  "service": "atlasterm-sync",
  "version": "0.1.0",
  "checked_at": "2026-05-24T00:00:00Z"
}
```

`GET /readyz`

Status: `200 OK` when process-local memory storage is active or the configured
JSON ledger directory is writable. Startup fails before serving traffic when the
configured JSON ledger directory cannot be prepared; after startup, status is
`503 Service Unavailable` if configured JSON ledger storage cannot be probed.
The response does not expose the local filesystem path.

```json
{
  "ok": true,
  "service": "atlasterm-sync",
  "version": "0.1.0",
  "checked_at": "2026-05-24T00:00:00Z",
  "storage": {
    "mode": "json_ledger",
    "writable": true,
    "message": "configured sync storage is writable"
  }
}
```

## Register Device

`POST /v1/devices/register`

Status: `200 OK`

Supported `platform` values are `desktop`, `web`, `ios`, and `android`.
`app_version` must be non-empty, at most 64 characters, and must not contain
leading/trailing whitespace, control characters, or Unicode format characters.
`display_name` is optional, but when present it must be non-empty, at most 128
characters, and must not contain leading/trailing whitespace, control
characters, or Unicode format characters. Invalid registration fields return
`400 Bad Request` with `code: "invalid_sync_request"`.

```json
{
  "device_id": "optional-existing-device-uuid",
  "platform": "ios",
  "app_version": "0.1.0",
  "display_name": "Alex's iPhone"
}
```

Response:

```json
{
  "device_id": "0af7b567-8c34-4318-8c6b-31cddfc36e6f",
  "sync_cursor": "0",
  "server_time": "2026-05-24T00:00:00Z"
}
```

Registration can return `413 Payload Too Large` with
`code: "ledger_quota_exceeded"` when the new device record would exceed the
configured JSON ledger quota.

## Push Changes

`POST /v1/sync/push`

Status: `202 Accepted`

Cursors are `0` or `server-N`; `base_cursor` is required for push requests.
Supported `operation` values are `create`, `update`, and `delete`.
Each `entity_type` and `entity_id` must be a canonical sync entity token: at
most 128 characters, starting with lowercase ASCII letter or digit, then only
lowercase ASCII letters, digits, `.`, `_`, `:`, or `-`. Invalid entity tokens
return `400 Bad Request` with `code: "invalid_sync_request"` before any change
is accepted.

```json
{
  "device_id": "0af7b567-8c34-4318-8c6b-31cddfc36e6f",
  "base_cursor": "server-1",
  "changes": [
    {
      "id": "292fbdf8-3868-4a11-b988-6d0301010650",
      "entity_type": "profile",
      "entity_id": "local-profile",
      "operation": "update",
      "payload": { "name": "Atlas Operator" },
      "client_time": "2026-05-24T00:00:00Z"
    }
  ]
}
```

Response:

```json
{
  "accepted": 1,
  "sync_cursor": "server-1",
  "conflicts": []
}
```

`changes[].id` is idempotent. Replaying an already accepted change returns
`accepted: 0` and does not duplicate the change envelope. If a pushed entity was
changed after `base_cursor`, the service returns the conflict in `conflicts`
with `reason: "changed_after_base_cursor"` instead of accepting that item.
`conflicts` entries include `entity_type`, `entity_id`, and `reason`.

Push validation errors:

- Missing device id or blank `base_cursor` returns `400 Bad Request` with
  `code: "invalid_sync_request"`.
- Invalid `entity_type` or `entity_id` tokens return `400 Bad Request` with
  `code: "invalid_sync_request"`.
- Empty `changes` returns `400 Bad Request` with `code: "empty_change_set"`.
- A cursor other than `0` or `server-N` returns `400 Bad Request` with
  `code: "invalid_cursor"`.
- An unregistered `device_id` returns `404 Not Found` with
  `code: "unknown_device"`.
- A push with more than `ATLASTERM_SYNC_MAX_PUSH_CHANGES`, a ledger already at
  `ATLASTERM_SYNC_MAX_STORED_CHANGES`, or an update that would exceed
  `ATLASTERM_SYNC_MAX_LEDGER_BYTES` returns `413 Payload Too Large` with
  `code: "ledger_quota_exceeded"` and rolls back the in-memory mutation.
- If `ATLASTERM_SYNC_STORAGE_PATH` is configured and the updated ledger cannot
  be written, the service returns `503 Service Unavailable` with
  `code: "storage_unavailable"` and rolls back the in-memory mutation. The
  same change ID can be retried after storage is restored because the failed
  write is not marked as processed.

## Pull Changes

`GET /v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=server-1&limit=100`

Status: `200 OK`

Cursors are `0` or `server-N`; omitted `since` defaults to `0`. `limit` is
optional, must be greater than zero, and is capped by
`ATLASTERM_SYNC_MAX_PULL_CHANGES`.

```json
{
  "device_id": "0af7b567-8c34-4318-8c6b-31cddfc36e6f",
  "since": "server-1",
  "next_cursor": "server-2",
  "has_more": false,
  "changes": [
    {
      "id": "292fbdf8-3868-4a11-b988-6d0301010650",
      "entity_type": "profile",
      "entity_id": "local-profile",
      "operation": "update",
      "payload": { "name": "Atlas Operator" },
      "sync_cursor": "server-2",
      "server_time": "2026-05-24T00:00:00Z"
    }
  ]
}
```

Pull responses exclude changes originally pushed by the requesting device.
`limit` bounds the scanned ledger sequence window, not only the returned remote
change count, so a page can contain zero `changes` and still advance
`next_cursor` over changes created by the requesting device. Continue pulling
with `since=next_cursor` until `has_more` is `false`. `next_cursor` is stable
when no new changes have been accepted.

Pull validation errors:

- A cursor other than `0` or `server-N` returns `400 Bad Request` with
  `code: "invalid_cursor"`.
- A zero `limit` returns `400 Bad Request` with
  `code: "invalid_sync_request"`.
- An unregistered `device_id` returns `404 Not Found` with
  `code: "unknown_device"`.

## Admin Snapshot

`GET /v1/admin/snapshot`

Status: `200 OK`

This route requires the dedicated `ATLASTERM_SYNC_ADMIN_TOKEN` bearer token,
distinct from `ATLASTERM_SYNC_AUTH_TOKEN`. Missing credentials return
`401 Unauthorized`, `code: "missing_authorization"`. The regular
`ATLASTERM_SYNC_AUTH_TOKEN` and any other wrong token are rejected with
`403 Forbidden`, `code: "admin_forbidden"`. If `ATLASTERM_SYNC_ADMIN_TOKEN` is
unset or matches the sync token, the route fails closed with `403 Forbidden`,
`code: "admin_token_required"` instead of accepting the regular sync token. It
returns a Web Admin-compatible snapshot projected from the current sync ledger.
Snapshot record IDs are canonical lowercase ASCII tokens using
letters, digits, `.`, `_`, `:`, or `-` so Web Admin can safely use them as stable
row keys and accessible row references.

```json
{
  "metrics": {
    "activeMembers": 1,
    "auditEventsToday": 1,
    "healthyDevices": 2,
    "rolesConfigured": 1
  },
  "members": [
    {
      "deviceCount": 2,
      "email": "local-sync@atlasterm.dev",
      "id": "member-local-sync",
      "name": "Local Sync Operator",
      "role": "Workspace Admin",
      "status": "active"
    }
  ],
  "roles": [
    {
      "id": "workspace-admin",
      "memberCount": 1,
      "name": "Workspace Admin",
      "risk": "full",
      "scope": "Members, roles, sync policy"
    }
  ],
  "devices": [
    {
      "cursor": "server-1",
      "id": "0af7b567-8c34-4318-8c6b-31cddfc36e6f",
      "lastSeen": "2026-05-24T00:00:00Z",
      "name": "Desktop Workstation",
      "owner": "Local Sync Operator",
      "platform": "desktop",
      "status": "current"
    }
  ],
  "auditEvents": [
    {
      "action": "Accepted Update sync change",
      "actor": "Sync API",
      "id": "audit-292fbdf8-3868-4a11-b988-6d0301010650",
      "target": "profile:local-profile",
      "time": "2026-05-24T00:00:00Z"
    }
  ]
}
```

When the sync ledger is empty, the endpoint still returns `200 OK` with zero
metrics and empty `members`, `roles`, `devices`, and `auditEvents` arrays. The
Web Admin treats that valid shape as its empty state.

### Device status values

| Status | Meaning |
|--------|---------|
| `current` | Device cursor matches the latest sequence, or no changes exist yet |
| `catching_up` | Activity within the last 60 seconds but cursor is behind |
| `degraded` | Last activity 60–600 seconds ago |
| `offline` | Last activity more than 600 seconds ago |

### Member status values

| Status | Meaning |
|--------|---------|
| `active` | Member is actively participating in sync |
| `invited` | Member has been invited but has not yet joined |
| `suspended` | Member access has been suspended |

## Notes For Future Implementation

- The JSON ledger is a single-process durability lane. Replace it with a
  transactional database-backed store before multi-writer or clustered
  production deployment.
- Extend conflict detection from entity-level stale-base checks to field-aware
  merge policy once encrypted payload envelopes are finalized.
