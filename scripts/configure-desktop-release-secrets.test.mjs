import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(
  new URL("./configure-desktop-release-secrets.mjs", import.meta.url),
);
const DISABLED_MARKER = "FORMAL_SIGNING_DISABLED";

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-signing-disabled-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const fakeGhPath = join(root, "fake-gh.mjs");
  const ghLogPath = join(root, "fake-gh.log");
  writeFileSync(
    fakeGhPath,
    `import { appendFileSync } from "node:fs";
appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(97);
`,
  );

  return {
    env: {
      ...process.env,
      ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
      ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
      ATLASTERM_WINDOWS_CERTIFICATE: "DO_NOT_READ_CERTIFICATE_SENTINEL",
      FAKE_GH_LOG: ghLogPath,
    },
    ghLogPath,
    root,
  };
}

function run(fixture, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    env: fixture.env,
  });
}

function assertNoGhCalls(fixture) {
  const log = existsSync(fixture.ghLogPath)
    ? readFileSync(fixture.ghLogPath, "utf8")
    : "";
  assert.equal(log, "");
  assert.doesNotMatch(log, /secret\s+set|environment|--env/i);
}

test("legacy configuration and verification paths fail closed before any GitHub call", (t) => {
  const fixture = createFixture(t);
  const legacyInvocations = [
    [],
    ["--repo", "JoeWorkspace/JoeSSH"],
    ["--verify-only"],
    ["--dry-run"],
    ["--skip-verify"],
    ["--repo=JoeWorkspace/JoeSSH", "--verify-only"],
  ];

  for (const args of legacyInvocations) {
    const result = run(fixture, args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, new RegExp(DISABLED_MARKER));
    assert.doesNotMatch(result.stdout + result.stderr, /DO_NOT_READ/);
  }

  assertNoGhCalls(fixture);
});

test("template mode creates only a local gitignored non-secret handoff template", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--root", fixture.root, "--write-template"]);
  const templatePath = join(
    fixture.root,
    "reports",
    "handoff",
    "desktop",
    "external-signer-input-template.env",
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(templatePath), true);
  const template = readFileSync(templatePath, "utf8");
  assert.match(template, /OFFLINE, LOCAL, GITIGNORED, AND NON-SECRET ONLY/);
  assert.match(template, /FORMAL_SIGNING_STATUS=FORMAL_SIGNING_DISABLED/);
  assert.match(template, /Never source this file into a shell/);
  assert.match(
    template,
    /Never import, upload, copy, or pass this file to GitHub/,
  );
  assert.match(template, /approved externally managed isolated signer/);
  assert.match(template, /UNSIGNED_ARTIFACT_SHA256=/);
  assert.doesNotMatch(template, /DO_NOT_READ_CERTIFICATE_SENTINEL/);
  assert.doesNotMatch(
    template,
    /ATLASTERM_(?:WINDOWS|APPLE|KEYCHAIN)_[A-Z0-9_]+/,
  );
  assert.doesNotMatch(template, /certificate\s*password|private key\s*=/i);
  assertNoGhCalls(fixture);
});

test("template mode permits a custom .env only below the Desktop handoff directory", (t) => {
  const fixture = createFixture(t);
  const safePath = "reports/handoff/desktop/reviewer/non-secret.env";
  const result = run(fixture, [
    "--root",
    fixture.root,
    "--write-template",
    safePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(fixture.root, safePath)), true);

  for (const unsafePath of [
    "../outside.env",
    "reports/handoff/other/template.env",
    "reports/handoff/desktop/template.txt",
  ]) {
    const rejected = run(fixture, [
      "--root",
      fixture.root,
      "--write-template",
      unsafePath,
    ]);
    assert.equal(rejected.status, 1, unsafePath);
    assert.match(rejected.stderr, new RegExp(DISABLED_MARKER));
  }
  assertNoGhCalls(fixture);
});

test("template mode refuses to overwrite an existing local file", (t) => {
  const fixture = createFixture(t);
  const relativePath = "reports/handoff/desktop/existing.env";
  const first = run(fixture, [
    "--root",
    fixture.root,
    "--write-template",
    relativePath,
  ]);
  assert.equal(first.status, 0, first.stderr);
  const fullPath = join(fixture.root, relativePath);
  const original = readFileSync(fullPath, "utf8");

  const second = run(fixture, [
    "--root",
    fixture.root,
    "--write-template",
    relativePath,
  ]);
  assert.equal(second.status, 1);
  assert.match(second.stderr, new RegExp(DISABLED_MARKER));
  assert.match(second.stderr, /Refusing to overwrite/);
  assert.equal(readFileSync(fullPath, "utf8"), original);
  assertNoGhCalls(fixture);
});

test("legacy options cannot be smuggled into template mode", (t) => {
  const fixture = createFixture(t);
  const legacyOptions = [
    ["--write-template", "--repo", "JoeWorkspace/JoeSSH"],
    ["--write-template", "--verify-only"],
    ["--write-template", "--dry-run"],
    ["--write-template", "--skip-verify"],
  ];

  for (const args of legacyOptions) {
    const result = run(fixture, ["--root", fixture.root, ...args]);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, new RegExp(DISABLED_MARKER));
  }
  assert.equal(
    existsSync(join(fixture.root, "reports", "handoff", "desktop")),
    false,
  );
  assertNoGhCalls(fixture);
});

test("help documents the template-only disabled boundary without invoking GitHub", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /formal signing automation is disabled/i);
  assert.match(result.stdout, /--write-template/);
  assert.match(result.stdout, /Never import or upload/);
  assertNoGhCalls(fixture);
});
