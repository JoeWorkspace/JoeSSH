# Sync Service Self-Hosting

Public Beta supports a self-hosted, single-process Sync Service. The JSON ledger
is intended for one running service instance. Multi-writer or clustered
production deployments require a transactional database backend and are outside
the `0.1.0-beta.10` support promise.

## Data Confidentiality Boundary

The Public Beta service authenticates routes but does not encrypt change
payloads end to end. It persists and returns each JSON `payload` as submitted,
so bearer authentication is not a substitute for payload confidentiality.

- Terminate TLS at an authenticating reverse proxy for every non-loopback
  deployment.
- Do not submit SSH private keys, passwords, bearer tokens, terminal output, or
  other secrets.
- Clients or deployers that need field confidentiality must encrypt those fields
  before submission and manage their own keys until JoeSSH ships a reviewed
  encrypted-envelope protocol.
- Filesystem and backup access to `ledger.json` must be treated as access to the
  unencrypted submitted payloads.

## Required Configuration

```bash
ATLASTERM_SYNC_BIND=127.0.0.1:4100
ATLASTERM_SYNC_AUTH_TOKEN=replace-with-32-plus-char-random-sync-token
ATLASTERM_SYNC_ADMIN_TOKEN=replace-with-32-plus-char-random-admin-token
ATLASTERM_SYNC_METRICS_TOKEN=replace-with-32-plus-char-random-metrics-token
ATLASTERM_SYNC_CORS_ORIGINS=https://admin.example.com
ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json
ATLASTERM_SYNC_RATE_LIMIT=100
ATLASTERM_SYNC_MAX_PUSH_CHANGES=256
ATLASTERM_SYNC_MAX_PULL_CHANGES=512
ATLASTERM_SYNC_MAX_STORED_CHANGES=100000
ATLASTERM_SYNC_MAX_LEDGER_BYTES=67108864
```

- `ATLASTERM_SYNC_AUTH_TOKEN` gates device registration, push, and pull routes.
- `ATLASTERM_SYNC_ADMIN_TOKEN` is required for `/v1/admin/snapshot` and must be
  a distinct bearer token for Web Admin; the regular sync token is rejected, and
  reusing the sync token fails closed.
- `ATLASTERM_SYNC_METRICS_TOKEN` protects `/metrics` when configured. Loopback
  deployments can scrape `/metrics` without it; non-loopback deployments must
  set it before startup succeeds.
- Environment-provided sync, admin, and metrics tokens must be at least 32 characters,
  must not contain whitespace or control characters, and must be distinct. The
  service fails fast on invalid production token configuration.
- `ATLASTERM_SYNC_CORS_ORIGINS` must list exact HTTP(S) origins; wildcards are
  rejected. Do not combine it with `ATLASTERM_SYNC_CORS_PERMISSIVE`; permissive
  CORS is loopback-only local development mode and non-loopback binds reject it
  at startup.
- `ATLASTERM_SYNC_STORAGE_PATH` enables durable single-process JSON storage with
  `schema_version: 1`, legacy v0 migration for ledgers without a version field,
  future-version fail-fast protection, a `ledger.lock` single-writer guard, and
  backup/temp recovery.
- Non-loopback binds such as `0.0.0.0:4100` fail startup unless
  `ATLASTERM_SYNC_AUTH_TOKEN`, `ATLASTERM_SYNC_METRICS_TOKEN`, and
  `ATLASTERM_SYNC_STORAGE_PATH` are configured, and permissive CORS is disabled.
  `ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1` exists only for explicit,
  short-lived evaluation environments; do not use it for Public Beta self-hosted
  deployments because the process-local ledger is lost on restart.
- `ATLASTERM_SYNC_RATE_LIMIT` limits per-client request rate. Invalid values
  fail startup instead of silently falling back; set `0` only when an upstream
  proxy enforces rate limiting.
- `ATLASTERM_SYNC_MAX_PUSH_CHANGES`, `ATLASTERM_SYNC_MAX_PULL_CHANGES`,
  `ATLASTERM_SYNC_MAX_STORED_CHANGES`, and `ATLASTERM_SYNC_MAX_LEDGER_BYTES`
  bound Public Beta JSON ledger growth and pull response size.
  Invalid or zero values fail startup. Registration and push requests that
  exceed a configured ledger quota return `413 Payload Too Large` with
  `code: "ledger_quota_exceeded"` and roll back any in-memory mutation.

## Docker

Build from the repository root:

```bash
docker build -f services/sync/Dockerfile -t joessh-sync:0.1.0-beta.10 .
docker run --rm -p 4100:4100 \
  --read-only \
  --cap-drop=ALL \
  --security-opt no-new-privileges \
  --pids-limit 256 \
  --memory 256m \
  --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  -e ATLASTERM_SYNC_AUTH_TOKEN=replace-with-32-plus-char-random-sync-token \
  -e ATLASTERM_SYNC_ADMIN_TOKEN=replace-with-32-plus-char-random-admin-token \
  -e ATLASTERM_SYNC_METRICS_TOKEN=replace-with-32-plus-char-random-metrics-token \
  -e ATLASTERM_SYNC_CORS_ORIGINS=https://admin.example.com \
  -e ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json \
  -v joessh-sync-data:/var/lib/joessh-sync \
  joessh-sync:0.1.0-beta.10
```

