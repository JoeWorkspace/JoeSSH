import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isVerifiedNpmBackportFinding } from "./vendored-npm-audit.mjs";
import { verifyVendoredZod } from "./vendored-zod-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const zod = verifyVendoredZod(root);
const captured = JSON.parse(
  readFileSync(
    new URL("./vendored-zod-audit.workspace.fixture.json", import.meta.url),
    "utf8",
  ),
);

test("requires verified Zod and the precise Expo dependency graph without modifying its evidence", () => {
  const report = freeze(structuredClone(captured));
  const original = JSON.stringify(report);
  for (const name of ["zod", "@expo/cli", "expo"]) {
    assert.equal(
      isVerifiedNpmBackportFinding(report, name, { zod }),
      true,
      name,
    );
  }
  assert.equal(JSON.stringify(report), original);
});

for (const name of ["@expo/cli", "expo", "zod"]) {
  test(`missing Zod source proof cannot recognize ${name}`, () => {
    assert.equal(
      isVerifiedNpmBackportFinding(captured, name, {}),
      false,
    );
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
  ["deepmerge severity raised", (r) => { r.vulnerabilities.deepmerge.severity = "high"; }],
  ["deepmerge advisory changed", (r) => { r.vulnerabilities.deepmerge.via[0].source++; }],
  ["new low parent edge", (r) => { r.vulnerabilities["@expo/config"].via.push("unknown"); }],
  ["unpatched nested deepmerge", (r) => { r.vulnerabilities.deepmerge.nodes.push("node_modules/example/node_modules/deepmerge"); }],
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
      isVerifiedNpmBackportFinding(report, "expo", { zod }),
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
    isVerifiedNpmBackportFinding(report, "other", { zod }),
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
