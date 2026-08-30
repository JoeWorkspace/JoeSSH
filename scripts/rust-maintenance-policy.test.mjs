import assert from "node:assert/strict";
import test from "node:test";
import { assessRustAuditReport } from "./rust-maintenance-policy.mjs";

const lockfile = "apps/desktop/src-tauri/Cargo.lock";
const now = new Date("2026-08-30T12:00:00Z");
function fixture() {
  const registration = {
    id: "RUSTSEC-2024-0415",
    package: "gtk",
    version: "0.18.2",
    checksum: "a".repeat(64),
    source: "registry+https://github.com/rust-lang/crates.io-index",
  };
  return {
    policy: {
      schemaVersion: 1,
      lockfile,
      reviewedAt: "2026-08-30",
      reviewBy: "2026-11-28",
      notices: [registration],
    },
    report: {
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
      warnings: {
        unmaintained: [
          {
            kind: "unmaintained",
            package: {
              name: registration.package,
              version: registration.version,
              checksum: registration.checksum,
              source: registration.source,
            },
            advisory: {
              id: registration.id,
              informational: "unmaintained",
              cvss: null,
            },
            versions: { patched: [], unaffected: [] },
          },
        ],
      },
    },
  };
}

test("reports only exact, current Tauri maintenance notices", () => {
  const { report, policy } = fixture();
  const assessment = assessRustAuditReport(report, lockfile, policy, now);
  assert.deepEqual(assessment.errors, []);
  assert.deepEqual(assessment.notices, ["RUSTSEC-2024-0415 gtk@0.18.2"]);
});

test("root workspace does not accept Tauri maintenance registrations", () => {
  const { report, policy } = fixture();
  assert.ok(
    assessRustAuditReport(report, "Cargo.lock", policy, now).errors.length > 0,
  );
});

for (const [name, mutate] of [
  [
    "vulnerabilities even when the found flag is false",
    (f) => {
      f.report.vulnerabilities.list.push({});
    },
  ],
  [
    "unsoundness",
    (f) => {
      f.report.warnings.unsound = f.report.warnings.unmaintained;
    },
  ],
  [
    "yanked crates",
    (f) => {
      f.report.warnings.yanked = [{ kind: "yanked", package: { name: "gtk" } }];
    },
  ],
  [
    "unknown notices",
    (f) => {
      f.report.warnings.notice = [{}];
    },
  ],
  [
    "changed versions",
    (f) => {
      f.report.warnings.unmaintained[0].package.version = "0.18.3";
    },
  ],
  [
    "changed source content",
    (f) => {
      f.report.warnings.unmaintained[0].package.checksum = "b".repeat(64);
    },
  ],
  [
    "changed source registry",
    (f) => {
      f.report.warnings.unmaintained[0].package.source =
        "git+https://example.invalid";
    },
  ],
  [
    "new advisories",
    (f) => {
      f.report.warnings.unmaintained[0].advisory.id = "RUSTSEC-2026-9999";
    },
  ],
  [
    "unsafe advisory classification",
    (f) => {
      f.report.warnings.unmaintained[0].advisory.informational = "unsound";
    },
  ],
  [
    "maintenance notices that acquire a CVSS",
    (f) => {
      f.report.warnings.unmaintained[0].advisory.cvss = "CVSS:3.1/AV:N";
    },
  ],
  [
    "newly available patched versions",
    (f) => {
      f.report.warnings.unmaintained[0].versions.patched = [">=0.18.3"];
    },
  ],
  [
    "stale registrations",
    (f) => {
      f.report.warnings = {};
    },
  ],
  [
    "duplicate registrations",
    (f) => {
      f.policy.notices.push(f.policy.notices[0]);
    },
  ],
  [
    "expired review",
    (f) => {
      f.policy.reviewBy = "2026-08-30";
    },
  ],
  [
    "unbounded review",
    (f) => {
      f.policy.reviewBy = "2099-01-01";
    },
  ],
  [
    "ignored advisory settings",
    (f) => {
      f.report.settings.ignore = ["RUSTSEC-2024-0415"];
    },
  ],
  [
    "target filtering",
    (f) => {
      f.report.settings.target_os = ["windows"];
    },
  ],
  [
    "severity filtering",
    (f) => {
      f.report.settings.severity = "high";
    },
  ],
  [
    "disabled warning classes",
    (f) => {
      f.report.settings.informational_warnings = ["unmaintained"];
    },
  ],
  [
    "empty advisory database",
    (f) => {
      f.report.database["advisory-count"] = 0;
    },
  ],
  [
    "malformed warnings",
    (f) => {
      f.report.warnings.unmaintained = {};
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const state = fixture();
    mutate(state);
    assert.ok(
      assessRustAuditReport(state.report, lockfile, state.policy, now).errors
        .length > 0,
    );
  });
}

for (const report of [null, {}, { vulnerabilities: {} }]) {
  test(`rejects incomplete report ${JSON.stringify(report)}`, () => {
    assert.ok(
      assessRustAuditReport(report, lockfile, fixture().policy, now).errors
        .length > 0,
    );
  });
}

for (const [field, invalid] of [
  ["package", ""],
  ["version", "latest"],
  ["checksum", undefined],
  ["checksum", "abc"],
  ["source", undefined],
  ["source", "git+https://example.invalid"],
]) {
  test(`rejects matching malformed registration and report: ${field}=${invalid}`, () => {
    const { report, policy } = fixture();
    policy.notices[0][field] = invalid;
    report.warnings.unmaintained[0].package[
      field === "package" ? "name" : field
    ] = invalid;
    assert.ok(
      assessRustAuditReport(report, lockfile, policy, now).errors.length > 0,
    );
  });
}