The container defaults to `ATLASTERM_SYNC_BIND=0.0.0.0:4100` and
`ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json`; pass sync,
admin, and metrics tokens and keep the volume mount so the JSON ledger survives
container restarts. The image includes a Docker `HEALTHCHECK` that probes
`/healthz` on `127.0.0.1:4100`; if you run the service on a different container
port, set `ATLASTERM_SYNC_HEALTHCHECK_PORT` to the listening port used by
`ATLASTERM_SYNC_BIND`.
The release Dockerfile builds with `Cargo.lock` via `cargo build --locked`,
uses the repository's exact Rust `1.96.0` toolchain, and pins both build and
runtime base images by multi-platform manifest digest. Dependabot checks the
Docker inputs weekly; review and merge a digest update only after the full
release gate passes. The repository `.dockerignore` excludes Git metadata,
Node dependencies, Rust
targets, generated dist files, coverage, env files, and release reports from
the build context. Keep the runtime root filesystem read-only, drop Linux
capabilities, enable `no-new-privileges`, and set memory, CPU, process, and
temporary filesystem limits as shown above.

## systemd

Use `services/sync/joessh-sync.service.example` as a starting point. Create a
dedicated `joessh-sync` user, install the release binary as
`/usr/local/bin/joessh-sync`, create `/var/lib/joessh-sync`, then copy the
example service to `/etc/systemd/system/joessh-sync.service`.
The example uses `StateDirectory=joessh-sync`, `NoNewPrivileges`,
`PrivateDevices`, strict filesystem protection, kernel/control-group protection,
an empty `CapabilityBoundingSet`, address-family restrictions, and CPU, memory,
task, and file-descriptor resource limits. Adjust resource ceilings for larger
self-hosted deployments, but keep the sandboxing directives unless your host
policy has an audited replacement.

## Smoke Test

Before exposing the service, run:

```bash
npm run qa:sync:self-hosted-smoke
npm run qa:sync-release-package
npm run qa:sync:release-smoke
npm run qa:sync:release-backup-restore-smoke
npm run qa:sync:config-guard-smoke
npm run qa:sync:backup-restore-smoke
```

The smoke starts a local service, checks `/healthz` and `/readyz`, verifies
admin auth, exercises CORS preflight, registers two devices, pushes and pulls a
change, confirms that `/v1/admin/snapshot` projects those devices for Web Admin,
and asserts that `/metrics` reports the expected request, auth, storage, ledger,
device, change, and cursor counters.
`qa:sync:self-hosted-smoke` uses the debug service binary for fast local
validation; `qa:sync:release-smoke` first packages the release binary under
`reports/release/sync/` and runs the same smoke against that published
artifact.
`qa:sync:release-backup-restore-smoke` runs the backup/restore drill against the
staged release binary and records evidence tying the drill to the staged release
binary path, that binary's sha256, and the checksum manifest.
`qa:sync-release-package` is the fast package-hygiene self-test for the release
wrapper: it proves stale staged Sync binaries are removed, release evidence
files are preserved, and `SHA256SUMS.txt` points at the current platform
artifact before the slower packaged-service smoke runs.
`qa:sync:config-guard-smoke` starts one real service with a JSON ledger, then
verifies that a public bind without metrics auth fails startup, a public bind
without durable storage fails startup, a public bind with permissive CORS fails
startup, and a second service pointed at the same `ATLASTERM_SYNC_STORAGE_PATH`
fails to acquire `ledger.lock` while the first service remains healthy.
`qa:sync:backup-restore-smoke` runs the operator backup/restore drill against a
real local service: it seeds two devices and a change, copies an operator backup,
corrupts the primary JSON ledger, restores the backup as the service `.bak`
ledger, restarts the service, verifies pull/admin snapshot recovery, asserts
`joessh_sync_ledger_recovery_total{source="backup"} 1`, writes a new
post-recovery change, and records evidence in
`reports/smoke/sync/backup-restore-smoke.json`.

## Backup And Restore Drill

For Public Beta, the supported JSON ledger recovery model is single-process
self-hosting with an external backup copy. The service also uses `.bak` and
`.tmp` files internally during atomic writes, but operators should keep their
own scheduled backup outside the data directory or in durable object storage.

Suggested backup command:

```bash
sudo systemctl stop joessh-sync
sudo install -d -m 0700 /var/backups/joessh-sync
sudo cp /var/lib/joessh-sync/ledger.json \
  /var/backups/joessh-sync/ledger-$(date -u +%Y%m%dT%H%M%SZ).json
sudo sha256sum /var/backups/joessh-sync/ledger-*.json | tail -n 1
sudo systemctl start joessh-sync
```

Suggested restore command:

