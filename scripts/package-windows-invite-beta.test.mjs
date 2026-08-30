import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { WINDOWS_AUTHENTICODE_SETUP } from "./windows-powershell.mjs";

const SCRIPT_PATH = resolve(
  import.meta.dirname,
  "package-windows-invite-beta.mjs",
);
const UNSIGNED_PE_PATH = resolve(
  import.meta.dirname,
  "../node_modules/fb-dotslash/bin/windows/dotslash.exe",
);
const VERSION = "0.1.0-beta.10";
const windowsOnly = { skip: process.platform !== "win32" };

test(
  "real Authenticode uses the host Security module despite a shadowed PSModulePath",
  windowsOnly,
  (t) => {
    const temporaryRoot = resolve(tmpdir());
    const root = mkdtempSync(
      join(temporaryRoot, "joessh-windows-authenticode-"),
    );
    t.after(() => {
      assert.equal(dirname(resolve(root)), temporaryRoot);
      assert.ok(basename(root).startsWith("joessh-windows-authenticode-"));
      rmSync(root, { force: true, recursive: true });
    });
    const modules = join(root, "Modules");
    const shadowModule = join(modules, "Microsoft.PowerShell.Security");
    writeFile(
      join(shadowModule, "Microsoft.PowerShell.Security.psd1"),
      "@{ RootModule = 'Microsoft.PowerShell.Security.psm1'; ModuleVersion = '7.0.0'; FunctionsToExport = @('Get-AuthenticodeSignature') }",
    );
    writeFile(
      join(shadowModule, "Microsoft.PowerShell.Security.psm1"),
      "throw 'Shadow security module was loaded'",
    );
    const powershell = resolve(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    );
    const inheritedModulePath = process.env.PSModulePath;
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => key.toLowerCase() !== "psmodulepath",
      ),
    );
    environment.PSModulePath = `${modules};${inheritedModulePath ?? ""}`;
    function run(command, input) {
      return spawnSync(
        powershell,
        ["-NoProfile", "-NonInteractive", "-Command", command],
        {
          encoding: "utf8",
          env: environment,
          input,
          timeout: 30_000,
          windowsHide: true,
        },
      );
    }
    const shadowed = run(
      "$ErrorActionPreference = 'Stop'; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop;",
    );
    assert.notEqual(shadowed.status, 0);
    assert.match(shadowed.stderr, /Shadow security module was loaded/);

    const unsigned = join(root, "unsigned.ps1");
    writeFileSync(unsigned, "# Unsigned signature inspection fixture.\n");
    const command = [
      WINDOWS_AUTHENTICODE_SETUP,
      "$signature = Get-AuthenticodeSignature -LiteralPath ([Console]::In.ReadToEnd());",
      "[PSCustomObject]@{ Status = $signature.Status.ToString(); ModulePath = (Get-Module Microsoft.PowerShell.Security).Path } | ConvertTo-Json -Compress",
    ].join(" ");
    for (const [path, expectedStatus] of [
      [powershell, "Valid"],
      [unsigned, "NotSigned"],
    ]) {
      const result = run(command, path);
      assert.equal(result.status, 0, result.stderr);
      const signature = JSON.parse(result.stdout);
      assert.equal(signature.Status, expectedStatus);
      assert.equal(
        resolve(signature.ModulePath).toLowerCase(),
        resolve(
          dirname(powershell),
          "Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1",
        ).toLowerCase(),
      );
    }
    const missing = run(command, join(root, "missing.exe"));
    assert.notEqual(
      missing.status,
      0,
      "Signature inspection errors must still fail closed",
    );
    assert.equal(process.env.PSModulePath, inheritedModulePath);
  },
);

test(
  "packages one commit-bound unsigned PE into private Stage A handoff",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    const result = runPackager(fixture, ["--stage-a"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /awaiting native clean-VM smoke/);

    const candidateDir = join(
      fixture.root,
      "reports",
      "handoff",
      "desktop",
      "windows-invite",
      `${VERSION}-${fixture.commit.slice(0, 12)}-stage-a`,
    );
    const candidate = readJson(join(candidateDir, "candidate.json"));
    const artifactPath = join(candidateDir, candidate.artifact.fileName);

    assert.equal(candidate.stage, "A");
    assert.equal(candidate.artifactCommitBinding, "build-attestation");
    assert.equal(candidate.publicReleaseEvidence, false);
    assert.equal(candidate.releaseEligible, false);
    assert.equal(candidate.inviteDistributionReady, false);
    assert.equal(candidate.authenticode.status, "NotSigned");
    assert.match(candidate.artifact.fileName, /UNSIGNED-INTERNAL-ONLY\.exe$/);
    assert.equal(candidate.artifact.sha256, sha256File(artifactPath));
    assert.match(
      readFileSync(join(candidateDir, "HANDOFF-SHA256SUMS.txt"), "ascii"),
      /candidate\.json/,
    );
  },
);

