import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const proxyScript = resolve(root, "deploy", "web-admin", "node-admin-snapshot-proxy.mjs");
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const syncToken = "release-topology-sync-token-0123456789abcdef";
const adminToken = "release-topology-admin-token-fedcba9876543210";
const badAdminToken = "release-topology-wrong-token-001122334455";
const metricsToken = "release-topology-metrics-token-001122334455";
const parsed = parseArgs(process.argv.slice(2));
const tempDir = mkdtempSync(join(tmpdir(), "joessh-web-sync-topology-"));
const storagePath = join(tempDir, "ledger.json");

let syncService;
let goodProxy;
let badProxy;
let staticServer;
let activeProxyBaseUrl = "";

try {
  if (parsed.buildWeb) {
    run("npm", ["run", "build:web"], {
      ...process.env,
      VITE_ATLASTERM_ADMIN_SNAPSHOT_URL: "/api/admin/snapshot",
    });
  }

  if (parsed.packageRelease) {
    run(process.execPath, [resolve(root, "scripts", "package-sync-release.mjs")], process.env, { shell: false });
    run(
      process.execPath,
      [resolve(root, "scripts", "verify-artifact-checksums.mjs"), "reports/release/sync/SHA256SUMS.txt"],
      process.env,
      { shell: false },
    );
  } else if (parsed.buildSyncArgs.length > 0) {
    run("cargo", parsed.buildSyncArgs, process.env);
  }

  assertWebDist(parsed.distDir);
  if (!existsSync(parsed.syncBinary)) {
    throw new Error(`Expected sync binary at ${displayPath(parsed.syncBinary)}`);
  }

  const syncPort = await findFreePort();
  const goodProxyPort = await findFreePort();
  const badProxyPort = await findFreePort();
  const staticPort = await findFreePort();
  const syncBaseUrl = `http://127.0.0.1:${syncPort}`;
  const goodProxyBaseUrl = `http://127.0.0.1:${goodProxyPort}`;
  const badProxyBaseUrl = `http://127.0.0.1:${badProxyPort}`;
  const webOrigin = `http://127.0.0.1:${staticPort}`;

  syncService = startSyncService(syncPort, webOrigin);
  await waitForHealth(syncBaseUrl, syncService, "Sync Service");
  await assertReady(syncBaseUrl);
  await assertSyncCors(syncBaseUrl, webOrigin);
  await assertDirectSyncAdminAuth(syncBaseUrl);

  goodProxy = startProxy(goodProxyPort, syncBaseUrl, adminToken);
  await waitForHealth(goodProxyBaseUrl, goodProxy, "Web Admin snapshot proxy");
  badProxy = startProxy(badProxyPort, syncBaseUrl, badAdminToken);
  await waitForHealth(badProxyBaseUrl, badProxy, "Web Admin bad-token snapshot proxy");

  activeProxyBaseUrl = goodProxyBaseUrl;
  staticServer = await startStaticReleaseServer(parsed.distDir, staticPort);
  await assertStaticWebAdmin(webOrigin);
  await assertTopologyEmptySnapshot(webOrigin);
  await assertProxyReplacesBrowserAuthorization(webOrigin);
  const seededChange = await seedSyncData(syncBaseUrl);
  await assertTopologyPopulatedSnapshot(webOrigin, seededChange);

  activeProxyBaseUrl = badProxyBaseUrl;
  await assertTopologyAdminTokenError(webOrigin);

  console.log(`Web Admin + Sync release topology smoke passed on ${webOrigin}`);
} finally {
  await stopServer(staticServer);
  await stopChild(goodProxy);
  await stopChild(badProxy);
  await stopChild(syncService);
  rmSync(tempDir, { force: true, recursive: true });
}

