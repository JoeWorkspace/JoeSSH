import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const registerPath = resolve(
  readCliValue("--register") ??
    resolve(root, "docs", "dependency-risk-register.md"),
);
const auditJsonPath = readCliValue("--audit-json");
const packageLockPath = resolve(
  readCliValue("--package-lock") ?? resolve(root, "package-lock.json"),
);
const now = parseNow(readCliValue("--now"));
const severityRank = { low: 1, moderate: 2, high: 3, critical: 4 };
const approvedHighExceptionWorkspace = "apps/mobile";
const approvedHighExceptions = new Map([
  [
    "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
    { packageName: "image-size", expiresOn: "2026-09-08" },
  ],
  [
    "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
    { packageName: "image-size", expiresOn: "2026-09-08" },
  ],
]);
const approvedHighExceptionGraph = new Map([
  [
    "@expo/cli",
    highExceptionNode(false, ["@expo/metro", "@expo/metro-config"]),
  ],
  [
    "@expo/metro",
    highExceptionNode(false, [
      "metro",
      "metro-config",
      "metro-transform-worker",
    ]),
  ],
  ["@expo/metro-config", highExceptionNode(false, ["@expo/metro"])],
  ["@expo/ui", highExceptionNode(false, ["react-native-worklets"])],
  [
    "@react-native/community-cli-plugin",
    highExceptionNode(false, [
      "@react-native/metro-config",
      "metro",
      "metro-config",
    ]),
  ],
  ["@react-native/metro-config", highExceptionNode(false, ["metro-config"])],
  [
    "@react-native/virtualized-lists",
    highExceptionNode(false, ["react-native"]),
  ],
  [
    "expo",
    highExceptionNode(true, ["@expo/cli", "@expo/metro", "@expo/metro-config"]),
  ],
  ["expo-modules-core", highExceptionNode(false, ["react-native-worklets"])],
  [
    "image-size",
    highExceptionNode(
      false,
      [],
      [
        "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
        "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
      ],
    ),
  ],
  [
    "metro",
    highExceptionNode(false, [
      "image-size",
      "metro-config",
      "metro-transform-worker",
    ]),
  ],
  ["metro-config", highExceptionNode(false, ["metro"])],
  ["metro-transform-worker", highExceptionNode(false, ["metro"])],
  [
    "react-native",
    highExceptionNode(true, [
      "@react-native/community-cli-plugin",
      "@react-native/virtualized-lists",
    ]),
  ],
  [
    "react-native-reanimated",
    highExceptionNode(false, ["react-native", "react-native-worklets"]),
  ],
  [
    "react-native-worklets",
    highExceptionNode(false, ["@react-native/metro-config", "react-native"]),
  ],
]);

if (!existsSync(registerPath)) {
  fail(`Missing dependency risk register: ${registerPath}`);
}

const register = readFileSync(registerPath, "utf8");
const auditFixture = auditJsonPath ? readAuditFixture() : undefined;
const fullReport =
  auditFixture ??
  readAuditReport(["audit", "--audit-level=high", "--json"], "full workspace");
const productionReport =
  auditFixture ??
  readAuditReport(
    ["audit", "--omit=dev", "--audit-level=moderate", "--json"],
    "production",
  );
validateAuditReport(fullReport, "full workspace");
validateAuditReport(productionReport, "production");

const fullVulnerabilities = fullReport.vulnerabilities;
const productionVulnerabilities = productionReport.vulnerabilities;
const highVulnerabilities = {
  ...productionVulnerabilities,
  ...fullVulnerabilities,
};
const highFindings = Object.values(highVulnerabilities).filter(
  (vulnerability) =>
    (severityRank[vulnerability.severity] ?? 0) >= severityRank.high,
);
const moderateFindings = Object.values(productionVulnerabilities).filter(
  (vulnerability) =>
    (severityRank[vulnerability.severity] ?? 0) === severityRank.moderate,
);
const missing = [];
const blocking = [];
const usedHighExceptions = new Map();

