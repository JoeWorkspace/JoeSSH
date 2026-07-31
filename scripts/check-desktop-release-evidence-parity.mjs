import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { checkDesktopReleaseWorkflowSecurity } from "./check-desktop-release-workflow-security.mjs";

const root = resolve(
  readCliValue("--root") ?? resolve(import.meta.dirname, ".."),
);
const workflowFile = ".github/workflows/desktop-release-artifacts.yml";
const workflowName = "Desktop Release Artifacts";
const workflowFileName = "desktop-release-artifacts.yml";
const disabledMarker = "FORMAL_SIGNING_DISABLED";
const unsignedArtifactPrefix = "desktop-unsigned-bundle-";
const offlineFormalJobName = "Package Formal Desktop Evidence";
const offlineArtifactName = "desktop-release-evidence";
const handoffReportPath =
  "reports/handoff/desktop/formal-evidence-unblock-report.json";
const releaseEvidenceSourcePath =
  "reports/release/desktop/release-evidence-source.json";
const releaseEvidenceChecksumPath =
  "reports/release/desktop/release-evidence-SHA256SUMS.txt";
const offlineTemplatePath =
  "reports/handoff/desktop/external-signer-input-template.env";
const documentationStatusMarkers = [
  disabledMarker,
  "unsigned staging",
  "automated formal signing is paused",
  "isolated signing principal",
];
const checks = [];

checkWorkflowContract();
checkOfflineToolingContract();
checkDocumentationContract();

const failures = checks.filter((check) => !check.ok);
for (const checkResult of checks) {
  console.log(
    (checkResult.ok ? "PASS" : "FAIL") +
      " " +
      checkResult.label +
      (checkResult.detail ? " - " + checkResult.detail : ""),
  );
}

if (failures.length > 0) {
  console.error(
    "Desktop release evidence parity failed with " +
      failures.length +
      " issue(s).",
  );
  process.exit(1);
}

console.log("Desktop release evidence parity checks passed.");

