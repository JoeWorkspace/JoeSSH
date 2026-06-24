import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const GENERATOR_PATH = fileURLToPath(new URL("./generate-local-release-authority.mjs", import.meta.url));
const VERIFIER_PATH = fileURLToPath(new URL("./verify-local-release-authority.mjs", import.meta.url));

function createFixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "local-release-authority-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  writeFile(root, "reports/release/local-release-authority/qa-release-public.log", options.logText ?? releaseGateLog());
  return root;
}

function releaseGateLog() {
  return [
    "> atlasterm@0.1.0-beta.1 qa:release:public:fixture",
    "> npm run qa:release:public",
    "Public Beta release readiness checks passed.",
    "",
  ].join("\n");
}

function createFakeGitCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    dirtyStatus: "",
    fsckFails: false,
    tagCommit: "abc123",
    ...options,
  };
  const fakeGitPath = join(binDir, "git.js");
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
  if (state.dirtyStatus) {
    console.log(state.dirtyStatus);
  }
  process.exit(0);
}
if (key === "rev-parse HEAD") {
  console.log("abc123");
  process.exit(0);
}
if (key === "rev-parse --verify v0.1.0-beta.1^{}") {
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "remote get-url origin") {
  console.log("https://github.com/joessh/joessh.git");
  process.exit(0);
}
if (key === "fsck --strict") {
  if (state.fsckFails) {
    console.error("dangling object");
    process.exit(1);
  }
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

function createFakeNpmCommand(root) {
  const binDir = join(root, "fake-npm-bin");
  mkdirSync(binDir, { recursive: true });
  const npmScriptPath = join(binDir, "npm.js");
  const output = [
    "atlasterm qa:release:public:fixture",
    "npm run qa:release:public",
    "Public Beta release readiness checks passed.",
    "",
  ].join("\n");
  writeFileSync(
    npmScriptPath,
    `
const args = process.argv.slice(2);
if (args.join(" ") !== "run qa:release:public:fixture") {
  console.error("unexpected npm args: " + args.join(" "));
  process.exit(2);
}
process.stdout.write(${JSON.stringify(output)});
`,
    "utf8",
  );
  return {
    ATLASTERM_RELEASE_NPM_ARGS: JSON.stringify([npmScriptPath]),
    ATLASTERM_RELEASE_NPM_COMMAND: process.execPath,
  };
}

function runGenerator(root, env = createFakeGitCommands(root), extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      GENERATOR_PATH,
      "--root",
      root,
      "--gate-command",
      "npm run qa:release:public:fixture",
      "--operator",
      "release-operator",
      "--target",
      "self-hosted download bucket",
      "--reuse-gate-log",
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

function runGeneratorWithFreshGate(root, env = createFakeGitCommands(root), extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      GENERATOR_PATH,
      "--root",
      root,
      "--gate-command",
      "npm run qa:release:public:fixture",
      "--operator",
      "release-operator",
      "--target",
      "self-hosted download bucket",
      ...extraArgs,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    },
  );
}

function runVerifier(root, env = createFakeGitCommands(root), extraArgs = []) {
  return spawnSync(process.execPath, [VERIFIER_PATH, "--root", root, ...extraArgs], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

test("generates and verifies local release authority evidence", (t) => {
  const root = createFixture(t);
  const env = createFakeGitCommands(root);

  const generated = runGenerator(root, env);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  assert.match(generated.stdout, /Local release authority verified for v0\.1\.0-beta\.1/);

  const evidence = JSON.parse(readFile(root, "reports/release/local-release-authority.json"));
  assert.equal(evidence.authorityVersion, 1);
  assert.equal(evidence.authority, "local");
  assert.equal(evidence.releaseTag, "v0.1.0-beta.1");
  assert.equal(evidence.releaseGate.command, "npm run qa:release:public:fixture");
  assert.equal(evidence.releaseGate.logSha256, sha256(releaseGateLog()));
  assert.equal(evidence.source.gitCommit, "abc123");
  assert.equal(evidence.source.releaseTagCommit, "abc123");
  assert.equal(evidence.source.gitFsckStrict, true);
  assert.match(
    readFile(root, "reports/release/local-release-authority-SHA256SUMS.txt"),
    /^([a-f0-9]{64}) {2}reports\/release\/local-release-authority\.json\n$/,
  );

  const verified = runVerifier(root, env);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
});

test("runs the local release gate by default before generating authority evidence", (t) => {
  const root = createFixture(t, { logText: "stale log\n" });
  const env = { ...createFakeGitCommands(root), ...createFakeNpmCommand(root) };

  const generated = runGeneratorWithFreshGate(root, env);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const log = readFile(root, "reports/release/local-release-authority/qa-release-public.log");
  assert.match(log, /^\$ npm run qa:release:public:fixture/m);
  assert.match(log, /Public Beta release readiness checks passed\./);
  assert.doesNotMatch(log, /stale log/);
  const evidence = JSON.parse(readFile(root, "reports/release/local-release-authority.json"));
  assert.equal(evidence.releaseGate.logSha256, sha256(log));
});

test("generates and self-verifies custom local release authority paths", (t) => {
  const root = createFixture(t);
  const env = createFakeGitCommands(root);

  const generated = runGenerator(root, env, [
    "--output",
    "reports/release/custom/local-release-authority.json",
    "--checksum",
    "reports/release/custom/local-release-authority-SHA256SUMS.txt",
  ]);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  assert.match(generated.stdout, /Local release authority verified for v0\.1\.0-beta\.1/);
  const verified = runVerifier(root, env, [
    "--evidence",
    "reports/release/custom/local-release-authority.json",
    "--checksum",
    "reports/release/custom/local-release-authority-SHA256SUMS.txt",
  ]);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
});

test("generates local release authority evidence for the local public release gate", (t) => {
  const root = createFixture(t, {
    logText: [
      "> atlasterm@0.1.0-beta.1 qa:release:public:local",
      "> npm run qa:release:public:local",
      "Public Beta release readiness checks passed.",
      "",
    ].join("\n"),
  });
  const env = createFakeGitCommands(root);

  const generated = runGenerator(root, env, ["--gate-command", "npm run qa:release:public:local"]);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const evidence = JSON.parse(readFile(root, "reports/release/local-release-authority.json"));
  assert.equal(evidence.releaseGate.command, "npm run qa:release:public:local");
});

test("accepts UTF-16LE PowerShell release gate logs", (t) => {
  const root = createFixture(t);
  const env = createFakeGitCommands(root);
  const logPath = join(root, "reports", "release", "local-release-authority", "qa-release-public.log");
  writeFileSync(logPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(releaseGateLog(), "utf16le")]));

  const generated = runGenerator(root, env);

  assert.equal(generated.status, 0, generated.stdout + generated.stderr);
  const verified = runVerifier(root, env);
  assert.equal(verified.status, 0, verified.stdout + verified.stderr);
});

test("rejects local release authority generation without a release readiness success marker", (t) => {
  const root = createFixture(t, {
    logText: "> npm run qa:release:public\nrelease failed before readiness\n",
  });

  const generated = runGenerator(root);

  assert.equal(generated.status, 1);
  assert.match(generated.stderr, /Release gate log must include the release readiness success marker/);
});

test("rejects local release authority verification when Git becomes dirty", (t) => {
  const root = createFixture(t);
  assert.equal(runGenerator(root).status, 0);

  const verified = runVerifier(root, createFakeGitCommands(root, { dirtyStatus: " M package.json" }));

  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /Git working tree outside reports\/release must be clean/);
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
