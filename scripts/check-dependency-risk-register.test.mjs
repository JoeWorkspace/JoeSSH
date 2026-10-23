import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { parseAuditResult } from "./check-dependency-risk-register.mjs";

const checkerPath = fileURLToPath(
  new URL("./check-dependency-risk-register.mjs", import.meta.url),
);
const imageSizeAdvisories = [
  "https://github.com/advisories/GHSA-w3rx-r6r6-pgpr",
  "https://github.com/advisories/GHSA-5p2g-fcmc-qvqq",
];
const moderateAdvisory = "https://github.com/advisories/GHSA-w5hq-g745-h8pq";
const moderateRegister = `# Risks\n\n\`uuid\`: ${moderateAdvisory}\n`;

test("accepts clean full-workspace and production reports", (t) => {
  const result = runChecker(t, auditReport({}));

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /no high-or-critical workspace findings/);
});

for (const severity of ["low", "high"]) {
  test(`accepts npm empty range metadata while enforcing ${severity} severity`, (t) => {
    const vulnerability = finding("wrapper", severity);
    vulnerability.range = "";
    const result = runChecker(t, auditReport({ wrapper: vulnerability }));

    if (severity === "high") {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /blocking high-or-critical findings/);
      assert.match(result.stderr, /wrapper \(high\)/);
    } else {
      assert.equal(result.status, 0, result.stderr);
    }
    assert.doesNotMatch(result.stderr, /invalid finding/);
  });
}

for (const fixAvailable of [
  false,
  true,
  { name: "image-size", version: "2.0.0", isSemVerMajor: true },
]) {
  test(`never exempts former image-size advisories (fixAvailable=${JSON.stringify(fixAvailable)})`, (t) => {
    const vulnerability = finding("image-size", "high", imageSizeAdvisories);
    vulnerability.fixAvailable = fixAvailable;
    const result = runChecker(t, auditReport({ "image-size": vulnerability }), {
      register: `# Historical exception\n\`image-size\`\n${imageSizeAdvisories.join("\n")}\n2026-09-08\n`,
    });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /blocking high-or-critical findings \(no exceptions\)/,
    );
    for (const url of imageSizeAdvisories) {
      assert.ok(result.stderr.includes(url));
    }
  });
}

for (const severity of ["high", "critical"]) {
  test(`rejects ${severity} findings even without a traceable advisory root`, (t) => {
    const vulnerability = finding("unknown-wrapper", severity);
    vulnerability.via = ["missing-root"];
    const result = runChecker(
      t,
      auditReport({ "unknown-wrapper": vulnerability }),
    );

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`unknown-wrapper (${severity})`));
  });
}

for (const scope of ["full workspace", "production"]) {
  test(`cannot mask a ${scope} high finding with a lower-severity finding in the other scope`, (t) => {
    const high = auditReport({ shared: finding("shared", "high") });
    const low = auditReport({ shared: finding("shared", "low") });
    const result = runChecker(t, scope === "full workspace" ? high : low, {
      production: scope === "production" ? high : low,
    });

    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(`${scope}: shared (high)`));
  });
}

test("accepts documented moderate production findings", (t) => {
  const result = runChecker(t, auditReport({}), {
    production: auditReport({
      uuid: finding("uuid", "moderate", [moderateAdvisory]),
    }),
    register: moderateRegister,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /1 registered production moderate dependency path/,
  );
});

test("rejects undocumented moderate production packages", (t) => {
  const result = runChecker(t, auditReport({}), {
    production: auditReport({
      uuid: finding("uuid", "moderate", [moderateAdvisory]),
    }),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uuid: missing package entry/);
  assert.match(result.stderr, /uuid: missing advisory/);
});

test("rejects a new moderate advisory for an already documented package", (t) => {
  const result = runChecker(t, auditReport({}), {
    production: auditReport({
      uuid: finding("uuid", "moderate", ["https://example.test/new-advisory"]),
    }),
    register: moderateRegister,
  });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /uuid: missing advisory https:\/\/example.test\/new-advisory/,
  );
});

test("keeps the production moderate threshold separate from development-only findings", (t) => {
  const result = runChecker(
    t,
    auditReport({ dev: finding("dev", "moderate") }),
    {
      production: auditReport({}),
    },
  );

  assert.equal(result.status, 0, result.stderr);
});

for (const severity of ["info", "low"]) {
  test(`does not classify ${severity} production findings as release blockers`, (t) => {
    const result = runChecker(
      t,
      auditReport({ example: finding("example", severity) }),
    );

    assert.equal(result.status, 0, result.stderr);
  });
}

for (const report of [
  { error: { summary: "registry unavailable" } },
  { ...auditReport({}), error: { summary: "partial registry response" } },
  { auditReportVersion: 2, vulnerabilities: [] },
  { auditReportVersion: 1, vulnerabilities: {} },
]) {
  test(`rejects invalid audit report ${JSON.stringify(report)}`, (t) => {
    const result = runChecker(t, report);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid or incomplete report/);
  });
}

