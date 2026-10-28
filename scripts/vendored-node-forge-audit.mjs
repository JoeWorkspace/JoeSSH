import { isDeepStrictEqual } from "node:util";
import { NODE_FORGE_REGISTRATION as pinned, assertVerifiedNodeForge } from "./vendored-node-forge-contract.mjs";

function assertVerified(verified) {
  assertVerifiedNodeForge(verified);
  if (!verified || !Object.isFrozen(verified) || verified.name !== pinned.name ||
      verified.version !== pinned.version || verified.path !== pinned.path ||
      verified.metadataSha256 !== pinned.metadataSha256 ||
      verified.registryPackage?.integrity !== pinned.integrity) {
    throw new Error("Original node-forge audit requires the verified pinned distribution.");
  }
}
export function nodeForgeRegistryAuditInputs(verified) {
  assertVerified(verified);
  const manifest = { name: "joessh-node-forge-registry-audit", version: "0.0.0", private: true, dependencies: { "node-forge": pinned.version } };
  return { manifest, lock: { name: manifest.name, version: manifest.version,
    lockfileVersion: 3, requires: true, packages: { "": manifest, "node_modules/node-forge": {
      version: pinned.version, resolved: pinned.archive, integrity: pinned.integrity, license: pinned.license,
    } } } };
}
// A fresh audit of the original official 1.4.2 identity must have no findings.
// A newly published advisory immediately blocks; there is no exception.
export function assessNodeForgeRegistryAudit(report, verified) {
  assertVerified(verified);
  if (report?.auditReportVersion !== 2 || !isDeepStrictEqual(report.vulnerabilities, {}) ||
      !isDeepStrictEqual(report.metadata?.vulnerabilities, { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }) ||
      !isDeepStrictEqual(report.metadata?.dependencies, { prod: 2, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 })) {
    throw new Error("Original node-forge audit contains an unexpected or changed finding; review required.");
  }
  return Object.freeze({ originalRegistryFindings: 0, verifiedBackport: "none" });
}
