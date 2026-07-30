import assert from "node:assert/strict";
import test from "node:test";

import {
  hasRustAuditErrorDiagnostics,
  rustAuditAttemptPassed,
} from "./run-rust-advisory-gate.mjs";

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
