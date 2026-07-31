import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  createWindowsStoreIdentityConfig,
  loadWindowsStoreSigningConfig,
  normalizeSigningConfig,
  parseSigningConfigPaths,
} from "./build-windows-store-candidate.mjs";

const THUMBPRINT = "a".repeat(40);
const LEGAL_PUBLISHER = "Joe Developer";

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
