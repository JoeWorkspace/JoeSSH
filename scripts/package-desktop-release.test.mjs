import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const PACKAGER_PATH = fileURLToPath(new URL("./package-desktop-release.mjs", import.meta.url));
const EVIDENCE_CHECKER_PATH = fileURLToPath(new URL("./verify-desktop-release-evidence.mjs", import.meta.url));

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "desktop-release-package-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  writeFile(root, "package.json", JSON.stringify({ version: "0.1.0-beta.1" }));
  return root;
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runPackager(root, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      PACKAGER_PATH,
      "--root",
      root,
      "--windows-signature-verification",
      "signtool verify /pa reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe passed",
      "--macos-signature-verification",
      "codesign --verify reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
      "--macos-notarization-verification",
      "spctl --assess reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
      ...extraArgs,
    ],
    { encoding: "utf8" },
  );
}

function runEvidenceChecker(root) {
  return spawnSync(process.execPath, [EVIDENCE_CHECKER_PATH, "--root", root], {
    encoding: "utf8",
  });
}

function readReleaseFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("packages Desktop bundle artifacts with checksums and release evidence", (t) => {
  const root = createFixture(t);
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows");
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/dmg/JoeSSH_0.1.0-beta.1_aarch64.dmg", "macos");
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/appimage/JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux");
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.1_x64-setup.exe.sig", "ignored");
  writeFile(root, "reports/release/desktop/JoeSSH_0.0.0_old.exe", "stale");

  const result = runPackager(root, ["--require-platforms", "windows,macos,linux"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.0.0_old.exe")), false);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_x64-setup.exe")), true);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_aarch64.dmg")), true);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_amd64.AppImage")), true);

  const manifest = readReleaseFile(root, "reports/release/desktop/SHA256SUMS.txt");
  assert.match(manifest, new RegExp(`${sha256("windows")}  reports/release/desktop/JoeSSH_0\\.1\\.0-beta\\.1_x64-setup\\.exe`));
  assert.match(manifest, new RegExp(`${sha256("macos")}  reports/release/desktop/JoeSSH_0\\.1\\.0-beta\\.1_aarch64\\.dmg`));
  assert.match(manifest, new RegExp(`${sha256("linux")}  reports/release/desktop/JoeSSH_0\\.1\\.0-beta\\.1_amd64\\.AppImage`));
  assert.doesNotMatch(manifest, /\.sig/);

  const evidence = JSON.parse(readReleaseFile(root, "reports/release/desktop/release-evidence.json"));
  assert.deepEqual(
    evidence.artifacts.map((artifact) => artifact.platform).sort(),
    ["linux", "macos", "windows"],
  );
  assert.equal(evidence.artifacts.find((artifact) => artifact.platform === "windows").signed, true);
  assert.equal(evidence.artifacts.find((artifact) => artifact.platform === "macos").notarized, true);
  assert.equal(evidence.artifacts.find((artifact) => artifact.platform === "linux").packageType, "AppImage");
  assert.equal(
    evidence.artifacts.find((artifact) => artifact.platform === "windows").sha256,
    sha256("windows"),
  );
  assert.equal(evidence.artifacts.find((artifact) => artifact.platform === "macos").sha256, sha256("macos"));
  assert.equal(evidence.artifacts.find((artifact) => artifact.platform === "linux").sha256, sha256("linux"));
  const evidenceText = readReleaseFile(root, "reports/release/desktop/release-evidence.json");
  assert.equal(
    readReleaseFile(root, "reports/release/desktop/release-evidence-SHA256SUMS.txt"),
    `${sha256(evidenceText)}  reports/release/desktop/release-evidence.json\n`,
  );

  const evidenceResult = runEvidenceChecker(root);
  assert.equal(evidenceResult.status, 0, evidenceResult.stdout + evidenceResult.stderr);
});

test("rejects Windows artifacts without signature verification evidence", (t) => {
  const root = createFixture(t);
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows");

  const result = spawnSync(process.execPath, [PACKAGER_PATH, "--root", root], {
    encoding: "utf8",
    env: {
      ...process.env,
      ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION: "",
    },
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Windows Desktop artifacts require --windows-signature-verification/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_x64-setup.exe")), false);
});

test("rejects stale source artifacts before staging Desktop release files", (t) => {
  const root = createFixture(t);
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.1_x64-setup.exe", "windows");
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/nsis/JoeSSH_0.1.0-beta.0_x64-setup.exe", "old windows");

  const result = runPackager(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Desktop bundle source contains artifact\(s\) that do not include 0\.1\.0-beta\.1/);
  assert.match(result.stderr, /0\.1\.0-beta\.0/);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.1_x64-setup.exe")), false);
  assert.equal(existsSync(join(root, "reports", "release", "desktop", "JoeSSH_0.1.0-beta.0_x64-setup.exe")), false);
});

test("packages Linux-only artifacts for platform-specific release runners", (t) => {
  const root = createFixture(t);
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/deb/JoeSSH_0.1.0-beta.1_amd64.deb", "linux deb");

  const result = spawnSync(process.execPath, [PACKAGER_PATH, "--root", root], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const evidence = JSON.parse(readReleaseFile(root, "reports/release/desktop/release-evidence.json"));
  assert.equal(evidence.artifacts.length, 1);
  assert.equal(evidence.artifacts[0].platform, "linux");
  assert.equal(evidence.artifacts[0].packageType, "deb");
  assert.equal(evidence.artifacts[0].sha256, sha256("linux deb"));
});

test("rejects missing required platform artifacts", (t) => {
  const root = createFixture(t);
  writeFile(root, "apps/desktop/src-tauri/target/release/bundle/appimage/JoeSSH_0.1.0-beta.1_amd64.AppImage", "linux");

  const result = spawnSync(
    process.execPath,
    [PACKAGER_PATH, "--root", root, "--require-platforms", "windows,linux"],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required platform\(s\): windows/);
});
