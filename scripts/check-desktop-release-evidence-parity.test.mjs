import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(
  new URL("./check-desktop-release-evidence-parity.mjs", import.meta.url),
);
const WORKFLOW = readFileSync(
  resolve(
    import.meta.dirname,
    "..",
    ".github/workflows/desktop-release-artifacts.yml",
  ),
  "utf8",
);
const STATUS_MARKERS = [
  "FORMAL_SIGNING_DISABLED",
  "unsigned staging",
  "Automated formal signing is paused",
  "isolated signing principal",
  "desktop-unsigned-bundle-",
];
const TEMPLATE_PATH =
  "reports/handoff/desktop/external-signer-input-template.env";

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-parity-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));

  const files = {
    "package.json": JSON.stringify({
      scripts: {
        "release:desktop:secret-template":
          "node scripts/configure-desktop-release-secrets.mjs --write-template",
      },
    }),
    ".github/workflows/desktop-release-artifacts.yml": WORKFLOW,
    "scripts/configure-desktop-release-secrets.mjs": [
      "FORMAL_SIGNING_DISABLED",
      TEMPLATE_PATH,
      "--write-template",
      "Never import, upload, copy, or pass this file to GitHub",
      "approved externally managed isolated signer",
      'flag: "wx"',
    ].join("\n"),
    "scripts/desktop-release-evidence-preflight.mjs": [
      "FORMAL_SIGNING_DISABLED",
      "approved externally managed isolated signer",
      "historical offline evidence verification tools do not form a runnable signing chain",
    ].join("\n"),
    "scripts/diagnose-desktop-release-evidence.mjs": [
      "desktop-release-artifacts.yml",
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "release-remote-ref",
      "desktop-formal-signing-disabled",
      "github-ci",
      "FORMAL_SIGNING_DISABLED",
      "approved externally managed isolated signer",
    ].join("\n"),
    "scripts/download-desktop-release-evidence.mjs": [
      "desktop-release-evidence",
      "Package Formal Desktop Evidence",
      "reports/release/desktop/release-evidence-source.json",
      "verify-desktop-release-evidence.mjs",
      "--require-source",
    ].join("\n"),
    "scripts/verify-desktop-release-evidence.mjs": [
      "desktop-release-evidence",
      "Package Formal Desktop Evidence",
      "reports/release/desktop/release-evidence-source.json",
      "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    ].join("\n"),
    "docs/desktop-distribution.md": createDistributionDoc(),
    "docs/release-checklist.md": createChecklistDoc(),
    "docs/repository-release-handoff.md": [
      "reports/handoff/desktop/formal-evidence-unblock-report.json",
      "reports/release/desktop/release-evidence-source.json",
    ].join("\n"),
    ...overrides,
  };

  for (const [relativePath, content] of Object.entries(files)) {
    writeFixtureFile(root, relativePath, `${content}\n`);
  }
  return root;
}

function createDistributionDoc() {
  return [
    ...STATUS_MARKERS,
    "Desktop Release Artifacts",
    "desktop-release-artifacts.yml",
    "desktop-release-evidence",
    "Package Formal Desktop Evidence",
    "reports/handoff/desktop/formal-evidence-unblock-report.json",
    TEMPLATE_PATH,
    "reports/release/desktop/release-evidence-source.json",
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    "externally managed isolated signer",
    "Never source",
    "does not provide a runnable signing, credential, or workflow chain",
  ].join("\n");
}

function createChecklistDoc() {
  return [
    ...STATUS_MARKERS,
    "desktop-release-evidence",
    "Package Formal Desktop Evidence",
    "reports/handoff/desktop/formal-evidence-unblock-report.json",
    "reports/release/desktop/release-evidence-source.json",
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  ].join("\n");
}

function writeFixtureFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runParity(root) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root], {
    encoding: "utf8",
  });
}

test("passes with disabled repository automation and retained historical evidence tooling", (t) => {
  const result = runParity(createFixture(t));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Desktop release evidence parity checks passed/);
});

