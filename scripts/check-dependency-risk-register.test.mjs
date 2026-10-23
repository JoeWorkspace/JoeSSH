import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkDependencyRiskRegister, parseAuditResult } from "./check-dependency-risk-register.mjs";

const packageName = "fixture-package";
const advisoryUrl = "https://github.com/advisories/GHSA-2345-6789-abcd";

function cleanReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      // npm dependency categories may overlap; their sum need not equal total.
      dependencies: { prod: 2, dev: 2, optional: 1, peer: 1, peerOptional: 0, total: 3 },
    },
  };
}

function vulnerabilityReport(severity = "moderate") {
  const report = cleanReport();
  report.vulnerabilities[packageName] = {
    name: packageName,
    severity,
    isDirect: true,
    via: [{ name: packageName, severity, url: advisoryUrl }],
    effects: [],
    range: "<2.0.0",
    nodes: [`node_modules/${packageName}`],
    fixAvailable: { name: packageName, version: "2.0.0", isSemVerMajor: true },
  };
  report.metadata.vulnerabilities[severity] = 1;
  report.metadata.vulnerabilities.total = 1;
  return report;
}

function auditResult(report = cleanReport(), status = 0) {
  return { status, signal: null, stdout: JSON.stringify(report), stderr: "" };
}

function registerFixture(t, contents = "") {
  const prefix = join(tmpdir(), "joessh-risk-register-");
  const rootDir = mkdtempSync(prefix);
  mkdirSync(join(rootDir, "docs"));
  writeFileSync(join(rootDir, "docs", "dependency-risk-register.md"), contents);
  t.after(() => {
    assert.ok(resolve(rootDir).startsWith(resolve(prefix)));
    rmSync(rootDir, { recursive: true, force: true });
  });
  return rootDir;
}

// Exercise the process result path without launching npm or using the network.
function childAudit(report, status, expectedRoot) {
  return (command, args, options) => {
    assert.equal(command, "npm");
    assert.deepEqual(args, ["audit", "--omit=dev", "--audit-level=moderate", "--json"]);
    assert.equal(options.cwd, expectedRoot);
    return spawnSync(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1]); process.exit(Number(process.argv[2]));",
      JSON.stringify(report),
      String(status),
    ], { encoding: "utf8" });
  };
}

test("accepts a complete clean v2 report with exit 0", () => {
  const report = cleanReport();
  assert.deepEqual(parseAuditResult(auditResult(report)), report);
});

test("accepts vulnerability findings with npm's normal exit 1", () => {
  const report = vulnerabilityReport();
  assert.deepEqual(parseAuditResult(auditResult(report, 1)), report);
});

test("accepts valid transitive references and boolean fix availability", () => {
  const report = vulnerabilityReport("low");
  report.vulnerabilities[packageName].via = ["transitive-package"];
  report.vulnerabilities[packageName].fixAvailable = false;
  assert.deepEqual(parseAuditResult(auditResult(report)), report);
});

test("rejects exit 1 with a clean report instead of declaring success", () => {
  assert.throws(() => parseAuditResult(auditResult(cleanReport(), 1)), /exit status does not match/);
});

test("rejects exit 0 with moderate findings at the configured audit threshold", () => {
  assert.throws(() => parseAuditResult(auditResult(vulnerabilityReport(), 0)), /exit status does not match/);
});

test("requires exit 0 for findings below the configured audit threshold", () => {
  for (const severity of ["info", "low"]) {
    const report = vulnerabilityReport(severity);
    assert.deepEqual(parseAuditResult(auditResult(report, 0)), report);
    assert.throws(() => parseAuditResult(auditResult(report, 1)), /exit status does not match/);
  }
});

for (const [label, result] of [
  ["missing process result", undefined],
  ["spawn error", { ...auditResult(), error: new Error("ENOENT") }],
  ["terminated process", { ...auditResult(), signal: "SIGTERM" }],
  ["null exit status", { ...auditResult(), status: null }],
  ["missing exit status", { ...auditResult(), status: undefined }],
  ["exit status 2", auditResult(cleanReport(), 2)],
  ["exit status 127", auditResult(cleanReport(), 127)],
  ["negative exit status", auditResult(cleanReport(), -1)],
  ["string exit status", auditResult(cleanReport(), "0")],
]) {
  test(`rejects ${label} even when output could look clean`, () => {
    assert.throws(() => parseAuditResult(result), /npm audit/);
  });
}

for (const [label, stdout] of [
  ["missing output", undefined],
  ["empty output", ""],
  ["whitespace output", " \n\t"],
  ["non-string output", {}],
  ["invalid JSON", "not JSON"],
]) {
  test(`rejects ${label}`, () => {
    assert.throws(() => parseAuditResult({ ...auditResult(), stdout }), /JSON/);
  });
}

for (const [label, report] of [
  ["npm registry error JSON", { error: { code: "E503", summary: "registry unavailable" } }],
  ["error field on an otherwise complete report", { ...cleanReport(), error: null }],
  ["null report", null],
  ["array report", []],
  ["empty report", {}],
]) {
  test(`rejects ${label} with exit 1`, () => {
    assert.throws(() => parseAuditResult(auditResult(report, 1)), /npm audit/);
  });
}

