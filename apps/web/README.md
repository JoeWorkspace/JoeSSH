# JoeSSH Web Admin

Vite React read-only viewer for JoeSSH team, device, role, and audit snapshots.
It does not currently ship mutating admin operations, billing, or hosted SaaS.

## Commands

```powershell
cd apps/web
npm install
npm run dev
npm run typecheck
npm run build
```

## Admin Snapshot Data

The console has an explicit data boundary for admin dashboard state:

- Live mode is the default, including the public root path. It fetches the
  configured admin snapshot endpoint and shows loading, authentication-required,
  empty, unavailable, or populated states.
- Fixture mode is explicit with `?adminSnapshot=fixture`. It renders
  `src/adminData.fixture.ts` so local dev, docs, and E2E smoke tests work without
  a running backend, but public deployments do not show simulated team data by
  accident.
- Live refreshes abort older in-flight refreshes. Timeout or caller abort applies
  through JSON parsing, stale body reads cannot overwrite current state, and the
  refresh control exposes a busy state while live snapshot loading is active.
- `VITE_ATLASTERM_ADMIN_SNAPSHOT_URL` overrides the live endpoint. Without it,
  live mode fetches `/api/admin/snapshot`. Unsupported protocols, protocol-relative
  URLs, malformed absolute URLs including HTTP(S) scheme-without-authority
  forms, non-root-relative URLs, raw whitespace- or backslash-bearing URLs, URLs
  with embedded credentials, and control- or format-character-bearing URLs fall
  back to the same-origin default at the loader boundary; URL fragments are
  stripped before requests.
- Browser bundles do not send admin snapshot bearer tokens. For protected Sync
  admin endpoints, deploy `/api/admin/snapshot` as a same-origin proxy and attach
  `ATLASTERM_SYNC_ADMIN_TOKEN` or equivalent authorization at the proxy layer.
  `deploy/web-admin/node-admin-snapshot-proxy.mjs` is a production proxy example
  for self-hosted Node environments; validate it with
  `npm run qa:web-admin-proxy-smoke`.

For local integration against `services/sync`, set
`ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET=http://127.0.0.1:4100` and
`ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN` to the same value as
`ATLASTERM_SYNC_ADMIN_TOKEN`, then open the Web Admin root path or use
`?adminSnapshot=live`.

The E2E suite includes a mock Sync API-compatible snapshot endpoint and verifies
that live Web Admin can load the same-origin `/api/admin/snapshot` proxy without
exposing bearer authorization to the browser:

```powershell
npm run test:web -w @atlasterm/e2e
```

The snapshot payload must be served with a JSON media type and include `metrics`,
`members`, `roles`, `devices`, and `auditEvents`. Record IDs must be canonical
lowercase ASCII tokens using only letters, digits, `.`, `_`, `:`, or `-`, and
display fields must be nonblank, unpadded, and free of control or format
characters before render code can consume them. `401` and `403` responses are
treated as authentication-required states before response bodies are read so sync
data is not shown before access is granted, and unavailable/error state copy must
not expose raw response details or bearer tokens.