test("fails when the formal-disabled workflow guard is deleted or weakened", (t) => {
  const candidates = [
    WORKFLOW.replace("FORMAL_SIGNING_DISABLED", "FORMAL_REQUEST_REJECTED"),
    WORKFLOW.replace(
      '"${FORMAL_EVIDENCE}" == "true"',
      '"${FORMAL_EVIDENCE}" == "false"',
    ),
  ];

  for (const candidate of candidates) {
    const result = runParity(
      createFixture(t, {
        ".github/workflows/desktop-release-artifacts.yml": candidate,
      }),
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL Desktop release workflow enforces the unsigned staging security contract/,
    );
  }
});

test("fails when workflow secrets or a formal artifact are reintroduced", (t) => {
  const secretExpression = "$" + "{{ secrets.REINTRODUCED_SIGNING_VALUE }}";
  const secretWorkflow = WORKFLOW.replace(
    "          ATLASTERM_DESKTOP_RELEASE_BUNDLES:",
    `          RELEASE_SECRET: ${secretExpression}\n          ATLASTERM_DESKTOP_RELEASE_BUNDLES:`,
  );
  const formalArtifact = WORKFLOW.replace(
    "desktop-unsigned-bundle-",
    "desktop-release-evidence-",
  );

  const secretResult = runParity(
    createFixture(t, {
      ".github/workflows/desktop-release-artifacts.yml": secretWorkflow,
    }),
  );
  const artifactResult = runParity(
    createFixture(t, {
      ".github/workflows/desktop-release-artifacts.yml": formalArtifact,
    }),
  );

  assert.equal(secretResult.status, 1);
  assert.match(
    secretResult.stdout,
    /FAIL Desktop release workflow contains no formal artifact, signing secret/,
  );
  assert.equal(artifactResult.status, 1);
  assert.match(
    artifactResult.stdout,
    /FAIL Desktop release workflow rejects formal automation and uploads only unsigned bundles/,
  );
});

test("fails when release docs no longer describe the paused automation boundary", (t) => {
  const drifted = createChecklistDoc().replace(
    "Automated formal signing is paused",
    "Automated formal signing is available",
  );
  const result = runParity(
    createFixture(t, { "docs/release-checklist.md": drifted }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL docs\/release-checklist\.md documents current automation status 'automated formal signing is paused'/i,
  );
});

test("fails when the compatibility preflight loses its disabled boundary", (t) => {
  const result = runParity(
    createFixture(t, {
      "scripts/desktop-release-evidence-preflight.mjs":
        "approved externally managed isolated signer\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL scripts\/desktop-release-evidence-preflight\.mjs retains offline evidence marker 'FORMAL_SIGNING_DISABLED'/,
  );
});

test("fails when a GitHub signing mutation path is reintroduced", (t) => {
  const unsafeConfigurator = [
    "FORMAL_SIGNING_DISABLED",
    TEMPLATE_PATH,
    "--write-template",
    "Never import, upload, copy, or pass this file to GitHub",
    "approved externally managed isolated signer",
    'flag: "wx"',
    "spawnSync",
    '"secret", "set"',
    "desktop-release-signing",
  ].join("\n");
  const result = runParity(
    createFixture(t, {
      "scripts/configure-desktop-release-secrets.mjs": unsafeConfigurator,
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop configurator is template-only and contains no GitHub mutation or credential-input implementation/,
  );
});

test("fails when package scripts re-expose a retired signing command", (t) => {
  const result = runParity(
    createFixture(t, {
      "package.json": JSON.stringify({
        scripts: {
          "release:desktop:configure-secrets":
            "node scripts/configure-desktop-release-secrets.mjs",
          "release:desktop:secret-template":
            "node scripts/configure-desktop-release-secrets.mjs --write-template",
        },
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL package exposes no Desktop signing mutation, preflight, or dispatch command/,
  );
});

test("fails when docs advertise a repository signing environment or runnable command", (t) => {
  const drifted = `${createDistributionDoc()}
desktop-release-signing
release:desktop:configure-secrets
`;
  const result = runParity(
    createFixture(t, { "docs/desktop-distribution.md": drifted }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop distribution guide contains no repository signing environment, credential inventory, or runnable signing command/,
  );
});