for (const [label, mutate] of [
  ["missing report version", (report) => { delete report.auditReportVersion; }],
  ["unsupported report version", (report) => { report.auditReportVersion = 1; }],
  ["missing vulnerabilities", (report) => { delete report.vulnerabilities; }],
  ["null vulnerabilities", (report) => { report.vulnerabilities = null; }],
  ["array vulnerabilities", (report) => { report.vulnerabilities = []; }],
  ["missing metadata", (report) => { delete report.metadata; }],
  ["missing vulnerability summary", (report) => { delete report.metadata.vulnerabilities; }],
  ["missing dependency summary", (report) => { delete report.metadata.dependencies; }],
  ["missing vulnerability count", (report) => { delete report.metadata.vulnerabilities.high; }],
  ["negative dependency count", (report) => { report.metadata.dependencies.prod = -1; }],
  ["fractional vulnerability count", (report) => { report.metadata.vulnerabilities.total = 0.5; }],
  ["string vulnerability count", (report) => { report.metadata.vulnerabilities.total = "0"; }],
  ["summary hiding a vulnerability", (report) => { report.metadata.vulnerabilities.moderate = 1; report.metadata.vulnerabilities.total = 1; }],
]) {
  test(`rejects ${label} instead of declaring an empty report clean`, () => {
    const report = cleanReport();
    mutate(report);
    assert.throws(() => parseAuditResult(auditResult(report)), /npm audit/);
  });
}

for (const [label, mutate] of [
  ["unknown severity", (entry) => { entry.severity = "unknown"; }],
  ["mismatched package name", (entry) => { entry.name = "different-package"; }],
  ["missing advisory references", (entry) => { delete entry.via; }],
  ["empty advisory references", (entry) => { entry.via = []; }],
  ["null advisory", (entry) => { entry.via = [null]; }],
  ["advisory missing URL", (entry) => { delete entry.via[0].url; }],
  ["advisory with invalid URL scheme", (entry) => { entry.via[0].url = "file:///fixture"; }],
  ["missing installed nodes", (entry) => { entry.nodes = []; }],
  ["invalid fix availability", (entry) => { entry.fixAvailable = {}; }],
]) {
  test(`rejects vulnerability entries with ${label}`, () => {
    const report = vulnerabilityReport();
    mutate(report.vulnerabilities[packageName]);
    assert.throws(() => parseAuditResult(auditResult(report, 1)), /invalid vulnerability entry/);
  });
}

test("rejects severity totals that disagree with vulnerability entries", () => {
  const report = vulnerabilityReport();
  report.metadata.vulnerabilities.moderate = 0;
  report.metadata.vulnerabilities.high = 1;
  assert.throws(() => parseAuditResult(auditResult(report, 1)), /does not match/);
});

test("a controlled child returning exit 1 still requires package and advisory coverage", (t) => {
  const rootDir = registerFixture(t, `Reviewed \`${packageName}\`: ${advisoryUrl}`);
  assert.match(checkDependencyRiskRegister({
    rootDir,
    runAudit: childAudit(vulnerabilityReport(), 1, rootDir),
  }), /covers 1/);
});

test("a controlled child returning error JSON cannot report a clean audit", (t) => {
  const rootDir = registerFixture(t);
  assert.throws(() => checkDependencyRiskRegister({
    rootDir,
    runAudit: childAudit({ error: { code: "E503", summary: "fixture-private-value" } }, 1, rootDir),
  }), (error) => {
    assert.match(error.message, /npm audit returned an error/);
    assert.ok(!error.message.includes("fixture-private-value"));
    return true;
  });
});

test("a controlled child returning exit 2 cannot report a clean audit", (t) => {
  const rootDir = registerFixture(t);
  assert.throws(() => checkDependencyRiskRegister({
    rootDir,
    runAudit: childAudit(cleanReport(), 2, rootDir),
  }), /supported exit status/);
});

test("a valid clean report can pass with an empty risk register", (t) => {
  const rootDir = registerFixture(t);
  assert.match(checkDependencyRiskRegister({ rootDir, runAudit: () => auditResult() }), /no moderate-or-higher/);
});

test("a valid low severity finding does not require a moderate+ register entry", (t) => {
  const rootDir = registerFixture(t);
  assert.match(checkDependencyRiskRegister({
    rootDir,
    runAudit: () => auditResult(vulnerabilityReport("low")),
  }), /no moderate-or-higher/);
});

test("an uncovered package fails even if its advisory is registered", (t) => {
  const rootDir = registerFixture(t, advisoryUrl);
  assert.throws(() => checkDependencyRiskRegister({
    rootDir,
    runAudit: () => auditResult(vulnerabilityReport(), 1),
  }), /missing package entry/);
});

test("an uncovered advisory fails even if its package is registered", (t) => {
  const rootDir = registerFixture(t, `\`${packageName}\``);
  assert.throws(() => checkDependencyRiskRegister({
    rootDir,
    runAudit: () => auditResult(vulnerabilityReport(), 1),
  }), /missing advisory/);
});