function parseArgs(args) {
  let buildWeb = true;
  let buildSyncArgs = ["build", "-p", "atlasterm-sync"];
  let distDir = resolve(root, "apps", "web", "dist");
  let syncBinary = resolve(root, "target", "debug", `atlasterm-sync${binaryExtension}`);
  let syncMode = "debug";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dist") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--dist requires a path.");
      }
      distDir = resolve(root, value);
      buildWeb = false;
      index += 1;
      continue;
    }
    if (arg === "--release") {
      if (syncMode !== "debug") {
        throw new Error("--release cannot be combined with --binary or --packaged-release.");
      }
      syncMode = "release";
      syncBinary = resolve(root, "target", "release", `atlasterm-sync${binaryExtension}`);
      buildSyncArgs = ["build", "--release", "-p", "atlasterm-sync"];
      continue;
    }
    if (arg === "--packaged-release") {
      if (syncMode !== "debug") {
        throw new Error("--packaged-release cannot be combined with --release or --binary.");
      }
      syncMode = "packaged-release";
      syncBinary = resolve(
        root,
        "reports",
        "release",
        "sync",
        `joessh-sync-${version}-${process.platform}-${process.arch}${binaryExtension}`,
      );
      buildSyncArgs = [];
      continue;
    }
    if (arg === "--binary") {
      if (syncMode !== "debug") {
        throw new Error("--binary cannot be combined with --release or --packaged-release.");
      }
      const value = args[index + 1];
      if (!value) {
        throw new Error("--binary requires a path.");
      }
      syncMode = "binary";
      syncBinary = resolve(root, value);
      buildSyncArgs = [];
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      buildWeb = false;
      buildSyncArgs = [];
      continue;
    }
    if (arg === "--skip-web-build") {
      buildWeb = false;
      continue;
    }
    if (arg === "--skip-sync-build") {
      if (syncMode === "packaged-release") {
        throw new Error("--skip-sync-build cannot be combined with --packaged-release.");
      }
      buildSyncArgs = [];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { buildSyncArgs, buildWeb, distDir, packageRelease: syncMode === "packaged-release", syncBinary };
}

