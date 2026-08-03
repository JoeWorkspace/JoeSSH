import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(
  new URL("./check-git-history-secrets.mjs", import.meta.url),
);
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

function createFixture(t, { scanExit = 0, version = "8.30.1" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "history-secret-scan-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const logPath = join(root, "invocations.jsonl");
  const fakePath = join(root, "fake-gitleaks.mjs");
  copyFileSync(
    join(repositoryRoot, ".gitleaks.toml"),
    join(root, ".gitleaks.toml"),
  );
  copyFileSync(
    join(repositoryRoot, ".gitleaksignore"),
    join(root, ".gitleaksignore"),
  );
  copyFileSync(
    join(repositoryRoot, "package.json"),
    join(root, "package.json"),
  );
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  copyFileSync(
    join(repositoryRoot, ".github", "workflows", "ci.yml"),
    join(root, ".github", "workflows", "ci.yml"),
  );
  writeFileSync(
    fakePath,
    `
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args.at(-1) === "version") {
  console.log("gitleaks version ${version}");
  process.exit(0);
}
console.error("redacted scan output");
process.exit(${scanExit});
`,
    "utf8",
  );
  return {
    env: {
      ...process.env,
      JOESSH_GITLEAKS_ARGS: JSON.stringify([fakePath]),
      JOESSH_GITLEAKS_COMMAND: process.execPath,
    },
    logPath,
    root,
  };
}

function run(fixture) {
  return spawnSync(process.execPath, [scriptPath, "--root", fixture.root], {
    encoding: "utf8",
    env: fixture.env,
  });
}

test("runs a redacted all-history Git scan without writing a report", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const invocations = readFileSync(fixture.logPath, "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  assert.deepEqual(invocations[0], ["version"]);
  assert.deepEqual(invocations[1], [
    "git",
    "--redact=100",
    "--no-banner",
    "--no-color",
    `--config=${join(fixture.root, ".gitleaks.toml")}`,
    `--gitleaks-ignore-path=${join(fixture.root, ".gitleaksignore")}`,
    "--log-opts=--all",
    fixture.root,
  ]);
});

test("fails closed when Gitleaks reports a finding or scan error", (t) => {
  const result = run(createFixture(t, { scanExit: 1 }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Full Git history secret scan failed/);
  assert.match(result.stderr, /redacted scan output/);
});

test("rejects unsupported Gitleaks versions", (t) => {
  const result = run(createFixture(t, { version: "7.6.1" }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Exact version 8\.30\.1 is required/);
});

test("rejects a different Gitleaks v8 release", (t) => {
  const result = run(createFixture(t, { version: "8.30.2" }));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Exact version 8\.30\.1 is required/);
});

test("fails explicitly when the Gitleaks executable is unavailable", (t) => {
  const fixture = createFixture(t);
  fixture.env.JOESSH_GITLEAKS_COMMAND = join(fixture.root, "missing-gitleaks");
  delete fixture.env.JOESSH_GITLEAKS_ARGS;
  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Gitleaks is required for the pre-publication full-history scan/,
  );
});

test("rejects injected Gitleaks flags that could force a zero exit code", (t) => {
  const fixture = createFixture(t);
  fixture.env.JOESSH_GITLEAKS_ARGS = JSON.stringify(["--exit-code=0"]);
  const result = run(fixture);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exactly one absolute wrapper path and no flags/);
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run with injected control flags",
  );
});

test("rejects any broadened history ignore entry before invoking Gitleaks", (t) => {
  const fixture = createFixture(t);
  writeFileSync(
    join(fixture.root, ".gitleaksignore"),
    `${readFileSync(join(fixture.root, ".gitleaksignore"), "utf8")}*\n`,
    "utf8",
  );
  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only the nine reviewed historical fixture/);
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run with a broadened ignore file",
  );
});

test("rejects rule-level allowlists before invoking Gitleaks", (t) => {
  const fixture = createFixture(t);
  writeFileSync(
    join(fixture.root, ".gitleaks.toml"),
    `${readFileSync(join(fixture.root, ".gitleaks.toml"), "utf8")}\n[[allowlists]]\npaths = ['''.*''']\n`,
    "utf8",
  );
  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only extend the upstream default rules/);
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run with a rule-level allowlist",
  );
});

test("rejects a release-preparation script that omits the real scan", (t) => {
  const fixture = createFixture(t);
  const packagePath = join(fixture.root, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts["qa:release-preparation"] =
    "npm run qa:release-preparation:contracts";
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must run the reviewed contracts and the real full-history secret scan/,
  );
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run when the release gate can bypass it",
  );
});

