import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT_PATH = fileURLToPath(new URL("./configure-desktop-release-secrets.mjs", import.meta.url));
const REPO = "JoeWorkspace/JoeSSH";
const REQUIRED_SECRET_NAMES = [
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
  const root = mkdtempSync(join(tmpdir(), "desktop-release-secrets-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  writeFile(root, "windows.pfx", "windows certificate");
  writeFile(root, "apple.p12", "apple certificate");
  const logPath = join(root, "secret-set-log.jsonl");

  return {
    env: {
      ...createSecretInputEnv(root),
      ...createFakeCommands(root, logPath, options),
    },
    logPath,
    root,
  };
}

function createSecretInputEnv(root) {
  return {
    ATLASTERM_APPLE_CERTIFICATE_FILE: join(root, "apple.p12"),
    ATLASTERM_APPLE_CERTIFICATE_PASSWORD: "apple-cert-password",
    ATLASTERM_APPLE_ID: "release@example.com",
    ATLASTERM_APPLE_PASSWORD: "apple-app-password",
    ATLASTERM_APPLE_TEAM_ID: "TEAM123456",
    ATLASTERM_KEYCHAIN_PASSWORD: "keychain-password",
    ATLASTERM_WINDOWS_CERTIFICATE_FILE: join(root, "windows.pfx"),
    ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD: "windows-cert-password",
    ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT: "00112233445566778899AABBCCDDEEFF00112233",
    ATLASTERM_WINDOWS_TIMESTAMP_URL: "http://timestamp.digicert.com",
  };
}

function createFakeCommands(root, logPath, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    head: "abc123",
    preflightFails: false,
    remoteRefs: {
      "refs/tags/v0.1.0-beta.1": "abc123",
      "refs/tags/v0.1.0-beta.1^{}": "abc123",
    },
    refCommits: {
      "v0.1.0-beta.1": "abc123",
    },
    secretSetFails: false,
    upstream: "origin/main",
    upstreamAhead: "0",
    upstreamBehind: "0",
    ...options,
  };

  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const { appendFileSync } = require("node:fs");
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const logPath = ${JSON.stringify(logPath)};
const requiredSecretNames = ${JSON.stringify(REQUIRED_SECRET_NAMES)};
const key = args.join("\\0");

if (key === "--version") {
  console.log("gh version 2.70.0");
  process.exit(0);
}
if (key === "auth\\0status") {
  console.log("Logged in");
  process.exit(0);
}
if (args[0] === "secret" && args[1] === "set" && args[3] === "--repo" && args[4] === ${JSON.stringify(REPO)} && args[5] === "--body-file" && args[6] === "-") {
  if (state.secretSetFails) {
    console.error("secret set failed");
    process.exit(1);
  }
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => {
    appendFileSync(logPath, JSON.stringify({ name: args[2], body }) + "\\n");
  });
  process.exitCode = 0;
  process.stdin.resume();
} else if (key === "api\\0repos/" + ${JSON.stringify(REPO)} + "/actions/secrets\\0--jq\\0.secrets[].name") {
  if (state.preflightFails) {
    console.log(requiredSecretNames.filter((name) => name !== "ATLASTERM_KEYCHAIN_PASSWORD").join("\\n"));
  } else {
    console.log(requiredSecretNames.join("\\n"));
  }
  process.exit(0);
} else if (key === "workflow\\0view\\0desktop-release-artifacts.yml\\0--repo\\0" + ${JSON.stringify(REPO)}) {
  console.log("Desktop Release Artifacts");
  process.exit(0);
} else {
  console.error("unexpected gh args: " + args.join(" "));
  process.exit(2);
}
`,
    "utf8",
  );

  const fakeGitPath = join(binDir, "git.js");
  writeFileSync(
    fakeGitPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join("\\0");
if (key === "remote\\0get-url\\0origin") {
  console.log("https://github.com/${REPO}.git");
  process.exit(0);
}
if (key === "rev-parse\\0HEAD") {
  console.log(state.head);
  process.exit(0);
}
if (args[0] === "rev-parse" && args[1] === "--verify") {
  const ref = args[2].replace(/\\^\\{\\}$/, "");
  if (state.refCommits[ref]) {
    console.log(state.refCommits[ref]);
    process.exit(0);
  }
  console.error("unknown ref " + ref);
  process.exit(1);
}
if (key === "rev-parse\\0--abbrev-ref\\0--symbolic-full-name\\0@{u}") {
  if (!state.upstream) {
    process.exit(1);
  }
  console.log(state.upstream);
  process.exit(0);
}
if (args[0] === "rev-list" && args[1] === "--left-right" && args[2] === "--count") {
  console.log(state.upstreamBehind + "\\t" + state.upstreamAhead);
  process.exit(0);
}
if (args[0] === "ls-remote" && args[1] === "--exit-code" && args[2] === "origin") {
  const ref = args[3];
  if (state.remoteRefs[ref]) {
    console.log(state.remoteRefs[ref] + "\\t" + ref);
    process.exit(0);
  }
  console.error("not found " + ref);
  process.exit(2);
}
console.error("unexpected git args: " + args.join(" "));
process.exit(2);
`,
    "utf8",
  );

  return {
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
  };
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function runConfigurator(root, args = [], env = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH, "--root", root, "--repo", REPO, ...args], {
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ...env,
    },
  });
}