```bash
sudo systemctl stop joessh-sync
sudo cp /var/backups/joessh-sync/ledger-20260621T000000Z.json \
  /var/lib/joessh-sync/ledger.bak
sudo printf '{corrupt-primary-ledger' > /var/lib/joessh-sync/ledger.json
sudo systemctl start joessh-sync
curl -fsS http://127.0.0.1:4100/readyz
curl -fsS \
  -H "Authorization: Bearer ${ATLASTERM_SYNC_METRICS_TOKEN}" \
  http://127.0.0.1:4100/metrics | grep 'joessh_sync_ledger_recovery_total{source="backup"}'
```

RPO is bounded by the age of the last operator backup copy. RTO is the time to
stop the service, place the backup at `ledger.bak`, restart, and verify
`/readyz`, `/metrics`, `/v1/sync/pull`, and `/v1/admin/snapshot`.
`npm run qa:sync:backup-restore-smoke` is the release-machine rehearsal for this
procedure and records the measured local RTO in `reports/smoke/sync/` evidence
without replacing packaged release evidence.
Packaged release candidates also run
`npm run qa:sync:release-backup-restore-smoke` so backup/restore evidence points
at the staged release binary path, binary sha256, and checksum manifest before
publish preflight.

## Operations Metrics

`/metrics` exposes Prometheus text metrics without bearer authentication only
for loopback deployments where a local sidecar scrapes the service. Set
`ATLASTERM_SYNC_METRICS_TOKEN` for any non-loopback bind; scrapers must then
send `Authorization: Bearer <metrics-token>`. Do not expose `/metrics` directly
on the public internet without TLS and an authenticating reverse proxy.

Key Public Beta metrics:

- `joessh_sync_http_requests_total{method,path,status}` and
  `joessh_sync_http_request_duration_seconds_*` for request volume, status mix,
  and latency.
- `joessh_sync_auth_failures_total{surface}` for sync/admin credential failures.
- `joessh_sync_rate_limited_total` for `429` rate-limit events.
- `joessh_sync_storage_write_failures_total` for JSON ledger write failures.
- `joessh_sync_ledger_recovery_total{source}` for recovery from `.bak` or `.tmp`
  ledger files.
- `joessh_sync_devices_registered`, `joessh_sync_changes_stored`,
  `joessh_sync_latest_sequence`, `joessh_sync_processed_change_ids`, and
  `joessh_sync_audit_events` for current ledger size and cursor state.

The JSON ledger intentionally keeps `changes` as complete sync history so
`GET /v1/sync/pull?since=0` and slow devices remain recoverable through
paginated replay. The
`audit_log` field is bounded operational history for recent Web Admin events;
older audit log entries are compacted before persistence and should not be used
as a compliance archive.
Use `ATLASTERM_SYNC_MAX_PUSH_CHANGES`, `ATLASTERM_SYNC_MAX_PULL_CHANGES`,
`ATLASTERM_SYNC_MAX_STORED_CHANGES`, and `ATLASTERM_SYNC_MAX_LEDGER_BYTES` to
cap accidental growth. Pull clients should keep requesting
`since=next_cursor` until `has_more` is `false`; a page may advance the cursor
without returned changes when it scans over changes from the same device. If a
ledger quota is reached, clients receive `413 Payload Too Large` with
`code: "ledger_quota_exceeded"`; raise the limit, compact through a future
database-backed migration, or provision a database backend before accepting more
history.

Suggested Public Beta alerts: page on any sustained storage write failure, any
ledger recovery outside a planned restore drill, a spike in admin auth failures,
or a sustained rate-limit rate that blocks legitimate clients. Track p95 request
latency from the duration sum/count series and investigate before Web Admin
snapshot refreshes exceed operator expectations.

## Public Beta Limits

- Do not run multiple Sync Service instances against one JSON ledger.
  `ledger.lock` is an atomic single-writer guard removed on clean shutdown. If a
  host crashes, restart removes a stale lock whose owner PID is no longer
  running; if the lock cannot be parsed, confirm no Sync Service process is
  running before deleting it manually.
- Do not treat the JSON ledger quotas as a multi-tenant capacity plan. They are
  DoS guardrails for single-process Public Beta self-hosting; high-retention,
  clustered, or multi-writer deployments require a database backend.
- Put TLS termination, request logging, and backup/restore automation in front
  of the service for any internet-facing deployment.
- Do not expose a non-loopback deployment without durable JSON ledger storage.
  The service fails fast by default; `ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1`
  is a development/evaluation escape hatch, not a supported Public Beta
  operating mode.
- Use `/healthz` for liveness, `/readyz` for readiness, and `/metrics` for
  operational telemetry; startup fails before serving traffic when the
  configured JSON ledger directory cannot be prepared, and `/readyz` returns
  `503` if configured JSON ledger storage becomes unwritable after startup.
- Keep sync and admin bearer tokens distinct; without a distinct
  `ATLASTERM_SYNC_ADMIN_TOKEN`, the admin snapshot route fails closed with
  `403 admin_token_required`.
- Rotate tokens and redeploy Web Admin if an admin snapshot token is exposed.
