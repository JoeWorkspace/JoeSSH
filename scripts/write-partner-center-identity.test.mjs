import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validatePartnerCenterIdentity } from "./windows-store-contract.mjs";
import { runPartnerCenterIdentityWriter } from "./write-partner-center-identity.mjs";
const LOCAL_DIRECTORY = join("reports", "handoff", "windows-store");
const DEFAULT_TEMPLATE = join(
  LOCAL_DIRECTORY,
  "partner-center-identity.input.json",
);
const DEFAULT_OUTPUT = join(LOCAL_DIRECTORY, "partner-center-identity.json");
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const FIXTURE_PARENT = join(REPOSITORY_ROOT, LOCAL_DIRECTORY, ".writer-tests");

function createFixture(t) {
  mkdirSync(FIXTURE_PARENT, { recursive: true });
  const root = mkdtempSync(join(FIXTURE_PARENT, "partner-center-identity-"));
  const scriptsDirectory = join(root, "scripts");
  mkdirSync(scriptsDirectory);
  const scriptPath = join(
    scriptsDirectory,
    "write-partner-center-identity.mjs",
  );
  copyFileSync(
    join(REPOSITORY_ROOT, "scripts", "write-partner-center-identity.mjs"),
    scriptPath,
  );
  copyFileSync(
    join(REPOSITORY_ROOT, "scripts", "windows-store-contract.mjs"),
    join(scriptsDirectory, "windows-store-contract.mjs"),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, scriptPath };
}

function run(fixture, args = []) {
  const result = spawnSync(process.execPath, [fixture.scriptPath, ...args], {
    cwd: fixture.root,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status ?? 1,
    stderr: result.stderr || result.error?.message || "",
    stdout: result.stdout || "",
  };
}

function validIdentity(overrides = {}) {
  return {
    schemaVersion: 1,
    source: "partner-center",
    productId: "9N1234567890",
    packageIdentityName: "Test.Package.Assigned",
    publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
    publisherDisplayName: "Verified Test Individual",
    publisherId: "8wekyb3d8bbwe",
    packageFamilyName: "Test.Package.Assigned_8wekyb3d8bbwe",
    reservedAt: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function writeInput(fixture, identity, name = "edited-input.json") {
  const path = join(fixture.root, LOCAL_DIRECTORY, name);
  mkdirSync(join(fixture.root, LOCAL_DIRECTORY), { recursive: true });
  writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
  });
  return path;
}

test("template mode creates a local placeholder without a claimed publisher", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--write-template"]);
  const templatePath = join(fixture.root, DEFAULT_TEMPLATE);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(templatePath), true);
  const template = JSON.parse(readFileSync(templatePath, "utf8"));
  assert.deepEqual(Object.keys(template), [
    "schemaVersion",
    "source",
    "productId",
    "packageIdentityName",
    "publisher",
    "publisherDisplayName",
    "publisherId",
    "packageFamilyName",
    "reservedAt",
  ]);
  assert.equal(template.source, "partner-center");
  assert.match(template.publisher, /^CN=CHANGE-ME/);
  assert.match(template.publisherDisplayName, /VERIFIED-PERSONAL-NAME/);
  assert.doesNotMatch(template.publisherDisplayName, /JoeSSH|JoeWorkspace/);
  assert.match(result.stdout, /Individual account/);
  assert.match(result.stdout, /Do not commit/);
});

test("writer creates the canonical file accepted by the candidate contract", (t) => {
  const fixture = createFixture(t);
  const personalNameSentinel = "Verified Test Individual";
  const inputPath = writeInput(
    fixture,
    validIdentity({ publisherDisplayName: personalNameSentinel }),
  );
  const result = run(fixture, ["--input", inputPath]);
  const outputPath = join(fixture.root, DEFAULT_OUTPUT);

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.deepEqual(validatePartnerCenterIdentity(output), {
    packageFamilyName: "Test.Package.Assigned_8wekyb3d8bbwe",
    packageIdentityName: "Test.Package.Assigned",
    productId: "9N1234567890",
    publisher: "CN=01234567-89ab-cdef-0123-456789abcdef",
    publisherDisplayName: personalNameSentinel,
    publisherId: "8wekyb3d8bbwe",
    reservedAt: "2020-01-01T00:00:00.000Z",
    schemaVersion: 1,
    source: "partner-center",
  });
  assert.deepEqual(Object.keys(output), [
    "schemaVersion",
    "source",
    "productId",
    "packageIdentityName",
    "publisher",
    "publisherDisplayName",
    "publisherId",
    "packageFamilyName",
    "reservedAt",
  ]);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    new RegExp(personalNameSentinel),
  );
  assert.match(result.stdout, /--partner-identity/);
  assert.match(result.stdout, /no identity value was printed/);
});

