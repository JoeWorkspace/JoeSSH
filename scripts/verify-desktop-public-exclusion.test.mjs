import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./verify-desktop-public-exclusion.mjs", import.meta.url));

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "desktop-public-exclusion-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  return { env: createFakeGit(root, options), root };
}

function createFakeGit(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    head: "abc123",
    repository: "https://github.com/joessh/joessh.git",
    tag: "abc123",
    ...options,
  };
  const fakeGitPath = join(binDir, "git.mjs");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
if (key === "rev-parse --is-inside-work-tree") {
  console.log("true");
  process.exit(0);
}
if (key === "status --porcelain=v1 --untracked-files=all -- . :(exclude)reports/release") {
  if (state.dirtyStatus) console.log(state.dirtyStatus);
  process.exit(0);
}
if (key === "rev-parse HEAD") {
  console.log(state.head);
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.1^{}") {
  console.log(state.tag);
  process.exit(0);
}
if (key === "fsck --strict") {
  process.exit(0);
}
if (key === "remote get-url origin") {
  console.log(state.repository);
  process.exit(0);
}
console.error("unexpected git args: " + key);
process.exit(2);
`,
    "utf8",
  );
  return {
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
  };
}

function runScript(root, env, args = []) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("writes and verifies Desktop public exclusion evidence", (t) => {
  const { env, root } = createFixture(t);
  const generated = runScript(root, env, ["--write"]);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  assert.match(generated.stdout, /desktop-exclusion\.json/);

  const evidence = JSON.parse(readFile(root, "reports/release/desktop-exclusion.json"));
  assert.equal(evidence.artifact, "desktop-public-exclusion");
  assert.equal(evidence.releaseProfile, "web-sync-only");
  assert.equal(evidence.publicDesktopDownloads, false);
  assert.equal(evidence.source.gitCommit, "abc123");
  assert.match(
    readFile(root, "reports/release/desktop-exclusion-SHA256SUMS.txt"),
    /^[a-f0-9]{64} {2}reports\/release\/desktop-exclusion\.json\n$/,
  );

  const verified = runScript(root, env);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
  assert.match(verified.stdout, /Desktop public exclusion verified/);
});

test("rejects staged Desktop release artifacts before writing exclusion evidence", (t) => {
  const { env, root } = createFixture(t);
  writeFile(root, "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe", "desktop installer");

  const generated = runScript(root, env, ["--write"]);

  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /No public Desktop downloads are allowed/);
  assert.match(generated.stderr, /JoeSSH_0\.1\.0-beta\.1_x64-setup\.exe/);
});

test("rejects stale Desktop public exclusion checksum evidence", (t) => {
  const { env, root } = createFixture(t);
  assert.equal(runScript(root, env, ["--write"]).status, 0);
  writeFile(root, "reports/release/desktop-exclusion.json", JSON.stringify({
    artifact: "desktop-public-exclusion",
    assertions: [
      "no public Desktop downloads are included in this release profile",
      "reports/release/desktop contains no Desktop release artifacts",
      "signed Desktop formal evidence remains required if Desktop downloads are published",
    ],
    desktopReleaseDir: "reports/release/desktop",
    evidenceVersion: 1,
    product: "JoeSSH",
    publicDesktopDownloads: false,
    releaseProfile: "web-sync-only",
    releaseTag: "v0.1.0-beta.1",
    source: {
      cleanTreeExcluding: "reports/release",
      gitCommit: "abc123",
      gitFsckStrict: true,
      releaseTagCommit: "abc123",
      repository: "https://github.com/joessh/joessh.git",
    },
    version: "0.1.0-beta.1",
  }, null, 2));

  const verified = runScript(root, env);

  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /checksum manifest hash mismatch/);
});

test("rejects exclusion evidence from a different commit", (t) => {
  const { env, root } = createFixture(t);
  const evidence = {
    artifact: "desktop-public-exclusion",
    assertions: [
      "no public Desktop downloads are included in this release profile",
      "reports/release/desktop contains no Desktop release artifacts",
      "signed Desktop formal evidence remains required if Desktop downloads are published",
    ],
    desktopReleaseDir: "reports/release/desktop",
    evidenceVersion: 1,
    generatedAt: "2026-06-24T00:00:00.000Z",
    product: "JoeSSH",
    publicDesktopDownloads: false,
    releaseProfile: "web-sync-only",
    releaseTag: "v0.1.0-beta.1",
    source: {
      cleanTreeExcluding: "reports/release",
      gitCommit: "deadbeef",
      gitFsckStrict: true,
      releaseTagCommit: "deadbeef",
      repository: "https://github.com/joessh/joessh.git",
    },
    version: "0.1.0-beta.1",
  };
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  writeFile(root, "reports/release/desktop-exclusion.json", text);
  writeFile(root, "reports/release/desktop-exclusion-SHA256SUMS.txt", `${sha256(text)}  reports/release/desktop-exclusion.json\n`);

  const verified = runScript(root, env);

  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /source\.gitCommit does not match current HEAD/);
});

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function readFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
