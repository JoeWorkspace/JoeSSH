import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

const DEFAULT_ADMIN_SNAPSHOT_PROXY_MAX_BYTES = 1_048_576;

const config = readConfig(process.env);
const server = createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    writeJson(response, 502, {
      code: "admin_snapshot_proxy_error",
      message: error instanceof Error ? error.message : "Admin snapshot proxy failed.",
    });
  });
});

server.listen(config.port, config.host, () => {
  console.log(`JoeSSH Web Admin snapshot proxy listening on http://${formatHostForUrl(config.host)}:${config.port}`);
});

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

  if (requestUrl.pathname === "/healthz") {
    writeJson(response, 200, { ok: true, service: "joessh-web-admin-snapshot-proxy" });
    return;
  }

  if (requestUrl.pathname !== "/api/admin/snapshot") {
    writeJson(response, 404, { code: "not_found" });
    return;
  }

  if (request.method !== "GET") {
    response.writeHead(405, {
      Allow: "GET",
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(JSON.stringify({ code: "method_not_allowed" }));
    return;
  }

  if (config.operatorToken && !isAuthorizedBearer(request.headers.authorization, config.operatorToken)) {
    writeJson(response, 401, { code: "operator_auth_required" });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const upstreamResponse = await fetch(config.snapshotUrl, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${config.adminToken}`,
      },
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    const contentType = upstreamResponse.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      writeJson(response, 502, { code: "invalid_upstream_media_type" });
      return;
    }

    let upstreamBody;
    try {
      upstreamBody = await readUpstreamTextWithLimit(upstreamResponse, config.maxBodyBytes);
    } catch (error) {
      if (error instanceof UpstreamSnapshotTooLargeError) {
        writeJson(response, 502, { code: "upstream_snapshot_too_large" });
        return;
      }
      throw error;
    }

    response.writeHead(upstreamResponse.status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(upstreamBody);
  } finally {
    clearTimeout(timeout);
  }
}

function readConfig(env) {
  const bind = env.ATLASTERM_WEB_ADMIN_PROXY_BIND ?? "127.0.0.1:4300";
  const { host, port } = parseBind(bind);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail("ATLASTERM_WEB_ADMIN_PROXY_BIND must include a valid TCP port.");
  }
  const publicBind = !isLoopbackHost(host);
  if (publicBind && !envFlagEnabled(env.ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND)) {
    fail(
      "ATLASTERM_WEB_ADMIN_PROXY_BIND must stay on a loopback address unless ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1 is set behind an authenticating reverse proxy.",
    );
  }

  const adminToken = env.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN;
  if (typeof adminToken !== "string" || adminToken.length < 32) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN must be at least 32 characters.");
  }
  if (/[\s\u0000-\u001f\u007f]/u.test(adminToken)) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN must not contain whitespace or control characters.");
  }

  const operatorToken = readOptionalToken(env.ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN, {
    envName: "ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN",
    required: publicBind,
  });
  if (operatorToken && operatorToken === adminToken) {
    fail("ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN must be distinct from ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN.");
  }

  const target = env.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET ?? "http://127.0.0.1:4100";
  let targetUrl;
  try {
    targetUrl = new URL("/v1/admin/snapshot", target.endsWith("/") ? target : `${target}/`);
  } catch {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET must be a valid HTTP(S) URL.");
  }
  if (!["http:", "https:"].includes(targetUrl.protocol) || targetUrl.username || targetUrl.password) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET must be an HTTP(S) URL without embedded credentials.");
  }

  return {
    adminToken,
    host,
    maxBodyBytes: parseMaxBodyBytes(
      env.ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES ?? String(DEFAULT_ADMIN_SNAPSHOT_PROXY_MAX_BYTES),
    ),
    operatorToken,
    port,
    snapshotUrl: targetUrl,
    timeoutMs: parseTimeoutMs(env.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TIMEOUT_MS ?? "10000"),
  };
}

function readOptionalToken(value, { envName, required }) {
  if (value === undefined || value === "") {
    if (required) {
      fail(`${envName} must be set when ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1 is used.`);
    }
    return null;
  }

  if (value.length < 32) {
    fail(`${envName} must be at least 32 characters.`);
  }
  if (/[\s\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${envName} must not contain whitespace or control characters.`);
  }
  return value;
}

function parseTimeoutMs(value) {
  if (!/^[0-9]+$/.test(value)) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_TIMEOUT_MS must be an integer number of milliseconds.");
  }

  const timeoutMs = Number.parseInt(value, 10);
  if (timeoutMs < 100 || timeoutMs > 60000) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_TIMEOUT_MS must be between 100 and 60000 milliseconds.");
  }
  return timeoutMs;
}

