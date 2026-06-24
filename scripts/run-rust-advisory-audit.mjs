import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const scriptName = "run-rust-advisory-audit.mjs";
const {
  cargoArgs,
  cargoCommand,
  dbPath,
  maxCacheHours,
  root,
} = parseArgs(process.argv.slice(2));

const auditArgs = ["audit", "--deny", "warnings"];
const first = runCargo(auditArgs);
writeOutput(first);
if (first.status === 0) {
  process.exit(0);
}

const diagnostic = `${first.stdout}\n${first.stderr}`;
if (!isFetchFailure(diagnostic)) {
  process.exit(first.status ?? 1);
}

const cacheFreshness = inspectFreshAdvisoryCache(dbPath, maxCacheHours);
if (!cacheFreshness.ok) {
  console.error(
    `${scriptName}: cargo audit could not fetch the RustSec advisory DB, and the local cache cannot be used: ${cacheFreshness.reason}`,
  );
  process.exit(first.status ?? 1);
}

console.warn(
  `${scriptName}: cargo audit advisory DB fetch failed; retrying with fresh local cache ${displayPath(
    dbPath,
  )} (${cacheFreshness.ageHours.toFixed(1)}h old).`,
);
const fallback = runCargo([...auditArgs, "--db", dbPath, "--no-fetch", "--stale"]);
writeOutput(fallback);
process.exit(fallback.status ?? 1);

function runCargo(args) {
  return spawnSync(cargoCommand, [...cargoArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writeOutput(result) {
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
}

function isFetchFailure(text) {
  return /couldn'?t fetch advisory database|failed to prepare fetch|git-upload-pack|error sending request/i.test(text);
}

function inspectFreshAdvisoryCache(path, maxHours) {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return { ok: false, reason: `${displayPath(path)} does not exist` };
  }

  const freshnessMarkers = [
    join(path, ".git", "FETCH_HEAD"),
    join(path, ".git", "refs", "remotes", "origin", "HEAD"),
    join(path, ".git", "packed-refs"),
  ].filter((candidate) => existsSync(candidate));
  if (freshnessMarkers.length === 0) {
    return { ok: false, reason: `${displayPath(path)} has no Git freshness marker` };
  }

  const newestMtime = freshnessMarkers
    .map((candidate) => statSync(candidate).mtimeMs)
    .reduce((newest, mtime) => Math.max(newest, mtime), 0);
  const ageHours = (Date.now() - newestMtime) / (60 * 60 * 1000);
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return { ok: false, reason: `${displayPath(path)} has an invalid freshness timestamp` };
  }
  if (ageHours > maxHours) {
    return {
      ok: false,
      reason: `${displayPath(path)} is ${ageHours.toFixed(1)}h old, above ${maxHours}h`,
    };
  }

  return { ageHours, ok: true };
}

function parseArgs(args) {
  let root = resolve(import.meta.dirname, "..");
  let dbPath = process.env.CARGO_AUDIT_DB
    ? resolve(process.env.CARGO_AUDIT_DB)
    : join(homedir(), ".cargo", "advisory-db");
  let maxCacheHours = Number.parseFloat(process.env.ATLASTERM_RUST_ADVISORY_MAX_CACHE_HOURS ?? "48");
  let cargoCommand = process.env.ATLASTERM_CARGO_COMMAND ?? "cargo";
  const cargoArgs = parseJsonArrayEnv("ATLASTERM_CARGO_ARGS");

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--db") {
      dbPath = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      dbPath = resolve(arg.slice("--db=".length));
      continue;
    }
    if (arg === "--max-cache-hours") {
      maxCacheHours = Number.parseFloat(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-cache-hours=")) {
      maxCacheHours = Number.parseFloat(arg.slice("--max-cache-hours=".length));
      continue;
    }
    if (arg === "--cargo-command") {
      cargoCommand = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--cargo-command=")) {
      cargoCommand = arg.slice("--cargo-command=".length);
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(maxCacheHours) || maxCacheHours <= 0) {
    fail("--max-cache-hours must be a positive number.");
  }

  return {
    cargoArgs,
    cargoCommand,
    dbPath,
    maxCacheHours,
    root,
  };
}

function parseJsonArrayEnv(name) {
  const value = process.env[name];
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")) {
      return parsed;
    }
  } catch {
    // Fall through to the explicit error below.
  }
  fail(`${name} must be a JSON array of strings when set.`);
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value.`);
  }
  return value;
}

function displayPath(path) {
  return resolve(path).replace(/\\/g, "/");
}

function fail(message) {
  console.error(`${scriptName}: ${message}`);
  process.exit(1);
}
