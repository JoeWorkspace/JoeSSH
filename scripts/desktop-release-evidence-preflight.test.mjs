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
  new URL("./desktop-release-evidence-preflight.mjs", import.meta.url),
);
const DISABLED_MARKER = "FORMAL_SIGNING_DISABLED";

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-preflight-disabled-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const commandLog = join(root, "external-command.log");
  const fakeCommand = join(root, "fake-command.mjs");
  writeFileSync(
    fakeCommand,
    `import { appendFileSync } from "node:fs";
appendFileSync(process.env.EXTERNAL_COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
process.exit(96);
`,
  );
  return {
    commandLog,
    env: {
      ...process.env,
      ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeCommand]),
      ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
      ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeCommand]),
      ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
      ATLASTERM_APPLE_PASSWORD: "DO_NOT_READ_PASSWORD_SENTINEL",
      EXTERNAL_COMMAND_LOG: commandLog,
    },
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

function assertNoExternalCommands(fixture) {
  const log = existsSync(fixture.commandLog)
    ? readFileSync(fixture.commandLog, "utf8")
    : "";
  assert.equal(log, "");
  assert.doesNotMatch(log, /secret\s+(?:set|list)|environment|workflow\s+run/i);
}

test("every retired preflight, inventory, and dispatch path fails closed", (t) => {
  const fixture = createFixture(t);
  const invocations = [
    [],
    ["--dispatch"],
    ["--secrets-only"],
    ["--dry-run", "--dispatch"],
    ["--repo", "JoeWorkspace/JoeSSH"],
    ["--ref", "main"],
    ["--workflow", "desktop-release-artifacts.yml"],
    ["--retention-days", "14"],
    ["--root", fixture.root, "--dispatch"],
  ];

  for (const args of invocations) {
    const result = run(fixture, args);
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, new RegExp(DISABLED_MARKER));
    assert.match(result.stderr, /No repository secret inventory/);
    assert.match(result.stderr, /approved externally managed isolated signer/);
    assert.doesNotMatch(result.stdout + result.stderr, /DO_NOT_READ/);
  }

  assertNoExternalCommands(fixture);
});

test("help describes the compatibility guard without touching GitHub or Git", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /formal signing automation is disabled/i);
  assert.match(result.stdout, /does not inspect GitHub environments/);
  assert.match(result.stdout, /externally managed isolated signer/);
  assertNoExternalCommands(fixture);
});

test("help cannot be combined to bypass fail-closed behavior", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--help", "--dispatch"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, new RegExp(DISABLED_MARKER));
  assertNoExternalCommands(fixture);
});
