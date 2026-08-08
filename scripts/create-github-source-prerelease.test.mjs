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
import { join } from "node:path";
import test from "node:test";

const scriptPath = join(
  import.meta.dirname,
  "create-github-source-prerelease.mjs",
);
const repositoryPackageJson = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "package.json"), "utf8"),
);
const version = repositoryPackageJson.version;
const tag = `v${version}`;

test("repository release notes satisfy the source prerelease boundary contract", (t) => {
  const releaseNotes = readFileSync(
    join(import.meta.dirname, "..", "docs", "release-notes", `${version}.md`),
    "utf8",
  );
  const fixture = createFixture(t, { releaseNotes });
  const result = runRelease(fixture, ["--dry-run"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /dry run passed/);
  assert.equal(readState(fixture).release, null);
});

test("accepts required release-note phrases split across line wrapping", (t) => {
  const fixture = createFixture(t, {
    releaseNotes: [
      `# JoeSSH ${version} Source Preview`,
      "",
      "This source-only GitHub",
      "prerelease provides automatically generated",
      "source archives.",
      "It does not include Desktop",
      "installers and has zero",
      "uploaded assets.",
      "There is no",
      "WCAG or EAA conformance",
      "claim.",
      "",
    ].join("\n"),
  });
  const result = runRelease(fixture, ["--dry-run"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /dry run passed/);
  assert.equal(readState(fixture).release, null);
});

test("source prerelease dry run proves the zero-asset candidate", (t) => {
  const fixture = createFixture(t);
  const result = runRelease(fixture, ["--dry-run"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /dry run passed/);
  assert.match(result.stdout, /zero uploaded assets/);
  assert.equal(readState(fixture).release, null);
});

test("publishes a prerelease with no uploaded assets", (t) => {
  const fixture = createFixture(t);
  const result = runRelease(fixture);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout.includes(`Published ${tag}`), true);
  const release = readState(fixture).release;
  assert.equal(release.draft, false);
  assert.equal(release.prerelease, true);
  assert.deepEqual(release.assets, []);
  assert.equal(release.tag_name, tag);
  const invocations = readInvocations(fixture);
  assert.equal(
    invocations.some(
      ({ args, mode }) =>
        mode === "gh" && args.includes("POST") && args.includes("--input"),
    ),
    true,
  );
  assert.equal(
    invocations.some(
      ({ args, mode }) =>
        mode === "gh" && args.includes("PATCH") && args.includes("--input"),
    ),
    true,
  );
  assert.equal(
    invocations.filter(
      ({ args, mode }) =>
        mode === "gh" &&
        args.includes("repos/JoeWorkspace/JoeSSH/branches/main/protection"),
    ).length,
    2,
  );
});

test("rejects publication without explicit billing confirmation", (t) => {
  const fixture = createFixture(t);
  const result = runRelease(fixture, [], { confirmBillingReady: false });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub release controls must pass/);
  assert.match(result.stderr, /billing-spending-limit/);
  assert.equal(readState(fixture).release, null);
  assert.equal(
    readInvocations(fixture).some(
      ({ args, mode }) => mode === "gh" && args.includes("POST"),
    ),
    false,
  );
});

test("rejects any staged release payload before GitHub mutation", (t) => {
  const fixture = createFixture(t);
  writeFixtureFile(
    fixture.root,
    "reports/release/sync/stale-beta12.exe",
    "stale",
  );

  const result = runRelease(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires zero staged release files/);
  assert.match(result.stderr, /stale-beta12\.exe/);
  assert.equal(readState(fixture).release, null);
});

test("rejects a remote tag that is not the reviewed HEAD", (t) => {
  const fixture = createFixture(t, { remoteCommit: "def456" });
  const result = runRelease(fixture, ["--dry-run"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Remote source prerelease tag/);
  assert.match(result.stderr, /expected abc123/);
});

test("rejects a lightweight source prerelease tag", (t) => {
  const fixture = createFixture(t, { lightweightTag: true });
  const result = runRelease(fixture, ["--dry-run"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be an annotated Git tag/);
});

test("deletes the exact release when zero-asset verification fails", (t) => {
  const fixture = createFixture(t, { publishWithAsset: true });
  const result = runRelease(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /uploaded assets must be an empty array/);
  assert.match(result.stderr, /was deleted and its absence was confirmed/);
  assert.equal(readState(fixture).release, null);
  const deletes = readInvocations(fixture).filter(
    ({ args, mode }) => mode === "gh" && args.includes("DELETE"),
  );
  assert.equal(deletes.length, 1);
  assert.equal(
    deletes[0].args.includes("repos/JoeWorkspace/JoeSSH/releases/71"),
    true,
  );
});

test("deletes the exact release if protected main moves during publication", (t) => {
  const fixture = createFixture(t, { moveMainAfterPublish: true });
  const result = runRelease(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must exactly equal protected main commit/);
  assert.match(result.stderr, /was deleted and its absence was confirmed/);
  assert.equal(readState(fixture).release, null);
});

test("verifies an already-published source prerelease", (t) => {
  const fixture = createFixture(t, { published: true });
  const result = runRelease(fixture, ["--verify-published"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verified published source prerelease/);
  assert.match(result.stdout, /zero uploaded assets/);
});

test("published verification rejects attached binaries", (t) => {
  const fixture = createFixture(t, {
    published: true,
    publishedAssets: [{ id: 9, name: "unsigned.exe" }],
  });
  const result = runRelease(fixture, ["--verify-published"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /uploaded assets must be an empty array/);
});

function createFixture(t, settings = {}) {
  const root = mkdtempSync(join(tmpdir(), "joessh-source-prerelease-test-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const statePath = join(root, "fake-state.json");
  const logPath = join(root, "fake-invocations.jsonl");
  const fakeCommandPath = join(root, "fake-command.mjs");
  writeFixtureFile(
    root,
    "package.json",
    `${JSON.stringify({ name: "atlasterm", version }, null, 2)}\n`,
  );
  writeFixtureFile(
    root,
    `docs/release-notes/${version}.md`,
    settings.releaseNotes ??
      [
        `# JoeSSH ${version} Source Preview`,
        "",
        "This source-only GitHub prerelease provides automatically generated source archives.",
        "It does not include Desktop installers and has zero uploaded assets.",
        "There is no WCAG or EAA conformance claim.",
        "",
      ].join("\n"),
  );
  mkdirSync(join(root, "reports", "release"), { recursive: true });
  const initialRelease = settings.published
    ? releaseFixture({
        assets: settings.publishedAssets ?? [],
        body: readFileSync(
          join(root, "docs", "release-notes", `${version}.md`),
          "utf8",
        ).trimEnd(),
        draft: false,
      })
    : null;
  writeFileSync(
    statePath,
    `${JSON.stringify({ release: initialRelease, settings, version })}\n`,
  );
  writeFileSync(fakeCommandPath, fakeCommandSource(), "utf8");
  return { fakeCommandPath, logPath, root, statePath };
}

function runRelease(fixture, args = [], { confirmBillingReady = true } = {}) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      "--root",
      fixture.root,
      ...(confirmBillingReady ? ["--confirm-billing-ready"] : []),
      ...args,
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        ...process.env,
        ATLASTERM_SOURCE_PRERELEASE_GH_ARGS: JSON.stringify([
          fixture.fakeCommandPath,
          "gh",
        ]),
        ATLASTERM_SOURCE_PRERELEASE_GH_COMMAND: process.execPath,
        ATLASTERM_SOURCE_PRERELEASE_GIT_ARGS: JSON.stringify([
          fixture.fakeCommandPath,
          "git",
        ]),
        ATLASTERM_SOURCE_PRERELEASE_GIT_COMMAND: process.execPath,
        SOURCE_RELEASE_FAKE_LOG: fixture.logPath,
        SOURCE_RELEASE_FAKE_STATE: fixture.statePath,
      },
    },
  );
}

function readState(fixture) {
  return JSON.parse(readFileSync(fixture.statePath, "utf8"));
}

function readInvocations(fixture) {
  try {
    return readFileSync(fixture.logPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function writeFixtureFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function releaseFixture({ assets = [], body, draft }) {
  return {
    assets,
    body,
    draft,
    html_url: `https://github.com/JoeWorkspace/JoeSSH/releases/tag/${tag}`,
    id: 71,
    name: `JoeSSH ${version} Source Preview`,
    prerelease: true,
    tag_name: tag,
    tarball_url: `https://api.github.test/tarball/${tag}`,
    zipball_url: `https://api.github.test/zipball/${tag}`,
  };
}

function fakeCommandSource() {
  return String.raw`
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const [mode, ...args] = process.argv.slice(2);
const statePath = process.env.SOURCE_RELEASE_FAKE_STATE;
const logPath = process.env.SOURCE_RELEASE_FAKE_LOG;
const input = args.includes("--input") ? readFileSync(0, "utf8") : "";
appendFileSync(logPath, JSON.stringify({ args, input, mode }) + "\n");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const settings = state.settings ?? {};
const commit = "abc123";
const version = state.version;
const tag = "v" + version;

function save() {
  writeFileSync(statePath, JSON.stringify(state) + "\n");
}

function json(value) {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}

function notFound() {
  process.stderr.write("HTTP 404: Not Found\n");
  process.exit(1);
}

function release(payload, draft) {
  return {
    assets: draft ? [] : settings.publishWithAsset ? [{ id: 9, name: "unsigned.exe" }] : [],
    body: payload.body,
    draft,
    html_url: "https://github.com/JoeWorkspace/JoeSSH/releases/tag/" + tag,
    id: 71,
    name: payload.name,
    prerelease: payload.prerelease,
    tag_name: payload.tag_name,
    tarball_url: "https://api.github.test/tarball/" + tag,
    zipball_url: "https://api.github.test/zipball/" + tag,
  };
}

if (mode === "git") {
  const key = args.join("\0");
  if (key === "rev-parse\0--is-inside-work-tree") process.stdout.write("true\n");
  else if (key.startsWith("status\0--porcelain=v1")) process.stdout.write(settings.dirty ?? "");
  else if (key === "rev-parse\0HEAD") process.stdout.write(commit + "\n");
  else if (key === "rev-parse\0--verify\0" + tag + "^{}") process.stdout.write(commit + "\n");
  else if (key === "cat-file\0-t\0" + tag) process.stdout.write((settings.lightweightTag ? "commit" : "tag") + "\n");
  else if (key === "fsck\0--strict") process.stdout.write("");
  else if (key === "remote\0get-url\0origin") process.stdout.write("https://github.com/JoeWorkspace/JoeSSH.git\n");
  else {
    process.stderr.write("unexpected git args: " + JSON.stringify(args));
    process.exit(2);
  }
  process.exit(0);
}

if (mode !== "gh") {
  process.stderr.write("unexpected mode");
  process.exit(2);
}
if (args.join("\0") === "--version") {
  process.stdout.write("gh version 2.test\n");
  process.exit(0);
}
if (args.join("\0") === "auth\0status") {
  process.stdout.write("authenticated\n");
  process.exit(0);
}
if (args[0] !== "api") {
  process.stderr.write("unexpected gh args: " + JSON.stringify(args));
  process.exit(2);
}
const methodIndex = args.indexOf("--method");
const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
const endpoint = args.find((arg) => arg.startsWith("repos/"));

if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/git/ref/tags/" + tag) {
  json({ object: { sha: "abc999", type: "tag" } });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/git/tags/abc999") {
  json({ object: { sha: settings.remoteCommit ?? commit, type: "commit" } });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH") {
  json({
    default_branch: "main",
    id: 123456,
    owner: { type: "Organization" },
    private: false,
    security_and_analysis: {
      dependabot_security_updates: { status: "enabled" },
      secret_scanning: { status: "enabled" },
      secret_scanning_push_protection: { status: "enabled" },
    },
    visibility: "public",
  });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/branches/main") {
  json({ commit: { sha: settings.mainCommit ?? commit }, name: "main", protected: true });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/branches/main/protection") {
  json({
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    required_linear_history: { enabled: true },
    required_pull_request_reviews: {
      bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
      require_last_push_approval: false,
      required_approving_review_count: 0,
    },
    required_status_checks: {
      checks: [{ app_id: 15368, context: "Public Release Readiness" }],
      contexts: ["Public Release Readiness"],
      strict: true,
    },
  });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/private-vulnerability-reporting") {
  json({ enabled: true });
}
if (
  method === "GET" &&
  endpoint?.startsWith("repos/JoeWorkspace/JoeSSH/environments/") &&
  endpoint.endsWith("/secrets?per_page=100")
) {
  json([{ secrets: [], total_count: 0 }]);
}
if (method === "GET" && endpoint?.startsWith("repos/JoeWorkspace/JoeSSH/environments/")) {
  const name = decodeURIComponent(endpoint.split("/").at(-1));
  json({
    can_admins_bypass: false,
    deployment_branch_policy: {
      custom_branch_policies: false,
      protected_branches: true,
    },
    name,
    protection_rules: [{
      prevent_self_review: false,
      reviewers: [{ reviewer: { id: 1, login: "release-reviewer" }, type: "User" }],
      type: "required_reviewers",
    }],
  });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/actions/secrets?per_page=100") {
  json([{ secrets: [], total_count: 0 }]);
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/actions/artifacts?per_page=100") {
  json([{ artifacts: [], total_count: 0 }]);
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/actions/cache/usage") {
  json({ active_caches_count: 0, active_caches_size_in_bytes: 0 });
}
if (method === "GET" && endpoint?.startsWith("repos/JoeWorkspace/JoeSSH/commits/" + commit + "/check-runs?")) {
  json({
    check_runs: [{
      app: { id: 15368 },
      conclusion: "success",
      head_sha: commit,
      id: 41,
      name: "Public Release Readiness",
      started_at: "2026-08-09T00:00:00Z",
      status: "completed",
    }],
    total_count: 1,
  });
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/releases/tags/" + tag) {
  if (state.release) json(state.release);
  notFound();
}
if (method === "GET" && endpoint === "repos/JoeWorkspace/JoeSSH/releases/71") {
  if (state.release) json(state.release);
  notFound();
}
if (method === "POST" && endpoint === "repos/JoeWorkspace/JoeSSH/releases") {
  const payload = JSON.parse(input);
  state.release = release(payload, true);
  save();
  json(state.release);
}
if (method === "PATCH" && endpoint === "repos/JoeWorkspace/JoeSSH/releases/71") {
  const payload = JSON.parse(input);
  state.release = release(payload, false);
  if (settings.moveMainAfterPublish) state.settings.mainCommit = "def456";
  save();
  json(state.release);
}
if (method === "DELETE" && endpoint === "repos/JoeWorkspace/JoeSSH/releases/71") {
  state.release = null;
  save();
  process.exit(0);
}
process.stderr.write("unexpected gh api request: " + method + " " + endpoint + "\n");
process.exit(2);
`;
}
