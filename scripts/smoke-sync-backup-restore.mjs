import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve } from "node:path";
import net from "node:net";

const root = resolve(import.meta.dirname, "..");
const cargoCommand = "cargo";
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const { binaryKind, binaryPath: syncBinary, buildArgs, packageRelease } = parseArgs(process.argv.slice(2));
const releaseManifestPath = resolve(root, "reports", "release", "sync", "SHA256SUMS.txt");
const evidenceDirectory =
  binaryKind === "packaged-release" ? resolve(root, "reports", "release", "sync") : resolve(root, "reports", "smoke", "sync");
const syncToken = "public-beta-sync-token-0123456789abcdef";
const adminToken = "public-beta-admin-token-fedcba9876543210";
const metricsToken = "public-beta-metrics-token-001122334455";
const webOrigin = "http://127.0.0.1:4200";
const tempDir = mkdtempSync(join(tmpdir(), "joessh-sync-backup-restore-"));
const storagePath = join(tempDir, "ledger.json");
const serviceBackupPath = withExtension(storagePath, "bak");
const operatorBackupPath = join(tempDir, "operator-ledger-backup.json");
const evidencePath = resolve(evidenceDirectory, "backup-restore-smoke.json");
const evidenceChecksumPath = resolve(evidenceDirectory, "backup-restore-smoke-SHA256SUMS.txt");

let service;
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

  service = await startSyncService("seed");
  const desktopDeviceId = await registerDevice(service.baseUrl, "Backup Restore Desktop");
  const mobileDeviceId = await registerDevice(service.baseUrl, "Backup Restore Mobile");
  const firstChangeId = await pushSmokeChange(service.baseUrl, desktopDeviceId, "0", "prod-edge-restore-primary");
  await assertPulledChange(service.baseUrl, mobileDeviceId, "0", firstChangeId, "server-1");
  await assertAdminSnapshot(service.baseUrl, [desktopDeviceId, mobileDeviceId], [firstChangeId], 1);
  await assertMetrics(service.baseUrl, {
    backupRecoveries: 0,
    changesStored: 1,
    latestSequence: 1,
    tempRecoveries: 0,
  });
  await stopSyncService(service);
  service = undefined;

  if (!existsSync(storagePath)) {
    throw new Error("Expected sync ledger to exist before the backup drill");
  }
  copyFileSync(storagePath, operatorBackupPath);
  const operatorBackupHash = sha256(operatorBackupPath);
  writeFileSync(storagePath, "{not-json");
  copyFileSync(operatorBackupPath, serviceBackupPath);
  if (sha256(serviceBackupPath) !== operatorBackupHash) {
    throw new Error("Restored service backup does not match the operator backup copy");
  }

  const recoveryStartedAt = Date.now();
  service = await startSyncService("restore");
  const recoveryDurationMs = Date.now() - recoveryStartedAt;
  await assertPulledChange(service.baseUrl, mobileDeviceId, "0", firstChangeId, "server-1");
  await assertAdminSnapshot(service.baseUrl, [desktopDeviceId, mobileDeviceId], [firstChangeId], 1);
  await assertMetrics(service.baseUrl, {
    backupRecoveries: 1,
    changesStored: 1,
    latestSequence: 1,
    tempRecoveries: 0,
  });

  const secondChangeId = await pushSmokeChange(service.baseUrl, mobileDeviceId, "server-1", "prod-edge-restore-followup");
  await assertPulledChange(service.baseUrl, desktopDeviceId, "server-1", secondChangeId, "server-2");
  await assertAdminSnapshot(service.baseUrl, [desktopDeviceId, mobileDeviceId], [firstChangeId, secondChangeId], 2);
  await assertMetrics(service.baseUrl, {
    backupRecoveries: 1,
    changesStored: 2,
    latestSequence: 2,
    tempRecoveries: 0,
  });

  writeEvidence({
    desktopDeviceId,
    firstChangeId,
    mobileDeviceId,
    operatorBackupHash,
    recoveryDurationMs,
    secondChangeId,
  });
  console.log(
    `Sync backup/restore smoke passed; evidence written to ${relative(root, evidencePath).replace(/\\/g, "/")}`,
  );
} finally {
  if (service) {
    await stopSyncService(service);
  }
  rmSync(tempDir, { force: true, recursive: true });
}

function parseArgs(args) {
  let binaryPath = resolve(root, "target", "debug", `atlasterm-sync${binaryExtension}`);
  let buildArgs = ["build", "-p", "atlasterm-sync"];
  let binaryKind = "debug";
  let packageRelease = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--release") {
      binaryPath = resolve(root, "target", "release", `atlasterm-sync${binaryExtension}`);
      buildArgs = ["build", "--release", "-p", "atlasterm-sync"];
      binaryKind = "release";
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
      binaryKind = "packaged-release";
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
      binaryKind = "custom";
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

  return { binaryKind, binaryPath, buildArgs, packageRelease };
}

