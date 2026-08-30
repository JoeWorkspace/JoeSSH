import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const registerPath = resolve(
  readCliValue("--register") ??
    resolve(root, "docs", "dependency-risk-register.md"),
);
const auditJsonPath = readCliValue("--audit-json");
const productionAuditJsonPath = readCliValue("--production-audit-json");
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

if (!existsSync(registerPath)) {
  fail(`Missing dependency risk register: ${registerPath}`);
}

const register = readFileSync(registerPath, "utf8");
const fullReport = auditJsonPath
  ? readAuditFixture(auditJsonPath)
  : readAuditReport(
      ["audit", "--audit-level=high", "--json"],
      "full workspace",
    );
const productionReport = productionAuditJsonPath
  ? readAuditFixture(productionAuditJsonPath)
  : auditJsonPath
    ? fullReport
    : readAuditReport(
        ["audit", "--omit=dev", "--audit-level=moderate", "--json"],
        "production",
      );
validateAuditReport(fullReport, "full workspace");
validateAuditReport(productionReport, "production");

// Inspect both scopes independently: a lower-severity copy of a package in one
// report must never overwrite a blocking finding in the other report.
const blocking = [];
for (const [scope, report] of [
  ["full workspace", fullReport],
  ["production", productionReport],
]) {
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    if (severityRank[vulnerability.severity] >= severityRank.high) {
      const advisories = collectDirectAdvisoryUrls(vulnerability);
      blocking.push(
        `${scope}: ${vulnerability.name} (${vulnerability.severity})${
          advisories.length > 0 ? `: ${advisories.join(", ")}` : ""
        }`,
      );
    }
  }
}

if (blocking.length > 0) {
  fail(
    `Dependency audit contains blocking high-or-critical findings (no exceptions):\n- ${blocking.join("\n- ")}`,
  );
}

const moderateFindings = Object.values(productionReport.vulnerabilities).filter(
  (vulnerability) => vulnerability.severity === "moderate",
);
const missing = [];
for (const vulnerability of moderateFindings) {
  if (!register.includes(`\`${vulnerability.name}\``)) {
    missing.push(`${vulnerability.name}: missing package entry`);
  }

  for (const url of collectDirectAdvisoryUrls(vulnerability)) {
    if (!register.includes(url)) {
      missing.push(`${vulnerability.name}: missing advisory ${url}`);
    }
  }
}

if (missing.length > 0) {
  fail(
    `Dependency risk register is missing current production audit items:\n- ${[
      ...new Set(missing),
    ].join("\n- ")}`,
  );
}

if (moderateFindings.length === 0) {
  console.log(
    "Dependency audit has no high-or-critical workspace findings and no moderate-or-higher production findings.",
  );
} else {
  console.log(
    `Dependency audit passed with ${moderateFindings.length} registered production moderate dependency path(s); no high-or-critical workspace findings.`,
  );
}

function readAuditFixture(path) {
  if (!existsSync(path)) {
    fail(`Missing npm audit fixture: ${path}`);
  }
  return parseAuditJson(readFileSync(path, "utf8"), "");
}

function readAuditReport(args, label) {
  const audit = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  if (audit.error) {
    fail(`Unable to run ${label} npm audit: ${audit.error.message}`);
  }
  if (audit.status !== 0 && audit.status !== 1) {
    fail(
      `${label} npm audit failed (exit ${String(audit.status)}).${audit.stderr ? `\n${audit.stderr}` : ""}`,
    );
  }

  return parseAuditJson(audit.stdout ?? "", audit.stderr ?? "");
}

function validateAuditReport(report, label) {
  if (
    report?.auditReportVersion !== 2 ||
    report.error ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)
  ) {
    fail(`${label} npm audit returned an invalid or incomplete report`);
  }
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (
      !vulnerability ||
      typeof vulnerability !== "object" ||
      vulnerability.name !== name ||
      !Object.hasOwn(severityRank, vulnerability.severity) ||
      !Array.isArray(vulnerability.via)
    ) {
      fail(`${label} npm audit returned an invalid finding for ${name}`);
    }
  }
}

function parseAuditJson(stdout, stderr) {
  if (!stdout.trim()) {
    fail(`npm audit did not return JSON output.${stderr ? `\n${stderr}` : ""}`);
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(
      `Unable to parse npm audit JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function collectDirectAdvisoryUrls(vulnerability) {
  const urls = new Set();
  for (const item of vulnerability.via) {
    if (item && typeof item === "object" && typeof item.url === "string") {
      urls.add(item.url);
    }
  }
  return [...urls];
}

function readCliValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${flag} requires a value`);
  }
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
