import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  verifyVendoredZod,
  verifyVendoredZodSource,
} from "./vendored-zod-contract.mjs";
import { isVerifiedNpmBackportFinding } from "./vendored-npm-audit.mjs";
import {
  assessZodRegistryAudit,
  isVerifiedZodFinding,
  zodRegistryAuditInputs,
} from "./vendored-zod-audit.mjs";

const verified = verifyVendoredZod(resolve(import.meta.dirname, ".."));
const registry = JSON.parse(
  readFileSync(
    new URL("./vendored-zod-audit.registry.fixture.json", import.meta.url),
    "utf8",
  ),
);
const workspace = JSON.parse(
  readFileSync(
    new URL("./vendored-zod-audit.workspace.fixture.json", import.meta.url),
    "utf8",
  ),
);

test("original-identity audit uses the real published registry version and integrity", () => {
  const input = zodRegistryAuditInputs(verified);
  assert.deepEqual(input.manifest.dependencies, { zod: "3.25.76" });
  const entry = input.lock.packages["node_modules/zod"];
  assert.equal(entry.version, "3.25.76");
  assert.equal(entry.resolved, verified.registryPackage.resolved);
  assert.equal(entry.integrity, verified.registryPackage.integrity);
  assert.equal(entry.link, undefined);
  assert.equal(Object.keys(input.lock.packages).length, 2);
  assert.deepEqual(assessZodRegistryAudit(registry, verified), {
    originalRegistryFindings: 1,
    verifiedBackport: "GHSA-mrhx-c7xc-m3w5",
    upstreamFixedRelease: false,
  });
});

for (const [label, change] of [
  [
    "new advisory",
    (r) => {
      r.vulnerabilities.zod.via.push({
        ...r.vulnerabilities.zod.via[0],
        source: 9999999,
      });
    },
  ],
  [
    "changed source",
    (r) => {
      r.vulnerabilities.zod.via[0].source++;
    },
  ],
  [
    "changed range",
    (r) => {
      r.vulnerabilities.zod.via[0].range = "<=4.6.6";
    },
  ],
  [
    "changed CVSS",
    (r) => {
      r.vulnerabilities.zod.via[0].cvss.score = 10;
    },
  ],
  [
    "changed title",
    (r) => {
      r.vulnerabilities.zod.via[0].title += " changed";
    },
  ],
  [
    "new node",
    (r) => {
      r.vulnerabilities.zod.nodes.push("node_modules/other/zod");
    },
  ],
  [
    "different fix",
    (r) => {
      r.vulnerabilities.zod.fixAvailable.version = "4.6.8";
    },
  ],
  [
    "different dependency counts",
    (r) => {
      r.metadata.dependencies.total++;
    },
  ],
  [
    "critical finding",
    (r) => {
      r.metadata.vulnerabilities.critical = 1;
    },
  ],
  [
    "empty stale report",
    (r) => {
      r.vulnerabilities = {};
      r.metadata.vulnerabilities.high = 0;
      r.metadata.vulnerabilities.total = 0;
    },
  ],
]) {
  test("original registry audit fails closed: " + label, () => {
    const changed = structuredClone(registry);
    change(changed);
    assert.throws(
      () => assessZodRegistryAudit(changed, verified),
      /unexpected or changed/,
    );
  });
}

test("matches only the actual installed Zod leaf without modifying the report", () => {
  const before = JSON.stringify(workspace);
  assert.equal(isVerifiedZodFinding(workspace, "zod", verified), true);
  for (const name of ["@expo/cli", "expo", "node-forge", "unknown"])
    assert.equal(isVerifiedZodFinding(workspace, name, verified), false);
  assert.equal(JSON.stringify(workspace), before);
});

for (const [label, change] of [
  [
    "new advisory",
    (r) => {
      r.vulnerabilities.zod.via.push({
        ...r.vulnerabilities.zod.via[0],
        source: 9999999,
      });
    },
  ],
  [
    "changed advisory URL",
    (r) => {
      r.vulnerabilities.zod.via[0].url = "https://example.invalid/unknown";
    },
  ],
  [
    "duplicate node",
    (r) => {
      r.vulnerabilities.zod.nodes.push(r.vulnerabilities.zod.nodes[0]);
    },
  ],
  [
    "missing vendor node",
    (r) => {
      r.vulnerabilities.zod.nodes.pop();
    },
  ],
  [
    "unexpected node",
    (r) => {
      r.vulnerabilities.zod.nodes.push("node_modules/zod");
    },
  ],
  [
    "new parent",
    (r) => {
      r.vulnerabilities.zod.effects.push("unknown");
    },
  ],
  [
    "wrong range",
    (r) => {
      r.vulnerabilities.zod.range = "*";
    },
  ],
  [
    "wrong directness",
    (r) => {
      r.vulnerabilities.zod.isDirect = true;
    },
  ],
  [
    "different fix",
    (r) => {
      r.vulnerabilities.zod.fixAvailable = true;
    },
  ],
  [
    "extra leaf field",
    (r) => {
      r.vulnerabilities.zod.unreviewed = true;
    },
  ],
  [
    "different version schema",
    (r) => {
      r.auditReportVersion = 1;
    },
  ],
]) {
  test("workspace Zod leaf fails closed: " + label, () => {
    const changed = structuredClone(workspace);
    change(changed);
    assert.equal(isVerifiedZodFinding(changed, "zod", verified), false);
  });
}

test("audit functions reject forged frozen verification records", () => {
  const forged = Object.freeze({ ...verified });
  assert.throws(() => zodRegistryAuditInputs(forged), /source-verified/);
  assert.throws(
    () => assessZodRegistryAudit(registry, forged),
    /source-verified/,
  );
  assert.throws(
    () => isVerifiedZodFinding(workspace, "zod", forged),
    /source-verified/,
  );
});

test("source-only proof cannot authorize original-identity audit, direct matching, or parent composition", () => {
  const sourceProof = verifyVendoredZodSource(
    resolve(import.meta.dirname, ".."),
  );
  assert.equal(sourceProof.installation.verified, false);
  assert.throws(() => zodRegistryAuditInputs(sourceProof), /source-verified/);
  assert.throws(
    () => assessZodRegistryAudit(registry, sourceProof),
    /source-verified/,
  );
  assert.throws(
    () => isVerifiedZodFinding(workspace, "zod", sourceProof),
    /source-verified/,
  );
  for (const name of ["zod", "@expo/cli", "expo"]) {
    assert.throws(
      () =>
        isVerifiedNpmBackportFinding(workspace, name, {
          zod: sourceProof,
        }),
      /source-verified/,
    );
  }
});
