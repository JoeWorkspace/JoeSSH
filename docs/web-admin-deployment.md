# Web Admin Deployment

JoeSSH Web Admin is a static Vite build. Public Beta deployments can use any
static host that preserves the generated files and the deployment `_headers`
file.

## Build And Verify

```bash
npm run build:web
npm run qa:subresource-integrity
npm run qa:security-headers
npm run qa:bundle-size
npm run release:web
node scripts/verify-web-release-package.mjs
```

The generated `_headers` file must be deployed with the static assets. It
provides HTTP-only protections that HTML meta tags cannot enforce, including
clickjacking protection.
For the source-only beta.20/beta.21 revisions and the Store-only beta.22 through beta.24
source revisions, these commands are local build/deployment validation only; do not
attach the generated zip to any of their zero-asset GitHub prereleases. A later
public binary release must first use a distinct unused `FULL_RELEASE_VERSION`
after beta.24. For that release,
`release:web` writes Web
Admin checksums to
`reports/release/web/SHA256SUMS.txt` and packages the deployable static bundle
as `reports/release/web/joessh-web-admin-<FULL_RELEASE_VERSION>.zip`. The zip contains
the deployable `dist` contents at the archive root, including `_headers` and
`.well-known/security.txt`. `verify-web-release-package.mjs` checks the staged
zip itself before upload: the checksum manifest must bind to the zip, required
deployment files must be present, `_headers` must contain the HTTP security
headers, `manifest.json` must describe the JoeSSH Admin root app, built JS/CSS
assets must exist, and packaged text assets must not contain JoeSSH token env
names, bearer literals, sentinel tokens, or high-entropy credential literals.

## Live Sync Configuration

The public root path defaults to live Web Admin and requests
`GET /api/admin/snapshot` on the same origin. Deploy that path as an edge/server
proxy to the Sync Service admin snapshot endpoint, and attach any
`ATLASTERM_SYNC_ADMIN_TOKEN` or equivalent authorization at the proxy layer.
Browser bundles must not receive admin snapshot bearer tokens. The fixture
dashboard is available only through `?adminSnapshot=fixture` for local QA,
documentation screenshots, and demos that intentionally use simulated data.

The repository includes a production-safe Node proxy example at
`deploy/web-admin/node-admin-snapshot-proxy.mjs`. It exposes only
`/api/admin/snapshot`, injects `ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN`
server-side, ignores browser-supplied `Authorization`, and rejects startup when
the admin token is missing or malformed. It also binds to loopback by default
and refuses non-loopback `ATLASTERM_WEB_ADMIN_PROXY_BIND` values unless
`ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1` is explicitly set. Public bind
mode also requires a distinct `ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN`; every
`/api/admin/snapshot` request must then include
`Authorization: Bearer <operator-token>` before the proxy injects the upstream
admin token. The proxy caps upstream snapshot bodies at 1 MiB by default,
checks `Content-Length` before reading, cancels oversized streams, and returns
`502 upstream_snapshot_too_large` when the Sync admin snapshot exceeds the
configured limit. Operators may raise the cap with
`ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES`, from 1024 bytes up to 10485760
bytes, only after confirming browser memory and dashboard latency budgets for
the deployment. In production, prefer keeping the Node proxy on loopback and
let Nginx, Caddy, Cloudflare Access, or another authenticating reverse proxy
inject that operator authorization header only after the operator is
authenticated.
Validate the example with:

```bash
npm run qa:web-admin-proxy-smoke
```

Run the Web Admin Lighthouse release-machine gate before publishing static
assets:

```bash
npm run qa:lighthouse
```

The gate rebuilds `apps/web/dist`, serves it with deployment headers from
`_headers`, audits an explicit `?adminSnapshot=fixture` route for deterministic
performance and accessibility evidence, enforces the configured Lighthouse
thresholds, fails on Lighthouse run warnings, and writes
`reports/lighthouse/web-admin.json`. The live same-origin proxy path is covered
by `npm run qa:web-admin-sync-topology-release-smoke`.

Before promoting a Web Admin + self-hosted Sync release topology, run the
release-like topology smoke as well:

```bash
npm run qa:web-admin-sync-topology-release-smoke
```

For faster development checks, `npm run qa:web-admin-sync-topology-smoke` keeps
the same topology assertions while using the local debug Sync build. Release
candidates must use the packaged lane above.

This builds or uses `apps/web/dist`, packages the Sync Service into the staged
`reports/release/sync/joessh-sync-*` binary, verifies
`reports/release/sync/SHA256SUMS.txt`, serves Web Admin as static release
output, routes same-origin `/api/admin/snapshot` through the production Node
proxy, and starts a real local Sync Service with temporary JSON ledger storage.
It verifies Sync admin auth, scoped CORS, the empty snapshot projection, a
populated snapshot after real register/push API writes, browser-supplied
`Authorization` replacement, and the bad upstream admin-token error path.

Set this optional build-time value only when Web Admin should read from a
different non-secret snapshot URL:

```bash
VITE_ATLASTERM_ADMIN_SNAPSHOT_URL=https://sync.example.com/v1/admin/snapshot
```

The app validates `VITE_ATLASTERM_ADMIN_SNAPSHOT_URL`, strips fragments, rejects
unsupported protocols, embedded credentials, whitespace/control characters, and
malformed HTTP(S) URLs. The frontend sends no `Authorization` header for live
snapshot requests. Browser-side loading also caps live snapshot responses at
1 MiB before JSON parsing, using `Content-Length` and streaming byte counts when
available. The deployed CSP must allow the configured admin snapshot origin in
`connect-src`; this is generated by the existing Web build code.

## Cache And Rollback

- Keep HTML short-lived or no-cache at the hosting layer.
- Immutable hashed assets can be cached long-term.
- To rollback, redeploy the previous `dist` artifact and its matching
  `_headers`, then verify SRI and the admin snapshot live path.
- Do not expose Web Admin against a Sync Service that lacks
  `ATLASTERM_SYNC_ADMIN_TOKEN` or equivalent edge authorization.
- Keep `deploy/web-admin/node-admin-snapshot-proxy.mjs` on loopback unless an
  upstream reverse proxy authenticates operator traffic before requests reach
  `/api/admin/snapshot` and injects the configured
  `ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN`.
