import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { auditPackageLock } from "./check-package-lock-portability.mjs";

const lockPath = resolve(import.meta.dirname, "..", "package-lock.json");
const sourceLock = JSON.parse(readFileSync(lockPath, "utf8"));
const rolldownLinuxPath = "node_modules/@rolldown/binding-linux-x64-gnu";

test("accepts the repository lockfile", () => {
  const result = auditPackageLock(sourceLock);
  assert.deepEqual(result.issues, []);
  assert.ok(result.registryPackages > 800);
  assert.ok(result.optionalPackages > 30);
});

test("rejects a missing integrity hash", () => {
  const lock = structuredClone(sourceLock);
  delete lock.packages[rolldownLinuxPath].integrity;

  const result = auditPackageLock(lock);

  assert.ok(
    result.issues.includes(
      `${rolldownLinuxPath} is missing a valid integrity hash.`,
    ),
  );
});

test("rejects a missing cross-platform optional package", () => {
  const lock = structuredClone(sourceLock);
  delete lock.packages[rolldownLinuxPath];

  const result = auditPackageLock(lock);

  assert.ok(
    result.issues.some(
      (issue) =>
        issue.includes(
          "references missing optional package @rolldown/binding-linux-x64-gnu",
        ) ||
        issue.startsWith(
          "@rolldown/binding-linux-x64-gnu must be locked at ",
        ),
    ),
  );
});

test("rejects a local package resolution", () => {
  const lock = structuredClone(sourceLock);
  lock.packages[rolldownLinuxPath].resolved = "file:C:\\temp\\rolldown";

  const result = auditPackageLock(lock);

  assert.ok(
    result.issues.includes(
      `${rolldownLinuxPath} resolves to a local path: file:C:\\temp\\rolldown`,
    ),
  );
});
