import assert from "node:assert/strict";
import test from "node:test";

import {
  auditRustLockfiles,
  hasRustAuditErrorDiagnostics,
  rustAuditAttemptPassed,
} from "./run-rust-advisory-gate.mjs";

test("audits both workspace and desktop lockfiles with warning denial", () => {
  const calls = [];
  const audits = auditRustLockfiles((command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: "", stderr: "" };
  });
  assert.deepEqual(calls, [
    ["cargo", ["audit", "--deny", "warnings", "--file", "Cargo.lock"]],
    [
      "cargo",
      [
        "audit",
        "--deny",
        "warnings",
        "--file",
        "apps/desktop/src-tauri/Cargo.lock",
      ],
    ],
  ]);
  assert.ok(audits.every(({ passed }) => passed));
});

for (const failedLockfile of [
  "Cargo.lock",
  "apps/desktop/src-tauri/Cargo.lock",
]) {
  test(`blocks release when ${failedLockfile} has a denied advisory`, () => {
    const audits = auditRustLockfiles((_command, args) => ({
      status: args.at(-1) === failedLockfile ? 1 : 0,
      stdout: "",
      stderr: "",
    }));
    assert.equal(audits.length, 2);
    assert.deepEqual(
      audits.filter(({ passed }) => !passed).map(({ lockfile }) => lockfile),
      [failedLockfile],
    );
  });
}

test("does not accept cached-only audits after an online diagnostic failure", () => {
  const calls = [];
  const audits = auditRustLockfiles((_command, args) => {
    calls.push(args);
    return {
      status: 0,
      stdout: "",
      stderr: "error: advisory database fetch failed",
    };
  });
  assert.ok(audits.every(({ passed }) => !passed));
  assert.equal(calls.length, 2);
  assert.ok(calls.every((args) => !args.includes("--no-fetch")));
});

test("accepts a clean cargo audit result", () => {
  assert.equal(
    rustAuditAttemptPassed({
      status: 0,
      stdout: "Scanning Cargo.lock for vulnerabilities\n",
      stderr: "",
    }),
    true,
  );
});

test("rejects cargo audit error diagnostics even when exit status is zero", () => {
  const output =
    "error: couldn't check if the package is yanked: registry request timed out";

  assert.equal(hasRustAuditErrorDiagnostics(output), true);
  assert.equal(
    rustAuditAttemptPassed({ status: 0, stdout: "", stderr: output }),
    false,
  );
});

test("rejects non-zero and process launch failures", () => {
  assert.equal(
    rustAuditAttemptPassed({ status: 1, stdout: "", stderr: "vulnerable" }),
    false,
  );
  assert.equal(
    rustAuditAttemptPassed({
      status: null,
      error: new Error("cargo missing"),
      stdout: "",
      stderr: "",
    }),
    false,
  );
});
