import { isDeepStrictEqual } from "node:util";
import { NODE_FORGE_REGISTRATION } from "./vendored-node-forge-contract.mjs";

// This is the original registry identity, not an invented patched version.
const registryPackage = Object.freeze({
  version: "1.4.0",
  resolved: "https://registry.npmjs.org/node-forge/-/node-forge-1.4.0.tgz",
  integrity:
    "sha512-LarFH0+6VfriEhqMMcLX2F7SwSXeWwnEAJEsYm5QKWchiVYVvJyV9v7UDvUv+w5HO23ZpQTXDv/GxdDdMyOuoQ==",
  license: "(BSD-3-Clause OR GPL-2.0)",
});
const advisoryId = "GHSA-86w9-cpqp-85rv";
const advisory = Object.freeze({
  source: 1240912,
  name: "node-forge",
  dependency: "node-forge",
  title:
    "node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements",
  url: `https://github.com/advisories/${advisoryId}`,
  severity: "high",
  cwe: ["CWE-347"],
  cvss: {
    score: 7.5,
    vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N",
  },
  range: "<=1.4.0",
});

function assertVerifiedBackport(verified) {
  if (
    !verified ||
    !Object.isFrozen(verified) ||
    verified.name !== "node-forge" ||
    verified.version !== registryPackage.version ||
    verified.path !== "vendor/node-forge-1.4.0" ||
    verified.metadataSha256 !== NODE_FORGE_REGISTRATION.metadataSha256 ||
    !isDeepStrictEqual(verified.patchedAdvisories, [advisoryId]) ||
    verified.registryPackage?.name !== "node-forge" ||
    verified.registryPackage.version !== registryPackage.version ||
    verified.registryPackage.resolved !== registryPackage.resolved ||
    verified.registryPackage.integrity !== registryPackage.integrity
  ) {
    throw new Error(
      "Original node-forge audit requires the verified pinned backport.",
    );
  }
}

export function nodeForgeRegistryAuditInputs(verified) {
  assertVerifiedBackport(verified);
  const manifest = {
    name: "joessh-node-forge-registry-audit",
    version: "0.0.0",
    private: true,
    dependencies: { "node-forge": "1.4.0" },
  };
  return {
    manifest,
    lock: {
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { "": manifest, "node_modules/node-forge": registryPackage },
    },
  };
}

// The caller must first validate npm's JSON schema and exit status. Recognize
// only the exact defect whose installed source bytes have been verified.
// Additional or changed upstream findings require review and block the gate.
export function assessNodeForgeRegistryAudit(report, verified) {
  assertVerifiedBackport(verified);
  const expected = {
    "node-forge": {
      name: "node-forge",
      severity: "high",
      isDirect: true,
      via: [advisory],
      effects: [],
      range: "*",
      nodes: ["node_modules/node-forge"],
      fixAvailable: false,
    },
  };
  if (
    report?.auditReportVersion !== 2 ||
    !isDeepStrictEqual(report.vulnerabilities, expected) ||
    !isDeepStrictEqual(report.metadata?.vulnerabilities, {
      info: 0,
      low: 0,
      moderate: 0,
      high: 1,
      critical: 0,
      total: 1,
    }) ||
    !isDeepStrictEqual(report.metadata?.dependencies, {
      prod: 2,
      dev: 0,
      optional: 0,
      peer: 0,
      peerOptional: 0,
      total: 1,
    })
  ) {
    throw new Error(
      "Original node-forge audit contains an unexpected or changed finding; review required.",
    );
  }
  return Object.freeze({
    originalRegistryFindings: 1,
    verifiedBackport: advisoryId,
    upstreamFixedRelease: false,
  });
}

// npm also propagates this same defect to the Expo parent packages. It does
// not know that the published version's installed source has been patched.
// Match only this fixed graph and the unchanged advisory; never lower or
// rewrite the original report, and never recognize an additional finding.
export function isVerifiedNodeForgeFinding(report, name, verified) {
  assertVerifiedBackport(verified);
  const relationships = {
    expo: ["@expo/cli"],
    "@expo/cli": ["@expo/code-signing-certificates", "node-forge"],
    "@expo/code-signing-certificates": ["node-forge"],
  };
  const expectedNodes = {
    expo: ["node_modules/expo"],
    "@expo/cli": ["node_modules/@expo/cli"],
    "@expo/code-signing-certificates": [
      "node_modules/@expo/code-signing-certificates",
    ],
    "node-forge": ["node_modules/node-forge", "vendor/node-forge-1.4.0"],
  };
  const visited = new Set();
  const queue = [name];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (visited.has(current)) continue;
    visited.add(current);
    const finding = report?.vulnerabilities?.[current];
    if (
      !finding ||
      finding.name !== current ||
      finding.severity !== "high" ||
      !Object.hasOwn(expectedNodes, current) ||
      !isDeepStrictEqual(
        [...finding.nodes].sort(),
        [...expectedNodes[current]].sort(),
      )
    )
      return false;
    if (current === "node-forge") {
      if (!isDeepStrictEqual(finding.via, [advisory])) return false;
    } else {
      if (!isDeepStrictEqual([...finding.via].sort(), relationships[current]))
        return false;
      queue.push(...relationships[current]);
    }
  }
  return visited.has("node-forge");
}
