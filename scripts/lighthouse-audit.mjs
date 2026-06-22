import { createServer } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import lighthouse from "lighthouse";
import puppeteer from "puppeteer";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const categories = ["performance", "accessibility", "best-practices", "seo"];
const defaultThresholds = {
  accessibility: 0.9,
  "best-practices": 0.9,
  performance: 0.9,
  seo: 0.9,
};
const thresholdFlags = {
  "--min-accessibility": "accessibility",
  "--min-best-practices": "best-practices",
  "--min-performance": "performance",
  "--min-seo": "seo",
};
const targetDefaults = {
  desktop: {
    distDir: resolve(root, "apps", "desktop", "dist"),
    outputPath: resolve(root, "reports", "lighthouse", "desktop.json"),
  },
  web: {
    distDir: resolve(root, "apps", "web", "dist"),
    outputPath: resolve(root, "reports", "lighthouse", "web-admin.json"),
  },
};

if (isMainModule()) {
  const options = parseArgs(process.argv.slice(2));

  try {
    await runAudit(options);
  } catch (error) {
    console.error(errorMessage(error));
    process.exit(1);
  }
}

async function runAudit({ distDir, outputPath, thresholds }) {
  assertDist(distDir);

  const maxAttempts = parsePositiveInteger(
    process.env.ATLASTERM_LIGHTHOUSE_ATTEMPTS ?? "3",
    "ATLASTERM_LIGHTHOUSE_ATTEMPTS",
  );
  let lastLhr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const lhr = await runLighthouseAttempt(distDir);
    lastLhr = lhr;
    const runWarningFailures = collectRunWarningFailures(lhr);
    if (runWarningFailures.length > 0 && attempt < maxAttempts) {
      console.log(
        `Lighthouse emitted ${runWarningFailures.length} run warning(s) on attempt ${attempt}/${maxAttempts}; retrying before failing closed.`,
      );
      continue;
    }
    break;
  }

  if (!lastLhr?.categories) {
    throw new Error("Lighthouse did not return category results.");
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(lastLhr, null, 2));

  const failures = collectRunWarningFailures(lastLhr);
  console.log("\n=== Lighthouse Audit Results ===\n");
  if (failures.length > 0) {
    console.log(`  FAIL Lighthouse run warnings: ${failures.length}`);
    for (const failure of failures) {
      console.log(`    - ${failure.replace(/^Lighthouse run warning: /, "")}`);
    }
  }
  for (const category of categories) {
    const resultCategory = lastLhr.categories[category];
    if (!resultCategory || typeof resultCategory.score !== "number") {
      failures.push(`${category} score is missing`);
      console.log(`  FAIL ${category}: missing score`);
      continue;
    }

    const score = Math.round(resultCategory.score * 100);
    const minimum = Math.round(thresholds[category] * 100);
    const passed = resultCategory.score >= thresholds[category];
    console.log(
      `  ${passed ? "PASS" : "FAIL"} ${resultCategory.title}: ${score}/100 (min ${minimum})`,
    );
    if (!passed) {
      failures.push(
        `${resultCategory.title} scored ${score}/100 below minimum ${minimum}/100`,
      );
    }
  }

  console.log(`\nFull report saved to ${displayPath(outputPath)}`);

  if (failures.length > 0) {
    throw new Error(
      `Lighthouse thresholds failed:\n- ${failures.join("\n- ")}`,
    );
  }
}

