import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { verifyVendoredNpmPackages } from "./vendored-npm-contract.mjs";
import { parseAuditResult } from "./check-dependency-risk-register.mjs";
import { resolve } from "node:path";
import { verifyVendoredNodeForge } from "./vendored-node-forge-contract.mjs";
import { nodeForgeRegistryAuditInputs, assessNodeForgeRegistryAudit } from "./vendored-node-forge-audit.mjs";
const verified = verifyVendoredNodeForge(resolve(import.meta.dirname, ".."));
const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: {
  vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
  dependencies: { prod: 2, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 },
} };
test("original official 1.4.2 identity must be audited clean", () => {
  const inputs = nodeForgeRegistryAuditInputs(verified);
  assert.equal(inputs.manifest.dependencies["node-forge"], "1.4.2");
  assert.equal(inputs.lock.packages["node_modules/node-forge"].integrity, verified.registryPackage.integrity);
  assert.equal(assessNodeForgeRegistryAudit(clean, verified).originalRegistryFindings, 0);
});
for (const [name, mutate] of [
  ["new high advisory", (r) => { r.vulnerabilities["node-forge"] = { severity: "high" }; }],
  ["new low advisory", (r) => { r.vulnerabilities["node-forge"] = { severity: "low" }; }],
  ["altered counts", (r) => { r.metadata.vulnerabilities.total++; }],
  ["altered dependency counts", (r) => { r.metadata.dependencies.total++; }],
]) test(name + " blocks original audit", () => { const changed = structuredClone(clean); mutate(changed); assert.throws(() => assessNodeForgeRegistryAudit(changed, verified), /review required/); });
test("forged source identity cannot authorize registry audit", () => {
  assert.throws(() => nodeForgeRegistryAuditInputs(Object.freeze({ ...verified, metadataSha256: "bad" })), /verified pinned/);
});

test("exact frozen clone cannot forge source proof", () => {
  const cloned = Object.freeze({ ...verified });
  assert.throws(() => nodeForgeRegistryAuditInputs(cloned), /verified pinned/);
  assert.throws(() => assessNodeForgeRegistryAudit(clean, cloned), /verified pinned/);
});
test("transport, invalid exit status and EAUDIT errors block the clean registry audit", () => {
  for (const status of [1, 2, null]) assert.throws(() => parseAuditResult({ status, stdout: JSON.stringify(clean) }, "registry", "high"));
  assert.throws(() => parseAuditResult({ status: 0, error: new Error("network unavailable"), stdout: JSON.stringify(clean) }, "registry", "high"));
  assert.throws(() => parseAuditResult({ status: 0, stdout: JSON.stringify({ ...clean, error: { code: "EAUDIT" } }) }, "registry", "high"));
});
for (const alternative of [
  "missing",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
]) {
  test(`cannot skip vendor verification with ${alternative} direct dependency`, (t) => {
    const temporaryRoot = realpathSync(tmpdir());
    const fixture = mkdtempSync(join(temporaryRoot, "joessh-forge-binding-"));
    t.after(() => {
      assert.equal(dirname(fixture), temporaryRoot);
      assert.ok(basename(fixture).startsWith("joessh-forge-binding-"));
      rmSync(fixture, { recursive: true, force: true });
    });
    mkdirSync(join(fixture, "vendor"));
    cpSync(verified.directory, join(fixture, verified.path), {
      recursive: true,
    });
    const spec = "file:vendor/node-forge-1.4.2";
    const manifest = {
      dependencies: { "node-forge": spec },
      overrides: { "node-forge": "$node-forge" },
    };
    const lock = {
      packages: {
        "": { dependencies: manifest.dependencies },
        "node_modules/node-forge": { resolved: verified.path, link: true },
        [verified.path]: {
          name: verified.name,
          version: verified.version,
          license: verified.declaredLicense,
        },
      },
    };
    writeFileSync(join(fixture, "package.json"), JSON.stringify(manifest));
    writeFileSync(join(fixture, "package-lock.json"), JSON.stringify(lock));
    assert.equal(verifyVendoredNpmPackages(fixture).length, 1);
    delete manifest.dependencies;
    delete manifest.overrides;
    if (alternative !== "missing")
      manifest[alternative] = { "node-forge": spec };
    writeFileSync(join(fixture, "package.json"), JSON.stringify(manifest));
    assert.throws(
      () => verifyVendoredNpmPackages(fixture),
      /Orphaned vendored npm identity/,
    );
  });
}
