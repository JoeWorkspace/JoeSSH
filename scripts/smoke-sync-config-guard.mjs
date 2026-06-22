import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import net from "node:net";

const root = resolve(import.meta.dirname, "..");
const cargoCommand = "cargo";
const binaryExtension = process.platform === "win32" ? ".exe" : "";
const { binaryPath: syncBinary, buildArgs } = parseArgs(process.argv.slice(2));
const syncToken = "public-beta-sync-token-0123456789abcdef";
const adminToken = "public-beta-admin-token-fedcba9876543210";
const metricsToken = "public-beta-metrics-token-001122334455";
const webOrigin = "http://127.0.0.1:4200";
const tempDir = mkdtempSync(join(tmpdir(), "joessh-sync-config-guard-"));
const storagePath = join(tempDir, "ledger.json");

let primary;
try {
  if (buildArgs.length > 0) {
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

  await assertPublicBindRequiresMetricsToken();
  await assertPublicBindRequiresDurableStorage();
  await assertConfiguredStoragePathMustBeUsable();
  await assertPublicBindRejectsPermissiveCors();
  primary = await startSyncService(await findFreePort(), "primary");
  await assertReady(primary.baseUrl);
  await assertSecondInstanceFails();
  await assertReady(primary.baseUrl);
  console.log("Sync config guard smoke passed: public binds require metrics auth, durable usable storage, scoped CORS, and duplicate JSON ledger instances are rejected");
} finally {
  if (primary) {
    await stopSyncService(primary);
  }
  rmSync(tempDir, { force: true, recursive: true });
}

function parseArgs(args) {
  let binaryPath = resolve(root, "target", "debug", `atlasterm-sync${binaryExtension}`);
  let buildArgs = ["build", "-p", "atlasterm-sync"];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--release") {
      binaryPath = resolve(root, "target", "release", `atlasterm-sync${binaryExtension}`);
      buildArgs = ["build", "--release", "-p", "atlasterm-sync"];
      continue;
    }
    if (arg === "--binary") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--binary requires a path.");
      }
      binaryPath = resolve(root, value);
      buildArgs = [];
      index += 1;
      continue;
    }
    if (arg === "--skip-build") {
      buildArgs = [];
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { binaryPath, buildArgs };
}

async function assertPublicBindRequiresDurableStorage() {
  const port = await findFreePort();
  const publicBind = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `0.0.0.0:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  publicBind.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(publicBind, 5_000, "public bind without durable storage startup");
  if (code === 0 || signal) {
    throw new Error(`Expected public bind without durable storage to fail, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_SYNC_STORAGE_PATH/i.test(stderr)) {
    throw new Error(`Expected public bind failure to mention ATLASTERM_SYNC_STORAGE_PATH, got:\n${stderr}`);
  }
}

async function assertPublicBindRequiresMetricsToken() {
  const port = await findFreePort();
  const publicBind = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `0.0.0.0:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_STORAGE_PATH: join(tempDir, "metrics-token-required-ledger.json"),
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  publicBind.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(publicBind, 5_000, "public bind without metrics token startup");
  if (code === 0 || signal) {
    throw new Error(`Expected public bind without metrics token to fail, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_SYNC_METRICS_TOKEN/i.test(stderr)) {
    throw new Error(`Expected public bind failure to mention ATLASTERM_SYNC_METRICS_TOKEN, got:\n${stderr}`);
  }
}

async function assertConfiguredStoragePathMustBeUsable() {
  const port = await findFreePort();
  const blockedParent = join(tempDir, "blocked-storage-parent");
  writeFileSync(blockedParent, "not-a-directory", "utf8");
  const publicBind = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `0.0.0.0:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_STORAGE_PATH: join(blockedParent, "ledger.json"),
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  publicBind.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(publicBind, 5_000, "public bind with unusable storage path startup");
  if (code === 0 || signal) {
    throw new Error(`Expected public bind with unusable storage path to fail, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_SYNC_STORAGE_PATH/i.test(stderr) || !/storage ledger directory/i.test(stderr)) {
    throw new Error(`Expected public bind failure to mention unusable ATLASTERM_SYNC_STORAGE_PATH, got:\n${stderr}`);
  }
}

async function assertPublicBindRejectsPermissiveCors() {
  const port = await findFreePort();
  const publicBind = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `0.0.0.0:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_CORS_PERMISSIVE: "1",
      ATLASTERM_SYNC_STORAGE_PATH: join(tempDir, "permissive-cors-rejected-ledger.json"),
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  publicBind.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(publicBind, 5_000, "public bind with permissive CORS startup");
  if (code === 0 || signal) {
    throw new Error(`Expected public bind with permissive CORS to fail, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_SYNC_CORS_PERMISSIVE/i.test(stderr) || !/ATLASTERM_SYNC_CORS_ORIGINS/i.test(stderr)) {
    throw new Error(`Expected public bind failure to mention scoped CORS configuration, got:\n${stderr}`);
  }
}

async function assertSecondInstanceFails() {
  const port = await findFreePort();
  const duplicate = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `127.0.0.1:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_STORAGE_PATH: storagePath,
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  duplicate.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(duplicate, 5_000, "duplicate sync service startup");
  if (code === 0 || signal) {
    throw new Error(`Expected duplicate sync service to reject the ledger lock, got code=${code} signal=${signal}`);
  }
  if (!/sync storage ledger lock|already be using this JSON ledger/i.test(stderr)) {
    throw new Error(`Expected duplicate service stderr to mention the ledger lock, got:\n${stderr}`);
  }
}

async function startSyncService(port, label) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_BIND: `127.0.0.1:${port}`,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_STORAGE_PATH: storagePath,
    }),
    stdio: ["ignore", "ignore", "pipe"],
  });

  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  await waitForHealth({ child, stderr }, baseUrl, label);
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

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