test("rejects release preparation that omits Desktop workflow security", (t) => {
  const fixture = createFixture(t);
  const packagePath = join(fixture.root, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  packageJson.scripts["qa:release-preparation:contracts"] = packageJson.scripts[
    "qa:release-preparation:contracts"
  ].replace("npm run qa:desktop-release-workflow-security && ", "");
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must run the reviewed contracts and the real full-history secret scan/,
  );
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run when the Desktop workflow contract is bypassed",
  );
});

test("rejects shallow CI checkout before the history scan", (t) => {
  const fixture = createFixture(t);
  const workflowPath = join(fixture.root, ".github", "workflows", "ci.yml");
  const workflow = readFileSync(workflowPath, "utf8").replace(
    "          fetch-depth: 0\n",
    "",
  );
  writeFileSync(workflowPath, workflow, "utf8");

  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI lint must fetch full history/);
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run under a shallow CI contract",
  );
});

test("rejects CI drift in the pinned download, checksum, preinstall scan, or absolute handoff", async (t) => {
  const mutations = [
    [
      "download URL",
      "gitleaks_8.30.1_linux_x64.tar.gz",
      "gitleaks_8.30.1_linux_arm64.tar.gz",
    ],
    [
      "official SHA-256",
      "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
      "051f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    ],
    [
      "checksum verification",
      "sha256sum --check --strict -",
      "sha256sum --version",
    ],
    [
      "exact version verification",
      'if [[ "${actual_version}" != "${GITLEAKS_VERSION}" ]]; then',
      'if [[ -z "${actual_version}" ]]; then',
    ],
    [
      "reviewed config checksum",
      "17692ae221e51b1fe8fa4cd7862e02258d23a8873fc75ebd12251a0372fa2dfe",
      "07692ae221e51b1fe8fa4cd7862e02258d23a8873fc75ebd12251a0372fa2dfe",
    ],
    [
      "reviewed ignore checksum",
      "a60c709073214edf6582b7cb911364b184743516b30a4970493195d04ee47ccf",
      "060c709073214edf6582b7cb911364b184743516b30a4970493195d04ee47ccf",
    ],
    [
      "absolute preinstall binary",
      'readonly gitleaks_bin="${RUNNER_TEMP}/gitleaks-bin/gitleaks"',
      'readonly gitleaks_bin="gitleaks"',
    ],
    [
      "real preinstall scan",
      '"${gitleaks_bin}" git \\',
      'printf "scan skipped\\n" \\',
    ],
    [
      "absolute release gate binary",
      "JOESSH_GITLEAKS_COMMAND: ${{ runner.temp }}/gitleaks-bin/gitleaks",
      "JOESSH_GITLEAKS_COMMAND: gitleaks",
    ],
    [
      "real CI gate",
      "npm run qa:release-preparation",
      "npm run qa:release-preparation:contracts",
    ],
  ];

  for (const [name, from, to] of mutations) {
    await t.test(name, (subtest) => {
      const fixture = createFixture(subtest);
      const workflowPath = join(fixture.root, ".github", "workflows", "ci.yml");
      const source = readFileSync(workflowPath, "utf8");
      assert.ok(source.includes(from), `fixture must contain ${from}`);
      writeFileSync(workflowPath, source.replace(from, to), "utf8");

      const result = run(fixture);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /CI lint must fetch full history/);
      assert.equal(
        existsSync(fixture.logPath),
        false,
        "Gitleaks must not run when CI wiring drifts",
      );
    });
  }
});

test("rejects moving dependency installation before the trusted history scan", (t) => {
  const fixture = createFixture(t);
  const workflowPath = join(fixture.root, ".github", "workflows", "ci.yml");
  const source = readFileSync(workflowPath, "utf8");
  const npmCi = "      - run: npm ci\n";
  const scanName =
    "      - name: Scan full Git history before dependency installation\n";
  const npmCiIndex = source.indexOf(npmCi);
  const scanIndex = source.indexOf(scanName);
  assert.ok(npmCiIndex > scanIndex, "fixture must scan before npm ci");
  const withoutNpmCi =
    source.slice(0, npmCiIndex) + source.slice(npmCiIndex + npmCi.length);
  const moved = `${withoutNpmCi.slice(0, scanIndex)}${npmCi}${withoutNpmCi.slice(scanIndex)}`;
  writeFileSync(workflowPath, moved, "utf8");

  const result = run(fixture);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /scan through its absolute path before dependency installation/,
  );
  assert.equal(
    existsSync(fixture.logPath),
    false,
    "Gitleaks must not run when npm lifecycle scripts precede the trusted scan",
  );
});