for (const vulnerability of [
  null,
  { name: "broken", via: [] },
  { name: "broken", severity: "unknown", via: [] },
  { name: "different", severity: "low", via: [] },
  { name: "broken", severity: "low" },
]) {
  test(`rejects malformed audit finding ${JSON.stringify(vulnerability)}`, (t) => {
    const result = runChecker(t, auditReport({ broken: vulnerability }));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid finding for broken/);
  });
}

test("validates the production response even when the full response is clean", (t) => {
  const result = runChecker(t, auditReport({}), { production: { error: {} } });

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /production npm audit returned an invalid or incomplete report/,
  );
});

for (const rawAudit of ["", "registry returned HTML instead of JSON"]) {
  test(`rejects empty or non-JSON output (${JSON.stringify(rawAudit)})`, (t) => {
    const result = runChecker(t, auditReport({}), { rawAudit });

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /did not return JSON output|Unable to parse npm audit JSON/,
    );
  });
}

for (const [name, mutate] of [
  [
    "missing metadata",
    (report) => {
      delete report.metadata;
    },
  ],
  [
    "missing vulnerability summary",
    (report) => {
      delete report.metadata.vulnerabilities;
    },
  ],
  [
    "missing dependency summary",
    (report) => {
      delete report.metadata.dependencies;
    },
  ],
  [
    "missing severity count",
    (report) => {
      delete report.metadata.vulnerabilities.high;
    },
  ],
  [
    "hidden high count",
    (report) => {
      report.metadata.vulnerabilities.high = 1;
      report.metadata.vulnerabilities.total = 1;
    },
  ],
  [
    "fractional total",
    (report) => {
      report.metadata.vulnerabilities.total = 0.5;
    },
  ],
  [
    "negative dependency count",
    (report) => {
      report.metadata.dependencies.prod = -1;
    },
  ],
  [
    "string dependency count",
    (report) => {
      report.metadata.dependencies.total = "0";
    },
  ],
  [
    "error property with null value",
    (report) => {
      report.error = null;
    },
  ],
]) {
  test(`rejects ${name} rather than declaring the report clean`, (t) => {
    const report = auditReport({});
    mutate(report);
    const result = runChecker(t, report);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid|incomplete|metadata does not match/);
  });
}

for (const [name, mutate] of [
  [
    "empty advisory list",
    (entry) => {
      entry.via = [];
    },
  ],
  [
    "malformed advisory URL",
    (entry) => {
      entry.via[0].url = "not a URL";
    },
  ],
  [
    "unsupported advisory protocol",
    (entry) => {
      entry.via[0].url = "file:///private";
    },
  ],
  [
    "unknown advisory severity",
    (entry) => {
      entry.via[0].severity = "unknown";
    },
  ],
  [
    "advisory severity exceeding the reported package severity",
    (entry) => {
      entry.via[0].severity = "high";
    },
  ],
  [
    "missing install nodes",
    (entry) => {
      entry.nodes = [];
    },
  ],
  [
    "missing affected range",
    (entry) => {
      delete entry.range;
    },
  ],
  [
    "invalid effects",
    (entry) => {
      entry.effects = [null];
    },
  ],
  [
    "invalid fix metadata",
    (entry) => {
      entry.fixAvailable = { isSemVerMajor: true };
    },
  ],
]) {
  test(`rejects a documented finding with ${name}`, (t) => {
    const entry = finding("uuid", "moderate", [moderateAdvisory]);
    mutate(entry);
    const result = runChecker(t, auditReport({ uuid: entry }), {
      register: moderateRegister,
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /invalid finding for uuid/);
  });
}

test("rejects severity counts that disagree with the reported packages", (t) => {
  const report = auditReport({
    uuid: finding("uuid", "moderate", [moderateAdvisory]),
  });
  report.metadata.vulnerabilities.moderate = 0;
  report.metadata.vulnerabilities.low = 1;
  const result = runChecker(t, report, { register: moderateRegister });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /metadata does not match/);
});

for (const [scope, threshold] of [
  ["full workspace", "high"],
  ["production", "moderate"],
]) {
  for (const severity of [
    null,
    "info",
    "low",
    "moderate",
    "high",
    "critical",
  ]) {
    test(`checks ${scope} process exit against its ${threshold} threshold for ${severity ?? "clean"} reports`, () => {
      const report = auditReport(
        severity ? { example: finding("example", severity) } : {},
      );
      const blocking =
        threshold === "high"
          ? ["high", "critical"]
          : ["moderate", "high", "critical"];
      const expectedStatus = blocking.includes(severity) ? 1 : 0;
      const audit = {
        status: expectedStatus,
        signal: null,
        stdout: JSON.stringify(report),
        stderr: "",
      };
      assert.deepEqual(parseAuditResult(audit, scope, threshold), report);
      assert.throws(
        () =>
          parseAuditResult(
            { ...audit, status: 1 - expectedStatus },
            scope,
            threshold,
          ),
        /exit status does not match/,
      );
    });
  }
}

