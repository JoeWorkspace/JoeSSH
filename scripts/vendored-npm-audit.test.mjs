import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isVerifiedNpmBackportFinding } from "./vendored-npm-audit.mjs";
import { isVerifiedNodeForgeFinding } from "./vendored-node-forge-audit.mjs";
import { verifyVendoredNodeForge } from "./vendored-node-forge-contract.mjs";
import { verifyVendoredZod } from "./vendored-zod-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const forge = verifyVendoredNodeForge(root);
const zod = verifyVendoredZod(root);
const captured = JSON.parse(
  readFileSync(
    new URL("./vendored-zod-audit.workspace.fixture.json", import.meta.url),
    "utf8",
  ),
);

test("requires both independently verified leaves for Expo's shared path without modifying its evidence", () => {
  const report = freeze(structuredClone(captured));
  const original = JSON.stringify(report);
  assert.equal(isVerifiedNodeForgeFinding(report, "@expo/cli", forge), false);
  for (const name of Object.keys(report.vulnerabilities)) {
    assert.equal(
      isVerifiedNpmBackportFinding(report, name, { forge, zod }),
      true,
      name,
    );
  }
  assert.equal(JSON.stringify(report), original);
});

for (const name of ["@expo/cli", "expo", "zod"]) {
  test(`missing Zod source proof cannot recognize ${name}`, () => {
    assert.equal(
      isVerifiedNpmBackportFinding(captured, name, { forge }),
      false,
    );
  });
}
for (const name of ["@expo/cli", "expo", "node-forge"]) {
  test(`missing forge source proof cannot recognize ${name}`, () => {
    assert.equal(isVerifiedNpmBackportFinding(captured, name, { zod }), false);
  });
}

for (const [label, mutate] of [
  [
    "new CLI advisory edge",
    (r) => r.vulnerabilities["@expo/cli"].via.push("unknown"),
  ],
  ["duplicate Zod edge", (r) => r.vulnerabilities["@expo/cli"].via.push("zod")],
  ["new Expo parent edge", (r) => r.vulnerabilities.expo.via.push("unknown")],
  [
    "unknown Zod advisory",
    (r) =>
      r.vulnerabilities.zod.via.push({
        ...r.vulnerabilities.zod.via[0],
        source: 9999999,
      }),
  ],
  [
    "changed Zod advisory",
    (r) => {
      r.vulnerabilities.zod.via[0].range = "<5";
    },
  ],
  [
    "additional vulnerable Zod copy",
    (r) =>
      r.vulnerabilities.zod.nodes.push(
        "node_modules/unpatched/node_modules/zod",
      ),
  ],
  [
    "changed Zod parent",
    (r) => r.vulnerabilities.zod.effects.push("new-parent"),
  ],
  [
    "changed Zod severity",
    (r) => {
      r.vulnerabilities.zod.severity = "critical";
    },
  ],
  [
    "unknown forge advisory",
    (r) =>
      r.vulnerabilities["node-forge"].via.push({
        ...r.vulnerabilities["node-forge"].via[0],
        source: 9999998,
      }),
  ],
  [
    "changed CLI node",
    (r) =>
      r.vulnerabilities["@expo/cli"].nodes.push(
        "node_modules/alternate/@expo/cli",
      ),
  ],
  [
    "missing Zod leaf",
    (r) => {
      delete r.vulnerabilities.zod;
    },
  ],
]) {
  test(`${label} still blocks the shared Expo release path`, () => {
    const report = structuredClone(captured);
    mutate(report);
    const original = JSON.stringify(report);
    assert.equal(
      isVerifiedNpmBackportFinding(report, "expo", { forge, zod }),
      false,
    );
    assert.equal(JSON.stringify(report), original);
  });
}

test("a forged or cloned Zod proof cannot authorize composition", () => {
  for (const unverified of [Object.freeze({}), Object.freeze({ ...zod })]) {
    assert.throws(
      () =>
        isVerifiedNpmBackportFinding(captured, "expo", {
          forge,
          zod: unverified,
        }),
      /source-verified pinned v3 backport/,
    );
  }
});

test("an unrelated high finding remains unrecognized", () => {
  const report = structuredClone(captured);
  report.vulnerabilities.other = {
    ...report.vulnerabilities.zod,
    name: "other",
  };
  assert.equal(
    isVerifiedNpmBackportFinding(report, "other", { forge, zod }),
    false,
  );
});

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
