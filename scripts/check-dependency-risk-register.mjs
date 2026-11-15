import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const npmCommand = "npm";
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const severities = Object.keys(severityRank);

export function checkDependencyRiskRegister({ rootDir = root, runAudit = spawnSync } = {}) {
  const registerPath = resolve(rootDir, "docs", "dependency-risk-register.md");
  if (!existsSync(registerPath)) {
    throw new Error(`Missing dependency risk register: ${registerPath}`);
  }

  const audit = runAudit(npmCommand, ["audit", "--omit=dev", "--audit-level=moderate", "--json"], {
    cwd: rootDir,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const report = parseAuditResult(audit);
  const register = readFileSync(registerPath, "utf8");
  const vulnerabilities = Object.values(report.vulnerabilities).filter(
    (vulnerability) => severityRank[vulnerability.severity] >= severityRank.moderate,
  );

  const missing = [];
  for (const vulnerability of vulnerabilities) {
    const name = vulnerability.name;
    if (!register.includes(`\`${name}\``)) {
      missing.push(`${name}: missing package entry`);
    }

    for (const url of collectAdvisoryUrls(vulnerability)) {
      if (!register.includes(url)) {
        missing.push(`${name}: missing advisory ${url}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Dependency risk register is missing current production moderate+ audit items:\n- ${missing.join("\n- ")}`);
  }
  return vulnerabilities.length === 0
    ? "Production dependency audit has no moderate-or-higher vulnerabilities."
    : `Production dependency risk register covers ${vulnerabilities.length} moderate-or-higher audit item(s).`;
}

// npm audit uses exit 1 for ordinary vulnerability findings. Validate both the
// process outcome and the complete report before interpreting an empty result.
export function parseAuditResult(audit) {
  if (!isRecord(audit) || audit.error) {
    throw new Error("Unable to run npm audit.");
  }
  if (audit.signal || (audit.status !== 0 && audit.status !== 1)) {
    throw new Error("npm audit did not complete with a supported exit status (0 or 1).");
  }
  if (typeof audit.stdout !== "string" || !audit.stdout.trim()) {
    throw new Error("npm audit did not return JSON output.");
  }

  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    throw new Error("Unable to parse npm audit JSON.");
  }
  if (!isRecord(report) || Object.hasOwn(report, "error")) {
    throw new Error("npm audit returned an error or an invalid report object.");
  }
  if (report.auditReportVersion !== 2 || !isRecord(report.vulnerabilities)
    || !isRecord(report.metadata) || !isRecord(report.metadata.vulnerabilities)
    || !isRecord(report.metadata.dependencies)) {
    throw new Error("npm audit did not return a complete v2 report with vulnerabilities and metadata.");
  }

  const summary = report.metadata.vulnerabilities;
  const dependencyCounts = report.metadata.dependencies;
  if (![...severities, "total"].every((key) => isCount(summary[key]))
    || !["prod", "dev", "optional", "peer", "peerOptional", "total"].every(
      (key) => isCount(dependencyCounts[key]),
    )) {
    throw new Error("npm audit returned invalid vulnerability or dependency counts.");
  }

  const observedCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (!name || !isRecord(vulnerability) || vulnerability.name !== name
      || !severities.includes(vulnerability.severity) || typeof vulnerability.isDirect !== "boolean"
      || !isStringArray(vulnerability.effects) || !isStringArray(vulnerability.nodes)
      || vulnerability.nodes.length === 0 || !isNonemptyString(vulnerability.range)
      || !isFixAvailable(vulnerability.fixAvailable) || !Array.isArray(vulnerability.via)
      || vulnerability.via.length === 0 || !vulnerability.via.every(isAdvisoryReference)) {
      throw new Error("npm audit returned an invalid vulnerability entry.");
    }
    observedCounts[vulnerability.severity] += 1;
  }
  if (summary.total !== Object.keys(report.vulnerabilities).length
    || !severities.every((severity) => summary[severity] === observedCounts[severity])) {
    throw new Error("npm audit vulnerability metadata does not match its entries.");
  }
  // The command above fixes --audit-level=moderate, so its status must agree
  // with the presence of findings at or above that threshold.
  const hasModerateOrHigher = summary.moderate + summary.high + summary.critical > 0;
  if (audit.status !== (hasModerateOrHigher ? 1 : 0)) {
    throw new Error("npm audit exit status does not match its moderate-or-higher findings.");
  }
  return report;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonemptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every(isNonemptyString);
}

function isFixAvailable(value) {
  return typeof value === "boolean" || (isRecord(value)
    && isNonemptyString(value.name) && isNonemptyString(value.version)
    && typeof value.isSemVerMajor === "boolean");
}

function isAdvisoryReference(value) {
  if (isNonemptyString(value)) return true;
  if (!isRecord(value) || !isNonemptyString(value.name)
    || !severities.includes(value.severity) || !isNonemptyString(value.url)) {
    return false;
  }
  try {
    const url = new URL(value.url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function collectAdvisoryUrls(vulnerability) {
  const urls = new Set();
  for (const item of vulnerability.via) {
    if (typeof item === "object") {
      urls.add(item.url);
    }
  }
  return [...urls];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(checkDependencyRiskRegister());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Dependency risk register check failed.");
    process.exitCode = 1;
  }
}
