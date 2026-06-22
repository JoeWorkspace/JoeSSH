import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const root = resolve(readCliValue("--root") ?? resolve(import.meta.dirname, ".."));
const workflowFile = ".github/workflows/desktop-release-artifacts.yml";
const workflowName = "Desktop Release Artifacts";
const workflowFileName = "desktop-release-artifacts.yml";
const formalEvidenceJobName = "Package Formal Desktop Evidence";
const artifactName = "desktop-release-evidence";
const handoffReportPath = "reports/handoff/desktop/formal-evidence-unblock-report.json";
const releaseEvidenceSourcePath = "reports/release/desktop/release-evidence-source.json";
const releaseEvidenceChecksumPath = "reports/release/desktop/release-evidence-SHA256SUMS.txt";
const requiredSecrets = [
  "ATLASTERM_WINDOWS_CERTIFICATE",
  "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD",
  "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
  "ATLASTERM_WINDOWS_TIMESTAMP_URL",
  "ATLASTERM_APPLE_CERTIFICATE",
  "ATLASTERM_APPLE_CERTIFICATE_PASSWORD",
  "ATLASTERM_APPLE_ID",
  "ATLASTERM_APPLE_PASSWORD",
  "ATLASTERM_APPLE_TEAM_ID",
  "ATLASTERM_KEYCHAIN_PASSWORD",
];
const checks = [];

checkWorkflowContract();
checkScriptContract();
checkDocumentationContract();

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}${check.detail ? ` - ${check.detail}` : ""}`);
}

if (failures.length > 0) {
  console.error(`Desktop release evidence parity failed with ${failures.length} issue(s).`);
  process.exit(1);
}

console.log("Desktop release evidence parity checks passed.");

function checkWorkflowContract() {
  const workflow = readRequiredText(workflowFile);
  check(workflow.includes(`name: ${workflowName}`), "Desktop release workflow name is stable", workflowFile);
  check(workflow.includes("formal_evidence"), "Desktop release workflow exposes formal_evidence dispatch input", workflowFile);
  check(workflow.includes(formalEvidenceJobName), "Desktop release workflow keeps the formal evidence job name stable", workflowFile);
  check(workflow.includes(`name: ${artifactName}`), "Desktop release workflow uploads the expected formal evidence artifact", workflowFile);
  for (const secret of requiredSecrets) {
    check(
      workflow.includes(`secrets.${secret}`),
      `Desktop release workflow references GitHub secret ${secret}`,
      workflowFile,
    );
  }
}

function checkScriptContract() {
  const scriptExpectations = [
    [
      "scripts/desktop-release-evidence-preflight.mjs",
      [
        workflowFileName,
        "formal_evidence=true",
        "workflowRunArgs",
        "must be published to origin",
        ...requiredSecrets,
      ],
    ],
    [
      "scripts/configure-desktop-release-secrets.mjs",
      [
        "reports/handoff/desktop/secret-input-template.env",
        "desktop-release-evidence-preflight.mjs",
        ...requiredSecrets,
      ],
    ],
    [
      "scripts/diagnose-desktop-release-evidence.mjs",
      [
        workflowFileName,
        handoffReportPath,
        "release-remote-ref",
        "desktop-signing-secrets",
        "github-ci",
        ...requiredSecrets,
      ],
    ],
    [
      "scripts/download-desktop-release-evidence.mjs",
      [
        artifactName,
        formalEvidenceJobName,
        releaseEvidenceSourcePath,
        "verify-desktop-release-evidence.mjs",
        "--require-source",
      ],
    ],
    [
      "scripts/verify-desktop-release-evidence.mjs",
      [
        artifactName,
        formalEvidenceJobName,
        releaseEvidenceSourcePath,
        releaseEvidenceChecksumPath,
      ],
    ],
  ];

  for (const [relativePath, snippets] of scriptExpectations) {
    const text = readRequiredText(relativePath);
    for (const snippet of snippets) {
      check(text.includes(snippet), `${relativePath} contains '${snippet}'`, relativePath);
    }
  }
}

function checkDocumentationContract() {
  const docExpectations = [
    [
      "docs/desktop-distribution.md",
      [
        workflowName,
        workflowFileName,
        artifactName,
        formalEvidenceJobName,
        handoffReportPath,
        releaseEvidenceSourcePath,
        releaseEvidenceChecksumPath,
        ...requiredSecrets,
      ],
    ],
    [
      "docs/release-checklist.md",
      [
        artifactName,
        formalEvidenceJobName,
        handoffReportPath,
        releaseEvidenceSourcePath,
        releaseEvidenceChecksumPath,
      ],
    ],
    ["docs/repository-release-handoff.md", [handoffReportPath, releaseEvidenceSourcePath]],
  ];

  for (const [relativePath, snippets] of docExpectations) {
    const text = readRequiredText(relativePath);
    for (const snippet of snippets) {
      check(text.includes(snippet), `${relativePath} documents '${snippet}'`, relativePath);
    }
  }
}

function readRequiredText(relativePath) {
  const path = resolve(root, relativePath);
  if (!existsSync(path)) {
    check(false, `${relativePath} exists`);
    return "";
  }
  return readFileSync(path, "utf8");
}

function check(ok, label, detail = "") {
  checks.push({ detail, label, ok });
}

function readCliValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} requires a value.`);
  }
  return value;
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