test("rejects a dirty source worktree", windowsOnly, (t) => {
  const fixture = createFixture(t);
  writeJson(join(fixture.root, "package.json"), {
    version: VERSION,
    dirtyMarker: true,
  });
  const result = runPackager(fixture, ["--stage-a"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /require a clean Git worktree/);
});

test(
  "packages the same Git worktree through its Windows 8.3 directory alias",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    const shortRoot = windowsShortPath(fixture.root);
    const nativeRoot = realpathSync.native(fixture.root);
    assert.notEqual(
      shortRoot.toLowerCase(),
      nativeRoot.toLowerCase(),
      "This Windows filesystem did not expose an 8.3 alias; the required alias regression cannot be verified",
    );
    assert.equal(
      realpathSync.native(shortRoot).toLowerCase(),
      nativeRoot.toLowerCase(),
    );
    const gitRoot = git(shortRoot, [
      "rev-parse",
      "--show-toplevel",
    ]).stdout.trim();
    assert.equal(
      realpathSync.native(gitRoot).toLowerCase(),
      nativeRoot.toLowerCase(),
    );

    const result = runPackager(
      {
        ...fixture,
        root: shortRoot,
        bundleDir: join(
          shortRoot,
          "apps/desktop/src-tauri/target/release/bundle/nsis",
        ),
      },
      ["--stage-a"],
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /awaiting native clean-VM smoke/);
  },
);

test(
  "rejects a different Git worktree selected by inherited Git environment",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    const foreign = createFixture(t);
    const result = runPackager(fixture, ["--stage-a"], {
      GIT_DIR: join(foreign.root, ".git"),
      GIT_WORK_TREE: foreign.root,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /The Git worktree root does not match --root/);
    assert.ok(result.stderr.includes(realpathSync.native(fixture.root)));
    assert.ok(result.stderr.includes(realpathSync.native(foreign.root)));
  },
);

