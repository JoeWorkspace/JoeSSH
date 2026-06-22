# JoeSSH Sync Service

Rust Axum service for the JoeSSH sync API. By default the service uses a
process-local ledger for registered devices, idempotent change IDs, monotonic
cursors, pull windows, and stale-base conflict detection. Set
`ATLASTERM_SYNC_STORAGE_PATH` to a JSON file path to load and persist that
ledger across service restarts.

## Intended Commands

```powershell
cd services/sync
cargo run
cargo test
```

The service listens on `ATLASTERM_SYNC_BIND`, defaulting to `127.0.0.1:4100`.
If `ATLASTERM_SYNC_BIND` is a non-loopback address, startup requires a sync
bearer token, a metrics bearer token, and durable JSON ledger storage via
`ATLASTERM_SYNC_STORAGE_PATH`; permissive CORS is rejected on non-loopback binds.
`ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1` is an explicit short-lived evaluation
escape hatch; do not use it for Public Beta self-hosted deployments.

Set `ATLASTERM_SYNC_STORAGE_PATH` when local or single-process deployments need
registered devices and accepted sync changes to survive restart:

```powershell
$env:ATLASTERM_SYNC_STORAGE_PATH='C:\ProgramData\JoeSSH\sync-ledger.json'
cargo run
```

The service writes the ledger through a temporary file and backup replacement.
New ledgers include `schema_version: 1`; ledgers without `schema_version` are
treated as legacy v0 and migrated in memory, while future `schema_version`
values fail startup to avoid old binaries rewriting newer ledger formats.
When JSON storage is enabled, the service creates a `ledger.lock` single-writer
guard; a second service instance pointed at the same ledger fails startup
instead of sharing the file. Clean shutdown removes the lock. After a host
crash, restart removes a stale lock whose owner PID is no longer running; if
the lock cannot be parsed, delete it only after confirming no service process is
running.
During startup, the primary ledger is preferred, a valid `.bak` ledger recovers
the previous committed state if the primary file is missing or unreadable, and a
complete `.tmp` ledger is used only when neither primary nor backup exists.
If a register or push mutation cannot be persisted, the request returns
`503 Service Unavailable` with `code: "storage_unavailable"` and the in-memory
mutation is rolled back. The same request can be retried after storage is
restored because failed push change IDs are not marked as processed.
Set `ATLASTERM_SYNC_MAX_PUSH_CHANGES`, `ATLASTERM_SYNC_MAX_PULL_CHANGES`,
`ATLASTERM_SYNC_MAX_STORED_CHANGES`, and `ATLASTERM_SYNC_MAX_LEDGER_BYTES` to
bound JSON ledger growth and pull page size. Requests that exceed a configured ledger quota return `413 Payload Too Large` with
`code: "ledger_quota_exceeded"` and roll back any in-memory mutation; existing
over-quota ledgers fail startup before serving traffic.

By default the service keeps `/v1` open for local development. Set
`ATLASTERM_SYNC_AUTH_TOKEN` before exposing it beyond localhost; when present,
all `/v1` requests require `Authorization: Bearer <token>`. Environment-provided
sync, admin, and metrics bearer tokens must be at least 32 characters, must not
contain whitespace/control characters, and must be distinct. `GET /healthz`
remains unauthenticated for process probes. `GET /metrics` is open only when no
`ATLASTERM_SYNC_METRICS_TOKEN` is configured, which is intended for loopback
scrapers; when configured it requires `Authorization: Bearer <metrics-token>`.

Browser CORS does not allow cross-origin callers unless configured. Set
`ATLASTERM_SYNC_CORS_ORIGINS` to a comma-separated HTTP(S) origin allowlist for
deployed admin or companion clients:

```powershell
$env:ATLASTERM_SYNC_AUTH_TOKEN='dev-sync-token-0123456789abcdef0123456789'
$env:ATLASTERM_SYNC_ADMIN_TOKEN='dev-admin-token-9876543210fedcba987654'
$env:ATLASTERM_SYNC_METRICS_TOKEN='dev-metrics-token-00112233445566778899'
$env:ATLASTERM_SYNC_CORS_ORIGINS='https://admin.atlasterm.example,https://ops.atlasterm.example'
cargo run
```

For local browser development only, set `ATLASTERM_SYNC_CORS_PERMISSIVE=1` to
allow any origin explicitly on loopback binds. Non-loopback binds reject
permissive CORS at startup. Do not combine permissive CORS with
`ATLASTERM_SYNC_CORS_ORIGINS`; the service rejects ambiguous CORS modes at startup.

## API Surface

- `GET /healthz` returns liveness/process health and service metadata.
- `GET /readyz` returns readiness and verifies configured JSON ledger storage
  is writable before traffic is routed to the service.
- `POST /v1/devices/register` registers or refreshes a sync device identity.
- `GET /v1/admin/snapshot` returns a Web Admin-compatible ledger snapshot.
- `POST /v1/sync/push` accepts an ordered batch of local changes.
- `GET /v1/sync/pull?device_id=...&since=...&limit=...` returns paginated remote changes after a cursor.

See [../../docs/sync-api.md](../../docs/sync-api.md) for request and response shapes.
