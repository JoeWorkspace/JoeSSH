import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

const checkerPath = fileURLToPath(
  new URL("./check-dependency-risk-register.mjs", import.meta.url),
);
const repositoryRegisterPath = fileURLToPath(
  new URL("../docs/dependency-risk-register.md", import.meta.url),
);
const repositoryRegister = readFileSync(repositoryRegisterPath, "utf8");
const repositoryPackageLock = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../package-lock.json", import.meta.url)),
    "utf8",
  ),
);
const imageSizeAdvisories = [
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
];
const approvedViaGraph = {
  "@expo/cli": ["@expo/metro", "@expo/metro-config"],
  "@expo/metro": ["metro", "metro-config", "metro-transform-worker"],
  "@expo/metro-config": ["@expo/metro"],
  "@expo/ui": ["react-native-worklets"],
  "@react-native/community-cli-plugin": [
    "@react-native/metro-config",
    "metro",
    "metro-config",
  ],
  "@react-native/metro-config": ["metro-config"],
  "@react-native/virtualized-lists": ["react-native"],
  expo: ["@expo/cli", "@expo/metro", "@expo/metro-config"],
  "expo-modules-core": ["react-native-worklets"],
  "image-size": [],
  metro: ["image-size", "metro-config", "metro-transform-worker"],
  "metro-config": ["metro"],
  "metro-transform-worker": ["metro"],
  "react-native": [
    "@react-native/community-cli-plugin",
    "@react-native/virtualized-lists",
  ],
  "react-native-reanimated": ["react-native", "react-native-worklets"],
  "react-native-worklets": ["@react-native/metro-config", "react-native"],
};

test("accepts only the registered, unexpired image-size high advisories", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities.uuid = {
    name: "uuid",
    severity: "moderate",
    via: [
      {
        name: "uuid",
        severity: "moderate",
        url: "https://github.com/advisories/GHSA-w5hq-g745-h8pq",
      },
    ],
  };
  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2 time-boxed high build-tooling exception/);
});

test("rejects an unexpected high advisory even when another exception is valid", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities.nanoid = highFinding(
    "nanoid",
    [
      {
        name: "nanoid",
        severity: "high",
        url: "https://github.com/advisories/GHSA-2v37-7h3g-55p8",
      },
    ],
    false,
  );
  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unapproved high advisory/);
});

test("never permits a critical finding", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities["image-size"] = {
    ...vulnerabilities["image-size"],
    severity: "critical",
    via: [
      {
        name: "image-size",
        severity: "critical",
        url: imageSizeAdvisories[0],
      },
    ],
  };
  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /critical findings cannot be excepted/);
});

test("expires the image-size exception automatically", (t) => {
  const result = runChecker(
    t,
    auditReport(approvedHighVulnerabilities()),
    "2026-09-09",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exception expired on 2026-09-08/);
});

test("rejects an incomplete audit response instead of treating it as clean", (t) => {
  const result = runChecker(
    t,
    { error: { summary: "registry unavailable" } },
    "2026-08-08",
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid or incomplete report/);
});

test("rejects a high dependency path with an unresolved root", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities.metro.via.push("missing-root");
  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unresolved advisory dependency missing-root/);
});

test("rejects direct image-size even with the exact advisory URLs", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities["image-size"].isDirect = true;

  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /direct dependencies are never covered/);
});

test("rejects an unknown wrapper around the approved root advisory", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities["desktop-image-loader"] = highFinding(
    "desktop-image-loader",
    ["image-size"],
    false,
  );

  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /affected package set changed/);
});

test("rejects drift in an otherwise approved Expo Metro via graph", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities.metro.via = ["image-size"];

  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /metro: high-advisory dependency graph changed/);
});

test("rejects the exception after npm reports a compatible fix", (t) => {
  const vulnerabilities = approvedHighVulnerabilities();
  vulnerabilities["image-size"].fixAvailable = true;

  const result = runChecker(t, auditReport(vulnerabilities), "2026-08-08");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm reports a compatible fix/);
});

for (const [label, mutateLock] of [
  [
    "root release tooling",
    (lock) => {
      lock.packages[""].devDependencies.expo = "57.0.9";
    },
  ],
  [
    "Desktop",
    (lock) => {
      lock.packages["apps/desktop"].dependencies.expo = "57.0.9";
    },
  ],
  [
    "Web",
    (lock) => {
      lock.packages["apps/web"].dependencies.expo = "57.0.9";
    },
  ],
]) {
  test(`rejects an image-size path reachable from ${label}`, (t) => {
    const packageLock = clonePackageLock();
    mutateLock(packageLock);
    const result = runChecker(
      t,
      auditReport(approvedHighVulnerabilities()),
      "2026-08-08",
      packageLock,
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /image-size exception reaches forbidden/);
  });
}

function runChecker(t, report, now, packageLock = clonePackageLock()) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "joessh-dependency-audit-"));
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));
  const auditPath = join(fixtureRoot, "audit.json");
  const packageLockPath = join(fixtureRoot, "package-lock.json");
  const registerPath = join(fixtureRoot, "register.md");
  writeFileSync(auditPath, JSON.stringify(report));
  writeFileSync(packageLockPath, JSON.stringify(packageLock));
  writeFileSync(registerPath, repositoryRegister);

  return spawnSync(
    process.execPath,
    [
      checkerPath,
      "--audit-json",
      auditPath,
      "--package-lock",
      packageLockPath,
      "--register",
      registerPath,
      "--now",
      now,
    ],
    { encoding: "utf8" },
  );
}

function auditReport(vulnerabilities) {
  return {
    auditReportVersion: 2,
    vulnerabilities,
  };
}

function approvedHighVulnerabilities() {
  const vulnerabilities = {};
  for (const [name, via] of Object.entries(approvedViaGraph)) {
    vulnerabilities[name] = highFinding(
      name,
      name === "image-size"
        ? imageSizeAdvisories.map((url) => ({
            name,
            severity: "high",
            url,
          }))
        : [...via],
      name === "expo" || name === "react-native",
    );
  }
  vulnerabilities["image-size"].fixAvailable = {
    isSemVerMajor: true,
    name: "expo",
    version: "53.0.27",
  };
  return vulnerabilities;
}

function highFinding(name, via, isDirect) {
  return {
    isDirect,
    name,
    nodes: [`node_modules/${name}`],
    severity: "high",
    via,
  };
}

function clonePackageLock() {
  return JSON.parse(JSON.stringify(repositoryPackageLock));
}
