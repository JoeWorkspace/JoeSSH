const TAURI_LOCKFILE = "apps/desktop/src-tauri/Cargo.lock";
const DAY_MS = 86_400_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function noticeKey(notice) {
  return `${notice.id}:${notice.package}:${notice.version}:${notice.checksum}:${notice.source}`;
}

function validRegistration(notice) {
  return (
    isRecord(notice) &&
    /^RUSTSEC-\d{4}-\d{4}$/.test(notice.id ?? "") &&
    typeof notice.package === "string" &&
    /^[A-Za-z0-9_-]+$/.test(notice.package) &&
    typeof notice.version === "string" &&
    /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(
      notice.version,
    ) &&
    typeof notice.checksum === "string" &&
    /^[a-f0-9]{64}$/.test(notice.checksum) &&
    notice.source === "registry+https://github.com/rust-lang/crates.io-index"
  );
}

export function assessRustAuditReport(
  report,
  lockfile,
  policy,
  now = new Date(),
) {
  const errors = [];
  const notices = [];
  const vulnerabilities = report?.vulnerabilities;
  const settings = report?.settings;
  if (
    !isRecord(report) ||
    report.error ||
    !isRecord(report.database) ||
    !Number.isInteger(report.database["advisory-count"]) ||
    report.database["advisory-count"] < 1 ||
    !isRecord(report.lockfile) ||
    !Number.isInteger(report.lockfile["dependency-count"]) ||
    report.lockfile["dependency-count"] < 1 ||
    !isRecord(vulnerabilities) ||
    !Array.isArray(vulnerabilities.list) ||
    !isRecord(report.warnings) ||
    !isRecord(settings)
  )
    return { errors: ["Incomplete cargo audit report"], notices };

  if (
    !Array.isArray(settings.ignore) ||
    settings.ignore.length !== 0 ||
    !Array.isArray(settings.target_arch) ||
    settings.target_arch.length !== 0 ||
    !Array.isArray(settings.target_os) ||
    settings.target_os.length !== 0 ||
    settings.severity !== null ||
    !Array.isArray(settings.informational_warnings) ||
    !["unmaintained", "unsound", "notice"].every((kind) =>
      settings.informational_warnings.includes(kind),
    )
  )
    errors.push(
      "Audit must not ignore advisories or filter targets or severity",
    );

  if (
    vulnerabilities.found !== false ||
    vulnerabilities.count !== 0 ||
    vulnerabilities.list.length !== 0
  ) {
    errors.push("Vulnerabilities are never covered by maintenance notices");
  }

  let registered = [];
  if (lockfile === TAURI_LOCKFILE) {
    const reviewedAt = Date.parse(policy?.reviewedAt);
    const reviewBy = Date.parse(policy?.reviewBy);
    if (
      policy?.schemaVersion !== 1 ||
      policy.lockfile !== TAURI_LOCKFILE ||
      !Array.isArray(policy.notices) ||
      !Number.isFinite(reviewedAt) ||
      !Number.isFinite(reviewBy) ||
      reviewedAt > now.getTime() ||
      reviewBy <= now.getTime() ||
      reviewBy <= reviewedAt ||
      reviewBy - reviewedAt > 90 * DAY_MS
    )
      errors.push(
        "Tauri maintenance review is invalid or expired (maximum 90 days)",
      );
    else registered = policy.notices;
  } else if (lockfile !== "Cargo.lock") {
    errors.push("Unknown Rust lockfile scope");
  }

  if (!registered.every(validRegistration))
    errors.push(
      "Malformed maintenance registration: exact package, version, registry and SHA-256 required",
    );
  const registeredKeys = new Set(
    registered.filter(validRegistration).map(noticeKey),
  );
  if (registeredKeys.size !== registered.length)
    errors.push("Duplicate maintenance registration");
  const observedKeys = new Set();
  for (const [kind, warnings] of Object.entries(report.warnings)) {
    if (!Array.isArray(warnings)) {
      errors.push(`Malformed ${kind} warnings`);
      continue;
    }
    for (const warning of warnings) {
      const advisory = warning?.advisory;
      const dependency = warning?.package;
      const versions = warning?.versions;
      if (
        kind !== "unmaintained" ||
        warning?.kind !== "unmaintained" ||
        advisory?.informational !== "unmaintained" ||
        advisory.cvss !== null ||
        !Array.isArray(versions?.patched) ||
        versions.patched.length !== 0 ||
        !Array.isArray(versions?.unaffected) ||
        versions.unaffected.length !== 0 ||
        !isRecord(dependency) ||
        !/^RUSTSEC-\d{4}-\d{4}$/.test(advisory.id ?? "")
      ) {
        errors.push(
          `Unaccepted ${kind} warning: ${advisory?.id ?? dependency?.name ?? "unknown"}`,
        );
        continue;
      }
      const observed = {
        id: advisory.id,
        package: dependency.name,
        version: dependency.version,
        checksum: dependency.checksum,
        source: dependency.source,
      };
      if (!validRegistration(observed)) {
        errors.push(`Malformed maintenance package: ${advisory.id}`);
        continue;
      }
      const key = noticeKey(observed);
      if (!registeredKeys.has(key) || observedKeys.has(key)) {
        errors.push(
          `Unregistered or changed maintenance notice: ${advisory.id} ${dependency.name}@${dependency.version}`,
        );
      } else {
        observedKeys.add(key);
        notices.push(`${advisory.id} ${dependency.name}@${dependency.version}`);
      }
    }
  }
  if (registeredKeys.size !== observedKeys.size)
    errors.push(
      "Maintenance notices changed; re-review and remove stale registrations",
    );
  return { errors, notices };
}
