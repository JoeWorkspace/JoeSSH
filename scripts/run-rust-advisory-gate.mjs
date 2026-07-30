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

if (scriptPath.endsWith(basename(import.meta.url))) {
  const attempts = [
    ["audit", "--deny", "warnings"],
    ["audit", "--deny", "warnings", "--no-fetch"],
  ];

  let passed = false;
  for (const [index, args] of attempts.entries()) {
    const result = spawnSync("cargo", args, {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: {
        ...process.env,
        CARGO_TERM_COLOR: "never",
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
    });
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    if (rustAuditAttemptPassed(result)) {
      passed = true;
      break;
    }
    if (index === 0) {
      console.warn(
        "RustSec online audit was inconclusive; retrying against the freshly cached advisory database without network fetch.",
      );
    }
  }

  if (!passed) {
    console.error(
      "Strict RustSec gate failed: cargo audit exited unsuccessfully or emitted an error diagnostic.",
    );
    process.exit(1);
  }
}
