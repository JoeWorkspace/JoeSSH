import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  RUST_AUDIT_CONFIG,
  RUSTSEC_DATABASE_URL,
  runRustAuditOnline,
} from "./rust-audit-transport.mjs";

function fixture(t) {
  const temporaryRoot = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryRoot, "joessh-audit-transport-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), temporaryRoot);
    assert.ok(basename(root).startsWith("joessh-audit-transport-"));
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, ".cargo"));
  writeFileSync(join(root, ".cargo/audit.toml"), RUST_AUDIT_CONFIG);
  writeFileSync(join(root, "Cargo.lock"), "version = 4\n");
  return root;
}

function successfulRunner(root, mutate = () => {}) {
  const calls = [];
  const runAudit = (command, args, options) => {
    calls.push({ command, args, options });
    let result;
    if (args.includes("--version")) {
      result = { status: 0, stdout: "cargo-audit-audit 0.22.2\n", stderr: "" };
    } else if (args.includes("--json")) {
      result = { status: 0, stdout: '{"warnings":{}}\n', stderr: "" };
    } else {
      const path = args[args.indexOf("--file") + 1];
      result = {
        status: 0,
        stdout: "",
        stderr: `    Fetching advisory database from \`${RUSTSEC_DATABASE_URL}\`\n      Loaded 999 security advisories (from ${root})\n    Updating crates.io index\n    Scanning ${path} for vulnerabilities (42 crate dependencies)\n`,
      };
    }
    mutate(result, args, options);
    return result;
  };
  return { runAudit, calls };
}

test("repository config pins online checks and overrides home configuration", () => {
  const config = readFileSync(
    new URL("../.cargo/audit.toml", import.meta.url),
    "utf8",
  ).replace(/\r\n/g, "\n");
  assert.equal(config, RUST_AUDIT_CONFIG);
});

test("checks terminal online completion before obtaining JSON for the same lockfile", (t) => {
  const root = fixture(t);
  const { runAudit, calls } = successfulRunner(root);
  const result = runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} });
  assert.equal(result.passed, true, result.errors.join("\n"));
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].args, ["audit", "--version"]);
  assert.ok(calls[1].args.includes("terminal"));
  assert.ok(calls[2].args.includes("--json"));
  for (const call of calls.slice(1)) {
    assert.equal(call.command, "cargo");
    assert.equal(call.options.cwd, root);
    assert.equal(call.options.env.CARGO_TERM_COLOR, "never");
    assert.ok(call.args.includes(resolve(root, "Cargo.lock")));
    assert.ok(call.args.includes("warnings"));
    assert.ok(
      !call.args.some((arg) =>
        ["--no-fetch", "--no-yanked", "--quiet", "--stale"].includes(arg),
      ),
    );
  }
});

for (const [name, output] of [
  [
    "failed index update",
    "warning: couldn't update crates.io index: request timed out",
  ],
  ["failed index open", "warning: couldn't open crates.io index: unavailable"],
  [
    "failed per-package yanked lookup",
    "error: couldn't check if the package is yanked: timeout",
  ],
  ["offline fallback", "Using offline advisory database"],
  ["unknown warning", "warning: an unrecognized failure occurred"],
  ["colored error", "\u001b[31merror: unavailable\u001b[0m"],
]) {
  test(`rejects ${name} despite exit zero and stops before JSON`, (t) => {
    const root = fixture(t);
    const { runAudit, calls } = successfulRunner(root, (result, args) => {
      if (args.includes("terminal")) result.stderr += `${output}\n`;
    });
    assert.equal(
      runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
      false,
    );
    assert.equal(calls.length, 2);
  });
}

for (const marker of ["Fetching", "Loaded", "Updating", "Scanning"]) {
  test(`rejects missing ${marker} evidence even without diagnostics`, (t) => {
    const root = fixture(t);
    const { runAudit } = successfulRunner(root, (result, args) => {
      if (args.includes("terminal"))
        result.stderr = result.stderr
          .split("\n")
          .filter((line) => !line.includes(marker))
          .join("\n");
    });
    assert.equal(
      runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
      false,
    );
  });
}

test("rejects markers for a different database or lockfile", (t) => {
  const root = fixture(t);
  for (const [from, to] of [
    [RUSTSEC_DATABASE_URL, "https://example.invalid/db"],
    [resolve(root, "Cargo.lock"), "another.lock"],
  ]) {
    const { runAudit } = successfulRunner(root, (result, args) => {
      if (args.includes("terminal"))
        result.stderr = result.stderr.replace(from, to);
    });
    assert.equal(
      runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
      false,
    );
  }
});