function checkWorkflowContract() {
  const workflow = readRequiredText(workflowFile);
  const securityFailures = checkDesktopReleaseWorkflowSecurity(workflow)
    .filter((result) => !result.passed)
    .map((result) => result.label);

  check(
    securityFailures.length === 0,
    "Desktop release workflow enforces the unsigned staging security contract",
    securityFailures.join("; "),
  );
  check(
    workflow.includes("name: " + workflowName) &&
      workflow.includes("formal_evidence:"),
    "Desktop release workflow name and compatibility input are stable",
    workflowFile,
  );
  check(
    workflow.includes(disabledMarker) &&
      workflow.includes(unsignedArtifactPrefix),
    "Desktop release workflow rejects formal automation and uploads only unsigned bundles",
    workflowFile,
  );
  check(
    !workflow.includes(offlineFormalJobName) &&
      !workflow.includes("name: " + offlineArtifactName) &&
      !/\$\{\{\s*secrets\./.test(workflow) &&
      !/^\s*environment:/m.test(workflow) &&
      !/^\s*id-token:/m.test(workflow),
    "Desktop release workflow contains no formal artifact, signing secret, environment, or id-token chain",
    workflowFile,
  );
}

function checkOfflineToolingContract() {
  const packageJson = JSON.parse(readRequiredText("package.json") || "{}");
  check(
    packageJson.scripts?.["release:desktop:secret-template"] ===
      "node scripts/configure-desktop-release-secrets.mjs --write-template",
    "package retains only the offline non-secret Desktop signer template command",
    "package.json",
  );
  check(
    !packageJson.scripts?.["release:desktop:configure-secrets"] &&
      !packageJson.scripts?.["release:desktop:evidence-preflight"] &&
      !packageJson.scripts?.["release:desktop:evidence-workflow"],
    "package exposes no Desktop signing mutation, preflight, or dispatch command",
    "package.json",
  );

  const scriptExpectations = [
    [
      "scripts/desktop-release-evidence-preflight.mjs",
      [
        disabledMarker,
        "approved externally managed isolated signer",
        "historical offline evidence verification tools do not form a runnable signing chain",
      ],
    ],
    [
      "scripts/configure-desktop-release-secrets.mjs",
      [
        disabledMarker,
        offlineTemplatePath,
        "--write-template",
        "Never import, upload, copy, or pass this file to GitHub",
        "approved externally managed isolated signer",
        'flag: "wx"',
      ],
    ],
    [
      "scripts/diagnose-desktop-release-evidence.mjs",
      [
        workflowFileName,
        handoffReportPath,
        "release-remote-ref",
        "desktop-formal-signing-disabled",
        "github-ci",
        disabledMarker,
        "approved externally managed isolated signer",
      ],
    ],
    [
      "scripts/download-desktop-release-evidence.mjs",
      [
        offlineArtifactName,
        offlineFormalJobName,
        releaseEvidenceSourcePath,
        "verify-desktop-release-evidence.mjs",
        "--require-source",
      ],
    ],
    [
      "scripts/verify-desktop-release-evidence.mjs",
      [
        offlineArtifactName,
        offlineFormalJobName,
        releaseEvidenceSourcePath,
        releaseEvidenceChecksumPath,
      ],
    ],
  ];

  for (const [relativePath, snippets] of scriptExpectations) {
    const text = readRequiredText(relativePath);
    for (const snippet of snippets) {
      check(
        text.includes(snippet),
        relativePath + " retains offline evidence marker '" + snippet + "'",
        relativePath,
      );
    }
  }

  const preflight = readRequiredText(
    "scripts/desktop-release-evidence-preflight.mjs",
  );
  const configurator = readRequiredText(
    "scripts/configure-desktop-release-secrets.mjs",
  );
  const diagnostics = readRequiredText(
    "scripts/diagnose-desktop-release-evidence.mjs",
  );
  const forbiddenSigningCredentialPattern =
    /ATLASTERM_(?:WINDOWS|APPLE|KEYCHAIN)_[A-Z0-9_]+/;
  const forbiddenExternalAccessPattern =
    /node:(?:child_process|https?|net)|\b(?:spawn|exec)(?:Sync)?\s*\(|\bfetch\s*\(/;

  check(
    !forbiddenExternalAccessPattern.test(preflight) &&
      !preflight.includes("process.env") &&
      !preflight.includes("workflowRunArgs") &&
      !preflight.includes("formal_evidence=true") &&
      !preflight.includes("desktop-release-signing") &&
      !forbiddenSigningCredentialPattern.test(preflight),
    "Desktop evidence preflight is a fail-closed compatibility guard with no external command or credential path",
    "scripts/desktop-release-evidence-preflight.mjs",
  );
  check(
    !forbiddenExternalAccessPattern.test(configurator) &&
      !configurator.includes("process.env") &&
      !configurator.includes("readFile") &&
      !configurator.includes('"secret", "set"') &&
      !configurator.includes("desktop-release-signing") &&
      !configurator.includes("secret-input-template.env") &&
      !configurator.includes("--repo") &&
      !configurator.includes("--verify-only") &&
      !forbiddenSigningCredentialPattern.test(configurator),
    "Desktop configurator is template-only and contains no GitHub mutation or credential-input implementation",
    "scripts/configure-desktop-release-secrets.mjs",
  );
  check(
    !diagnostics.includes("desktop-release-signing") &&
      !diagnostics.includes("release:desktop:configure-secrets") &&
      !diagnostics.includes("release:desktop:evidence-workflow") &&
      !forbiddenSigningCredentialPattern.test(diagnostics),
    "Desktop diagnostics report the disabled boundary without requiring repository signing credentials",
    "scripts/diagnose-desktop-release-evidence.mjs",
  );
}

function checkDocumentationContract() {
  const statusDocs = [
    "docs/desktop-distribution.md",
    "docs/release-checklist.md",
  ];
  for (const relativePath of statusDocs) {
    const text = readRequiredText(relativePath);
    const normalized = text.toLowerCase().replace(/\s+/g, " ");
    for (const marker of documentationStatusMarkers) {
      check(
        normalized.includes(marker.toLowerCase()),
        relativePath + " documents current automation status '" + marker + "'",
        relativePath,
      );
    }
    check(
      text.includes(unsignedArtifactPrefix),
      relativePath + " documents the unsigned artifact prefix",
      relativePath,
    );
  }

  const offlineDocExpectations = [
    [
      "docs/desktop-distribution.md",
      [
        workflowName,
        workflowFileName,
        offlineArtifactName,
        offlineFormalJobName,
        handoffReportPath,
        offlineTemplatePath,
        releaseEvidenceSourcePath,
        releaseEvidenceChecksumPath,
        "externally managed isolated signer",
        "Never source",
        "does not provide a runnable signing, credential, or workflow chain",
      ],
    ],
    [
      "docs/release-checklist.md",
      [
        offlineArtifactName,
        offlineFormalJobName,
        handoffReportPath,
        releaseEvidenceSourcePath,
        releaseEvidenceChecksumPath,
      ],
    ],
    [
      "docs/repository-release-handoff.md",
      [handoffReportPath, releaseEvidenceSourcePath],
    ],
  ];

  for (const [relativePath, snippets] of offlineDocExpectations) {
    const text = readRequiredText(relativePath);
    for (const snippet of snippets) {
      check(
        text.includes(snippet),
        relativePath + " retains offline handoff marker '" + snippet + "'",
        relativePath,
      );
    }
  }

  const desktopDistribution = readRequiredText("docs/desktop-distribution.md");
  check(
    !desktopDistribution.includes("desktop-release-signing") &&
      !desktopDistribution.includes("release:desktop:configure-secrets") &&
      !desktopDistribution.includes("release:desktop:evidence-workflow") &&
      !/ATLASTERM_(?:WINDOWS|APPLE|KEYCHAIN)_[A-Z0-9_]+/.test(
        desktopDistribution,
      ),
    "Desktop distribution guide contains no repository signing environment, credential inventory, or runnable signing command",
    "docs/desktop-distribution.md",
  );
}

function readRequiredText(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    check(false, relativePath + " exists");
    return "";
  }
  return readFileSync(path, "utf8").replace(/^\uFEFF/, "");
}

function check(ok, label, detail = "") {
  checks.push({ detail, label, ok: Boolean(ok) });
}

function readCliValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(name + " requires a value.");
  }
  return value;
}

function fail(message) {
  console.error(basename(import.meta.url) + ": " + message);
  process.exit(1);
}
