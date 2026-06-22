import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const registerPath = resolve(root, "docs", "dependency-risk-register.md");
const npmCommand = "npm";
const severityRank = { low: 1, moderate: 2, high: 3, critical: 4 };

if (!existsSync(registerPath)) {
  fail(`Missing dependency risk register: ${registerPath}`);
}

const audit = spawnSync(npmCommand, ["audit", "--omit=dev", "--audit-level=moderate", "--json"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (audit.error) {
  fail(`Unable to run npm audit: ${audit.error.message}`);
}

const auditStdout = audit.stdout ?? "";
const auditStderr = audit.stderr ?? "";
if (!auditStdout.trim()) {
  fail(`npm audit did not return JSON output.${auditStderr ? `\n${auditStderr}` : ""}`);
}

let report;
try {
  report = JSON.parse(auditStdout);
} catch (error) {
  fail(`Unable to parse npm audit JSON: ${error instanceof Error ? error.message : String(error)}`);
}

const register = readFileSync(registerPath, "utf8");
const vulnerabilities = Object.values(report.vulnerabilities ?? {}).filter(
  (vulnerability) => (severityRank[vulnerability.severity] ?? 0) >= severityRank.moderate,
);

const missing = [];
for (const vulnerability of vulnerabilities) {
  const name = vulnerability.name;
  if (!register.includes(`\`${name}\``)) {
    missing.push(`${name}: missing package entry`);
  }

  const advisoryUrls = collectAdvisoryUrls(vulnerability);
  for (const url of advisoryUrls) {
    if (!register.includes(url)) {
      missing.push(`${name}: missing advisory ${url}`);
    }
  }
}

if (missing.length > 0) {
  fail(`Dependency risk register is missing current production moderate+ audit items:\n- ${missing.join("\n- ")}`);
}

if (vulnerabilities.length === 0) {
  console.log("Production dependency audit has no moderate-or-higher vulnerabilities.");
} else {
  console.log(`Production dependency risk register covers ${vulnerabilities.length} moderate-or-higher audit item(s).`);
}

function collectAdvisoryUrls(vulnerability) {
  const urls = new Set();
  for (const item of vulnerability.via ?? []) {
    if (item && typeof item === "object" && typeof item.url === "string") {
      urls.add(item.url);
    }
  }
  return [...urls];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
