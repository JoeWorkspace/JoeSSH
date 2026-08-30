import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";

export const RUSTSEC_DATABASE_URL =
  "https://github.com/RustSec/advisory-db.git";
export const RUST_AUDIT_CONFIG = `[advisories]
ignore = []
informational_warnings = ["unmaintained", "unsound", "notice"]

[database]
url = "${RUSTSEC_DATABASE_URL}"
fetch = true
stale = false

[output]
format = "terminal"
quiet = false
show_tree = false

[yanked]
enabled = true
update_index = true
`;

const SCOPE_DENIALS = new Map([
  ["Cargo.lock", ["--deny", "warnings"]],
  [
    "apps/desktop/src-tauri/Cargo.lock",
    ["--deny", "unsound", "--deny", "yanked"],
  ],
  ["vendored:glib@0.18.5", ["--deny", "yanked"]],
]);

function processSucceeded(result) {
  return result?.status === 0 && !result.error && !result.signal;
}

function diagnosticErrors(output, terminal) {
  const errors = [];
  for (const line of stripVTControlCharacters(output).split(/\r?\n/)) {
    if (/\boffline\b/i.test(line))
      errors.push(`Offline audit diagnostic: ${line.trim()}`);
    if (/^\s*error(?:\[|:)/i.test(line)) errors.push(line.trim());
    if (/^\s*warning:/i.test(line)) {
      // Terminal report attributes and the count summary are data, not transport
      // diagnostics. The caller must still assess the JSON advisory identities.
      const reportAttribute =
        terminal &&
        /^\s*Warning:\s+(?:unmaintained|unsound|notice|yanked)\s*$/.test(line);
      const reportSummary =
        terminal &&
        /^\s*warning:\s+\d+ allowed warnings? found(?: in .+)?\s*$/.test(line);
      if (!reportAttribute && !reportSummary) errors.push(line.trim());
    }
  }
  return errors;
}

function inspectProbe(result, lockfile) {
  const errors = [];
  if (!processSucceeded(result))
    errors.push("Terminal cargo audit did not exit successfully");
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  errors.push(...diagnosticErrors(output, true));
  const lines = stripVTControlCharacters(output)
    .split(/\r?\n/)
    .map((line) => line.trim());
  const markers = [
    (line) =>
      line === `Fetching advisory database from \`${RUSTSEC_DATABASE_URL}\``,
    (line) => /^Loaded [1-9]\d* security advisories \(from .+\)$/.test(line),
    (line) => line === "Updating crates.io index",
    (line) =>
      line.startsWith(`Scanning ${lockfile} for vulnerabilities (`) &&
      /\([1-9]\d* crate dependencies\)$/.test(line),
  ];
  let previous = -1;
  for (const marker of markers) {
    const index = lines.findIndex(
      (line, position) => position > previous && marker(line),
    );
    if (index < 0) {
      errors.push(
        "Missing ordered online database/index/lockfile scan evidence",
      );
      break;
    }
    previous = index;
  }
  return errors;
}

function assertConfig(root) {
  const text = readFileSync(resolve(root, ".cargo/audit.toml"), "utf8").replace(
    /\r\n/g,
    "\n",
  );
  if (text !== RUST_AUDIT_CONFIG) {
    throw new Error(
      "Repository .cargo/audit.toml must match the strict online audit configuration",
    );
  }
}

function lockfileHash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Verify online transport before obtaining a machine-readable audit report.
 *
 * cargo-audit 0.22.2 has no standalone yanked-completed marker. In terminal
 * mode, however, every failed index initialization emits a warning and each
 * failed per-package lookup emits an error; only JSON mode hides the former.
 * Requiring the pinned version, strict non-quiet config, ordered startup/scan
 * markers, a successful process, and no such diagnostics establishes completion.
 * See the pinned auditor.rs and presenter.rs at:
 * https://github.com/RustSec/rustsec/tree/cargo-audit/v0.22.2/cargo-audit/src
 *
 * This proves transport completion, not advisory acceptance. The caller must
 * assess result.stdout with its strict policy (including vendor patch evidence).
 * `lockfile` may be a temporary registry projection; `scope` fixes its denials.
 */
export function runRustAuditOnline(
  lockfile,
  {
    root = resolve(import.meta.dirname, ".."),
    scope = lockfile,
    runAudit = spawnSync,
    env = process.env,
  } = {},
) {
  const outcome = { passed: false, errors: [], probe: null, result: null };
  try {
    const deny = SCOPE_DENIALS.get(scope);
    if (!deny) throw new Error(`Unknown Rust audit scope: ${scope}`);
    const offline = env.CARGO_NET_OFFLINE?.trim().toLowerCase();
    if (offline && offline !== "false" && offline !== "0") {
      throw new Error(
        "CARGO_NET_OFFLINE is incompatible with the online audit gate",
      );
    }
    assertConfig(root);
    const path = resolve(root, lockfile);
    const before = lockfileHash(path);
    const options = {
      cwd: resolve(root),
      encoding: "utf8",
      env: { ...env, CARGO_TERM_COLOR: "never" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    };
    const version = runAudit("cargo", ["audit", "--version"], options);
    if (
      !processSucceeded(version) ||
      !/^cargo-audit(?:-audit)? 0\.22\.2$/.test(
        (version.stdout ?? "").trim(),
      ) ||
      diagnosticErrors(
        `${version.stdout ?? ""}\n${version.stderr ?? ""}`,
        false,
      ).length
    ) {
      throw new Error("Online completion checks require cargo-audit 0.22.2");
    }
    const args = ["audit", "--color", "never", ...deny, "--file", path];
    outcome.probe = runAudit(
      "cargo",
      [...args, "--format", "terminal"],
      options,
    );
    outcome.errors.push(...inspectProbe(outcome.probe, path));
    if (outcome.errors.length) return outcome;
    assertConfig(root);
    if (lockfileHash(path) !== before)
      throw new Error("Lockfile changed during online audit");
    outcome.result = runAudit("cargo", [...args, "--json"], options);
    if (!processSucceeded(outcome.result))
      outcome.errors.push("JSON cargo audit did not exit successfully");
    outcome.errors.push(
      ...diagnosticErrors(
        `${outcome.result?.stdout ?? ""}\n${outcome.result?.stderr ?? ""}`,
        false,
      ),
    );
    try {
      const report = JSON.parse(outcome.result?.stdout ?? "");
      if (!report || typeof report !== "object" || Array.isArray(report))
        throw new Error();
    } catch {
      outcome.errors.push("Cargo audit did not return a JSON report object");
    }
    assertConfig(root);
    if (lockfileHash(path) !== before)
      throw new Error("Lockfile changed during online audit");
    outcome.passed = outcome.errors.length === 0;
  } catch (error) {
    outcome.errors.push(error instanceof Error ? error.message : String(error));
  }
  return outcome;
}
