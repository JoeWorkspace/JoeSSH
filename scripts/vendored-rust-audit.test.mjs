import assert from "node:assert/strict";
import test from "node:test";
import {
  assessVendoredRustAudit,
  registryAuditLockfile,
} from "./vendored-rust-audit.mjs";

function fixture() {
  const registryPackage = {
    name: "glib",
    version: "0.18.5",
    source: "registry+https://github.com/rust-lang/crates.io-index",
    checksum:
      "233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5",
  };
  return {
    verified: {
      name: "glib",
      version: "0.18.5",
      registryPackage,
      patchedAdvisories: ["RUSTSEC-2024-0429"],
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
        unsound: [
          {
            kind: "unsound",
            package: { ...registryPackage },
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
        ],
      },
    },
  };
}

test("keeps the original registry identity available to future advisory scans", () => {
  const { verified } = fixture();
  const lock = registryAuditLockfile(verified);
  assert.match(
    lock,
    /source = "registry\+https:\/\/github.com\/rust-lang\/crates.io-index"/,
  );
  assert.match(lock, /checksum = "233daaf6/);
  assert.match(lock, /version = "0.18.5"/);
});

test("accounts only for the verified official backport without changing the raw report", () => {
  const { report, verified } = fixture();
  const assessment = assessVendoredRustAudit(report, verified);
  assert.deepEqual(assessment.errors, []);
  assert.deepEqual(assessment.backports, ["RUSTSEC-2024-0429 glib@0.18.5"]);
  assert.equal(report.warnings.unsound.length, 1);
});

test("audits an unmodified advisory identity for a compatibility-only patch", () => {
  const verified = {
    name: "tauri",
    version: "2.11.2",
    registryPackage: {
      name: "tauri",
      version: "2.11.2",
      source: "registry+https://github.com/rust-lang/crates.io-index",
      checksum:
        "437404997acf375d85f1177afa7e11bb971f274ed6a7b83a2a3e339015f4cc28",
    },
    patchedAdvisories: [],
  };
  const report = fixture().report;
  report.warnings = {};
  const assessment = assessVendoredRustAudit(report, verified);
  assert.deepEqual(assessment.errors, []);
  assert.deepEqual(assessment.backports, []);
});

test("compatibility-only vendor audit rejects additional packages", () => {
  const f = fixture();
  f.verified = {
    ...f.verified,
    name: "tauri",
    version: "2.11.2",
    patchedAdvisories: [],
  };
  f.report.warnings = {};
  f.report.lockfile["dependency-count"] = 2;
  assert.ok(assessVendoredRustAudit(f.report, f.verified).errors.length > 0);
});

for (const [name, mutate] of [
  [
    "future vulnerability",
    (f) => {
      f.report.vulnerabilities.list.push({});
    },
  ],
  [
    "future unsoundness",
    (f) => {
      const warning = structuredClone(f.report.warnings.unsound[0]);
      warning.advisory.id = "RUSTSEC-2026-9999";
      f.report.warnings.unsound.push(warning);
    },
  ],
  [
    "yanked upstream release",
    (f) => {
      f.report.warnings.yanked = [{}];
    },
  ],
  [
    "changed package checksum",
    (f) => {
      f.report.warnings.unsound[0].package.checksum = "0".repeat(64);
    },
  ],
  [
    "changed advisory classification",
    (f) => {
      f.report.warnings.unsound[0].advisory.cvss = "CVSS:3.1/AV:N";
    },
  ],
  [
    "changed patched versions",
    (f) => {
      f.report.warnings.unsound[0].versions.patched = [">=0.18.6"];
    },
  ],
  [
    "missing patch verification",
    (f) => {
      f.verified.patchedAdvisories = [];
    },
  ],
  [
    "missing known advisory",
    (f) => {
      f.report.warnings = {};
    },
  ],
  [
    "duplicate known advisory",
    (f) => {
      f.report.warnings.unsound.push(f.report.warnings.unsound[0]);
    },
  ],
  [
    "additional packages",
    (f) => {
      f.report.lockfile["dependency-count"] = 2;
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.ok(assessVendoredRustAudit(f.report, f.verified).errors.length > 0);
  });
}
