import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const host = process.env.ATLASTERM_E2E_REAL_SYNC_HOST ?? '127.0.0.1';
const publicPort = Number.parseInt(process.env.ATLASTERM_E2E_REAL_SYNC_PORT ?? '4112', 10);
const webOrigin = process.env.ATLASTERM_E2E_REAL_SYNC_WEB_ORIGIN ?? 'http://127.0.0.1:4212';
const syncToken = process.env.ATLASTERM_E2E_REAL_SYNC_AUTH_TOKEN ?? 'e2e-real-sync-token-0123456789abcdef';
const adminToken = process.env.ATLASTERM_E2E_REAL_SYNC_ADMIN_TOKEN ?? 'e2e-real-admin-token-fedcba9876543210';
const metricsToken = process.env.ATLASTERM_E2E_REAL_SYNC_METRICS_TOKEN ?? 'e2e-real-metrics-token-001122334455';
const binaryExtension = process.platform === 'win32' ? '.exe' : '';
const syncBinary =
  process.env.ATLASTERM_E2E_REAL_SYNC_BINARY ?? join(root, 'target', 'debug', `atlasterm-sync${binaryExtension}`);
const skipBuild = process.env.ATLASTERM_E2E_REAL_SYNC_SKIP_BUILD === '1';
const internalPort = await findFreePort();
const internalBaseUrl = `http://${host}:${internalPort}`;
const tempDir = mkdtempSync(join(tmpdir(), 'joessh-e2e-real-sync-'));
const storagePath = join(tempDir, 'ledger.json');

let syncChild;
let publicServer;

try {
  if (!skipBuild) {
    const build = spawnSync('cargo', ['build', '-p', 'atlasterm-sync'], {
      cwd: root,
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    if (build.status !== 0) {
      process.exit(build.status ?? 1);
    }
  }

  if (!existsSync(syncBinary)) {
    throw new Error(`Expected sync binary at ${syncBinary}`);
  }

  syncChild = spawn(syncBinary, [], {
    cwd: root,
    env: syncServiceEnv({
      ATLASTERM_SYNC_ADMIN_TOKEN: adminToken,
      ATLASTERM_SYNC_AUTH_TOKEN: syncToken,
      ATLASTERM_SYNC_BIND: `${host}:${internalPort}`,
      ATLASTERM_SYNC_CORS_ORIGINS: webOrigin,
      ATLASTERM_SYNC_METRICS_TOKEN: metricsToken,
      ATLASTERM_SYNC_STORAGE_PATH: storagePath,
      RUST_LOG: 'warn',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = [];
  syncChild.stderr.on('data', (chunk) => stderr.push(chunk.toString()));

  await waitForHealth(internalBaseUrl, stderr);
  await assertReady(internalBaseUrl);
  await seedSyncLedger(internalBaseUrl);
  publicServer = await listenPublicProxy();
  console.log(`JoeSSH real Sync admin snapshot E2E proxy listening at http://${host}:${publicPort}`);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  cleanup();
  process.exit(1);
}

function syncServiceEnv(overrides) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('ATLASTERM_SYNC_')) {
      delete env[key];
    }
  }
  return {
    ...env,
    ...overrides,
  };
}

async function seedSyncLedger(baseUrl) {
  const desktopDeviceId = await registerDevice(baseUrl, 'Real Sync Desktop', 'desktop');
  const mobileDeviceId = await registerDevice(baseUrl, 'Real Sync Mobile', 'ios');
  const changeId = randomUUID();

  const push = await fetch(`${baseUrl}/v1/sync/push`, {
    body: JSON.stringify({
      base_cursor: '0',
      changes: [
        {
          client_time: new Date().toISOString(),
          entity_id: 'real-sync-connection',
          entity_type: 'connection',
          id: changeId,
          operation: 'update',
          payload: { encrypted_blob: 'real-sync-e2e-ciphertext' },
        },
      ],
      device_id: desktopDeviceId,
    }),
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (push.status !== 202) {
    throw new Error(`Expected real Sync seed push to return 202, got ${push.status}: ${await push.text()}`);
  }

  const snapshot = await adminSnapshot(baseUrl);
  const deviceIds = new Set(snapshot.devices?.map((device) => device.id));
  if (!deviceIds.has(desktopDeviceId) || !deviceIds.has(mobileDeviceId)) {
    throw new Error(`Real Sync seed snapshot did not include both devices: ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.auditEvents?.some((event) => event.id === `audit-${changeId}`)) {
    throw new Error(`Real Sync seed snapshot did not include the pushed change audit event: ${JSON.stringify(snapshot)}`);
  }
}

async function registerDevice(baseUrl, displayName, platform) {
  const response = await fetch(`${baseUrl}/v1/devices/register`, {
    body: JSON.stringify({
      app_version: '0.1.0-beta.1',
      display_name: displayName,
      platform,
    }),
    headers: {
      Authorization: `Bearer ${syncToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`Expected real Sync device registration to succeed, got ${response.status}: ${await response.text()}`);
  }

  const body = await response.json();
  if (!body.device_id) {
    throw new Error(`Real Sync device registration did not return a device_id: ${JSON.stringify(body)}`);
  }
  return body.device_id;
}

async function assertReady(baseUrl) {
  const response = await fetch(`${baseUrl}/readyz`);
  if (!response.ok) {
    throw new Error(`Expected real Sync readiness to succeed, got ${response.status}: ${await response.text()}`);
  }
}

async function adminSnapshot(baseUrl) {
  const response = await fetch(`${baseUrl}/v1/admin/snapshot`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!response.ok) {
    throw new Error(`Expected real Sync admin snapshot to succeed, got ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function listenPublicProxy() {
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === '/healthz') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: true, service: 'joessh-real-sync-e2e' }));
        return;
      }

      const upstream = await fetch(`${internalBaseUrl}${request.url}`, {
        body: allowsRequestBody(request.method) ? await readRequestBody(request) : undefined,
        headers: forwardHeaders(request.headers),
        method: request.method,
      });
      const body = Buffer.from(await upstream.arrayBuffer());
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      response.end(body);
    } catch (error) {
      response.writeHead(502, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(publicPort, host, () => resolve(server));
  });
}

function allowsRequestBody(method) {
  return method !== 'GET' && method !== 'HEAD';
}

function readRequestBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function forwardHeaders(headers) {
  const forwarded = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || ['connection', 'content-length', 'host'].includes(name.toLowerCase())) {
      continue;
    }
    if (Array.isArray(value)) {
      forwarded.set(name, value.join(', '));
    } else {
      forwarded.set(name, value);
    }
  }
  return forwarded;
}

async function waitForHealth(baseUrl, stderr) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (syncChild.exitCode !== null) {
      throw new Error(`Real Sync service exited early with ${syncChild.exitCode}:\n${stderr.join('')}`);
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
  throw new Error(`Timed out waiting for real Sync health check:\n${stderr.join('')}`);
}

function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close(() => {
        if (port) {
          resolvePort(port);
        } else {
          reject(new Error('Unable to allocate a free local TCP port.'));
        }
      });
    });
    server.on('error', reject);
  });
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function cleanup() {
  if (publicServer) {
    publicServer.close();
  }
  if (syncChild && !syncChild.killed) {
    syncChild.kill();
  }
  rmSync(tempDir, { force: true, recursive: true });
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(0);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});