for (const vulnerability of highFindings) {
  const rank = severityRank[vulnerability.severity] ?? 0;
  if (rank >= severityRank.critical) {
    blocking.push(
      `${vulnerability.name}: critical findings cannot be excepted`,
    );
    continue;
  }

  if (rank >= severityRank.high) {
    const rootResolution = collectRootAdvisories(
      vulnerability.name,
      highVulnerabilities,
    );
    for (const unresolved of rootResolution.unresolved) {
      blocking.push(`${vulnerability.name}: ${unresolved}`);
    }
    if (rootResolution.advisories.length === 0) {
      blocking.push(
        `${vulnerability.name}: high finding has no traceable root advisory`,
      );
      continue;
    }

    for (const advisory of rootResolution.advisories) {
      const exception = approvedHighExceptions.get(advisory.url);
      if (!exception || exception.packageName !== advisory.packageName) {
        blocking.push(
          `${vulnerability.name}: unapproved high advisory ${advisory.url}`,
        );
        continue;
      }

      if (now > endOfDayUtc(exception.expiresOn)) {
        blocking.push(
          `${advisory.packageName}: high-advisory exception expired on ${exception.expiresOn} (${advisory.url})`,
        );
        continue;
      }

      for (const requiredText of [
        `\`${advisory.packageName}\``,
        advisory.url,
        exception.expiresOn,
      ]) {
        if (!register.includes(requiredText)) {
          missing.push(
            `${advisory.packageName}: risk register is missing ${requiredText}`,
          );
        }
      }

      usedHighExceptions.set(advisory.url, exception);
    }
  }
}

if (usedHighExceptions.size > 0) {
  blocking.push(...validateApprovedHighExceptionGraph(highVulnerabilities));
  blocking.push(...validateApprovedHighExceptionLockScope(packageLockPath));
}

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

if (blocking.length > 0) {
  fail(
    `Dependency audit contains blocking high-or-critical findings:\n- ${[
      ...new Set(blocking),
    ].join("\n- ")}`,
  );
}

if (missing.length > 0) {
  fail(
    `Dependency risk register is missing current production audit items:\n- ${[
      ...new Set(missing),
    ].join("\n- ")}`,
  );
}

if (highFindings.length === 0 && moderateFindings.length === 0) {
  console.log(
    "Production dependency audit has no moderate-or-higher vulnerabilities.",
  );
} else {
  console.log(
    `Dependency audit passed with ${usedHighExceptions.size} time-boxed high build-tooling exception(s) and ${moderateFindings.length} registered production moderate dependency path(s).`,
  );
}

function highExceptionNode(isDirect, viaPackages, advisoryUrls = []) {
  return { advisoryUrls, isDirect, viaPackages };
}

function validateApprovedHighExceptionGraph(vulnerabilities) {
  const errors = [];
  const expectedNames = [...approvedHighExceptionGraph.keys()].sort();
  const actualNames = Object.entries(vulnerabilities)
    .filter(
      ([, vulnerability]) =>
        (severityRank[vulnerability?.severity] ?? 0) >= severityRank.high,
    )
    .map(([name]) => name)
    .sort();

  if (!sameStringList(actualNames, expectedNames)) {
    errors.push(
      `image-size exception affected package set changed; expected [${expectedNames.join(
        ", ",
      )}], received [${actualNames.join(", ")}]`,
    );
  }

  for (const [name, expected] of approvedHighExceptionGraph) {
    const vulnerability = vulnerabilities[name];
    if (!vulnerability || vulnerability.severity !== "high") {
      errors.push(`${name}: missing exact high-severity exception graph node`);
      continue;
    }

    if (vulnerability.name !== name) {
      errors.push(
        `${name}: audit graph node name changed to ${String(vulnerability.name)}`,
      );
    }

    if (vulnerability.isDirect !== expected.isDirect) {
      errors.push(
        name === "image-size" && vulnerability.isDirect === true
          ? "image-size: direct dependencies are never covered by the mobile build-tooling exception"
          : `${name}: direct-dependency status changed; expected isDirect=${expected.isDirect}`,
      );
    }

    const expectedNodes = [`node_modules/${name}`];
    const actualNodes = Array.isArray(vulnerability.nodes)
      ? vulnerability.nodes.filter((node) => typeof node === "string").sort()
      : [];
    if (!sameStringList(actualNodes, expectedNodes)) {
      errors.push(
        `${name}: installed audit nodes changed; expected [${expectedNodes.join(
          ", ",
        )}], received [${actualNodes.join(", ")}]`,
      );
    }

    const actualViaPackages = [];
    const actualAdvisoryUrls = [];
    let malformedVia = false;
    for (const item of vulnerability.via ?? []) {
      if (typeof item === "string") {
        actualViaPackages.push(item);
      } else if (
        item &&
        typeof item === "object" &&
        typeof item.url === "string" &&
        item.name === name &&
        item.severity === "high"
      ) {
        actualAdvisoryUrls.push(item.url);
      } else {
        malformedVia = true;
      }
    }

    if (
      malformedVia ||
      !sameStringList(
        actualViaPackages.sort(),
        [...expected.viaPackages].sort(),
      ) ||
      !sameStringList(
        actualAdvisoryUrls.sort(),
        [...expected.advisoryUrls].sort(),
      )
    ) {
      errors.push(
        `${name}: high-advisory dependency graph changed; expected via packages [${expected.viaPackages.join(
          ", ",
        )}] and advisories [${expected.advisoryUrls.join(
          ", ",
        )}], received via packages [${actualViaPackages.join(
          ", ",
        )}] and advisories [${actualAdvisoryUrls.join(", ")}]`,
      );
    }
  }

  const imageSizeFinding = vulnerabilities["image-size"];
  if (
    imageSizeFinding &&
    imageSizeFinding.fixAvailable !== false &&
    !(
      imageSizeFinding.fixAvailable &&
      typeof imageSizeFinding.fixAvailable === "object" &&
      imageSizeFinding.fixAvailable.isSemVerMajor === true
    )
  ) {
    errors.push(
      "image-size: exception is invalid because npm reports a compatible fix",
    );
  }

  return errors;
}

