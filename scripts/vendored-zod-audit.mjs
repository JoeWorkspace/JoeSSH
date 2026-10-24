import { isDeepStrictEqual } from "node:util";
import {
  ZOD_REGISTRATION,
  assertVerifiedZod,
} from "./vendored-zod-contract.mjs";

const advisoryId = "GHSA-mrhx-c7xc-m3w5";
const advisory = Object.freeze({
  source: 1243066,
  name: "zod",
  dependency: "zod",
  title:
    "Zod can exhaust memory while validating oversized constrained collections",
  url: "https://github.com/advisories/GHSA-mrhx-c7xc-m3w5",
  severity: "high",
  cwe: ["CWE-770"],
  cvss: {
    score: 7.5,
    vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
  },
  range: "<4.6.6",
});
const registryPackage = Object.freeze({
  version: "3.25.76",
  resolved: ZOD_REGISTRATION.archive,
  integrity: ZOD_REGISTRATION.integrity,
  license: "MIT",
});

export function zodRegistryAuditInputs(verified) {
  assertVerifiedZod(verified);
  const manifest = {
    name: "joessh-zod-registry-audit",
    version: "0.0.0",
    private: true,
    dependencies: { zod: "3.25.76" },
  };
  return {
    manifest,
    lock: {
      name: manifest.name,
      version: manifest.version,
      lockfileVersion: 3,
      requires: true,
      packages: { "": manifest, "node_modules/zod": registryPackage },
    },
  };
}

// The integrating caller validates npm JSON and exit status before this strict
// original-identity comparison. Any new/changed advisory blocks the gate.
export function assessZodRegistryAudit(report, verified) {
  assertVerifiedZod(verified);
  const expected = {
    zod: {
      name: "zod",
      severity: "high",
      isDirect: true,
      via: [advisory],
      effects: [],
      range: "<4.6.6",
      nodes: ["node_modules/zod"],
      fixAvailable: { name: "zod", version: "4.6.7", isSemVerMajor: true },
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
      "Original Zod audit contains an unexpected or changed finding; review required.",
    );
  }
  return Object.freeze({
    originalRegistryFindings: 1,
    verifiedBackport: advisoryId,
    upstreamFixedRelease: false,
  });
}

// Recognize only the direct Zod leaf. Parent graph handling belongs to the
// independent composition module; this function never rewrites the report.
export function isVerifiedZodFinding(report, name, verified) {
  assertVerifiedZod(verified);
  if (name !== "zod" || report?.auditReportVersion !== 2) return false;
  const expected = {
    name: "zod",
    severity: "high",
    isDirect: false,
    via: [advisory],
    effects: ["@expo/cli"],
    range: "<4.6.6",
    nodes: ["node_modules/@expo/cli/node_modules/zod", "vendor/zod-3.25.76"],
    fixAvailable: { name: "expo", version: "54.0.38", isSemVerMajor: true },
  };
  return isDeepStrictEqual(report.vulnerabilities?.zod, expected);
}