test("rejects stale or multiple Desktop installers", windowsOnly, (t) => {
  const fixture = createFixture(t);
  copyFileSync(
    UNSIGNED_PE_PATH,
    join(fixture.bundleDir, "JoeSSH_0.1.0-beta.8_x64-setup.exe"),
  );
  const result = runPackager(fixture, ["--stage-a"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Expected exactly one Desktop installer/);
});

test("rejects a non-PE file renamed to .exe", windowsOnly, (t) => {
  const fixture = createFixture(t, { textArtifact: true });
  const result = runPackager(fixture, ["--stage-a"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not a valid Windows PE installer/);
});

test("rejects a project version mismatch", windowsOnly, (t) => {
  const fixture = createFixture(t, { desktopVersion: "0.1.0-beta.8" });
  const result = runPackager(fixture, ["--stage-a"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /version mismatch/);
});

test("rejects a stale or forged build attestation", windowsOnly, (t) => {
  const fixture = createFixture(t, { attestationCommit: "f".repeat(40) });
  const result = runPackager(fixture, ["--stage-a"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not bind this installer/);
});

test("rejects a build attestation for another PE machine", windowsOnly, (t) => {
  const fixture = createFixture(t, {
    attestationPeMachine: "forged-machine",
  });
  const result = runPackager(fixture, ["--stage-a"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not bind this installer/);
});

test("rejects output paths outside private handoff", windowsOnly, (t) => {
  const fixture = createFixture(t);
  const result = runPackager(fixture, [
    "--stage-a",
    "--output-root",
    "reports/release/desktop",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must stay inside/);
});

test("keeps Stage B fail-closed", () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--stage-b"], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stage B packaging is blocked/);
});

function createFixture(t, overrides = {}) {
  assert.equal(
    existsSync(UNSIGNED_PE_PATH),
    true,
    "The Windows dotslash PE fixture must be installed by npm ci.",
  );
  const root = mkdtempSync(join(tmpdir(), "joessh-windows-invite-package-"));
  t.after(() => {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith("joessh-windows-invite-package-"));
    rmSync(root, { force: true, recursive: true });
  });

  writeJson(join(root, "package.json"), { version: VERSION });
  writeJson(join(root, "apps/desktop/package.json"), {
    name: "@atlasterm/desktop",
    version: overrides.desktopVersion ?? VERSION,
  });
  writeJson(join(root, "apps/desktop/src-tauri/tauri.conf.json"), {
    productName: "JoeSSH",
    version: VERSION,
    identifier: "dev.atlasterm.joessh",
    bundle: { publisher: "JoeSSH Project" },
  });
  writeFile(
    join(root, "apps/desktop/src-tauri/Cargo.toml"),
    `[package]\nname = "atlasterm-desktop-shell"\nversion = "${VERSION}"\n`,
  );
  writeFile(
    join(root, ".gitignore"),
    "apps/desktop/src-tauri/target/\nreports/\n",
  );
  git(root, ["init", "--quiet"]);
  git(root, ["config", "user.email", "tests@joessh.invalid"]);
  git(root, ["config", "user.name", "JoeSSH Tests"]);
  git(root, ["add", "."]);
  git(root, ["commit", "--quiet", "-m", "fixture"]);
  const commit = git(root, ["rev-parse", "HEAD"]).stdout.trim();

  const bundleDir = join(
    root,
    "apps",
    "desktop",
    "src-tauri",
    "target",
    "release",
    "bundle",
    "nsis",
  );
  mkdirSync(bundleDir, { recursive: true });
  const artifactPath = join(bundleDir, `JoeSSH_${VERSION}_x64-setup.exe`);
  if (overrides.textArtifact) {
    writeFileSync(artifactPath, "not a PE installer");
  } else {
    copyFileSync(UNSIGNED_PE_PATH, artifactPath);
  }
  const artifactStat = statSync(artifactPath);
  const artifactData = readFileSync(artifactPath);
  const peOffset = overrides.textArtifact ? 0 : artifactData.readUInt32LE(0x3c);
  const machineCode = overrides.textArtifact
    ? 0x8664
    : artifactData.readUInt16LE(peOffset + 4);
  writeJson(join(bundleDir, "windows-invite-build-attestation.json"), {
    schemaVersion: 1,
    kind: "windows-invite-build-attestation",
    generatedAt: "2026-07-29T09:01:00.000Z",
    startedAt: "2026-07-29T09:00:00.000Z",
    platform: "windows",
    architecture: "x64",
    bundleTarget: "nsis",
    version: VERSION,
    commit: overrides.attestationCommit ?? commit,
    gitExecutable: "C:/Program Files/Git/cmd/git.exe",
    gitVersion: "git version 2.50.1.windows.1",
    sourceTreeClean: true,
    artifact: {
      fileName: `JoeSSH_${VERSION}_x64-setup.exe`,
      sizeBytes: artifactStat.size,
      sha256: sha256File(artifactPath),
      peMachine:
        overrides.attestationPeMachine ??
        (machineCode === 0x014c ? "x86-nsis-bootstrapper" : "x64"),
    },
  });

  return { bundleDir, commit, root };
}

function windowsShortPath(path) {
  const powershell = resolve(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32/WindowsPowerShell/v1.0/powershell.exe",
  );
  const command = [
    "$ErrorActionPreference = 'Stop';",
    "$path = [Console]::In.ReadToEnd();",
    "$fso = [Activator]::CreateInstance([type]::GetTypeFromProgID('Scripting.FileSystemObject'));",
    "$fso.GetFolder($path).ShortPath",
  ].join(" ");
  const result = spawnSync(
    powershell,
    ["-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      input: path,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function runPackager(fixture, args, environment = {}) {
  return spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--root",
      fixture.root,
      "--bundle-dir",
      fixture.bundleDir,
      ...args,
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        ...process.env,
        ATLASTERM_RELEASE_GIT_COMMAND: "ignored-fake-git",
        ATLASTERM_RELEASE_POWERSHELL_COMMAND: "ignored-fake-powershell",
        ATLASTERM_RELEASE_SIGNTOOL_COMMAND: "ignored-fake-signtool",
        ...environment,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function writeJson(path, value) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