for (const [name, overrides] of [
  ["spawn failure", { error: new Error("synthetic spawn error") }],
  ["signal termination", { signal: "SIGTERM" }],
  ["missing status", { status: undefined }],
  ["null status", { status: null }],
  ["unsupported status", { status: 2 }],
  ["string status", { status: "0" }],
  ["missing stdout", { stdout: undefined }],
]) {
  test(`rejects ${name} even with an otherwise clean report`, () => {
    const audit = {
      status: 0,
      signal: null,
      stdout: JSON.stringify(auditReport({})),
      stderr: "",
      ...overrides,
    };
    assert.throws(
      () => parseAuditResult(audit, "full workspace", "high"),
      /Unable to run|supported exit status|JSON output/,
    );
  });
}

test("rejects a real child exit 1 paired with a clean audit report", () => {
  const audit = spawnSync(
    process.execPath,
    [
      "-e",
      "process.stdout.write(process.argv[1]); process.exit(1);",
      JSON.stringify(auditReport({})),
    ],
    { encoding: "utf8" },
  );
  assert.throws(
    () => parseAuditResult(audit, "full workspace", "high"),
    /exit status does not match/,
  );
});

test("rejects a registered moderate finding with a dangling advisory dependency", (t) => {
  const entry = finding("uuid", "moderate");
  entry.via = ["missing-advisory-package"];
  const result = runChecker(t, auditReport({ uuid: entry }), {
    register: moderateRegister,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unresolved advisory dependency/);
});

for (const selfReference of [true, false]) {
  test(`rejects an advisory-free ${selfReference ? "self-reference" : "dependency cycle"}`, (t) => {
    const first = finding("first", "moderate");
    first.via = [selfReference ? "first" : "second"];
    const second = finding("second", "moderate");
    second.via = ["first"];
    const result = runChecker(
      t,
      auditReport(selfReference ? { first } : { first, second }),
      {
        register: "`first`\n`second`\n",
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /no traceable advisory/);
  });
}

for (const cycle of [false, true]) {
  test(`accepts a documented transitive advisory ${cycle ? "with a dependency cycle" : "chain"}`, (t) => {
    const first = finding("first", "moderate", [moderateAdvisory]);
    if (cycle) first.via.push("second");
    const second = finding("second", "moderate");
    second.via = ["first"];
    const result = runChecker(t, auditReport({ first, second }), {
      register: `\`first\`\n\`second\`\n${moderateAdvisory}\n`,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /2 registered production moderate dependency/);
  });
}

for (const cycle of [false, true]) {
  for (const documented of [false, true]) {
    test(`requires the reachable advisory URL for a moderate wrapper over a low leaf (cycle=${cycle}, documented=${documented})`, (t) => {
      const wrapper = finding("wrapper", "moderate");
      wrapper.via = ["leaf"];
      const leaf = finding("leaf", "low", [moderateAdvisory]);
      if (cycle) leaf.via.push("wrapper");
      const result = runChecker(t, auditReport({}), {
        production: auditReport({ wrapper, leaf }),
        register: `\`wrapper\`\n${documented ? moderateAdvisory : ""}\n`,
      });
      if (documented) {
        assert.equal(result.status, 0, result.stderr);
      } else {
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /wrapper: missing advisory/);
        assert.ok(result.stderr.includes(moderateAdvisory));
      }
    });
  }
}

function runChecker(t, report, options = {}) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "joessh-dependency-audit-"));
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));
  const auditPath = join(fixtureRoot, "audit.json");
  const registerPath = join(fixtureRoot, "register.md");
  writeFileSync(auditPath, options.rawAudit ?? JSON.stringify(report));
  writeFileSync(registerPath, options.register ?? "# Risks\n");
  const args = [
    checkerPath,
    "--audit-json",
    auditPath,
    "--register",
    registerPath,
  ];
  if (options.production) {
    const productionPath = join(fixtureRoot, "production-audit.json");
    writeFileSync(productionPath, JSON.stringify(options.production));
    args.push("--production-audit-json", productionPath);
  }

  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function auditReport(vulnerabilities) {
  const counts = {
    info: 0,
    low: 0,
    moderate: 0,
    high: 0,
    critical: 0,
    total: Object.keys(vulnerabilities).length,
  };
  for (const entry of Object.values(vulnerabilities)) {
    if (
      entry &&
      ["info", "low", "moderate", "high", "critical"].includes(entry.severity)
    )
      counts[entry.severity] += 1;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: counts,
      dependencies: {
        prod: 1,
        dev: 0,
        optional: 0,
        peer: 0,
        peerOptional: 0,
        total: 1,
      },
    },
  };
}

function finding(name, severity, urls = []) {
  return {
    name,
    severity,
    isDirect: false,
    effects: [],
    nodes: [`node_modules/${name}`],
    range: "*",
    fixAvailable: false,
    via: urls.length
      ? urls.map((url) => ({ name, severity, url }))
      : [{ name, severity, url: `https://example.test/advisories/${name}` }],
  };
}
