import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  assertCleanBuildHead,
  createNpmInvocation,
  createWindowsStoreIdentityConfig,
  loadWindowsStoreSigningConfig,
  normalizeSigningConfig,
  parseSigningConfigPaths,
  windowsStoreNsisBuildProvenancePath,
  writeWindowsStoreNsisBuildProvenance,
} from "./build-windows-store-candidate.mjs";

const THUMBPRINT = "a".repeat(40);
const LEGAL_PUBLISHER = "Joe Developer";
const SOURCE_COMMIT = "a".repeat(40);

test("binds NSIS bytes to the clean source HEAD in an adjacent provenance file", () => {
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "joessh-build-proof-"));
  const artifactPath = join(
    fixtureDirectory,
    "JoeSSH_0.1.0-beta.10_x64-setup.exe",
  );
  try {
    writeFileSync(artifactPath, "exact installer bytes", "utf8");
    const provenancePath = writeWindowsStoreNsisBuildProvenance({
      artifactPath,
      projectVersion: "0.1.0-beta.10",
      sourceCommit: SOURCE_COMMIT,
    });
    assert.equal(
      provenancePath,
      windowsStoreNsisBuildProvenancePath(artifactPath),
    );
    const provenance = JSON.parse(readFileSync(provenancePath, "utf8"));
    assert.equal(provenance.sourceCommit, SOURCE_COMMIT);
    assert.equal(provenance.projectVersion, "0.1.0-beta.10");
    assert.equal(
      provenance.artifact.fileName,
      artifactPath.split(/[\\/]/).at(-1),
    );
    assert.equal(provenance.artifact.sizeBytes, 21);
    assert.match(provenance.artifact.sha256, /^[a-f0-9]{64}$/);
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
});

test("clean build HEAD binding rejects dirty or changed repositories", () => {
  const cleanSpawn = (_command, args) =>
    args[0] === "rev-parse"
      ? { status: 0, stdout: `${SOURCE_COMMIT}\n` }
      : { status: 0, stdout: "" };
  assert.equal(assertCleanBuildHead(cleanSpawn), SOURCE_COMMIT);
  assert.throws(
    () => assertCleanBuildHead(cleanSpawn, "b".repeat(40)),
    /HEAD changed/,
  );
  assert.throws(
    () =>
      assertCleanBuildHead((_command, args) =>
        args[0] === "rev-parse"
          ? { status: 0, stdout: `${SOURCE_COMMIT}\n` }
          : { status: 0, stdout: " M package.json\n" },
      ),
    /clean Git worktree/,
  );
});

test("uses cmd.exe to launch npm scripts on Windows", () => {
  assert.deepEqual(
    createNpmInvocation("win32", {
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
    }),
    {
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "release:desktop:build"],
    },
  );
  assert.deepEqual(createNpmInvocation("win32", {}), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd", "run", "release:desktop:build"],
  });
});

test("launches npm directly outside Windows", () => {
  assert.deepEqual(createNpmInvocation("linux"), {
    command: "npm",
    args: ["run", "release:desktop:build"],
  });
});

test("creates only the audited temporary legal publisher override", () => {
  assert.deepEqual(createWindowsStoreIdentityConfig(LEGAL_PUBLISHER), {
    bundle: { publisher: LEGAL_PUBLISHER },
  });
  for (const value of ["", " CHANGE-ME ", "Joe, Developer"]) {
    assert.throws(
      () => createWindowsStoreIdentityConfig(value),
      /ATLASTERM_WINDOWS_LEGAL_PUBLISHER/,
    );
  }
});

test("accepts and normalizes only Tauri Windows certificate signing fields", () => {
  assert.deepEqual(
    normalizeSigningConfig({
      bundle: {
        windows: {
          certificateThumbprint: THUMBPRINT,
          digestAlgorithm: "SHA256",
          timestampUrl: "https://timestamp.example.net",
          tsp: true,
        },
      },
    }),
    {
      bundle: {
        windows: {
          certificateThumbprint: THUMBPRINT.toUpperCase(),
          digestAlgorithm: "sha256",
          timestampUrl: "https://timestamp.example.net/",
          tsp: true,
        },
      },
    },
  );
});

