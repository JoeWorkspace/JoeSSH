import { assessRustAuditReport } from "./rust-maintenance-policy.mjs";

// Audit the original registry identity too: cargo-audit skips path dependencies.
// Only a content-verified backport may account for the exact upstream defect.
export function registryAuditLockfile(verified) {
  const { name, version, source, checksum } = verified.registryPackage;
  return `version = 4\n\n[[package]]\nname = ${JSON.stringify(name)}\nversion = ${JSON.stringify(version)}\nsource = ${JSON.stringify(source)}\nchecksum = ${JSON.stringify(checksum)}\n`;
}

export function assessVendoredRustAudit(report, verified) {
  const backports = [];
  const remaining = structuredClone(report);
  const expected = verified.registryPackage;
  if (Array.isArray(remaining?.warnings?.unsound)) {
    remaining.warnings.unsound = remaining.warnings.unsound.filter(
      (warning) => {
        const advisory = warning?.advisory;
        const dependency = warning?.package;
        const patched =
          verified.name === "glib" &&
          verified.version === "0.18.5" &&
          verified.patchedAdvisories?.includes("RUSTSEC-2024-0429") &&
          warning.kind === "unsound" &&
          advisory?.id === "RUSTSEC-2024-0429" &&
          advisory.package === "glib" &&
          advisory.informational === "unsound" &&
          advisory.cvss === null &&
          advisory.withdrawn === null &&
          advisory.url === "https://github.com/gtk-rs/gtk-rs-core/pull/1343" &&
          JSON.stringify(warning.versions) ===
            JSON.stringify({
              patched: [">=0.20.0"],
              unaffected: ["<0.15.0"],
            }) &&
          ["name", "version", "source", "checksum"].every(
            (key) => dependency?.[key] === expected[key],
          );
        if (patched)
          backports.push(
            `${advisory.id} ${dependency.name}@${dependency.version}`,
          );
        return !patched;
      },
    );
  }
  const assessment = assessRustAuditReport(remaining, "Cargo.lock");
  if (backports.length !== 1)
    assessment.errors.push(
      "The verified GLib backport must match exactly one unchanged upstream advisory",
    );
  if (report?.lockfile?.["dependency-count"] !== 1)
    assessment.errors.push(
      "The vendored registry audit must cover exactly one package",
    );
  return { ...assessment, backports };
}
