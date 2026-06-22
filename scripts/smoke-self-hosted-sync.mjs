import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

const root = resolve(import.meta.dirname, "..");
const cargoCommand = "cargo";
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const { binaryPath: syncBinary, buildArgs, packageRelease } = parseArgs(process.argv.slice(2));
const syncToken = "public-beta-sync-token-0123456789abcdef";
const adminToken = "public-beta-admin-token-fedcba9876543210";
const metricsToken = "public-beta-metrics-token-001122334455";
const webOrigin = "http://127.0.0.1:4200";
const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const tempDir = mkdtempSync(join(tmpdir(), "joessh-sync-smoke-"));
const storagePath = join(tempDir, "ledger.json");

let child;
try {
  if (packageRelease) {
    const packageResult = spawnSync(process.execPath, [resolve(root, "scripts", "package-sync-release.mjs")], {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    });
    if (packageResult.status !== 0) {
      process.exit(packageResult.status ?? 1);
    }

    const checksumResult = spawnSync(
      process.execPath,
      [resolve(root, "scripts", "verify-artifact-checksums.mjs"), "reports/release/sync/SHA256SUMS.txt"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: "inherit",
      },
    );
    if (checksumResult.status !== 0) {
      process.exit(checksumResult.status ?? 1);
    }
  } else if (buildArgs.length > 0) {
    const build = spawnSync(cargoCommand, buildArgs, {
      cwd: root,
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    if (build.status !== 0) {
      process.exit(build.status ?? 1);
    }
  }

  if (!existsSync(syncBinary)) {
    throw new Error(`Expected sync binary at ${syncBinary}`);
  }

  await assertInvalidConfigFails("short sync token", {
    ATLASTERM_SYNC_AUTH_TOKEN: "short-token",
  }, /ATLASTERM_SYNC_AUTH_TOKEN must be at least 32 characters/);
  await assertInvalidConfigFails("invalid rate limit", {
    ATLASTERM_SYNC_RATE_LIMIT: "fast",
  }, /ATLASTERM_SYNC_RATE_LIMIT must be a non-negative integer/);
  await assertInvalidConfigFails("ambiguous CORS mode", {
    ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
    ATLASTERM_SYNC_CORS_PERMISSIVE: "1",
  }, /ATLASTERM_SYNC_CORS_PERMISSIVE cannot be combined with ATLASTERM_SYNC_CORS_ORIGINS/);

  child = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `127.0.0.1:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_MAX_PULL_CHANGES: "1",
      ATLASTERM_SYNC_STORAGE_PATH: storagePath,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  await waitForHealth(baseUrl, stderr);
  await assertReady(baseUrl);
  await assertUnauthorizedAdminSnapshot(baseUrl);
  await assertCorsPreflight(baseUrl);
  const desktopDeviceId = await registerDevice(baseUrl, "Public Beta Smoke Desktop");
  const mobileDeviceId = await registerDevice(baseUrl, "Public Beta Smoke Mobile");
  const firstChangeId = await pushSmokeChange(baseUrl, desktopDeviceId, "0", "public-beta-smoke-primary", "server-1");
  const secondChangeId = await pushSmokeChange(baseUrl, desktopDeviceId, "server-1", "public-beta-smoke-followup", "server-2");
  await assertPulledChangesPaginated(baseUrl, mobileDeviceId, [firstChangeId, secondChangeId], "server-2");
  await assertAdminSnapshot(baseUrl, [desktopDeviceId, mobileDeviceId]);
  await assertMetrics(baseUrl);
  console.log(`Self-hosted sync smoke passed on ${baseUrl}`);
} finally {
  if (child && !child.killed) {
    child.kill();
  }
  rmSync(tempDir, { force: true, recursive: true });
}

function parseArgs(args) {
  let binaryPath = resolve(root, "target", "debug", `atlasterm-sync${binaryExtension}`);
  let buildArgs = ["build", "-p", "atlasterm-sync"];
  let packageRelease = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--release") {
      binaryPath = resolve(root, "target", "release", `atlasterm-sync${binaryExtension}`);
      buildArgs = ["build", "--release", "-p", "atlasterm-sync"];
      packageRelease = false;
      continue;
    }
    if (arg === "--packaged-release") {
      binaryPath = resolve(
        root,
        "reports",
        "release",
        "sync",
        `joessh-sync-${version}-${process.platform}-${process.arch}${binaryExtension}`,
      );
      buildArgs = [];
      packageRelease = true;
      continue;
    }
    if (arg === "--binary") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--binary requires a path.");
      }
      binaryPath = resolve(root, value);
      buildArgs = [];
      packageRelease = false;
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      buildArgs = [];
      packageRelease = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { binaryPath, buildArgs, packageRelease };
}

async function assertInvalidConfigFails(label, overrides, expectedError) {
  const configPort = await findFreePort();
  const failingChild = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `127.0.0.1:${configPort}`,
      ...overrides,
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  failingChild.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(failingChild, 5_000, label);
  if (code === 0 || signal) {
    throw new Error(`Expected sync service to reject ${label}, got code=${code} signal=${signal}`);
  }
  if (!expectedError.test(stderr)) {
    throw new Error(`Expected sync service ${label} error to match ${expectedError}, got:\n${stderr}`);
  }
}

function syncServiceEnv(overrides) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ATLASTERM_SYNC_")) {
      delete env[key];
    }
  }
  return {
    ...env,
    RUST_LOG: "warn",
    ...overrides,
  };
}

function waitForExit(process, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error(`Timed out waiting for sync service to reject ${label}`));
    }, timeoutMs);
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function assertUnauthorizedAdminSnapshot(url) {
  const response = await fetch(`${url}/v1/admin/snapshot`);
  if (response.status !== 401) {
    throw new Error(`Expected unauthenticated admin snapshot to return 401, got ${response.status}`);
  }
}

async function assertReady(url) {
  const response = await fetch(`${url}/readyz`);
  if (!response.ok) {
    throw new Error(`Expected readiness check to succeed, got ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (body.ok !== true || body.storage?.mode !== "json_ledger" || body.storage?.writable !== true) {
    throw new Error(`Readiness check did not report writable JSON ledger storage: ${JSON.stringify(body)}`);
  }
}

async function assertCorsPreflight(url) {
  const response = await fetch(`${url}/v1/devices/register`, {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Headers": "authorization,content-type",
      "Access-Control-Request-Method": "POST",
      Origin: webOrigin,
    },
  });

  if (!response.ok) {
    throw new Error(`Expected CORS preflight to succeed, got ${response.status}`);
  }
  if (response.headers.get("access-control-allow-origin") !== webOrigin) {
    throw new Error("Expected CORS preflight to echo the configured Web Admin origin");
  }
}

async function registerDevice(url, displayName) {
  const response = await fetch(`${url}/v1/devices/register`, {
    body: JSON.stringify({
      app_version: "0.1.0-beta.1",
      display_name: displayName,
      platform: "desktop",
    }),
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Expected device registration to succeed, got ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (!body.device_id) {
    throw new Error("Device registration did not return device_id");
  }
  return body.device_id;
}

async function pushSmokeChange(url, deviceId, baseCursor, entityId, expectedCursor) {
  const changeId = randomUUID();
  const response = await fetch(`${url}/v1/sync/push`, {
    body: JSON.stringify({
      base_cursor: baseCursor,
      changes: [
        {
          client_time: new Date().toISOString(),
          entity_id: entityId,
          entity_type: "connection",
          id: changeId,
          operation: "update",
          payload: { encrypted_blob: "smoke-ciphertext" },
        },
      ],
      device_id: deviceId,
    }),
    headers: {
      Authorization: `Bearer ${syncToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (response.status !== 202) {
    throw new Error(`Expected sync push to succeed, got ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  if (body.accepted !== 1 || body.sync_cursor !== expectedCursor) {
    throw new Error(`Sync push did not accept the smoke change: ${JSON.stringify(body)}`);
  }
  return changeId;
}

async function assertPulledChangesPaginated(url, deviceId, expectedChangeIds, expectedCursor) {
  const seen = new Set();
  let cursor = "0";
  let finalCursor = "0";
  let pageCount = 0;

  for (;;) {
    pageCount += 1;
    const response = await fetch(`${url}/v1/sync/pull?device_id=${deviceId}&since=${encodeURIComponent(cursor)}`, {
      headers: { Authorization: `Bearer ${syncToken}` },
    });

    if (!response.ok) {
      throw new Error(`Expected sync pull to succeed, got ${response.status}: ${await response.text()}`);
    }
    const body = await response.json();
    if (!Array.isArray(body.changes) || typeof body.next_cursor !== "string" || typeof body.has_more !== "boolean") {
      throw new Error(`Sync pull returned malformed pagination state: ${JSON.stringify(body)}`);
    }
    for (const change of body.changes) {
      seen.add(change.id);
    }
    finalCursor = body.next_cursor;
    if (!body.has_more) {
      break;
    }
    if (pageCount > 10 || body.next_cursor === cursor) {
      throw new Error(`Sync pull pagination did not make progress: ${JSON.stringify(body)}`);
    }
    cursor = body.next_cursor;
  }

  if (finalCursor !== expectedCursor || pageCount < 2 || !expectedChangeIds.every((changeId) => seen.has(changeId))) {
    throw new Error(`Sync pull did not return all smoke changes across pages: ${JSON.stringify({ finalCursor, pageCount, seen: [...seen] })}`);
  }
}

async function assertAdminSnapshot(url, deviceIds) {
  const response = await fetch(`${url}/v1/admin/snapshot`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (!response.ok) {
    throw new Error(`Expected admin snapshot to succeed, got ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (!Array.isArray(body.devices) || !deviceIds.every((deviceId) => body.devices.some((device) => device.id === deviceId))) {
    throw new Error("Admin snapshot did not include the registered smoke devices");
  }
  if (body.metrics?.healthyDevices !== deviceIds.length) {
    throw new Error("Admin snapshot did not project healthy device metrics");
  }
}

async function assertMetrics(url) {
  const unauthorized = await fetch(`${url}/metrics`);
  if (unauthorized.status !== 401) {
    throw new Error(`Expected unauthenticated metrics to return 401, got ${unauthorized.status}: ${await unauthorized.text()}`);
  }

  const response = await fetch(`${url}/metrics`, {
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  if (!response.ok) {
    throw new Error(`Expected metrics to succeed, got ${response.status}: ${await response.text()}`);
  }
  const metrics = await response.text();
  const required = [
    'joessh_sync_devices_registered 2',
    'joessh_sync_changes_stored 2',
    'joessh_sync_latest_sequence 2',
    'joessh_sync_http_requests_total{method="POST",path="/v1/devices/register",status="200"} 2',
    'joessh_sync_http_requests_total{method="POST",path="/v1/sync/push",status="202"} 2',
    'joessh_sync_http_requests_total{method="GET",path="/v1/sync/pull",status="200"} 2',
    'joessh_sync_auth_failures_total{surface="admin"} 1',
    'joessh_sync_auth_failures_total{surface="metrics"} 1',
    'joessh_sync_storage_write_failures_total 0',
    'joessh_sync_ledger_recovery_total{source="backup"} 0',
    'joessh_sync_ledger_recovery_total{source="temp"} 0',
  ];
  for (const line of required) {
    if (!metrics.includes(line)) {
      throw new Error(`Expected metrics to include ${line}, got:\n${metrics}`);
    }
  }
}

async function waitForHealth(url, stderr) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Sync service exited early with ${child.exitCode}:\n${stderr.join("")}`);
    }

    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Service is still starting.
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for sync service health check:\n${stderr.join("")}`);
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const portNumber = typeof address === "object" && address ? address.port : undefined;
      server.close(() => {
        if (portNumber) {
          resolvePort(portNumber);
        } else {
          reject(new Error("Unable to allocate a free port"));
        }
      });
    });
    server.on("error", reject);
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