test("writer rejects extra fields without leaking their values", (t) => {
  const fixture = createFixture(t);
  const secretSentinel = "TOKEN_VALUE_MUST_NOT_BE_PRINTED";
  const inputPath = writeInput(fixture, {
    ...validIdentity(),
    accessToken: secretSentinel,
  });
  const result = run(fixture, ["--input", inputPath]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unexpected: accessToken/);
  assert.match(result.stderr, /Never include tokens/);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    new RegExp(secretSentinel),
  );
  assert.equal(existsSync(join(fixture.root, DEFAULT_OUTPUT)), false);
});

test("writer rejects project aliases for an Individual publisher", (t) => {
  const fixture = createFixture(t);

  for (const [index, publisherDisplayName] of [
    "JoeSSH",
    "JoeSSH Community",
    "JoeSSH Project",
    "JoeWorkspace",
  ].entries()) {
    const inputPath = writeInput(
      fixture,
      validIdentity({ publisherDisplayName }),
      `alias-${index}.json`,
    );
    const result = run(fixture, [
      "--input",
      inputPath,
      "--output",
      join(LOCAL_DIRECTORY, `output-${index}.json`),
    ]);
    assert.equal(result.status, 1, publisherDisplayName);
    assert.match(result.stderr, /exact personal name/);
    assert.equal(
      existsSync(join(fixture.root, LOCAL_DIRECTORY, `output-${index}.json`)),
      false,
    );
  }
});

test("writer refuses silent trimming or normalization of copied fields", (t) => {
  const fixture = createFixture(t);
  const inputPath = writeInput(
    fixture,
    validIdentity({ productId: " 9N1234567890 " }),
  );
  const result = run(fixture, ["--input", inputPath]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /productId must be copied exactly/);
  assert.equal(existsSync(join(fixture.root, DEFAULT_OUTPUT)), false);
});

test("writer rejects invalid UTF-8 before parsing JSON", (t) => {
  const fixture = createFixture(t);
  const inputPath = join(fixture.root, LOCAL_DIRECTORY, "invalid-utf8.json");
  mkdirSync(join(fixture.root, LOCAL_DIRECTORY), { recursive: true });
  writeFileSync(inputPath, Buffer.from([0x7b, 0x22, 0x80, 0x22, 0x7d]));
  const result = run(fixture, ["--input", inputPath]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /valid UTF-8 JSON/);
  assert.equal(existsSync(join(fixture.root, DEFAULT_OUTPUT)), false);
});

test("repository output is restricted to the gitignored handoff directory", (t) => {
  const fixture = createFixture(t);
  const inputPath = writeInput(fixture, validIdentity());
  const result = run(fixture, [
    "--input",
    inputPath,
    "--output",
    "docs/partner-center-identity.json",
  ]);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must stay below reports\/handoff\/windows-store/,
  );
  assert.equal(
    existsSync(join(fixture.root, "docs", "partner-center-identity.json")),
    false,
  );
});

test("relative traversal cannot disguise an external output path", (t) => {
  const fixture = createFixture(t);
  const inputPath = writeInput(fixture, validIdentity());
  const result = run(fixture, [
    "--input",
    inputPath,
    "--output",
    "../partner-center-identity.json",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must use an explicit absolute path/);
  assert.equal(
    existsSync(join(fixture.root, "..", "partner-center-identity.json")),
    false,
  );
});

test("an explicit absolute path outside the repository remains allowed", (t) => {
  const fixture = createFixture(t);
  const personalNameSentinel = "Verified External Test Individual";
  const inputPath = writeInput(
    fixture,
    validIdentity({ publisherDisplayName: personalNameSentinel }),
  );
  const externalDirectory = mkdtempSync(
    join(tmpdir(), "partner-center-identity-output-"),
  );
  t.after(() => rmSync(externalDirectory, { recursive: true, force: true }));
  const outputPath = join(externalDirectory, "partner-center-identity.json");

  const result = run(fixture, ["--input", inputPath, "--output", outputPath]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(outputPath), true);
  assert.doesNotMatch(
    result.stdout + result.stderr,
    new RegExp(personalNameSentinel),
  );
});

test("CLI arguments cannot redefine the repository root", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--root", fixture.root, "--write-template"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown argument: --root/);
});

