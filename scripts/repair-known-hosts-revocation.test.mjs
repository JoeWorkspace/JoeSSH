import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";

const fixtureRoot = resolve("reports/internal/maintenance-recovery-tests");
function fixture() {
  mkdirSync(fixtureRoot, { recursive: true });
  const parent = mkdtempSync(join(fixtureRoot, "trust-"));
  const directory = join(parent, "dev.atlasterm.joessh");
  mkdirSync(directory);
  return {
    directory,
    cleanup() {
      assert.ok(resolve(parent).startsWith(fixtureRoot + sep));
      rmSync(parent, { recursive: true });
    },
  };
}
function repair(directory) {
  return execFileSync(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      resolve("scripts/repair-known-hosts-revocation.ps1"),
      "-AppDataDirectory",
      directory,
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
}
test(
  "repair keeps main bytes, backs up damaged metadata, and refuses future versions",
  { skip: process.platform !== "win32" },
  () => {
    const f = fixture();
    try {
      const main = join(f.directory, "known-hosts.json");
      const sidecar = join(f.directory, "known-hosts-revocation.json");
      const content = '{ "host:22": "SHA256:existing-pin" }\n';
      writeFileSync(main, content);
      writeFileSync(sidecar, "broken");
      assert.equal(JSON.parse(repair(f.directory)).status, "repaired");
      assert.equal(readFileSync(main, "utf8"), content);
      assert.equal(
        readdirSync(f.directory).filter((name) => name.includes(".backup-"))
          .length,
        1,
      );
      const saved = readFileSync(sidecar, "utf8");
      assert.match(repair(f.directory), /already valid/);
      assert.equal(readFileSync(sidecar, "utf8"), saved);
      writeFileSync(sidecar, '{ "version": 2, "token": "future" }');
      assert.throws(() => repair(f.directory), /newer format/);
      assert.equal(readFileSync(main, "utf8"), content);
      const unknown = JSON.stringify({
        ...JSON.parse(saved),
        extra: "unknown",
      });
      writeFileSync(sidecar, unknown);
      assert.throws(() => repair(f.directory), /newer format/);
      assert.equal(readFileSync(sidecar, "utf8"), unknown);
      writeFileSync(main, "broken");
      assert.throws(() => repair(f.directory));
      assert.equal(readFileSync(main, "utf8"), "broken");
    } finally {
      f.cleanup();
    }
  },
);

test(
  "recovery preserves version-one pins and refuses malformed records",
  { skip: process.platform !== "win32" },
  () => {
    const f = fixture();
    try {
      const main = join(f.directory, "known-hosts.json");
      const sidecar = join(f.directory, "known-hosts-revocation.json");
      const record = {
        key: "host:22",
        host: "host",
        port: 22,
        fingerprint: "SHA256:pin",
        first_seen_at_ms: 100,
        last_seen_at_ms: null,
        source: "confirmed",
      };
      const valid = JSON.stringify({
        version: 1,
        hosts: { "host:22": record },
      });
      writeFileSync(main, valid);
      assert.equal(JSON.parse(repair(f.directory)).status, "repaired");
      assert.equal(readFileSync(main, "utf8"), valid);
      const revision = readFileSync(sidecar, "utf8");
      for (const corrupt of [
        { version: 1, hosts: { "host:22": { ...record, port: "22" } } },
        { version: 1, hosts: false },
        { version: "1", hosts: {} },
      ]) {
        const bytes = JSON.stringify(corrupt);
        writeFileSync(main, bytes);
        assert.throws(() => repair(f.directory), /malformed|Malformed/);
        assert.equal(readFileSync(main, "utf8"), bytes);
        assert.equal(readFileSync(sidecar, "utf8"), revision);
      }
    } finally {
      f.cleanup();
    }
  },
);
test(
  "missing sidecar receives a fresh token without altering legacy pins",
  { skip: process.platform !== "win32" },
  () => {
    const f = fixture();
    try {
      writeFileSync(join(f.directory, "known-hosts.json"), "{}");
      assert.equal(JSON.parse(repair(f.directory)).status, "repaired");
      assert.match(
        JSON.parse(
          readFileSync(join(f.directory, "known-hosts-revocation.json")),
        ).token,
        /^[0-9a-f-]{36}$/,
      );
      assert.equal(
        readFileSync(join(f.directory, "known-hosts.json"), "utf8"),
        "{}",
      );
    } finally {
      f.cleanup();
    }
  },
);