async function startSyncService(label) {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `127.0.0.1:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_STORAGE_PATH: storagePath,
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  await waitForHealth({ child, stderr }, baseUrl, label);
  await assertReady(baseUrl);
  return { baseUrl, child, stderr };
}

async function stopSyncService(runningService) {
  if (runningService.child.exitCode !== null) {
    return;
  }

  runningService.child.kill();
  try {
    await waitForExit(runningService.child, 5_000, "sync service shutdown");
  } catch {
    if (runningService.child.exitCode === null) {
      runningService.child.kill("SIGKILL");
      await waitForExit(runningService.child, 5_000, "sync service forced shutdown");
    }
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

async function registerDevice(url, displayName) {
  const response = await fetch(`${url}/v1/devices/register`, {
    body: JSON.stringify({
      app_version: version,
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

async function pushSmokeChange(url, deviceId, baseCursor, entityId) {
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
          payload: { encrypted_blob: `backup-restore-ciphertext-${changeId}` },
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
  if (body.accepted !== 1 || !/^server-\d+$/.test(body.sync_cursor)) {
    throw new Error(`Sync push did not accept the smoke change: ${JSON.stringify(body)}`);
  }
  return changeId;
}

async function assertPulledChange(url, deviceId, since, changeId, expectedCursor) {
  let cursor = since;
  let finalBody;
  let found = false;

  for (let page = 0; page < 20; page += 1) {
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
    found ||= body.changes.some((change) => change.id === changeId);
    finalBody = body;
    if (!body.has_more) {
      break;
    }
    if (body.next_cursor === cursor) {
      throw new Error(`Sync pull pagination did not make progress: ${JSON.stringify(body)}`);
    }
    cursor = body.next_cursor;
  }

  if (!finalBody || finalBody.next_cursor !== expectedCursor || !found) {
    throw new Error(`Sync pull did not return the expected restored change: ${JSON.stringify(finalBody)}`);
  }
}

async function assertAdminSnapshot(url, deviceIds, changeIds, expectedChanges) {
  const response = await fetch(`${url}/v1/admin/snapshot`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (!response.ok) {
    throw new Error(`Expected admin snapshot to succeed, got ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (!Array.isArray(body.devices) || !deviceIds.every((deviceId) => body.devices.some((device) => device.id === deviceId))) {
    throw new Error("Admin snapshot did not include the restored smoke devices");
  }
  if (body.metrics?.healthyDevices !== deviceIds.length || body.metrics?.auditEventsToday < expectedChanges) {
    throw new Error(`Admin snapshot did not project restored device/change metrics: ${JSON.stringify(body.metrics)}`);
  }
  const auditIds = new Set((body.auditEvents ?? []).map((event) => event.id));
  for (const changeId of changeIds) {
    if (!auditIds.has(`audit-${changeId}`)) {
      throw new Error(`Admin snapshot did not include restored audit event for ${changeId}`);
    }
  }
}

async function assertMetrics(url, { backupRecoveries, changesStored, latestSequence, tempRecoveries }) {
  const response = await fetch(`${url}/metrics`, {
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  if (!response.ok) {
    throw new Error(`Expected metrics to succeed, got ${response.status}: ${await response.text()}`);
  }
  const metrics = await response.text();
  const required = [
    "joessh_sync_devices_registered 2",
    `joessh_sync_changes_stored ${changesStored}`,
    `joessh_sync_latest_sequence ${latestSequence}`,
    "joessh_sync_storage_write_failures_total 0",
    `joessh_sync_ledger_recovery_total{source="backup"} ${backupRecoveries}`,
    `joessh_sync_ledger_recovery_total{source="temp"} ${tempRecoveries}`,
  ];
  for (const line of required) {
    if (!metrics.includes(line)) {
      throw new Error(`Expected metrics to include ${line}, got:\n${metrics}`);
    }
  }
}

async function waitForHealth(runningService, url, label) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (runningService.child.exitCode !== null) {
      throw new Error(
        `Sync service exited early during ${label} start with ${runningService.child.exitCode}:\n${runningService.stderr.join("")}`,
      );
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
  throw new Error(`Timed out waiting for sync service health check during ${label} start:\n${runningService.stderr.join("")}`);
}

function waitForExit(process, timeoutMs, label) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    process.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    process.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
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

function writeEvidence({
  desktopDeviceId,
  firstChangeId,
  mobileDeviceId,
  operatorBackupHash,
  recoveryDurationMs,
  secondChangeId,
}) {
  mkdirSync(evidenceDirectory, { recursive: true });
  writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        artifact: "sync-backup-restore-smoke",
        assertions: [
          "seeded two devices and one sync change",
          "copied an operator ledger backup",
          "corrupted the primary JSON ledger",
          "restored the operator backup as the service .bak ledger",
          "verified startup recovery from backup metrics",
          "verified admin snapshot, pull, and post-recovery write path",
        ],
        binary: relative(root, syncBinary).replace(/\\/g, "/"),
        binaryKind,
        binaryManifest: binaryKind === "packaged-release" ? relative(root, releaseManifestPath).replace(/\\/g, "/") : null,
        binarySha256: sha256(syncBinary),
        devices: [desktopDeviceId, mobileDeviceId],
        evidenceVersion: 1,
        operatorBackupSha256: operatorBackupHash,
        platform: process.platform,
        recovery: {
          rpo: "all mutations durably persisted before the operator backup copy",
          rtoMs: recoveryDurationMs,
          scenario: "primary ledger corrupted; operator backup restored as ledger.bak before service restart",
        },
        restoredChanges: [firstChangeId, secondChangeId],
        timestamp: new Date().toISOString(),
        version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  writeFileSync(
    evidenceChecksumPath,
    `${sha256(evidencePath)}  ${relative(root, evidencePath).replace(/\\/g, "/")}\n`,
    "utf8",
  );
}

function withExtension(filePath, extension) {
  const currentExtension = extname(filePath);
  if (!currentExtension) {
    return `${filePath}.${extension}`;
  }
  return `${filePath.slice(0, -currentExtension.length)}.${extension}`;
}

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
