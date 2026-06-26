import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  checkMobilePublicEnv,
  discoverMobilePublicEnvFiles,
  formatMobilePublicEnvCheck,
} from "./check-mobile-public-env.mjs";

test("passes when the mobile sync auth token env is absent or blank", () => {
  assert.equal(checkMobilePublicEnv({}).ok, true);
  assert.equal(checkMobilePublicEnv({ EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: "" }).ok, true);
  assert.equal(checkMobilePublicEnv({ EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: "   " }).ok, true);
});

test("fails when a mobile public sync auth token would be embedded", () => {
  const result = checkMobilePublicEnv({
    EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: "mobile-release-token",
  });

  assert.equal(result.ok, false);
  assert.match(formatMobilePublicEnvCheck(result), /EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN/);
  assert.match(formatMobilePublicEnvCheck(result), /embedded in the app bundle/);
});

test("fails when a real mobile env file sets the public sync auth token", () => {
  const root = mkdtempSync(join(tmpdir(), "joessh-mobile-env-"));
  const mobileDir = join(root, "apps", "mobile");
  mkdirSync(mobileDir, { recursive: true });
  const envPath = join(mobileDir, ".env.local");
  writeFileSync(envPath, "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=super-secret-mobile-token\n", "utf8");

  try {
    const result = checkMobilePublicEnv(
      {},
      {
        envFilePaths: [envPath],
        root,
      },
    );
    const formatted = formatMobilePublicEnvCheck(result);

    assert.equal(result.ok, false);
    assert.match(formatted, /apps[\\/]mobile[\\/]\.env\.local:1/);
    assert.match(formatted, /EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN/);
    assert.doesNotMatch(formatted, /super-secret-mobile-token/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("allows commented and blank mobile public token env file entries", () => {
  const root = mkdtempSync(join(tmpdir(), "joessh-mobile-env-"));
  const envPath = join(root, ".env.production.local");
  writeFileSync(
    envPath,
    [
      "# EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=commented-secret",
      "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=   ",
      "export EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=\"\"",
      "",
    ].join("\n"),
    "utf8",
  );

  try {
    const result = checkMobilePublicEnv(
      {},
      {
        envFilePaths: [envPath],
        root,
      },
    );

    assert.equal(result.ok, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("discovers real root and app mobile env files but skips .env.example", () => {
  const root = mkdtempSync(join(tmpdir(), "joessh-mobile-env-"));
  const mobileDir = join(root, "apps", "mobile");
  mkdirSync(mobileDir, { recursive: true });
  writeFileSync(join(root, ".env"), "EXPO_PUBLIC_ATLASTERM_SYNC_URL=http://127.0.0.1:4100\n", "utf8");
  writeFileSync(join(root, ".env.example"), "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=example\n", "utf8");
  writeFileSync(join(mobileDir, ".env.production.local"), "EXPO_PUBLIC_ATLASTERM_SYNC_URL=https://example.test\n", "utf8");

  try {
    const discovered = discoverMobilePublicEnvFiles(root).map((filePath) => filePath.replaceAll("\\", "/"));

    assert.deepEqual(discovered.sort(), [
      join(root, ".env").replaceAll("\\", "/"),
      join(mobileDir, ".env.production.local").replaceAll("\\", "/"),
    ]);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("discovers symlinked mobile env files when the target is a file", (t) => {
  const root = mkdtempSync(join(tmpdir(), "joessh-mobile-env-"));
  const mobileDir = join(root, "apps", "mobile");
  const targetPath = join(root, "linked-env-target");
  const linkPath = join(mobileDir, ".env.local");
  mkdirSync(mobileDir, { recursive: true });
  writeFileSync(targetPath, "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN=linked-token\n", "utf8");

  try {
    symlinkSync(targetPath, linkPath);
  } catch (error) {
    rmSync(root, { force: true, recursive: true });
    t.skip(`symlink creation is unavailable on this machine: ${error.message}`);
    return;
  }

  try {
    assert.deepEqual(discoverMobilePublicEnvFiles(root), [linkPath]);
    const result = checkMobilePublicEnv(
      {},
      {
        envFilePaths: discoverMobilePublicEnvFiles(root),
        root,
      },
    );

    assert.equal(result.ok, false);
    assert.doesNotMatch(formatMobilePublicEnvCheck(result), /linked-token/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