function readSecretSetLog(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("sets all Desktop signing secrets from env and certificate files", (t) => {
  const { env, logPath, root } = createFixture(t);
  const result = runConfigurator(root, [], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Set ATLASTERM_WINDOWS_CERTIFICATE from ATLASTERM_WINDOWS_CERTIFICATE_FILE/);
  assert.match(result.stdout, /Desktop release secrets configured/);
  assert.doesNotMatch(result.stdout, /windows-cert-password|apple-app-password|windows certificate/);

  const logEntries = readSecretSetLog(logPath);
  assert.deepEqual(
    logEntries.map((entry) => entry.name).sort(),
    [...REQUIRED_SECRET_NAMES].sort(),
  );
  assert.equal(
    logEntries.find((entry) => entry.name === "ATLASTERM_WINDOWS_CERTIFICATE")?.body,
    Buffer.from("windows certificate").toString("base64"),
  );
  assert.equal(
    logEntries.find((entry) => entry.name === "ATLASTERM_APPLE_CERTIFICATE")?.body,
    Buffer.from("apple certificate").toString("base64"),
  );
});

test("supports dry run without setting GitHub secrets", (t) => {
  const { env, logPath, root } = createFixture(t);
  const result = runConfigurator(root, ["--dry-run"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Would set ATLASTERM_WINDOWS_CERTIFICATE/);
  assert.equal(readFileMaybe(logPath), "");
});

test("writes a redacted Desktop signing secret input template", (t) => {
  const { env, logPath, root } = createFixture(t);
  const templatePath = "reports/handoff/desktop/secret-input-template.env";
  const result = runConfigurator(root, ["--write-template", templatePath], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Wrote Desktop release secret input template/);
  assert.equal(readFileMaybe(logPath), "");

  const template = readFileSync(join(root, ...templatePath.split("/")), "utf8");
  assert.match(template, /ATLASTERM_WINDOWS_CERTIFICATE_FILE=/);
  assert.match(template, /# ATLASTERM_WINDOWS_CERTIFICATE=/);
  assert.match(template, /ATLASTERM_APPLE_PASSWORD=/);
  assert.match(template, /ATLASTERM_KEYCHAIN_PASSWORD=/);
  assert.doesNotMatch(template, /windows-cert-password|apple-app-password|windows certificate|apple certificate/);
});

test("uses the default Desktop signing secret template path", (t) => {
  const { env, root } = createFixture(t);
  const result = runConfigurator(root, ["--write-template"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const template = readFileSync(join(root, "reports", "handoff", "desktop", "secret-input-template.env"), "utf8");
  assert.match(template, /ATLASTERM_WINDOWS_TIMESTAMP_URL=/);
  assert.match(template, /ATLASTERM_APPLE_TEAM_ID=/);
});

test("verify-only reuses the formal evidence preflight", (t) => {
  const { env, logPath, root } = createFixture(t);
  const result = runConfigurator(root, ["--verify-only"], env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Desktop release secret verification passed/);
  assert.equal(readFileMaybe(logPath), "");
});

test("rejects missing and ambiguous secret inputs", (t) => {
  const missing = createFixture(t);
  delete missing.env.ATLASTERM_APPLE_PASSWORD;
  const missingResult = runConfigurator(missing.root, [], missing.env);

  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /ATLASTERM_APPLE_PASSWORD or ATLASTERM_APPLE_PASSWORD_FILE/);

  const ambiguous = createFixture(t);
  ambiguous.env.ATLASTERM_APPLE_ID_FILE = join(ambiguous.root, "apple-id.txt");
  writeFile(ambiguous.root, "apple-id.txt", "release@example.com");
  const ambiguousResult = runConfigurator(ambiguous.root, [], ambiguous.env);

  assert.equal(ambiguousResult.status, 1);
  assert.match(ambiguousResult.stderr, /ATLASTERM_APPLE_ID and ATLASTERM_APPLE_ID_FILE/);
});

test("rejects direct certificate secrets that are not base64", (t) => {
  const { env, root } = createFixture(t);
  delete env.ATLASTERM_WINDOWS_CERTIFICATE_FILE;
  env.ATLASTERM_WINDOWS_CERTIFICATE = "not base64!?";

  const result = runConfigurator(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ATLASTERM_WINDOWS_CERTIFICATE must be base64 text/);
});

test("fails when post-set formal evidence preflight does not pass", (t) => {
  const { env, root } = createFixture(t, { preflightFails: true });
  const result = runConfigurator(root, [], env);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing GitHub Actions secret\(s\) required for formal Desktop evidence/);
});

function readFileMaybe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