test("the exported production runner cannot redefine its repository boundary", (t) => {
  const fixture = createFixture(t);
  const outputPath = join(
    REPOSITORY_ROOT,
    "docs",
    `${basename(fixture.root)}.partner-center-identity.json`,
  );
  t.after(() => rmSync(outputPath, { force: true }));

  assert.throws(
    () =>
      runPartnerCenterIdentityWriter(["--write-template", outputPath], {
        log: () => {},
        root: fixture.root,
      }),
    /must stay below reports\/handoff\/windows-store/,
  );
  assert.equal(existsSync(outputPath), false);
});

test("Windows path casing cannot disguise a tracked repository output", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows path casing regression");
    return;
  }
  const fixture = createFixture(t);
  const inputPath = writeInput(fixture, validIdentity());
  const disguisedOutput = join(
    fixture.root.toUpperCase(),
    "docs",
    "partner-center-identity.json",
  );
  const result = run(fixture, [
    "--input",
    inputPath,
    "--output",
    disguisedOutput,
  ]);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must stay below reports\/handoff\/windows-store/,
  );
  assert.equal(
    existsSync(join(fixture.root, "docs", "partner-center-identity.json")),
    false,
  );
});

test("repository output cannot traverse a junction into a tracked directory", (t) => {
  const fixture = createFixture(t);
  const inputPath = writeInput(fixture, validIdentity());
  const trackedDirectory = join(fixture.root, "docs");
  const localDirectory = join(fixture.root, LOCAL_DIRECTORY);
  const junctionPath = join(localDirectory, "linked-output");
  mkdirSync(trackedDirectory, { recursive: true });
  try {
    symlinkSync(trackedDirectory, junctionPath, "junction");
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      t.skip("Filesystem does not permit a junction fixture");
      return;
    }
    throw error;
  }

  const result = run(fixture, [
    "--input",
    inputPath,
    "--output",
    join(junctionPath, "partner-center-identity.json"),
  ]);
  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must stay below reports\/handoff\/windows-store|symbolic link or junction/,
  );
  assert.equal(
    existsSync(join(trackedDirectory, "partner-center-identity.json")),
    false,
  );
});

test("writer never overwrites an existing template or validated identity", (t) => {
  const fixture = createFixture(t);
  const firstTemplate = run(fixture, ["--write-template"]);
  assert.equal(firstTemplate.status, 0, firstTemplate.stderr);
  const templatePath = join(fixture.root, DEFAULT_TEMPLATE);
  const originalTemplate = readFileSync(templatePath, "utf8");
  const secondTemplate = run(fixture, ["--write-template"]);
  assert.equal(secondTemplate.status, 1);
  assert.match(secondTemplate.stderr, /Refusing to overwrite/);
  assert.equal(readFileSync(templatePath, "utf8"), originalTemplate);

  const inputPath = writeInput(fixture, validIdentity());
  const firstOutput = run(fixture, ["--input", inputPath]);
  assert.equal(firstOutput.status, 0, firstOutput.stderr);
  const outputPath = join(fixture.root, DEFAULT_OUTPUT);
  const originalOutput = readFileSync(outputPath, "utf8");
  const secondOutput = run(fixture, ["--input", inputPath]);
  assert.equal(secondOutput.status, 1);
  assert.match(secondOutput.stderr, /Refusing to overwrite/);
  assert.equal(readFileSync(outputPath, "utf8"), originalOutput);
});

test("help documents the confirmed Individual identity boundary", (t) => {
  const fixture = createFixture(t);
  const result = run(fixture, ["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /noncommercial Individual account/);
  assert.match(result.stdout, /exact personal name/);
  assert.match(
    result.stdout,
    /different package identity field beginning with CN=/,
  );
  assert.match(result.stdout, /Existing files are never overwritten/);
});
