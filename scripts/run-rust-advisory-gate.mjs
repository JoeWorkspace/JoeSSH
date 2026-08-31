import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runRustAuditOnline } from "./rust-audit-transport.mjs";
import { assessRustAuditReport } from "./rust-maintenance-policy.mjs";
import {
  verifyVendoredRustPackages,
  verifyVendoredRustPackage,
  isFirstPartyCargoPackage,
} from "./vendored-rust-contract.mjs";
import {
  assessVendoredRustAudit,
  registryAuditLockfile,
} from "./vendored-rust-audit.mjs";

const root = resolve(import.meta.dirname, "..");

export function verifyResolvedRustSources(run = spawnSync) {
  const verified = [];
  for (const manifest of ["Cargo.toml", "apps/desktop/src-tauri/Cargo.toml"]) {
    const result = run(
      "cargo",
      [
        "metadata",
        "--locked",
        "--format-version",
        "1",
        "--manifest-path",
        manifest,
      ],
      {
        cwd: root,
        encoding: "utf8",
        timeout: 180_000,
        maxBuffer: 32 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status !== 0 || result.error)
      throw new Error(
        `Cannot verify resolved Cargo sources: ${result.stderr ?? result.error?.message}`,
      );
    const metadata = JSON.parse(result.stdout);
    if (!Array.isArray(metadata.packages) || !metadata.resolve)
      throw new Error("Incomplete Cargo metadata");
    const graphPackages = [];
    for (const entry of metadata.packages) {
      if (
        !entry ||
        typeof entry.name !== "string" ||
        typeof entry.version !== "string" ||
        typeof entry.manifest_path !== "string" ||
        !(entry.source === null || typeof entry.source === "string")
      )
        throw new Error("Malformed resolved Cargo package");
      if (entry.source === null && !isFirstPartyCargoPackage(entry, { root })) {
        graphPackages.push(
          verifyVendoredRustPackage(root, {
            name: entry.name,
            version: entry.version,
            manifestPath: entry.manifest_path,
          }),
        );
      }
    }
    if (
      manifest === "apps/desktop/src-tauri/Cargo.toml" &&
      (graphPackages.length !== 2 ||
        JSON.stringify(graphPackages.map(({ name }) => name).sort()) !==
          JSON.stringify(["glib", "tauri"]))
    )
      throw new Error(
        "The resolved Tauri graph must contain the registered GLib and Tauri sources",
      );
    verified.push(...graphPackages);
  }
  if (
    verified.length !== 2 ||
    JSON.stringify(verified.map(({ name }) => name).sort()) !==
      JSON.stringify(["glib", "tauri"])
  )
    throw new Error("Unexpected vendored packages in Rust workspaces");
  return verified;
}

export function auditRustLockfiles(
  runOnline = runRustAuditOnline,
  policy,
  now,
  resolveSources = verifyResolvedRustSources,
) {
  policy ??= JSON.parse(
    readFileSync(
      join(root, "docs/rust-maintenance-risk-register.json"),
      "utf8",
    ),
  );
  verifyVendoredRustPackages(root);
  const verifiedPackages = resolveSources();
  function audit(scope, path, assess) {
    const transport = runOnline(path, { root, scope });
    let assessment = { errors: [], notices: [] };
    if (transport.result) {
      try {
        assessment = assess(JSON.parse(transport.result.stdout));
      } catch (error) {
        assessment.errors.push(`Invalid Rust audit report: ${error.message}`);
      }
    } else {
      assessment.errors.push("No complete online JSON report was produced");
    }
    assessment.errors.push(...transport.errors);
    return {
      lockfile: scope,
      transport,
      assessment,
      passed: transport.passed && assessment.errors.length === 0,
    };
  }
  const audits = ["Cargo.lock", "apps/desktop/src-tauri/Cargo.lock"].map(
    (lockfile) =>
      audit(lockfile, lockfile, (report) =>
        assessRustAuditReport(report, lockfile, policy, now),
      ),
  );
  for (const verified of verifiedPackages) {
    const directory = mkdtempSync(join(tmpdir(), "joessh-rust-audit-"));
    const path = join(directory, "Cargo.lock");
    try {
      writeFileSync(path, registryAuditLockfile(verified));
      audits.push(
        audit(`vendored:${verified.name}@${verified.version}`, path, (report) =>
          assessVendoredRustAudit(report, verified),
        ),
      );
    } finally {
      // Only remove the file and empty directory allocated by this invocation.
      rmSync(path, { force: true });
      rmdirSync(directory);
    }
  }
  verifyVendoredRustPackages(root);
  return audits;
}

if (resolve(process.argv[1] ?? "").endsWith(basename(import.meta.url))) {
  try {
    const audits = auditRustLockfiles();
    for (const { lockfile, transport, assessment, passed } of audits) {
      console.log(
        `${passed ? "PASS" : "FAIL"} Rust advisory audit: ${lockfile}`,
      );
      for (const notice of assessment.notices)
        console.log(`TRACKED maintenance: ${notice}`);
      for (const backport of assessment.backports ?? [])
        console.log(`VERIFIED official backport: ${backport}`);
      for (const error of assessment.errors) console.error(error);
      if (!passed) {
        for (const result of [transport.probe, transport.result]) {
          if (result?.stderr) process.stderr.write(result.stderr);
          if (result?.error) console.error(result.error.message);
        }
      }
    }
    if (audits.some(({ passed }) => !passed))
      throw new Error(
        "Strict RustSec gate failed. Every lockfile and vendored upstream identity requires a complete online audit and verified source. Fix reported issues or restore network access; cached-only results are not accepted.",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
