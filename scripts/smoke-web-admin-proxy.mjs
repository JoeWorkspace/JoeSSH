import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import net from "node:net";

const root = resolve(import.meta.dirname, "..");
const proxyScript = resolve(root, "deploy", "web-admin", "node-admin-snapshot-proxy.mjs");
const adminToken = "web-admin-proxy-token-0123456789abcdef";
const operatorToken = "web-admin-operator-token-0123456789abcdef";
const defaultProxyMaxBytes = 1_048_576;
const upstreamPort = await findFreePort();
const proxyPort = await findFreePort();
const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;
const proxyUrl = `http://127.0.0.1:${proxyPort}`;
const observedAuthorizations = [];
let upstreamResponseMode = "normal";

await assertInvalidProxyConfigFails();
await assertInvalidTimeoutConfigFails();
await assertInvalidMaxBytesConfigFails();
await assertPublicBindFailsClosed();

const upstream = createServer((request, response) => {
  if (request.url !== "/v1/admin/snapshot") {
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "not_found" }));
    return;
  }

  observedAuthorizations.push(request.headers.authorization ?? "");
  if (request.headers.authorization !== `Bearer ${adminToken}`) {
    response.writeHead(403, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code: "admin_forbidden" }));
    return;
  }

  if (upstreamResponseMode === "oversized-content-length") {
    response.writeHead(200, {
      "Content-Length": String(defaultProxyMaxBytes + 1),
      "Content-Type": "application/json",
    });
    response.end("{}");
    return;
  }

  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      auditEvents: [],
      devices: [],
      members: [],
      metrics: { activeDevices: 0, healthyDevices: 0, pendingInvites: 0, totalMembers: 0 },
      roles: [],
    }),
  );
});

await listen(upstream, upstreamPort);

