import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { verifyVendoredNodeForge } from "./vendored-node-forge-contract.mjs";
import {
  assessNodeForgeRegistryAudit,
  isVerifiedNodeForgeFinding,
  nodeForgeRegistryAuditInputs,
} from "./vendored-node-forge-audit.mjs";
import { parseAuditResult } from "./check-dependency-risk-register.mjs";
import { verifyVendoredNpmPackages } from "./vendored-npm-contract.mjs";

const verified = verifyVendoredNodeForge(resolve(import.meta.dirname, ".."));
// Captured from npm 10.9.7's fresh, one-package original-identity audit.
const report = JSON.parse(
  readFileSync(
    new URL("./node-forge-registry-audit.fixture.json", import.meta.url),
    "utf8",
  ),
);

const workspaceReport = JSON.parse(
  readFileSync(
    new URL("./node-forge-workspace-audit.fixture.json", import.meta.url),
    "utf8",
  ),
);

test("audits the published 1.4.0 identity while accounting for the verified backport", () => {
  const inputs = nodeForgeRegistryAuditInputs(verified);
  assert.deepEqual(inputs.manifest.dependencies, { "node-forge": "1.4.0" });
  const locked = inputs.lock.packages["node_modules/node-forge"];
  assert.equal(locked.version, "1.4.0");
  assert.equal(locked.resolved, verified.registryPackage.resolved);
  assert.equal(locked.integrity, verified.registryPackage.integrity);
  assert.equal(locked.link, undefined);
  assert.equal(Object.keys(inputs.lock.packages).length, 2);
  assert.deepEqual(
    parseAuditResult(
      { status: 1, stdout: JSON.stringify(report) },
      "registry",
      "high",
    ),
    report,
  );
});

test("recognizes only the exact source-verified defect and makes no upstream release claim", () => {
  assert.deepEqual(assessNodeForgeRegistryAudit(report, verified), {
    originalRegistryFindings: 1,
    verifiedBackport: "GHSA-86w9-cpqp-85rv",
    upstreamFixedRelease: false,
  });
});

for (const [label, change] of [
  [
    "extra advisory",
    (r) =>
      r.vulnerabilities["node-forge"].via.push({
        ...r.vulnerabilities["node-forge"].via[0],
        source: 9999999,
        url: "https://example.test/new-advisory",
      }),
  ],
  [
    "unknown advisory ID",
    (r) => {
      r.vulnerabilities["node-forge"].via[0].url =
        "https://example.test/unknown";
    },
  ],
  [
    "changed source ID",
    (r) => {
      r.vulnerabilities["node-forge"].via[0].source += 1;
    },
  ],
  [
    "changed range",
    (r) => {
      r.vulnerabilities["node-forge"].via[0].range = "<=1.4.1";
    },
  ],
  [
    "changed severity",
    (r) => {
      r.vulnerabilities["node-forge"].via[0].severity = "critical";
    },
  ],
  [
    "changed CVSS",
    (r) => {
      r.vulnerabilities["node-forge"].via[0].cvss.score = 10;
    },
  ],
  [
    "dangling reference",
    (r) => {
      r.vulnerabilities["node-forge"].via = ["missing"];
    },
  ],
  [
    "different node",
    (r) => {
      r.vulnerabilities["node-forge"].nodes = ["node_modules/other"];
    },
  ],
  [
    "additional vulnerable package",
    (r) => {
      r.vulnerabilities.other = structuredClone(
        r.vulnerabilities["node-forge"],
      );
    },
  ],
  [
    "unreported vulnerability",
    (r) => {
      r.vulnerabilities = {};
    },
  ],
  [
    "inconsistent count",
    (r) => {
      r.metadata.vulnerabilities.high = 0;
    },
  ],
  [
    "unexpected dependency",
    (r) => {
      r.metadata.dependencies.total = 2;
    },
  ],
  [
    "new published fix",
    (r) => {
      r.vulnerabilities["node-forge"].fixAvailable = true;
    },
  ],
]) {
  test(`blocks original registry ${label} instead of silently filtering it`, () => {
    const changed = structuredClone(report);
    change(changed);
    assert.throws(
      () => assessNodeForgeRegistryAudit(changed, verified),
      /unexpected or changed finding/,
    );
  });
}

for (const key of [
  "name",
  "version",
  "path",
  "metadataSha256",
  "patchedAdvisories",
  "registryPackage",
]) {
  test(`rejects an unverified backport ${key}`, () => {
    const changed = {
      ...verified,
      [key]: key === "patchedAdvisories" ? [] : "altered",
    };
    Object.freeze(changed);
    assert.throws(
      () => nodeForgeRegistryAuditInputs(changed),
      /verified pinned backport/,
    );
    assert.throws(
      () => assessNodeForgeRegistryAudit(report, changed),
      /verified pinned backport/,
    );
  });
}

test("rejects upstream transport or exit-status failures even for the known advisory", () => {
  for (const status of [0, 2, null]) {
    assert.throws(() =>
      parseAuditResult(
        { status, stdout: JSON.stringify(report) },
        "registry",
        "high",
      ),
    );
  }
  assert.throws(() =>
    parseAuditResult(
      {
        status: 1,
        error: new Error("network unavailable"),
        stdout: JSON.stringify(report),
      },
      "registry",
      "high",
    ),
  );
  assert.throws(() =>
    parseAuditResult(
      {
        status: 1,
        stdout: JSON.stringify({ ...report, error: { code: "EAUDIT" } }),
      },
      "registry",
      "high",
    ),
  );
});

test("recognizes the same fixed defect through its four real workspace dependency paths", () => {
  for (const name of Object.keys(workspaceReport.vulnerabilities)) {
    assert.equal(
      isVerifiedNodeForgeFinding(workspaceReport, name, verified),
      true,
      name,
    );
  }
  const changed = structuredClone(workspaceReport);
  changed.vulnerabilities.unrelated = {
    ...changed.vulnerabilities.expo,
    name: "unrelated",
  };
  assert.equal(
    isVerifiedNodeForgeFinding(changed, "unrelated", verified),
    false,
  );
});

for (const [label, mutate] of [
  [
    "additional upstream advisory",
    (r) =>
      r.vulnerabilities["node-forge"].via.push({
        ...r.vulnerabilities["node-forge"].via[0],
        source: 9,
      }),
  ],
  [
    "changed upstream advisory",
    (r) => {
      r.vulnerabilities["node-forge"].via[0].url =
        "https://example.test/unknown";
    },
  ],
  [
    "unpatched nested copy",
    (r) =>
      r.vulnerabilities["node-forge"].nodes.push(
        "node_modules/expo/node_modules/node-forge",
      ),
  ],
  [
    "extra parent advisory",
    (r) =>
      r.vulnerabilities["@expo/cli"].via.push({
        ...r.vulnerabilities["node-forge"].via[0],
      }),
  ],
  [
    "critical propagation",
    (r) => {
      r.vulnerabilities["node-forge"].severity = "critical";
    },
  ],
  [
    "unknown parent dependency",
    (r) => r.vulnerabilities.expo.via.push("unknown"),
  ],
]) {
  test(`never recognizes ${label} as the verified workspace backport`, () => {
    const changed = structuredClone(workspaceReport);
    mutate(changed);
    assert.equal(isVerifiedNodeForgeFinding(changed, "expo", verified), false);
  });
}

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
    const spec = "file:vendor/node-forge-1.4.0";
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
