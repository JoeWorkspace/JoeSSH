import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./desktop-release-evidence-preflight.mjs", import.meta.url));
const REQUIRED_SECRETS = [
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

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-evidence-preflight-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  return {
    env: createFakeGitHubCli(root, options),
    root,
  };
}

function createFakeGitHubCli(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    authFails: false,
    secrets: REQUIRED_SECRETS,
    workflowMissing: false,
    ...options,
  };
  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join("\\0");
if (key === "--version") {
  console.log("gh version 2.70.0");
  process.exit(0);
}
if (key === "auth\\0status") {
  if (state.authFails) {
    console.error("not logged in");
    process.exit(1);
  }
  console.log("Logged in");
  process.exit(0);
}
if (key === "api\\0repos/JoeWorkspace/JoeSSH/actions/secrets\\0--jq\\0.secrets[].name") {
  for (const name of state.secrets) {
    console.log(name);
  }
  process.exit(0);
}
if (key === "workflow\\0view\\0desktop-release-artifacts.yml\\0--repo\\0JoeWorkspace/JoeSSH") {
  if (state.workflowMissing) {
    console.error("workflow not found");
    process.exit(1);
  }
  console.log("Desktop Release Artifacts");
  process.exit(0);
}
if (key === "workflow\\0run\\0desktop-release-artifacts.yml\\0--repo\\0JoeWorkspace/JoeSSH\\0--ref\\0v0.1.0-beta.1\\0-f\\0formal_evidence=true\\0-f\\0retention_days=14") {
  console.log("workflow dispatched");
  process.exit(0);
}
console.error("unexpected gh args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
  };
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runPreflight(root, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, "--repo", "JoeWorkspace/JoeSSH", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("passes when all formal Desktop evidence secrets and workflow are available", (t) => {
  const { env, root } = createFixture(t);
  const result = runPreflight(root, [], env);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Verified 10 required GitHub Actions secret name\(s\)/);
  assert.match(result.stdout, /Verified GitHub Actions workflow desktop-release-artifacts\.yml/);
  assert.match(result.stdout, /Desktop formal evidence preflight passed/);
});

test("prints the workflow dispatch command during dry run", (t) => {
  const { env, root } = createFixture(t);
  const result = runPreflight(root, ["--dispatch", "--dry-run", "--ref", "main", "--retention-days", "30"], env);

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /gh workflow run desktop-release-artifacts\.yml --repo JoeWorkspace\/JoeSSH --ref main -f formal_evidence=true -f retention_days=30/,
  );
});

test("dispatches the formal evidence workflow after prerequisites pass", (t) => {
  const { env, root } = createFixture(t);
  const result = runPreflight(root, ["--dispatch"], env);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /workflow dispatched/);
  assert.match(result.stdout, /Dispatched Desktop formal evidence workflow desktop-release-artifacts\.yml/);
});

test("fails with grouped missing secret names", (t) => {
  const secrets = REQUIRED_SECRETS.filter(
    (name) => !["ATLASTERM_APPLE_PASSWORD", "ATLASTERM_APPLE_TEAM_ID"].includes(name),
  );
  const { env, root } = createFixture(t, { secrets });
  const result = runPreflight(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing GitHub Actions secret\(s\) required for formal Desktop evidence/);
  assert.match(result.stderr, /macOS signing\/notarization: ATLASTERM_APPLE_PASSWORD, ATLASTERM_APPLE_TEAM_ID/);
});

test("fails when GitHub CLI authentication is unavailable", (t) => {
  const { env, root } = createFixture(t, { authFails: true });
  const result = runPreflight(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub CLI must be authenticated/);
  assert.match(result.stderr, /not logged in/);
});

test("rejects repositories outside owner/name format", (t) => {
  const { env, root } = createFixture(t);
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, "--repo", "JoeWorkspace"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--repo must use owner\/name format/);
});
