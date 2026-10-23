import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const severities = Object.keys(severityRank);

function checkDependencyRiskRegister() {
  const registerPath = resolve(
    readCliValue("--register") ??
      resolve(root, "docs", "dependency-risk-register.md"),
  );
  const auditJsonPath = readCliValue("--audit-json");
  const productionAuditJsonPath = readCliValue("--production-audit-json");

  if (!existsSync(registerPath)) {
    fail(`Missing dependency risk register: ${registerPath}`);
  }

  const register = readFileSync(registerPath, "utf8");
  const fullReport = auditJsonPath
    ? readAuditFixture(auditJsonPath)
    : readAuditReport(
        ["audit", "--audit-level=high", "--json"],
        "full workspace",
        "high",
      );
  const productionReport = productionAuditJsonPath
    ? readAuditFixture(productionAuditJsonPath)
    : auditJsonPath
      ? fullReport
      : readAuditReport(
          ["audit", "--omit=dev", "--audit-level=moderate", "--json"],
          "production",
          "moderate",
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

  const moderateFindings = Object.values(
    productionReport.vulnerabilities,
  ).filter((vulnerability) => vulnerability.severity === "moderate");
  const missing = [];
  for (const vulnerability of moderateFindings) {
    if (!register.includes(`\`${vulnerability.name}\``)) {
      missing.push(`${vulnerability.name}: missing package entry`);
    }

    for (const url of collectReachableAdvisoryUrls(
      vulnerability,
      productionReport.vulnerabilities,
    )) {
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
}

function readAuditFixture(path) {
  if (!existsSync(path)) {
    fail(`Missing npm audit fixture: ${path}`);
  }
  return parseAuditJson(readFileSync(path, "utf8"), "");
}

function readAuditReport(args, label, auditLevel) {
  const audit = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  return parseAuditResult(audit, label, auditLevel);
}

// npm returns 1 for findings at the requested audit threshold. Treat transport,
// process and schema failures separately from a valid vulnerability report.
export function parseAuditResult(audit, label, auditLevel) {
  if (!isRecord(audit) || audit.error) {
    throw new Error(`Unable to run ${label} npm audit`);
  }
  if (audit.signal || (audit.status !== 0 && audit.status !== 1)) {
    throw new Error(
      `${label} npm audit did not complete with a supported exit status (0 or 1)`,
    );
  }
  if (!Object.hasOwn(severityRank, auditLevel)) {
    throw new Error("Unsupported npm audit severity threshold");
  }
  const report = parseAuditJson(audit.stdout, audit.stderr);
  validateAuditReport(report, label);
  const hasBlockingFinding = severities.some(
    (severity) =>
      severityRank[severity] >= severityRank[auditLevel] &&
      report.metadata.vulnerabilities[severity] > 0,
  );
  if (audit.status !== (hasBlockingFinding ? 1 : 0)) {
    throw new Error(
      `${label} npm audit exit status does not match its ${auditLevel}-or-higher findings`,
    );
  }
  return report;
}

function validateAuditReport(report, label) {
  if (
    !isRecord(report) ||
    report.auditReportVersion !== 2 ||
    Object.hasOwn(report, "error") ||
    !isRecord(report.vulnerabilities) ||
    !isRecord(report.metadata) ||
    !isRecord(report.metadata.vulnerabilities) ||
    !isRecord(report.metadata.dependencies)
  ) {
    throw new Error(
      `${label} npm audit returned an invalid or incomplete report`,
    );
  }
  const summary = report.metadata.vulnerabilities;
  if (
    ![...severities, "total"].every((key) => isCount(summary[key])) ||
    !["prod", "dev", "optional", "peer", "peerOptional", "total"].every((key) =>
      isCount(report.metadata.dependencies[key]),
    )
  ) {
    throw new Error(
      `${label} npm audit returned invalid vulnerability or dependency counts`,
    );
  }
  const observed = Object.fromEntries(
    severities.map((severity) => [severity, 0]),
  );
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (
      !isNonemptyString(name) ||
      !isRecord(vulnerability) ||
      vulnerability.name !== name ||
      !Object.hasOwn(severityRank, vulnerability.severity) ||
      typeof vulnerability.isDirect !== "boolean" ||
      !isStringArray(vulnerability.effects) ||
      !isStringArray(vulnerability.nodes) ||
      vulnerability.nodes.length === 0 ||
      // npm can emit an empty affected range for a transitive meta-vulnerability.
      // Its severity and advisory graph still determine whether it blocks.
      typeof vulnerability.range !== "string" ||
      !isFixAvailable(vulnerability.fixAvailable) ||
      !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0 ||
      !vulnerability.via.every(
        (reference) =>
          isAdvisoryReference(reference) &&
          (typeof reference === "string" ||
            severityRank[reference.severity] <=
              severityRank[vulnerability.severity]),
      )
    ) {
      throw new Error(
        `${label} npm audit returned an invalid finding for ${name}`,
      );
    }
    observed[vulnerability.severity] += 1;
  }
  if (
    summary.total !== Object.keys(report.vulnerabilities).length ||
    !severities.every((severity) => summary[severity] === observed[severity])
  ) {
    throw new Error(
      `${label} npm audit vulnerability metadata does not match its entries`,
    );
  }
  validateAdvisoryReferences(report.vulnerabilities, label);
}

function validateAdvisoryReferences(vulnerabilities, label) {
  const dependents = new Map(
    Object.keys(vulnerabilities).map((name) => [name, new Set()]),
  );
  const traceable = new Set();
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    for (const reference of vulnerability.via) {
      if (typeof reference !== "string") {
        traceable.add(name);
      } else if (!dependents.has(reference)) {
        throw new Error(
          `${label} npm audit returned an invalid finding for ${name} (${vulnerability.severity}): unresolved advisory dependency ${reference}`,
        );
      } else {
        dependents.get(reference).add(name);
      }
    }
  }

  // Traverse each package and edge once, including graphs with dependency cycles.
  const queue = [...traceable];
  for (let index = 0; index < queue.length; index += 1) {
    for (const name of dependents.get(queue[index])) {
      if (!traceable.has(name)) {
        traceable.add(name);
        queue.push(name);
      }
    }
  }
  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (!traceable.has(name)) {
      throw new Error(
        `${label} npm audit returned an invalid finding for ${name} (${vulnerability.severity}): no traceable advisory`,
      );
    }
  }
}