function validateApprovedHighExceptionLockScope(lockPath) {
  if (!existsSync(lockPath)) {
    return [`image-size exception requires package lock: ${lockPath}`];
  }

  let lock;
  try {
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch (error) {
    return [
      `unable to parse image-size exception package lock: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }

  if (
    lock?.lockfileVersion !== 3 ||
    !lock.packages ||
    typeof lock.packages !== "object" ||
    Array.isArray(lock.packages)
  ) {
    return [
      "image-size exception requires a complete npm lockfileVersion 3 graph",
    ];
  }

  const packages = lock.packages;
  const errors = [];
  const affectedNames = new Set(approvedHighExceptionGraph.keys());
  const scopePaths = Object.entries(packages)
    .filter(
      ([path, entry]) =>
        path === "" ||
        (!path.includes("node_modules") &&
          entry &&
          typeof entry === "object" &&
          typeof entry.name === "string"),
    )
    .map(([path]) => path)
    .sort();

  if (!scopePaths.includes(approvedHighExceptionWorkspace)) {
    errors.push(
      `image-size exception requires the ${approvedHighExceptionWorkspace} workspace`,
    );
    return errors;
  }

  for (const name of affectedNames) {
    const nodePath = `node_modules/${name}`;
    if (!packages[nodePath] || typeof packages[nodePath] !== "object") {
      errors.push(`${name}: expected package-lock node ${nodePath} is missing`);
    }
  }

  for (const scopePath of scopePaths) {
    const scopeEntry = packages[scopePath];
    const scopeLabel = describeLockScope(scopePath, scopeEntry);
    if (dependencyNames(scopeEntry).includes("image-size")) {
      errors.push(
        `image-size: direct dependency is forbidden in ${scopeLabel}`,
      );
    }

    const reachable = collectReachableAffectedPackages(
      scopePath,
      packages,
      affectedNames,
      scopeLabel,
    );
    if (scopePath === approvedHighExceptionWorkspace) {
      const reachableNames = [...reachable.keys()].sort();
      const expectedNames = [...affectedNames].sort();
      if (!sameStringList(reachableNames, expectedNames)) {
        errors.push(
          `${scopeLabel}: mobile exception lock graph changed; expected affected packages [${expectedNames.join(
            ", ",
          )}], reached [${reachableNames.join(", ")}]`,
        );
      }
      continue;
    }

    if (reachable.size > 0) {
      const [name, path] = reachable.entries().next().value;
      errors.push(
        `${name}: image-size exception reaches forbidden ${scopeLabel} path (${path.join(
          " -> ",
        )})`,
      );
    }
  }

  return errors;
}

function collectReachableAffectedPackages(
  scopePath,
  packages,
  affectedNames,
  scopeLabel,
) {
  const reachable = new Map();
  const visited = new Set();
  const queue = [{ chain: [scopeLabel], packagePath: scopePath }];

  while (queue.length > 0) {
    const current = queue.shift();
    const effectivePath = resolveLinkedLockPath(current.packagePath, packages);
    if (visited.has(effectivePath)) {
      continue;
    }
    visited.add(effectivePath);

    const entry = packages[effectivePath];
    if (!entry || typeof entry !== "object") {
      continue;
    }

    for (const dependencyName of dependencyNames(entry)) {
      const dependencyPath = resolveLockDependencyPath(
        effectivePath,
        dependencyName,
        packages,
      );
      if (!dependencyPath) {
        continue;
      }

      const chain = [...current.chain, dependencyName];
      if (affectedNames.has(dependencyName) && !reachable.has(dependencyName)) {
        reachable.set(dependencyName, chain);
      }
      queue.push({ chain, packagePath: dependencyPath });
    }
  }

  return reachable;
}

function dependencyNames(entry) {
  const names = new Set();
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    const dependencies = entry?.[section];
    if (!dependencies || typeof dependencies !== "object") {
      continue;
    }
    for (const name of Object.keys(dependencies)) {
      names.add(name);
    }
  }
  return [...names];
}

function resolveLockDependencyPath(packagePath, dependencyName, packages) {
  let directory = packagePath;
  while (true) {
    if (!directory.endsWith("node_modules")) {
      const candidate = directory
        ? `${directory}/node_modules/${dependencyName}`
        : `node_modules/${dependencyName}`;
      if (packages[candidate]) {
        return candidate;
      }
    }

    if (!directory) {
      return undefined;
    }
    const separator = directory.lastIndexOf("/");
    directory = separator === -1 ? "" : directory.slice(0, separator);
  }
}

function resolveLinkedLockPath(packagePath, packages) {
  const entry = packages[packagePath];
  if (
    entry?.link === true &&
    typeof entry.resolved === "string" &&
    packages[entry.resolved]
  ) {
    return entry.resolved;
  }
  return packagePath;
}

function describeLockScope(path, entry) {
  if (path === "") {
    return "root release/dev tooling";
  }
  return `${path} (${entry.name})`;
}

function sameStringList(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function readAuditFixture() {
  if (!existsSync(auditJsonPath)) {
    fail(`Missing npm audit fixture: ${auditJsonPath}`);
  }
  return parseAuditJson(readFileSync(auditJsonPath, "utf8"), "");
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

  return parseAuditJson(audit.stdout ?? "", audit.stderr ?? "");
}

function validateAuditReport(report, label) {
  if (
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== "object" ||
    Array.isArray(report.vulnerabilities)
  ) {
    fail(`${label} npm audit returned an invalid or incomplete report`);
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
  for (const item of vulnerability.via ?? []) {
    if (item && typeof item === "object" && typeof item.url === "string") {
      urls.add(item.url);
    }
  }
  return [...urls];
}

function collectRootAdvisories(name, vulnerabilities, ancestry = new Set()) {
  if (ancestry.has(name)) {
    return {
      advisories: [],
      unresolved: [],
    };
  }

  const vulnerability = vulnerabilities[name];
  if (!vulnerability) {
    return {
      advisories: [],
      unresolved: [`unresolved advisory dependency ${name}`],
    };
  }

  const nextAncestry = new Set(ancestry);
  nextAncestry.add(name);
  const advisories = [];
  const unresolved = [];

  for (const item of vulnerability.via ?? []) {
    if (typeof item === "string") {
      const nested = collectRootAdvisories(item, vulnerabilities, nextAncestry);
      advisories.push(...nested.advisories);
      unresolved.push(...nested.unresolved);
      continue;
    }

    if (
      item &&
      typeof item === "object" &&
      typeof item.url === "string" &&
      (severityRank[item.severity] ?? 0) >= severityRank.high
    ) {
      advisories.push({
        packageName:
          typeof item.name === "string" && item.name ? item.name : name,
        url: item.url,
      });
    } else if (
      item &&
      typeof item === "object" &&
      (severityRank[item.severity] ?? 0) >= severityRank.high
    ) {
      unresolved.push(`${name}: high root advisory is missing its URL`);
    }
  }

  return {
    advisories: [
      ...new Map(
        advisories.map((advisory) => [
          `${advisory.packageName}\0${advisory.url}`,
          advisory,
        ]),
      ).values(),
    ],
    unresolved: [...new Set(unresolved)],
  };
}

function parseNow(value) {
  if (!value) {
    return new Date();
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) {
    fail(`--now must use YYYY-MM-DD; received ${value}`);
  }
  return parsed;
}

function endOfDayUtc(date) {
  return new Date(`${date}T23:59:59.999Z`);
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