test("rejects Store-policy, identity, and output overrides at every level", () => {
  for (const config of [
    { bundle: { targets: ["msi"], windows: {} } },
    {
      bundle: {
        publisher: "Unreviewed Publisher",
        windows: {
          signCommand: "sign %1",
        },
      },
    },
    {
      bundle: {
        windows: {
          webviewInstallMode: { type: "downloadBootstrapper" },
        },
      },
    },
    {
      bundle: {
        windows: {
          nsis: { installMode: "perMachine" },
        },
      },
    },
    {
      bundle: {
        windows: {
          identity: { name: "decoy" },
        },
      },
    },
    {
      bundle: {
        windows: {
          output: "../unreviewed",
        },
      },
    },
    {
      productName: "Decoy",
      bundle: { windows: { signCommand: "sign %1" } },
    },
  ]) {
    assert.throws(
      () => normalizeSigningConfig(config),
      /not (?:an )?allowed|cannot be empty/,
    );
  }
});

test("custom signCommand uses the exact Tauri shape and requires %1", () => {
  assert.deepEqual(
    normalizeSigningConfig({
      bundle: {
        windows: {
          signCommand: {
            cmd: "pwsh",
            args: ["-File", "sign.ps1", "%1"],
          },
        },
      },
    }),
    {
      bundle: {
        windows: {
          signCommand: {
            args: ["-File", "sign.ps1", "%1"],
            cmd: "pwsh",
          },
        },
      },
    },
  );
  assert.throws(
    () =>
      normalizeSigningConfig({
        bundle: { windows: { signCommand: "sign artifact.exe" } },
      }),
    /%1/,
  );
  assert.throws(
    () =>
      normalizeSigningConfig({
        bundle: {
          windows: {
            signCommand: {
              args: ["%1"],
              cmd: "pwsh",
              shell: true,
            },
          },
        },
      }),
    /shell is not allowed/,
  );
});

test("signing config environment accepts only absolute path entries", () => {
  const first = resolve("first-signing.json");
  const second = resolve("second-signing.json");
  assert.deepEqual(parseSigningConfigPaths(JSON.stringify([first, second])), [
    first,
    second,
  ]);
  assert.deepEqual(parseSigningConfigPaths(first), [first]);
  assert.throws(
    () => parseSigningConfigPaths("relative-signing.json"),
    /must be absolute/,
  );
  assert.throws(
    () => parseSigningConfigPaths('["valid", 42]'),
    /non-empty path/,
  );
  assert.throws(
    () => parseSigningConfigPaths('{"bundle":{}}'),
    /absolute path or a JSON array/,
  );
});

test("loaded configs are sanitized and cannot mix signing mechanisms", () => {
  const fixtureDirectory = mkdtempSync(
    join(tmpdir(), "joessh-signing-config-test-"),
  );
  const certificatePath = join(fixtureDirectory, "certificate.json");
  const commandPath = join(fixtureDirectory, "command.json");
  const unsafePath = join(fixtureDirectory, "unsafe.json");
  try {
    writeFileSync(
      certificatePath,
      JSON.stringify({
        bundle: {
          windows: {
            certificateThumbprint: THUMBPRINT,
            digestAlgorithm: "sha256",
            timestampUrl: "http://timestamp.example.net",
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      commandPath,
      JSON.stringify({
        bundle: {
          windows: {
            signCommand: {
              cmd: "pwsh",
              args: ["-File", "sign.ps1", "%1"],
            },
          },
        },
      }),
      "utf8",
    );
    writeFileSync(
      unsafePath,
      JSON.stringify({
        bundle: {
          targets: ["msi"],
          windows: {
            certificateThumbprint: THUMBPRINT,
          },
        },
      }),
      "utf8",
    );

    assert.deepEqual(loadWindowsStoreSigningConfig(certificatePath), {
      bundle: {
        windows: {
          certificateThumbprint: THUMBPRINT.toUpperCase(),
          digestAlgorithm: "sha256",
          timestampUrl: "http://timestamp.example.net/",
        },
      },
    });
    assert.throws(
      () =>
        loadWindowsStoreSigningConfig(
          JSON.stringify([certificatePath, commandPath]),
        ),
      /cannot be combined/,
    );
    assert.throws(
      () => loadWindowsStoreSigningConfig(unsafePath),
      /targets is not allowed/,
    );
    assert.throws(
      () =>
        loadWindowsStoreSigningConfig(
          JSON.stringify([certificatePath, certificatePath]),
        ),
      /listed more than once/,
    );
  } finally {
    rmSync(fixtureDirectory, { force: true, recursive: true });
  }
});
