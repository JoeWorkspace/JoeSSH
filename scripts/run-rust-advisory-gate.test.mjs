import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  auditRustLockfiles,
  verifyResolvedRustSources,
} from "./run-rust-advisory-gate.mjs";
import { verifyVendoredRustPackages } from "./vendored-rust-contract.mjs";
import { resolve } from "node:path";

const policy = {
  schemaVersion: 1,
  lockfile: "apps/desktop/src-tauri/Cargo.lock",
  reviewedAt: "2026-08-30",
  reviewBy: "2026-11-28",
  notices: [],
};
const now = new Date("2026-08-30T12:00:00Z");
const scopes = [
  "Cargo.lock",
  "apps/desktop/src-tauri/Cargo.lock",
  "vendored:glib@0.18.5",
  "vendored:tauri@2.11.2",
];
const vendors = verifyVendoredRustPackages(resolve(import.meta.dirname, ".."));
const glib = vendors.find(({ name }) => name === "glib");
const tauri = vendors.find(({ name }) => name === "tauri");
const resolveSources = () => [glib, tauri];

function metadataFor(manifest) {
  const packages = [
    {
      name: "atlasterm-core",
      version: "0.1.0-beta.22",
      source: null,
      manifest_path: resolve(import.meta.dirname, "../crates/core/Cargo.toml"),
    },
  ];
  if (manifest !== "Cargo.toml") {
    packages.push({
      name: "glib",
      version: "0.18.5",
      source: null,
      manifest_path: resolve(glib.directory, "Cargo.toml"),
    });
    packages.push({
      name: "tauri",
      version: "2.11.2",
      source: null,
      manifest_path: resolve(tauri.directory, "Cargo.toml"),
    });
  }
  return { resolve: {}, packages };
}

test("verifies the resolved source paths in both independent Rust workspaces", () => {
  const manifests = [];
  const verified = verifyResolvedRustSources((_command, args) => {
    const manifest = args.at(-1);
    manifests.push(manifest);
    return { status: 0, stdout: JSON.stringify(metadataFor(manifest)) };
  });
  assert.deepEqual(manifests, [
    "Cargo.toml",
    "apps/desktop/src-tauri/Cargo.toml",
  ]);
  assert.deepEqual(
    verified.map(({ name }) => name),
    ["glib", "tauri"],
  );
});

test("rejects an undeclared source-null dependency present only in the Sync workspace", () => {
  assert.throws(
    () =>
      verifyResolvedRustSources((_command, args) => {
        const manifest = args.at(-1);
        const metadata = metadataFor(manifest);
        if (manifest === "Cargo.toml")
          metadata.packages.push({
            name: "unknown-sync-only",
            version: "1.0.0",
            source: null,
            manifest_path: "unknown/Cargo.toml",
          });
        return { status: 0, stdout: JSON.stringify(metadata) };
      }),
    /Unregistered vendored/,
  );
});

function cleanResult(scope) {
  const report = {
    database: { "advisory-count": 1 },
    lockfile: { "dependency-count": 1 },
    settings: {
      ignore: [],
      target_arch: [],
      target_os: [],
      severity: null,
      informational_warnings: ["unmaintained", "unsound", "notice"],
    },
    vulnerabilities: { found: false, count: 0, list: [] },
    warnings: {},
  };
  if (scope === "vendored:glib@0.18.5")
    report.warnings.unsound = [
      {
        kind: "unsound",
        package: glib.registryPackage,
        advisory: {
          id: "RUSTSEC-2024-0429",
          package: "glib",
          informational: "unsound",
          cvss: null,
          withdrawn: null,
          url: "https://github.com/gtk-rs/gtk-rs-core/pull/1343",
        },
        versions: { patched: [">=0.20.0"], unaffected: ["<0.15.0"] },
      },
    ];
  return {
    passed: true,
    errors: [],
    result: { status: 0, stdout: JSON.stringify(report), stderr: "" },
  };
}

test("audits both real lockfiles and the verified vendor's registry identity", () => {
  const calls = [];
  let projectionPath;
  const audits = auditRustLockfiles(
    (path, { scope }) => {
      calls.push(scope);
      if (scope.startsWith("vendored:")) {
        projectionPath = path;
        assert.match(readFileSync(path, "utf8"), /source = "registry\+/);
      }
      return cleanResult(scope);
    },
    policy,
    now,
    resolveSources,
  );
  assert.deepEqual(calls, scopes);
  assert.ok(audits.every(({ passed }) => passed));
  assert.equal(existsSync(projectionPath), false);
});

for (const failedScope of scopes) {
  test(`blocks release when ${failedScope} has an online failure without falling back`, () => {
    const calls = [];
    const audits = auditRustLockfiles(
      (_path, { scope }) => {
        calls.push(scope);
        const outcome = cleanResult(scope);
        if (scope === failedScope) {
          outcome.passed = false;
          outcome.errors.push("Registry update failed");
        }
        return outcome;
      },
      policy,
      now,
      resolveSources,
    );
    assert.deepEqual(calls, scopes);
    assert.deepEqual(
      audits.filter(({ passed }) => !passed).map(({ lockfile }) => lockfile),
      [failedScope],
    );
  });
}

test("rejects incomplete or missing JSON despite a successful transport", () => {
  for (const result of [null, { stdout: "{}" }, { stdout: "not JSON" }]) {
    const audits = auditRustLockfiles(
      () => ({ passed: true, errors: [], result }),
      policy,
      now,
      resolveSources,
    );
    assert.ok(audits.every(({ passed }) => !passed));
  }
});

test("does not treat future GLib advisories as repaired by the existing backport", () => {
  const audits = auditRustLockfiles(
    (_path, { scope }) => {
      const outcome = cleanResult(scope);
      if (scope === "vendored:glib@0.18.5") {
        const report = JSON.parse(outcome.result.stdout);
        report.vulnerabilities.list.push({
          advisory: { id: "RUSTSEC-2026-9999" },
        });
        outcome.result.stdout = JSON.stringify(report);
      }
      return outcome;
    },
    policy,
    now,
    resolveSources,
  );
  assert.equal(
    audits.find(({ lockfile }) => lockfile === "vendored:glib@0.18.5").passed,
    false,
  );
});

test("rejects a Cargo graph resolving GLib from another source path", () => {
  assert.throws(
    () =>
      verifyResolvedRustSources(() => ({
        status: 0,
        stdout: JSON.stringify({
          resolve: {},
          packages: [
            {
              name: "glib",
              version: "0.18.5",
              source: null,
              manifest_path: resolve(glib.directory, "../other/Cargo.toml"),
            },
          ],
        }),
      })),
    /manifest_path/,
  );
});

test("rejects missing metadata, missing backport or an unknown path package", () => {
  for (const metadata of [
    {},
    { resolve: {}, packages: [] },
    {
      resolve: {},
      packages: [
        {
          name: "unknown",
          version: "1.0.0",
          source: null,
          manifest_path: "unknown/Cargo.toml",
        },
      ],
    },
  ]) {
    assert.throws(() =>
      verifyResolvedRustSources(() => ({
        status: 0,
        stdout: JSON.stringify(metadata),
      })),
    );
  }
});