function run(command, args, env, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env,
    shell: options.shell ?? process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assertWebDist(distDir) {
  const indexPath = resolve(distDir, "index.html");
  const headersPath = resolve(distDir, "_headers");
  if (!existsSync(indexPath)) {
    throw new Error(`Expected Web Admin dist index at ${displayPath(indexPath)}. Run npm run build:web first.`);
  }
  if (!existsSync(headersPath)) {
    throw new Error(`Expected Web Admin deployment headers at ${displayPath(headersPath)}.`);
  }

  const html = readFileSync(indexPath, "utf8");
  if (!html.includes('id="root"') || !html.includes("/assets/")) {
    throw new Error("Web Admin dist index.html does not look like a built Vite application.");
  }

  const headers = readFileSync(headersPath, "utf8");
  for (const header of ["Content-Security-Policy", "X-Frame-Options", "X-Content-Type-Options"]) {
    if (!headers.includes(header)) {
      throw new Error(`Web Admin _headers is missing ${header}.`);
    }
  }
}

function startSyncService(port, webOrigin) {
  return spawn(parsed.syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_BIND: `127.0.0.1:${port}`,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_STORAGE_PATH: storagePath,
      RUST_LOG: "warn",
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function startProxy(port, syncBaseUrl, proxyToken) {
  return spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: syncBaseUrl,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: proxyToken,
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `127.0.0.1:${port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function syncServiceEnv(overrides) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ATLASTERM_SYNC_")) {
      delete env[key];
    }
  }
  return { ...env, ...overrides };
}

async function startStaticReleaseServer(distDir, port) {
  const server = createServer((request, response) => {
    handleStaticRequest(request, response, distDir).catch((error) => {
      response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "static_release_proxy_error", message: errorMessage(error) }));
    });
  });

  await listen(server, port);
  return server;
}

async function handleStaticRequest(request, response, distDir) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (requestUrl.pathname === "/api/admin/snapshot") {
    await proxySnapshotRequest(request, response, requestUrl);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  const filePath = resolveStaticPath(distDir, requestUrl.pathname);
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=60",
    "Content-Type": contentTypeFor(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(readFileSync(filePath));
}

async function proxySnapshotRequest(request, response, requestUrl) {
  const upstream = await fetch(`${activeProxyBaseUrl}${requestUrl.pathname}${requestUrl.search}`, {
    body: allowsBody(request.method) ? await readRequestBody(request) : undefined,
    headers: forwardHeaders(request.headers),
    method: request.method,
    redirect: "manual",
  });
  const body = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, responseHeaders(upstream.headers));
  response.end(body);
}

function resolveStaticPath(distDir, pathname) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const resolved = resolve(distDir, relativePath);
  if (resolved !== distDir && !resolved.startsWith(`${distDir}${sep}`)) {
    return null;
  }
  return resolved;
}

async function assertReady(baseUrl) {
  const response = await fetch(`${baseUrl}/readyz`);
  if (!response.ok) {
    throw new Error(`Expected Sync readiness to succeed, got ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.ok !== true || body.storage?.mode !== "json_ledger" || body.storage?.writable !== true) {
    throw new Error(`Sync readiness did not report writable JSON ledger storage: ${JSON.stringify(body)}`);
  }
}

async function assertSyncCors(syncBaseUrl, webOrigin) {
  const allowed = await fetch(`${syncBaseUrl}/v1/admin/snapshot`, {
    headers: {
      "Access-Control-Request-Headers": "authorization",
      "Access-Control-Request-Method": "GET",
      Origin: webOrigin,
    },
    method: "OPTIONS",
  });
  if (!allowed.ok) {
    throw new Error(`Expected Sync admin CORS preflight to succeed, got ${allowed.status}`);
  }
  if (allowed.headers.get("access-control-allow-origin") !== webOrigin) {
    throw new Error("Expected Sync admin CORS preflight to echo the release Web Admin origin.");
  }

  const denied = await fetch(`${syncBaseUrl}/v1/admin/snapshot`, {
    headers: {
      "Access-Control-Request-Headers": "authorization",
      "Access-Control-Request-Method": "GET",
      Origin: "https://evil.example",
    },
    method: "OPTIONS",
  });
  if (denied.headers.get("access-control-allow-origin")) {
    throw new Error("Expected Sync admin CORS preflight to avoid allowing an unconfigured origin.");
  }
}

async function assertDirectSyncAdminAuth(syncBaseUrl) {
  const missing = await fetch(`${syncBaseUrl}/v1/admin/snapshot`);
  if (missing.status !== 401) {
    throw new Error(`Expected missing Sync admin auth to return 401, got ${missing.status}: ${await missing.text()}`);
  }

  const wrong = await fetch(`${syncBaseUrl}/v1/admin/snapshot`, {
    headers: { Authorization: `Bearer ${syncToken}` },
  });
  if (wrong.status !== 403) {
    throw new Error(`Expected wrong Sync admin auth to return 403, got ${wrong.status}: ${await wrong.text()}`);
  }
  const wrongBody = await wrong.json();
  if (wrongBody.code !== "admin_forbidden") {
    throw new Error(`Expected wrong Sync admin auth to report admin_forbidden, got ${JSON.stringify(wrongBody)}`);
  }

  const correct = await fetch(`${syncBaseUrl}/v1/admin/snapshot`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!correct.ok) {
    throw new Error(`Expected direct Sync admin snapshot to succeed, got ${correct.status}: ${await correct.text()}`);
  }
  assertEmptySnapshot(await correct.json());
}

async function assertStaticWebAdmin(webOrigin) {
  const response = await fetch(`${webOrigin}/`);
  if (!response.ok) {
    throw new Error(`Expected static Web Admin root to load, got ${response.status}`);
  }
  if (!response.headers.get("content-type")?.includes("text/html")) {
    throw new Error("Expected static Web Admin root to be served as HTML.");
  }
  const html = await response.text();
  if (!html.includes('id="root"') || !html.includes("/assets/")) {
    throw new Error("Static Web Admin root did not serve the built Vite shell.");
  }
}

async function assertTopologyEmptySnapshot(webOrigin) {
  const response = await fetch(`${webOrigin}/api/admin/snapshot`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Expected Web Admin topology snapshot to succeed, got ${response.status}: ${await response.text()}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Expected Web Admin topology snapshot to return JSON.");
  }
  assertEmptySnapshot(await response.json());
}

async function assertProxyReplacesBrowserAuthorization(webOrigin) {
  const response = await fetch(`${webOrigin}/api/admin/snapshot`, {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer browser-supplied-token-that-must-not-reach-sync",
    },
  });
  if (!response.ok) {
    throw new Error(`Expected browser Authorization to be replaced by the Node proxy, got ${response.status}: ${await response.text()}`);
  }
  assertEmptySnapshot(await response.json());
}

async function seedSyncData(syncBaseUrl) {
  const displayName = "Release topology workstation";
  const register = await postSyncJson(`${syncBaseUrl}/v1/devices/register`, {
    app_version: "0.1.0-public-beta-rc",
    display_name: displayName,
    platform: "desktop",
  });
  if (register.status !== 200) {
    throw new Error(`Expected Sync device registration to return 200, got ${register.status}: ${JSON.stringify(register.body)}`);
  }
  if (!register.body?.device_id || register.body?.sync_cursor !== "0") {
    throw new Error(`Sync device registration returned an unexpected body: ${JSON.stringify(register.body)}`);
  }

  const changeId = randomUUID();
  const entityId = "release-topology-profile";
  const push = await postSyncJson(`${syncBaseUrl}/v1/sync/push`, {
    base_cursor: register.body.sync_cursor,
    changes: [
      {
        client_time: new Date().toISOString(),
        entity_id: entityId,
        entity_type: "profile",
        id: changeId,
        operation: "update",
        payload: { encrypted_blob: "release-topology-ciphertext" },
      },
    ],
    device_id: register.body.device_id,
  });
  if (push.status !== 202) {
    throw new Error(`Expected Sync push to return 202, got ${push.status}: ${JSON.stringify(push.body)}`);
  }
  if (push.body?.accepted !== 1 || push.body?.sync_cursor !== "server-1" || push.body?.conflicts?.length !== 0) {
    throw new Error(`Sync push returned an unexpected body: ${JSON.stringify(push.body)}`);
  }

  return {
    changeId,
    deviceId: register.body.device_id,
    displayName,
    entityId,
  };
}

async function assertTopologyPopulatedSnapshot(webOrigin, expected) {
  const response = await fetch(`${webOrigin}/api/admin/snapshot`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Expected populated Web Admin topology snapshot to succeed, got ${response.status}: ${await response.text()}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Expected populated Web Admin topology snapshot to return JSON.");
  }

  const body = await response.json();
  const devices = body?.devices;
  if (!Array.isArray(devices) || devices.length !== 1) {
    throw new Error(`Expected populated admin snapshot to include one device, got ${JSON.stringify(body)}`);
  }
  const device = devices.find((candidate) => candidate.id === expected.deviceId);
  if (
    !device ||
    device.name !== expected.displayName ||
    device.platform !== "desktop" ||
    device.cursor !== "server-1" ||
    device.status !== "current"
  ) {
    throw new Error(`Expected populated admin snapshot device to reflect the registered pushed device, got ${JSON.stringify(body)}`);
  }

  const auditEvents = body?.auditEvents;
  if (!Array.isArray(auditEvents) || auditEvents.length < 2) {
    throw new Error(`Expected populated admin snapshot to include register and push audit events, got ${JSON.stringify(body)}`);
  }
  if (
    !auditEvents.some(
      (event) =>
        event.id === `audit-${expected.changeId}` &&
        event.action === "Accepted Update sync change" &&
        event.actor === "Sync API" &&
        event.target === `profile:${expected.entityId}`,
    )
  ) {
    throw new Error(`Expected populated admin snapshot audit events to include the pushed change, got ${JSON.stringify(body)}`);
  }
  if (
    !auditEvents.some(
      (event) =>
        event.id === `register-${expected.deviceId}` &&
        event.action === `Registered ${expected.displayName}` &&
        event.actor === "Sync API" &&
        event.target === `device:${expected.deviceId}`,
    )
  ) {
    throw new Error(`Expected populated admin snapshot audit events to include device registration, got ${JSON.stringify(body)}`);
  }

  const metrics = body?.metrics;
  if (
    metrics?.activeMembers !== 1 ||
    metrics?.auditEventsToday !== auditEvents.length ||
    metrics?.healthyDevices !== 1 ||
    metrics?.rolesConfigured !== 1
  ) {
    throw new Error(`Expected populated admin snapshot metrics to reflect seeded Sync data, got ${JSON.stringify(body)}`);
  }
}

async function assertTopologyAdminTokenError(webOrigin) {
  const response = await fetch(`${webOrigin}/api/admin/snapshot`, {
    headers: { Accept: "application/json" },
  });
  if (response.status !== 403) {
    throw new Error(`Expected bad proxy admin token to return 403 through the topology, got ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.code !== "admin_forbidden") {
    throw new Error(`Expected bad proxy admin token to surface admin_forbidden, got ${JSON.stringify(body)}`);
  }
}

async function postSyncJson(url, payload) {
  const response = await fetch(url, {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  return {
    body: await readJsonResponse(response),
    status: response.status,
  };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON response from ${response.url}, got ${response.status}: ${text}`);
  }
}

function assertEmptySnapshot(body) {
  for (const key of ["auditEvents", "devices", "members", "roles"]) {
    if (!Array.isArray(body?.[key]) || body[key].length !== 0) {
      throw new Error(`Expected empty ${key} in admin snapshot, got ${JSON.stringify(body)}`);
    }
  }
  const metrics = body?.metrics;
  if (
    metrics?.activeMembers !== 0 ||
    metrics?.auditEventsToday !== 0 ||
    metrics?.healthyDevices !== 0 ||
    metrics?.rolesConfigured !== 0
  ) {
    throw new Error(`Expected zeroed admin snapshot metrics, got ${JSON.stringify(body)}`);
  }
}

async function waitForHealth(baseUrl, child, label) {
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} exited early with ${child.exitCode}:\n${stderr.join("")}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Service is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label} health check:\n${stderr.join("")}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill();
  await waitForExit(child, 5_000).catch(() => {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  });
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for child process exit")), timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function stopServer(server) {
  if (!server) {
    return;
  }
  await new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolveClose();
      }
    });
  });
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function forwardHeaders(headers) {
  const forwarded = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || ["connection", "content-length", "host"].includes(name.toLowerCase())) {
      continue;
    }
    forwarded.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return forwarded;
}

function responseHeaders(headers) {
  const nextHeaders = {};
  for (const [name, value] of headers.entries()) {
    if (!["connection", "content-length", "transfer-encoding"].includes(name.toLowerCase())) {
      nextHeaders[name] = value;
    }
  }
  nextHeaders["Cache-Control"] = "no-store";
  nextHeaders["X-Content-Type-Options"] = "nosniff";
  return nextHeaders;
}

function allowsBody(method) {
  return method !== "GET" && method !== "HEAD";
}

function contentTypeFor(filePath) {
  const extension = extname(filePath).toLowerCase();
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".txt": "text/plain; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
    }[extension] ?? "application/octet-stream"
  );
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close(() => {
        if (port) {
          resolvePort(port);
        } else {
          reject(new Error("Unable to allocate a free local TCP port."));
        }
      });
    });
    server.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
