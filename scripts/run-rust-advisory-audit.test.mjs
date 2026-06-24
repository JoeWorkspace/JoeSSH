import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./run-rust-advisory-audit.mjs", import.meta.url));

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "rust-advisory-audit-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });
  const db = join(root, "advisory-db");
  mkdirSync(join(db, ".git"), { recursive: true });
  writeFileSync(join(db, ".git", "FETCH_HEAD"), "fresh\n", "utf8");
  if (options.staleDb) {
    const stale = new Date(Date.now() - 72 * 60 * 60 * 1000);
    utimesSync(join(db, ".git", "FETCH_HEAD"), stale, stale);
  }

  const statePath = join(root, "state.json");
  writeFileSync(statePath, JSON.stringify({ calls: [] }), "utf8");
  const fakeCargo = join(root, "fake-cargo.js");
  writeFileSync(
    fakeCargo,
    `
const fs = require("fs");
const statePath = process.env.FAKE_CARGO_STATE;
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
state.calls.push(process.argv.slice(2));
fs.writeFileSync(statePath, JSON.stringify(state), "utf8");
const call = state.calls.length;
if (call === 1) {
  process.stderr.write(process.env.FIRST_STDERR || "");
  process.stdout.write(process.env.FIRST_STDOUT || "");
  process.exit(Number(process.env.FIRST_STATUS || "0"));
}
process.stderr.write(process.env.SECOND_STDERR || "");
process.stdout.write(process.env.SECOND_STDOUT || "");
process.exit(Number(process.env.SECOND_STATUS || "0"));
`,
    "utf8",
  );

  return { db, fakeCargo, root, statePath };
}

function runWrapper(fixture, env = {}) {
  return spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--root",
      fixture.root,
      "--db",
      fixture.db,
      "--cargo-command",
      process.execPath,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ATLASTERM_CARGO_ARGS: JSON.stringify([fixture.fakeCargo]),
        FAKE_CARGO_STATE: fixture.statePath,
        ...env,
      },
    },
  );
}

function readCalls(fixture) {
  return JSON.parse(readFileSync(fixture.statePath, "utf8")).calls;
}

test("passes through successful cargo audit without fallback", (t) => {
  const fixture = createFixture(t);

  const result = runWrapper(fixture, {
    FIRST_STATUS: "0",
    FIRST_STDOUT: "Scanning Cargo.lock for vulnerabilities\n",
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readCalls(fixture).length, 1);
  assert.match(result.stdout, /Scanning Cargo\.lock/);
});

test("falls back to a fresh local advisory DB when fetch fails", (t) => {
  const fixture = createFixture(t);

  const result = runWrapper(fixture, {
    FIRST_STATUS: "1",
    FIRST_STDERR: "error: couldn't fetch advisory database: failed to prepare fetch\n",
    SECOND_STATUS: "0",
    SECOND_STDOUT: "Scanning Cargo.lock for vulnerabilities\n",
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = readCalls(fixture);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["audit", "--deny", "warnings"]);
  assert.ok(calls[1].includes("--no-fetch"));
  assert.ok(calls[1].includes("--stale"));
  assert.ok(calls[1].includes("--db"));
  assert.match(result.stderr, /retrying with fresh local cache/);
});

test("does not hide non-fetch audit failures", (t) => {
  const fixture = createFixture(t);

  const result = runWrapper(fixture, {
    FIRST_STATUS: "1",
    FIRST_STDERR: "vulnerability found\n",
  });

  assert.equal(result.status, 1);
  assert.equal(readCalls(fixture).length, 1);
  assert.match(result.stderr, /vulnerability found/);
});

test("rejects stale local advisory cache after a fetch failure", (t) => {
  const fixture = createFixture(t, { staleDb: true });

  const result = runWrapper(fixture, {
    ATLASTERM_RUST_ADVISORY_MAX_CACHE_HOURS: "1",
    FIRST_STATUS: "1",
    FIRST_STDERR: "error: couldn't fetch advisory database: failed to prepare fetch\n",
  });

  assert.equal(result.status, 1);
  assert.equal(readCalls(fixture).length, 1);
  assert.match(result.stderr, /local cache cannot be used/);
});
