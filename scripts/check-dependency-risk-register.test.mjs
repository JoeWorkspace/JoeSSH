import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const checkerPath = fileURLToPath(
  new URL("./check-dependency-risk-register.mjs", import.meta.url),
);
const imageSizeAdvisories = [
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
];
const moderateAdvisory = "https://github.com/advisories/GHSA-w5hq-g745-h8pq";
const moderateRegister = `# Risks\n\n\`uuid\`: ${moderateAdvisory}\n`;

test("accepts clean full-workspace and production reports", (t) => {
  const result = runChecker(t, auditReport({}));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no high-or-critical workspace findings/);
});

for (const fixAvailable of [false, true, { isSemVerMajor: true }]) {
  test(`never exempts former image-size advisories (fixAvailable=${JSON.stringify(fixAvailable)})`, (t) => {
    const vulnerability = finding("image-size", "high", imageSizeAdvisories);
    vulnerability.fixAvailable = fixAvailable;
    const result = runChecker(t, auditReport({ "image-size": vulnerability }), {
      register: `# Historical exception\n\`image-size\`\n${imageSizeAdvisories.join("\n")}\n2026-09-08\n`,
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /blocking high-or-critical findings \(no exceptions\)/,
    );
    for (const url of imageSizeAdvisories) {
      assert.ok(result.stderr.includes(url));
    }
  });
}

for (const severity of ["high", "critical"]) {
  test(`rejects ${severity} findings even without a traceable advisory root`, (t) => {
    const vulnerability = finding("unknown-wrapper", severity);
    vulnerability.via = ["missing-root"];
    const result = runChecker(
      t,
      auditReport({ "unknown-wrapper": vulnerability }),
    );

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`unknown-wrapper (${severity})`));
  });
}

for (const scope of ["full workspace", "production"]) {
  test(`cannot mask a ${scope} high finding with a lower-severity finding in the other scope`, (t) => {
    const high = auditReport({ shared: finding("shared", "high") });
    const low = auditReport({ shared: finding("shared", "low") });
    const result = runChecker(t, scope === "full workspace" ? high : low, {
      production: scope === "production" ? high : low,
    });

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`${scope}: shared (high)`));
  });
}

test("accepts documented moderate production findings", (t) => {
  const result = runChecker(t, auditReport({}), {
    production: auditReport({
      uuid: finding("uuid", "moderate", [moderateAdvisory]),
    }),
    register: moderateRegister,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /1 registered production moderate dependency path/,
  );
});

test("rejects undocumented moderate production packages", (t) => {
  const result = runChecker(t, auditReport({}), {
    production: auditReport({
      uuid: finding("uuid", "moderate", [moderateAdvisory]),
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uuid: missing package entry/);
  assert.match(result.stderr, /uuid: missing advisory/);
});

test("rejects a new moderate advisory for an already documented package", (t) => {
  const result = runChecker(t, auditReport({}), {
    production: auditReport({
      uuid: finding("uuid", "moderate", ["https://example.test/new-advisory"]),
    }),
    register: moderateRegister,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /uuid: missing advisory https:\/\/example.test\/new-advisory/,
  );
});

test("keeps the production moderate threshold separate from development-only findings", (t) => {
  const result = runChecker(
    t,
    auditReport({ dev: finding("dev", "moderate") }),
    {
      production: auditReport({}),
    },
  );

  assert.equal(result.status, 0, result.stderr);
});

for (const severity of ["info", "low"]) {
  test(`does not classify ${severity} production findings as release blockers`, (t) => {
    const result = runChecker(
      t,
      auditReport({ example: finding("example", severity) }),
    );

    assert.equal(result.status, 0, result.stderr);
  });
}

for (const report of [
  { error: { summary: "registry unavailable" } },
  { ...auditReport({}), error: { summary: "partial registry response" } },
  { auditReportVersion: 2, vulnerabilities: [] },
  { auditReportVersion: 1, vulnerabilities: {} },
]) {
  test(`rejects invalid audit report ${JSON.stringify(report)}`, (t) => {
    const result = runChecker(t, report);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid or incomplete report/);
  });
}

for (const vulnerability of [
  null,
  { name: "broken", via: [] },
  { name: "broken", severity: "unknown", via: [] },
  { name: "different", severity: "low", via: [] },
  { name: "broken", severity: "low" },
]) {
  test(`rejects malformed audit finding ${JSON.stringify(vulnerability)}`, (t) => {
    const result = runChecker(t, auditReport({ broken: vulnerability }));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid finding for broken/);
  });
}

test("validates the production response even when the full response is clean", (t) => {
  const result = runChecker(t, auditReport({}), { production: { error: {} } });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /production npm audit returned an invalid or incomplete report/,
  );
});

for (const rawAudit of ["", "registry returned HTML instead of JSON"]) {
  test(`rejects empty or non-JSON output (${JSON.stringify(rawAudit)})`, (t) => {
    const result = runChecker(t, auditReport({}), { rawAudit });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /did not return JSON output|Unable to parse npm audit JSON/,
    );
  });
}

function runChecker(t, report, options = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "joessh-dependency-audit-"));
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));
  const auditPath = join(fixtureRoot, "audit.json");
  const registerPath = join(fixtureRoot, "register.md");
  writeFileSync(auditPath, options.rawAudit ?? JSON.stringify(report));
  writeFileSync(registerPath, options.register ?? "# Risks\n");
  const args = [
    checkerPath,
    "--audit-json",
    auditPath,
    "--register",
    registerPath,
  ];
  if (options.production) {
    const productionPath = join(fixtureRoot, "production-audit.json");
    writeFileSync(productionPath, JSON.stringify(options.production));
    args.push("--production-audit-json", productionPath);
  }

  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function auditReport(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities };
}

function finding(name, severity, urls = []) {
  return {
    name,
    severity,
    isDirect: false,
    nodes: [`node_modules/${name}`],
    via: urls.map((url) => ({ name, severity, url })),
  };
}
