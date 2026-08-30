import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";

const scriptPath = resolve(process.argv[1] ?? "");

export function hasRustAuditErrorDiagnostics(output) {
  return output.split(/\r?\n/).some((line) => /^\s*error(?:\[|:)/i.test(line));
}

export function rustAuditAttemptPassed(result) {
  return (
    result.status === 0 &&
    !result.error &&
    !hasRustAuditErrorDiagnostics(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )
  );
}

export function auditRustLockfiles(runAudit = spawnSync) {
  return ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].map((lockfile) => {
    const result = runAudit(
      "cargo",
      ["audit", "--deny", "warnings", "--file", lockfile],
      {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          CARGO_TERM_COLOR: "never",
        },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 180_000,
      },
    );
    return { lockfile, result, passed: rustAuditAttemptPassed(result) };
  });
}

if (scriptPath.endsWith(basename(import.meta.url))) {
  const audits = auditRustLockfiles();
  for (const { lockfile, result, passed } of audits) {
    console.log(`${passed ? "PASS" : "FAIL"} Rust advisory audit: ${lockfile}`);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error.message);
  }

  if (audits.some(({ passed }) => !passed)) {
    console.error(
      "Strict RustSec gate failed: every lockfile requires a successful online audit without error diagnostics. Fix reported issues or retry after restoring network access; cached-only results are not accepted.",
    );
    process.exit(1);
  }
}