let proxy;
try {
  await assertPublicBindRequiresOperatorToken(upstreamUrl);
  await assertPublicBindRequiresOperatorAuthorization(upstreamUrl);

  proxy = spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: upstreamUrl,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: adminToken,
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `127.0.0.1:${proxyPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stderr = [];
  proxy.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  await waitForHealth(proxyUrl, proxy, stderr);
  await assertSnapshotProxy(proxyUrl);
  await assertProxyIgnoresBrowserAuthorization(proxyUrl);
  await assertProxyRejectsOversizedSnapshot(proxyUrl);
  await assertUnknownRoute(proxyUrl);
  console.log(`Web Admin snapshot proxy smoke passed on ${proxyUrl}`);
} finally {
  if (proxy && !proxy.killed) {
    proxy.kill();
  }
  await closeServer(upstream);
}

async function assertInvalidProxyConfigFails() {
  const port = await findFreePort();
  const child = spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: "http://127.0.0.1:4100",
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `127.0.0.1:${port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(child, 5_000);
  if (code === 0 || signal) {
    throw new Error(`Expected proxy to reject missing admin token, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN must be at least 32 characters/.test(stderr)) {
    throw new Error(`Expected missing-token startup failure, got:\n${stderr}`);
  }
}

async function assertInvalidTimeoutConfigFails() {
  const port = await findFreePort();
  const child = spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: "http://127.0.0.1:4100",
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: adminToken,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TIMEOUT_MS: "0",
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `127.0.0.1:${port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(child, 5_000);
  if (code === 0 || signal) {
    throw new Error(`Expected proxy to reject invalid timeout, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_ADMIN_SNAPSHOT_PROXY_TIMEOUT_MS must be between 100 and 60000 milliseconds/.test(stderr)) {
    throw new Error(`Expected invalid-timeout startup failure, got:\n${stderr}`);
  }
}

async function assertInvalidMaxBytesConfigFails() {
  const port = await findFreePort();
  const child = spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES: "0",
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: "http://127.0.0.1:4100",
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: adminToken,
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `127.0.0.1:${port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(child, 5_000);
  if (code === 0 || signal) {
    throw new Error(`Expected proxy to reject invalid max bytes, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES must be between 1024 and 10485760 bytes/.test(stderr)) {
    throw new Error(`Expected invalid-max-bytes startup failure, got:\n${stderr}`);
  }
}

async function assertPublicBindFailsClosed() {
  const port = await findFreePort();
  const child = spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: "http://127.0.0.1:4100",
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: adminToken,
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `0.0.0.0:${port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(child, 5_000);
  if (code === 0 || signal) {
    throw new Error(`Expected proxy to reject public bind without explicit opt-in, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1/.test(stderr)) {
    throw new Error(`Expected public-bind startup failure, got:\n${stderr}`);
  }
}

async function assertPublicBindRequiresOperatorToken(targetUrl) {
  const port = await findFreePort();
  const child = spawn(process.execPath, [proxyScript], {
    cwd: root,
    env: {
      ...process.env,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: targetUrl,
      ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: adminToken,
      ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND: "1",
      ATLASTERM_WEB_ADMIN_PROXY_BIND: `0.0.0.0:${port}`,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const { code, signal } = await waitForExit(child, 5_000);
  if (code === 0 || signal) {
    throw new Error(`Expected public proxy to require operator token, got code=${code} signal=${signal}`);
  }
  if (!/ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN must be set/.test(stderr)) {
    throw new Error(`Expected missing-operator-token startup failure, got:\n${stderr}`);
  }
}

async function assertPublicBindRequiresOperatorAuthorization(targetUrl) {
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = spawn(process.execPath, [proxyScript], {
      cwd: root,
      env: {
        ...process.env,
        ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET: targetUrl,
        ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN: adminToken,
        ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND: "1",
        ATLASTERM_WEB_ADMIN_PROXY_BIND: `0.0.0.0:${port}`,
        ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN: operatorToken,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
    await waitForHealth(url, child, stderr);

    const unauthenticated = await fetch(`${url}/api/admin/snapshot`);
    if (unauthenticated.status !== 401) {
      throw new Error(`Expected public proxy to reject missing operator auth, got ${unauthenticated.status}`);
    }

    const wrongToken = await fetch(`${url}/api/admin/snapshot`, {
      headers: { Authorization: "Bearer wrong-operator-token" },
    });
    if (wrongToken.status !== 401) {
      throw new Error(`Expected public proxy to reject wrong operator auth, got ${wrongToken.status}`);
    }

    const authorized = await fetch(`${url}/api/admin/snapshot`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    if (!authorized.ok) {
      throw new Error(`Expected public proxy to accept operator auth, got ${authorized.status}: ${await authorized.text()}`);
    }
    if (observedAuthorizations.at(-1) !== `Bearer ${adminToken}`) {
      throw new Error("Expected public proxy to attach only the configured upstream admin token");
    }
  } finally {
    if (child && !child.killed) {
      child.kill();
    }
  }
}

async function assertSnapshotProxy(url) {
  const response = await fetch(`${url}/api/admin/snapshot`);
  if (!response.ok) {
    throw new Error(`Expected proxied snapshot to succeed, got ${response.status}: ${await response.text()}`);
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Expected proxy response to preserve JSON media type");
  }
  const body = await response.json();
  if (body.metrics?.healthyDevices !== 0) {
    throw new Error(`Unexpected proxy snapshot body: ${JSON.stringify(body)}`);
  }
  if (observedAuthorizations.at(-1) !== `Bearer ${adminToken}`) {
    throw new Error("Expected proxy to attach the configured admin token upstream");
  }
}

async function assertProxyRejectsOversizedSnapshot(url) {
  upstreamResponseMode = "oversized-content-length";
  try {
    const response = await fetch(`${url}/api/admin/snapshot`);
    if (response.status !== 502) {
      throw new Error(`Expected oversized upstream snapshot to fail with 502, got ${response.status}: ${await response.text()}`);
    }

    const body = await response.json();
    if (body.code !== "upstream_snapshot_too_large") {
      throw new Error(`Expected upstream_snapshot_too_large, got ${JSON.stringify(body)}`);
    }
  } finally {
    upstreamResponseMode = "normal";
  }
}

async function assertProxyIgnoresBrowserAuthorization(url) {
  const response = await fetch(`${url}/api/admin/snapshot`, {
    headers: { Authorization: "Bearer browser-supplied-token" },
  });
  if (!response.ok) {
    throw new Error(`Expected browser Authorization to be ignored, got ${response.status}`);
  }
  if (observedAuthorizations.at(-1) !== `Bearer ${adminToken}`) {
    throw new Error("Expected proxy to replace, not forward, browser Authorization");
  }
}

async function assertUnknownRoute(url) {
  const response = await fetch(`${url}/v1/admin/snapshot`);
  if (response.status !== 404) {
    throw new Error(`Expected non-proxy routes to return 404, got ${response.status}`);
  }
}

function waitForExit(process, timeoutMs) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      process.kill();
      reject(new Error("Timed out waiting for proxy process to exit"));
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

async function waitForHealth(url, child, stderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Proxy exited early with ${child.exitCode}:\n${stderr.join("")}`);
    }
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) {
        return;
      }
    } catch {
      // Proxy is still starting.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for proxy health check:\n${stderr.join("")}`);
}

function listen(server, port) {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
}

function closeServer(server) {
  return new Promise((resolveClose, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolveClose();
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