function parseMaxBodyBytes(value) {
  if (!/^[0-9]+$/.test(value)) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES must be an integer byte count.");
  }

  const maxBodyBytes = Number.parseInt(value, 10);
  if (maxBodyBytes < 1024 || maxBodyBytes > 10485760) {
    fail("ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES must be between 1024 and 10485760 bytes.");
  }
  return maxBodyBytes;
}

function parseBind(bind) {
  const bracketedIpv6 = bind.match(/^\[([^\]]+)\]:([0-9]+)$/);
  if (bracketedIpv6) {
    return { host: bracketedIpv6[1], port: Number.parseInt(bracketedIpv6[2], 10) };
  }

  const hostPort = bind.match(/^([^:]+):([0-9]+)$/);
  if (!hostPort) {
    fail("ATLASTERM_WEB_ADMIN_PROXY_BIND must look like 127.0.0.1:4300 or [::1]:4300.");
  }

  return { host: hostPort[1], port: Number.parseInt(hostPort[2], 10) };
}

function isLoopbackHost(host) {
  const normalized = host.trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") {
    return true;
  }

  if (isIP(normalized) === 4) {
    const firstOctet = Number.parseInt(normalized.split(".")[0], 10);
    return firstOctet === 127;
  }

  return false;
}

function envFlagEnabled(value) {
  return typeof value === "string" && ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isAuthorizedBearer(header, token) {
  if (typeof header !== "string") {
    return false;
  }

  const match = header.match(/^Bearer\s+(\S+)$/i);
  return Boolean(match && timingSafeStringEqual(match[1], token));
}

function timingSafeStringEqual(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

class UpstreamSnapshotTooLargeError extends Error {
  constructor() {
    super("Upstream admin snapshot response was too large.");
    this.name = "UpstreamSnapshotTooLargeError";
  }
}

async function readUpstreamTextWithLimit(upstreamResponse, maxBodyBytes) {
  const contentLength = parseContentLength(upstreamResponse.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBodyBytes) {
    await cancelBody(upstreamResponse.body, "Upstream admin snapshot response was too large.");
    throw new UpstreamSnapshotTooLargeError();
  }

  if (upstreamResponse.body && typeof upstreamResponse.body.getReader === "function") {
    return readStreamTextWithLimit(upstreamResponse.body, maxBodyBytes);
  }

  const bodyText = await upstreamResponse.text();
  if (Buffer.byteLength(bodyText, "utf8") > maxBodyBytes) {
    throw new UpstreamSnapshotTooLargeError();
  }
  return bodyText;
}

async function readStreamTextWithLimit(body, maxBodyBytes) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let bodyText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    bytesRead += value.byteLength;
    if (bytesRead > maxBodyBytes) {
      await reader.cancel("Upstream admin snapshot response was too large.").catch(() => undefined);
      throw new UpstreamSnapshotTooLargeError();
    }

    bodyText += decoder.decode(value, { stream: true });
  }

  return bodyText + decoder.decode();
}

function parseContentLength(value) {
  const contentLength = value?.trim();
  if (!contentLength || !/^[0-9]+$/.test(contentLength)) {
    return null;
  }

  const parsedContentLength = Number.parseInt(contentLength, 10);
  return Number.isSafeInteger(parsedContentLength) ? parsedContentLength : null;
}

async function cancelBody(body, reason) {
  try {
    await body?.cancel(reason).catch(() => undefined);
  } catch (error) {
    void error;
  }
}

function formatHostForUrl(host) {
  return host.includes(":") ? `[${host}]` : host;
}

function writeJson(response, status, body) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

function fail(message) {
  console.error(`node-admin-snapshot-proxy.mjs: ${message}`);
  process.exit(1);
}