async function runLighthouseAttempt(distDir) {
  let browser;
  let server;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-gpu"],
      headless: true,
    });
    const browserPort = new URL(browser.wsEndpoint()).port;

    server = await startStaticServer(distDir);
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/?adminSnapshot=fixture`;

    console.log(
      `Running Lighthouse against ${url} (${displayPath(distDir)})...`,
    );

    const result = await lighthouse(url, {
      logLevel: "error",
      onlyCategories: categories,
      output: "json",
      port: Number(browserPort),
    });

    return result?.lhr;
  } finally {
    await closeServer(server);
    await browser?.close();
  }
}

export function collectRunWarningFailures(lhr) {
  const warnings = Array.isArray(lhr?.runWarnings) ? lhr.runWarnings : [];
  return warnings
    .map(formatRunWarning)
    .filter((warning) => warning.length > 0)
    .map((warning) => `Lighthouse run warning: ${warning}`);
}

function formatRunWarning(warning) {
  if (typeof warning === "string") {
    return warning.trim();
  }
  if (warning == null) {
    return "";
  }
  return JSON.stringify(warning);
}

function parseArgs(args) {
  let target = "web";
  let distDir;
  let outputPath;
  const thresholds = { ...defaultThresholds };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--target") {
      target = requireValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--dist") {
      distDir = resolve(root, requireValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--output") {
      outputPath = resolve(root, requireValue(args, index, arg));
      index += 1;
      continue;
    }

    if (Object.hasOwn(thresholdFlags, arg)) {
      thresholds[thresholdFlags[arg]] = parseThreshold(
        requireValue(args, index, arg),
        arg,
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Object.hasOwn(targetDefaults, target)) {
    throw new Error(
      `Unknown Lighthouse target '${target}'. Expected one of: ${Object.keys(targetDefaults).join(", ")}.`,
    );
  }

  return {
    distDir: distDir ?? targetDefaults[target].distDir,
    outputPath: outputPath ?? targetDefaults[target].outputPath,
    thresholds,
  };
}

function requireValue(args, index, arg) {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${arg} requires a value.`);
  }
  return value;
}

function parseThreshold(value, arg) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
    throw new Error(`${arg} must be a number from 0 to 1.`);
  }
  return numeric;
}

function parsePositiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return numeric;
}

function assertDist(distDir) {
  const indexPath = resolve(distDir, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Expected built app index at ${displayPath(indexPath)}.`);
  }
  if (!statSync(indexPath).isFile()) {
    throw new Error(
      `Built app index is not a file: ${displayPath(indexPath)}.`,
    );
  }
}

async function startStaticServer(distDir) {
  const deploymentHeaders = readDeploymentHeaders(distDir);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/admin/snapshot") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(JSON.stringify(createEmptyAdminSnapshot()));
      return;
    }

    const filePath = resolveStaticPath(distDir, request.url ?? "/");
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }

    response.writeHead(200, {
      "Cache-Control": filePath.endsWith("index.html")
        ? "no-store"
        : "public, max-age=60",
      "Content-Type": contentTypeFor(filePath),
      "X-Content-Type-Options": "nosniff",
      ...deploymentHeaders,
    });
    response.end(readFileSync(filePath));
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  return server;
}

function createEmptyAdminSnapshot() {
  return {
    auditEvents: [],
    devices: [],
    members: [],
    metrics: {
      activeMembers: 0,
      auditEventsToday: 0,
      healthyDevices: 0,
      rolesConfigured: 0,
    },
    roles: [],
  };
}

function readDeploymentHeaders(distDir) {
  const headersPath = resolve(distDir, "_headers");
  if (!existsSync(headersPath)) {
    return {};
  }

  const headers = {};
  let inRouteBlock = false;
  for (const line of readFileSync(headersPath, "utf8").split(/\r?\n/)) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }
    if (!/^\s/.test(line)) {
      inRouteBlock = true;
      continue;
    }
    if (!inRouteBlock) {
      continue;
    }

    const match = line.trim().match(/^([^:]+):\s*(.+)$/);
    if (match) {
      headers[match[1]] = match[2];
    }
  }
  return headers;
}

function resolveStaticPath(distDir, requestUrl) {
  const pathname = new URL(requestUrl, "http://127.0.0.1").pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath =
    decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const resolved = resolve(distDir, relativePath);
  if (resolved !== distDir && !resolved.startsWith(`${distDir}${sep}`)) {
    return null;
  }
  return resolved;
}

function contentTypeFor(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function closeServer(server) {
  if (!server?.listening) {
    return;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
}

function isMainModule() {
  return process.argv[1]
    ? import.meta.url === pathToFileURL(process.argv[1]).href
    : false;
}

function displayPath(path) {
  return relative(root, path).replace(/\\/g, "/");
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