test("rejects changed strict config before invoking cargo", (t) => {
  const root = fixture(t);
  for (const config of [
    "",
    RUST_AUDIT_CONFIG.replace("fetch = true", "fetch = false"),
    RUST_AUDIT_CONFIG.replace("enabled = true", "enabled = false"),
  ]) {
    writeFileSync(join(root, ".cargo/audit.toml"), config);
    const { runAudit, calls } = successfulRunner(root);
    assert.equal(
      runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
      false,
    );
    assert.equal(calls.length, 0);
  }
});

test("rejects a missing project config rather than loading home settings", (t) => {
  const root = fixture(t);
  rmSync(join(root, ".cargo/audit.toml"));
  const { runAudit, calls } = successfulRunner(root);
  assert.equal(
    runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
    false,
  );
  assert.equal(calls.length, 0);
});

test("rejects an offline environment and unknown scope before invoking cargo", (t) => {
  const root = fixture(t);
  const { runAudit, calls } = successfulRunner(root);
  assert.equal(
    runRustAuditOnline("Cargo.lock", {
      root,
      runAudit,
      env: { CARGO_NET_OFFLINE: "true" },
    }).passed,
    false,
  );
  assert.equal(
    runRustAuditOnline("Cargo.lock", {
      root,
      runAudit,
      env: {},
      scope: "arbitrary",
    }).passed,
    false,
  );
  assert.equal(calls.length, 0);
});

test("pins known scope denials while leaving advisory acceptance to the caller", (t) => {
  const root = fixture(t);
  for (const [scope, denialValues, warning] of [
    [
      "apps/desktop/src-tauri/Cargo.lock",
      ["unsound", "yanked"],
      "unmaintained",
    ],
    ["vendored:glib@0.18.5", ["yanked"], "unsound"],
    ["vendored:tauri@2.11.2", ["warnings"], null],
  ]) {
    const { runAudit, calls } = successfulRunner(root, (result, args) => {
      if (warning && args.includes("terminal")) {
        result.stdout = `Warning:  ${warning}\n`;
        result.stderr += "warning: 1 allowed warning found\n";
      }
    });
    assert.equal(
      runRustAuditOnline("Cargo.lock", { root, scope, runAudit, env: {} })
        .passed,
      true,
    );
    for (const { args } of calls.slice(1)) {
      assert.deepEqual(
        args.filter((arg, index) => args[index - 1] === "--deny"),
        denialValues,
      );
    }
  }
});

for (const [name, mutate] of [
  [
    "wrong version",
    (result, args) => {
      if (args.includes("--version")) result.stdout = "cargo-audit 0.22.1";
    },
  ],
  [
    "terminal failure",
    (result, args) => {
      if (args.includes("terminal")) result.status = 1;
    },
  ],
  [
    "JSON failure",
    (result, args) => {
      if (args.includes("--json")) result.status = 1;
    },
  ],
  [
    "JSON error diagnostic",
    (result, args) => {
      if (args.includes("--json"))
        result.stderr = "error: registry lookup failed";
    },
  ],
  [
    "invalid JSON",
    (result, args) => {
      if (args.includes("--json")) result.stdout = "not JSON";
    },
  ],
  [
    "timeout",
    (result, args) => {
      if (args.includes("terminal")) {
        result.status = null;
        result.error = new Error("ETIMEDOUT");
      }
    },
  ],
]) {
  test(`rejects ${name}`, (t) => {
    const root = fixture(t);
    const { runAudit } = successfulRunner(root, mutate);
    assert.equal(
      runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
      false,
    );
  });
}

test("rejects changed lockfile/config content between both audit passes", (t) => {
  for (const stage of ["terminal", "--json"]) {
    for (const file of ["Cargo.lock", ".cargo/audit.toml"]) {
      const root = fixture(t);
      const { runAudit } = successfulRunner(root, (_result, args) => {
        if (args.includes(stage)) writeFileSync(join(root, file), "changed");
      });
      assert.equal(
        runRustAuditOnline("Cargo.lock", { root, runAudit, env: {} }).passed,
        false,
      );
    }
  }
});

test("runner launch exceptions fail closed", (t) => {
  const root = fixture(t);
  const outcome = runRustAuditOnline("Cargo.lock", {
    root,
    env: {},
    runAudit() {
      throw new Error("spawn failed");
    },
  });
  assert.equal(outcome.passed, false);
  assert.match(outcome.errors.join("\n"), /spawn failed/);
});