function parseAuditJson(stdout, stderr) {
  if (typeof stdout !== "string" || !stdout.trim()) {
    throw new Error(
      `npm audit did not return JSON output.${stderr ? `\n${stderr}` : ""}`,
    );
  }

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `Unable to parse npm audit JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
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
  return (
    typeof value === "boolean" ||
    (isRecord(value) &&
      isNonemptyString(value.name) &&
      isNonemptyString(value.version) &&
      typeof value.isSemVerMajor === "boolean")
  );
}

function isAdvisoryReference(value) {
  if (isNonemptyString(value)) return true;
  if (
    !isRecord(value) ||
    !isNonemptyString(value.name) ||
    !Object.hasOwn(severityRank, value.severity) ||
    !isNonemptyString(value.url)
  )
    return false;
  try {
    const url = new URL(value.url);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
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

function collectReachableAdvisoryUrls(vulnerability, vulnerabilities) {
  const urls = new Set();
  const visited = new Set([vulnerability.name]);
  const queue = [vulnerability];
  // validateAuditReport already requires every reference to resolve. Visit
  // each dependency once so legitimate cyclic meta-vulnerability graphs finish.
  for (let index = 0; index < queue.length; index += 1) {
    for (const reference of queue[index].via) {
      if (typeof reference !== "string") {
        urls.add(reference.url);
      } else if (!visited.has(reference)) {
        visited.add(reference);
        queue.push(vulnerabilities[reference]);
      }
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    checkDependencyRiskRegister();
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : "Dependency risk register check failed",
    );
  }
}
