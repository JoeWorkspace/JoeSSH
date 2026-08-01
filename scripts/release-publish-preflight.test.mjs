import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildCargoCycloneDx } from "./release-sbom-contract.mjs";
import { verifyCanonicalReleaseCandidate } from "./release-candidate-github-contract.mjs";
import { buildThirdPartyLicenseBundle } from "./third-party-license-contract.mjs";
import {
  canonicalNpmSbomFixture,
  canonicalNpmPackageLockEntryFixture,
  materializeThirdPartyLicenseSourceArchives,
  writePublishedLicenseSourceInputFixture,
} from "./release-sbom-test-fixtures.mjs";

const PREFLIGHT_SCRIPT_PATH = fileURLToPath(
  new URL("./release-publish-preflight.mjs", import.meta.url),
);
const WEB_PACKAGER_PATH = fileURLToPath(
  new URL("./package-web-release.mjs", import.meta.url),
);
const RUST_SBOM_BOUNDARY =
  "All non-development packages reachable from the Rust workspace members, including normal and build dependencies.";
const TAURI_SBOM_BOUNDARY =
  "All non-development packages reachable from the Tauri shell workspace members, including normal and build dependencies.";
const STRICT_DEPLOYMENT_HEADERS = `/*
  Content-Security-Policy: frame-ancestors 'none'
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()
`;

function createReleaseFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-publish-preflight-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(
    root,
    "package.json",
    JSON.stringify({ name: "atlasterm", version: "0.1.0-beta.1" }),
  );
  writeFile(
    root,
    "package-lock.json",
    JSON.stringify({
      lockfileVersion: 3,
      name: "atlasterm",
      packages: {
        "": { name: "atlasterm", version: "0.1.0-beta.1" },
        "node_modules/@tauri-apps/api": { version: "2.5.0" },
        "node_modules/@tauri-apps/cli": { version: "2.11.3" },
        "node_modules/desktop-dependency":
          canonicalNpmPackageLockEntryFixture("desktop-dependency"),
        "node_modules/web-dependency":
          canonicalNpmPackageLockEntryFixture("web-dependency"),
      },
      requires: true,
      version: "0.1.0-beta.1",
    }),
  );
  writeFile(
    root,
    "Cargo.lock",
    cargoLockFixture([
      ["atlasterm-sync", "0.1.0-beta.1"],
      ["example-dependency", "1.0.0", "a".repeat(64)],
    ]),
  );
  writeFile(
    root,
    "apps/desktop/src-tauri/Cargo.lock",
    cargoLockFixture([
      ["tauri", "2.8.5"],
      ["example-dependency", "1.0.0", "a".repeat(64)],
    ]),
  );
  writeFile(root, "docs/release-checklist.md", "# Public Beta release notes\n");
  writeFile(
    root,
    "docs/release-notes/0.1.0-beta.1.md",
    "# JoeSSH 0.1.0-beta.1\n",
  );
  writeReleaseSbomFixture(root);
  materializeThirdPartyLicenseSourceArchives(root);
  writeSourceCommandFixtures(root);
  writePublishedLicenseFixture(root);

  const desktopArtifacts = [
    [
      "desktop installer",
      "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
    ],
    ["macos dmg", "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg"],
    [
      "linux appimage",
      "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage",
    ],
  ];
  for (const [content, path] of desktopArtifacts) {
    writeFile(root, path, content);
  }

  writeWebDistFixture(root);
  runWebPackager(root);
  writeFile(
    root,
    "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64",
    "sync binary",
  );
  writeManifest(
    root,
    "reports/release/desktop/SHA256SUMS.txt",
    desktopArtifacts,
  );
  writeManifest(root, "reports/release/sync/SHA256SUMS.txt", [
    ["sync binary", "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64"],
  ]);
  const syncEvidence = JSON.stringify(
    {
      artifact: "sync-backup-restore-smoke",
      binary: "reports/release/sync/joessh-sync-0.1.0-beta.1-linux-x64",
      binaryKind: "packaged-release",
      binaryManifest: "reports/release/sync/SHA256SUMS.txt",
      binarySha256: sha256("sync binary"),
      evidenceVersion: 1,
      platform: "linux",
      recovery: { rtoMs: 123 },
      version: "0.1.0-beta.1",
    },
    null,
    2,
  );
  writeFile(
    root,
    "reports/release/sync/backup-restore-smoke.json",
    `${syncEvidence}\n`,
  );
  writeManifest(
    root,
    "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
    [[`${syncEvidence}\n`, "reports/release/sync/backup-restore-smoke.json"]],
  );
  const desktopEvidence = JSON.stringify(
    {
      artifacts: [
        {
          path: "reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe",
          platform: "windows",
          sha256: sha256("desktop installer"),
          signed: true,
          signatureVerification:
            "signtool verify /pa reports/release/desktop/JoeSSH_0.1.0-beta.1_x64-setup.exe passed",
        },
        {
          path: "reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg",
          platform: "macos",
          sha256: sha256("macos dmg"),
          signed: true,
          notarized: true,
          signatureVerification:
            "codesign --verify reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
          notarizationVerification:
            "spctl --assess reports/release/desktop/JoeSSH_0.1.0-beta.1_aarch64.dmg passed",
        },
        {
          path: "reports/release/desktop/JoeSSH_0.1.0-beta.1_amd64.AppImage",
          platform: "linux",
          sha256: sha256("linux appimage"),
          packageType: "AppImage",
        },
      ],
    },
    null,
    2,
  );
  writeFile(
    root,
    "reports/release/desktop/release-evidence.json",
    desktopEvidence,
  );
  const desktopEvidenceSource = desktopEvidenceSourceFixture();
  writeFile(
    root,
    "reports/release/desktop/release-evidence-source.json",
    desktopEvidenceSource,
  );
  writeManifest(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    [
      [desktopEvidence, "reports/release/desktop/release-evidence.json"],
      [
        desktopEvidenceSource,
        "reports/release/desktop/release-evidence-source.json",
      ],
    ],
  );
  writeReleaseProvenanceFixture(root);

  return root;
}

function desktopEvidenceSourceFixture() {
  return JSON.stringify(
    {
      artifactName: "desktop-release-evidence",
      formalEvidenceJob: {
        conclusion: "success",
        databaseId: 123456780,
        name: "Package Formal Desktop Evidence",
        status: "completed",
      },
      importedAt: "2026-06-21T00:00:00.000Z",
      releaseRef: "v0.1.0-beta.1",
      releaseTagCommit: "abc123",
      repository: "JoeWorkspace/JoeSSH",
      sourceVersion: 1,
      workflowRun: {
        conclusion: "success",
        headSha: "abc123",
        id: "123456789",
        status: "completed",
        url: "https://github.example/actions/runs/123456789",
        workflowDatabaseId: 987654321,
        workflowName: "Desktop Release Artifacts",
      },
    },
    null,
    2,
  );
}

function writeWebDistFixture(root) {
  const files = {
    "apps/web/dist/.well-known/security.txt":
      "Contact: mailto:security@example.com\n",
    "apps/web/dist/_headers": STRICT_DEPLOYMENT_HEADERS,
    "apps/web/dist/404.html": "<!doctype html><title>Not Found</title>",
    "apps/web/dist/assets/app.js": "console.log('joessh web admin');",
    "apps/web/dist/assets/index.css": "body { color: #111; }",
    "apps/web/dist/favicon.svg":
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    "apps/web/dist/humans.txt": "JoeSSH Team\n",
    "apps/web/dist/index.html": '<!doctype html><div id="root"></div>',
    "apps/web/dist/manifest.json": JSON.stringify({
      icons: [{ src: "/favicon.svg", sizes: "any" }],
      name: "JoeSSH Admin",
      scope: "/",
      start_url: "/",
    }),
    "apps/web/dist/offline.html": "<!doctype html><title>Offline</title>",
    "apps/web/dist/robots.txt": "User-agent: *\nDisallow:\n",
    "apps/web/dist/sw.js": "self.addEventListener('fetch', () => {});",
  };

  for (const [relativePath, contents] of Object.entries(files)) {
    writeFile(root, relativePath, contents);
  }
}

function runWebPackager(root) {
  const result = spawnSync(
    process.execPath,
    [WEB_PACKAGER_PATH, "--root", root],
    {
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function writeReleaseSbomFixture(root) {
  const rustMetadata = cargoMetadataFixture("atlasterm-sync");
  const tauriMetadata = cargoMetadataFixture("atlasterm-desktop-shell");
  const sbomFiles = [
    ["reports/release/npm-desktop-sbom.cdx.json", cyclonedxFixture("desktop")],
    ["reports/release/npm-web-sbom.cdx.json", cyclonedxFixture("web")],
    [
      "reports/release/cargo-workspace-sbom.cdx.json",
      buildCargoCycloneDx(rustMetadata, readFile(root, "Cargo.lock"), {
        boundary: RUST_SBOM_BOUNDARY,
        packageName: "atlasterm-rust-workspace",
        packageVersion: "0.1.0-beta.1",
        rootPath: root,
      }),
    ],
    [
      "reports/release/tauri-cargo-sbom.cdx.json",
      buildCargoCycloneDx(
        tauriMetadata,
        readFile(root, "apps/desktop/src-tauri/Cargo.lock"),
        {
          boundary: TAURI_SBOM_BOUNDARY,
          packageName: "atlasterm-tauri-shell",
          packageVersion: "0.1.0-beta.1",
          rootPath: root,
        },
      ),
    ],
  ];
  for (const [path, content] of sbomFiles) {
    writeFile(root, path, content);
  }
  writeFile(
    root,
    "reports/internal/release-inputs/cargo-metadata.json",
    rustMetadata,
  );
  writeFile(
    root,
    "reports/internal/release-inputs/tauri-cargo-metadata.json",
    tauriMetadata,
  );
  writeManifest(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    sbomFiles.map(([path, content]) => [content, path]),
  );
}

function writePublishedLicenseFixture(root) {
  writePublishedLicenseSourceInputFixture(root);
  const { checksumText, manifestText, noticesText } =
    buildThirdPartyLicenseBundle(root);
  writeFile(
    root,
    "reports/release/third-party-licenses/manifest.json",
    manifestText,
  );
  writeFile(
    root,
    "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
    noticesText,
  );
  writeFile(
    root,
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
    checksumText,
  );
}

function cyclonedxFixture(name) {
  return canonicalNpmSbomFixture(name);
}

function cargoMetadataFixture(name) {
  const packageNames =
    name === "atlasterm-desktop-shell"
      ? [
          "atlasterm-desktop-shell",
          "atlasterm-core",
          "example-dependency",
          "russh",
          "russh-sftp",
          "serde",
          "tauri",
          "tokio",
          "uuid",
        ]
      : [
          "atlasterm-core",
          "atlasterm-sync",
          "example-dependency",
          "axum",
          "russh",
          "russh-sftp",
          "serde",
          "tokio",
          "uuid",
        ];
  const workspaceMembers =
    name === "atlasterm-desktop-shell"
      ? ["atlasterm-desktop-shell"]
      : ["atlasterm-core", "atlasterm-sync"];
  const registrySource =
    "registry+https://github.com/rust-lang/crates.io-index";
  const localPackages = new Set([...workspaceMembers, "atlasterm-core"]);
  const packageIds = new Map(
    packageNames.map((packageName) => {
      const version = localPackages.has(packageName) ? "0.1.0-beta.1" : "1.0.0";
      const id = localPackages.has(packageName)
        ? `path+file:///fixture/${packageName}#${packageName}@${version}`
        : `${registrySource}#${packageName}@${version}`;
      return [packageName, id];
    }),
  );
  const dependenciesFor = (packageName) => {
    const dependencies = [];
    if (packageName === "atlasterm-desktop-shell") {
      dependencies.push("atlasterm-core");
    }
    if (packageName === "atlasterm-core" || packageName === "atlasterm-sync") {
      dependencies.push("example-dependency");
    }
    return dependencies.map((dependencyName) => ({
      dep_kinds: [{ kind: null }],
      pkg: packageIds.get(dependencyName),
    }));
  };

  return JSON.stringify({
    packages: packageNames.map((packageName) => ({
      id: packageIds.get(packageName),
      license: "MIT",
      name: packageName,
      source: localPackages.has(packageName) ? null : registrySource,
      version: localPackages.has(packageName) ? "0.1.0-beta.1" : "1.0.0",
    })),
    resolve: {
      nodes: packageNames.map((packageName) => ({
        deps: dependenciesFor(packageName),
        id: packageIds.get(packageName),
      })),
    },
    workspace_members: workspaceMembers.map((packageName) =>
      packageIds.get(packageName),
    ),
    version: 1,
  });
}

function writeSourceCommandFixtures(root) {
  const binDirectory = join(root, ".test-bin");
  const runnerPath = join(binDirectory, "source-command.mjs");
  mkdirSync(binDirectory, { recursive: true });
  writeFile(
    root,
    ".test-source/cargo-metadata.json",
    readFile(root, "reports/internal/release-inputs/cargo-metadata.json"),
  );
  writeFile(
    root,
    ".test-source/tauri-cargo-metadata.json",
    readFile(root, "reports/internal/release-inputs/tauri-cargo-metadata.json"),
  );
  writeFileSync(
    runnerPath,
    `import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [kind, ...args] = process.argv.slice(2);
const root = process.env.JOESSH_SBOM_TEST_ROOT;
if (!root) {
  throw new Error("JOESSH_SBOM_TEST_ROOT is required.");
}

if (kind === "npm") {
  const workspaceIndex = args.indexOf("--workspace");
  const workspace = workspaceIndex >= 0 ? args[workspaceIndex + 1] : "";
  const target = workspace.endsWith("/desktop")
    ? "desktop"
    : workspace.endsWith("/web")
      ? "web"
      : "";
  if (!target) {
    throw new Error("Unexpected npm SBOM workspace: " + workspace);
  }
  const dependencyName = target + "-dependency";
  const packageLock = JSON.parse(
    readFileSync(resolve(root, "package-lock.json"), "utf8"),
  );
  const dependency = packageLock.packages["node_modules/" + dependencyName];
  if (!dependency || typeof dependency.version !== "string") {
    throw new Error("Fixture package-lock is missing " + dependencyName);
  }
  const digest = Buffer.from(
    dependency.integrity.slice("sha512-".length),
    "base64",
  );
  process.stdout.write(
    JSON.stringify({
      bomFormat: "CycloneDX",
      components: [
        {
          "bom-ref": dependencyName + "@" + dependency.version,
          externalReferences: [
            { type: "distribution", url: dependency.resolved },
          ],
          hashes: [{ alg: "SHA-512", content: digest.toString("hex") }],
          licenses: [{ license: { id: dependency.license } }],
          name: dependencyName,
          properties: [
            {
              name: "cdx:npm:package:path",
              value: "node_modules/" + dependencyName,
            },
          ],
          purl: "pkg:npm/" + dependencyName + "@" + dependency.version,
          scope: "required",
          type: "library",
          version: dependency.version,
        },
      ],
      metadata: { component: { name: packageLock.name } },
      specVersion: "1.5",
      version: 1,
    }),
  );
} else if (kind === "cargo") {
  const normalizedCwd = process.cwd().replaceAll("\\\\", "/");
  const metadataPath = normalizedCwd.endsWith("/apps/desktop/src-tauri")
    ? ".test-source/tauri-cargo-metadata.json"
    : ".test-source/cargo-metadata.json";
  process.stdout.write(readFileSync(resolve(root, metadataPath)));
} else {
  throw new Error("Unexpected fixture command: " + kind);
}
`,
    "utf8",
  );

  for (const command of ["npm", "cargo"]) {
    if (process.platform === "win32") {
      writeFileSync(
        join(binDirectory, `${command}.cmd`),
        `@echo off\r\n"${process.execPath}" "${runnerPath}" ${command} %*\r\n`,
        "utf8",
      );
      continue;
    }
    const commandPath = join(binDirectory, command);
    writeFileSync(
      commandPath,
      `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(runnerPath)} ${command} "$@"\n`,
      "utf8",
    );
    chmodSync(commandPath, 0o755);
  }
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function writeManifest(root, relativePath, entries) {
  writeFile(
    root,
    relativePath,
    entries
      .map(([content, artifactPath]) => `${sha256(content)}  ${artifactPath}`)
      .join("\n") + "\n",
  );
}

function writeReleaseProvenanceFixture(root) {
  const manifestPaths = [
    "reports/release/SBOM-SHA256SUMS.txt",
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
    "reports/release/desktop/SHA256SUMS.txt",
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    "reports/release/sync/SHA256SUMS.txt",
    "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
    "reports/release/web/SHA256SUMS.txt",
  ];
  const provenance = JSON.stringify(
    {
      checksumManifests: manifestPaths.map((path) => ({
        entries: parseManifest(root, path),
        path,
        sha256: sha256(readFile(root, path)),
      })),
      generatedAt: "2026-06-21T00:00:00.000Z",
      lockfiles: [
        "package-lock.json",
        "Cargo.lock",
        "apps/desktop/src-tauri/Cargo.lock",
      ].map((path) => ({ path, sha256: sha256(readFile(root, path)) })),
      product: "JoeSSH",
      provenanceVersion: 1,
      releaseNotes: {
        path: "docs/release-notes/0.1.0-beta.1.md",
        sha256: sha256(readFile(root, "docs/release-notes/0.1.0-beta.1.md")),
      },
      releaseTag: "v0.1.0-beta.1",
      source: {
        cleanTreeExcluding: "reports/release",
        gitCommit: "abc123",
        gitFsckStrict: true,
        releaseTagCommit: "abc123",
        repository: "https://github.com/joessh/joessh.git",
      },
      toolchain: {
        cargo: "cargo 1.88.0 (release-test)",
        node: process.version,
        npm: "10.9.7",
        rustc: "rustc 1.88.0 (release-test)",
        tauri: {
          npmApi: "2.5.0",
          npmCli: "2.11.3",
          rustCrate: "2.8.5",
        },
      },
      verifiers: [
        "verify-artifact-checksums.mjs --all-release",
        "verify-web-release-package.mjs",
        "verify-sync-release-evidence.mjs",
        "verify-desktop-release-evidence.mjs --require-source",
        "verify-release-sbom.mjs",
        "verify-third-party-licenses.mjs",
        "verify-release-provenance.mjs",
      ],
      version: "0.1.0-beta.1",
    },
    null,
    2,
  );
  writeFile(root, "reports/release/release-provenance.json", `${provenance}\n`);
  writeManifest(root, "reports/release/release-provenance-SHA256SUMS.txt", [
    [`${provenance}\n`, "reports/release/release-provenance.json"],
  ]);
}

function parseManifest(root, relativePath) {
  return readFile(root, relativePath)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})\s\s(.+)$/);
      assert.ok(
        match,
        `${relativePath} fixture manifest line should parse: ${line}`,
      );
      return { path: match[2], sha256: match[1] };
    });
}

function readFile(root, relativePath) {
  return readFileSync(join(root, ...relativePath.split("/")), "utf8");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function cargoLockFixture(packages) {
  return packages
    .map(
      ([name, version, checksum]) =>
        `[[package]]\nname = "${name}"\nversion = "${version}"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n${
          checksum ? `checksum = "${checksum}"\n` : ""
        }`,
    )
    .join("\n");
}

function runPreflight(root, env = createFakeGitCommands(root)) {
  return spawnSync(process.execPath, [PREFLIGHT_SCRIPT_PATH, "--root", root], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function runPreflightWithoutFakeGit(root) {
  return spawnSync(process.execPath, [PREFLIGHT_SCRIPT_PATH, "--root", root], {
    encoding: "utf8",
  });
}

function createFakeGitCommands(root, options = {}) {
  const binDir = join(root, "fake-bin");
  mkdirSync(binDir, { recursive: true });
  const state = {
    billingConfirmed: true,
    controlsFail: false,
    duplicateRelease: false,
    dirtyStatus: "",
    ghAuthFails: false,
    mainCommit: "abc123",
    releaseCheckAppId: 15368,
    releaseCheckConclusion: "success",
    releaseCheckHeadSha: "abc123",
    releaseCheckMissing: false,
    releaseCheckPages: null,
    releaseCheckStatus: "completed",
    releaseCheckTotalCount: null,
    releaseChecks: null,
    remoteTagCommit: "abc123",
    remoteTagMissing: false,
    remoteTagObjectSha: "fedcba",
    releaseViewUnknownFails: false,
    tagCommit: "abc123",
    tagMissing: false,
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
  if (state.tagMissing) {
    console.error("fatal: Needed a single revision");
    process.exit(1);
  }
  console.log(state.tagCommit);
  process.exit(0);
}
if (key === "fsck --strict") {
  process.exit(0);
}
if (key === "remote get-url origin") {
  console.log("https://github.com/joessh/joessh.git");
  process.exit(0);
}
console.error("unexpected git args: " + key);
process.exit(2);
`,
    "utf8",
  );

  const fakeGhPath = join(binDir, "gh.js");
  writeFileSync(
    fakeGhPath,
    `
const args = process.argv.slice(2);
const state = ${JSON.stringify(state)};
const key = args.join(" ");
const respond = (value) => {
  console.log(JSON.stringify(value));
  process.exit(0);
};
if (key === "--version") {
  console.log("gh version 2.0.0");
  process.exit(0);
}
if (key === "auth status") {
  if (state.ghAuthFails) {
    console.error("not logged in");
    process.exit(1);
  }
  console.log("Logged in");
  process.exit(0);
}
if (key === "api --method GET repos/JoeWorkspace/JoeSSH/git/ref/tags/v0.1.0-beta.1") {
  if (state.remoteTagMissing) {
    console.error("HTTP 404 tag not found");
    process.exit(1);
  }
  respond({ object: { type: "tag", sha: state.remoteTagObjectSha } });
}
  if (key === "api --method GET repos/JoeWorkspace/JoeSSH/git/tags/" + state.remoteTagObjectSha) {
    respond({ object: { type: "commit", sha: state.remoteTagCommit } });
  }
  if (key === "api --method GET repos/JoeWorkspace/JoeSSH/branches/main") {
    respond({
      commit: { sha: state.mainCommit },
      name: "main",
      protected: true,
    });
  }
const releaseChecksPrefix =
  "api --method GET repos/JoeWorkspace/JoeSSH/commits/abc123/check-runs?check_name=Public%20Release%20Readiness&filter=latest&per_page=100";
if (key === releaseChecksPrefix || key.startsWith(releaseChecksPrefix + "&page=")) {
  const pageMatch = key.match(/&page=([0-9]+)$/);
  const page = pageMatch ? Number(pageMatch[1]) : 1;
  const defaultChecks = state.releaseCheckMissing
    ? []
    : state.releaseChecks ?? [
        {
          app: { id: state.releaseCheckAppId },
          conclusion: state.releaseCheckConclusion,
          head_sha: state.releaseCheckHeadSha,
          id: 123456789,
          name: "Public Release Readiness",
          started_at: "2026-07-31T08:00:00Z",
          status: state.releaseCheckStatus,
        },
      ];
  const checkRuns = state.releaseCheckPages
    ? state.releaseCheckPages[page - 1] ?? []
    : page === 1
      ? defaultChecks
      : [];
  const totalCount =
    state.releaseCheckTotalCount ??
    (state.releaseCheckPages
      ? state.releaseCheckPages.flat().length
      : defaultChecks.length);
  respond({ check_runs: checkRuns, total_count: totalCount });
}
if (key === "release view v0.1.0-beta.1 --repo JoeWorkspace/JoeSSH --json url") {
  if (state.duplicateRelease) {
    console.log('{"url":"https://github.example/releases/v0.1.0-beta.1"}');
    process.exit(0);
  }
  if (state.releaseViewUnknownFails) {
    console.error("network unavailable");
    process.exit(1);
  }
  console.error("release not found");
  process.exit(1);
}
if (key === "api repos/JoeWorkspace/JoeSSH") {
  respond({
    default_branch: "main",
    owner: { id: 1, login: "JoeWorkspace", type: "User" },
    private: false,
    visibility: "public",
  });
}
  if (key === "api repos/JoeWorkspace/JoeSSH/branches/main") {
    respond({ commit: { sha: state.mainCommit }, name: "main", protected: true });
}
if (key === "api repos/JoeWorkspace/JoeSSH/branches/main/protection") {
  respond({
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
    required_conversation_resolution: { enabled: true },
    required_linear_history: { enabled: true },
    required_pull_request_reviews: {
      bypass_pull_request_allowances: { apps: [], teams: [], users: [] },
      require_last_push_approval: false,
      required_approving_review_count: 0,
    },
    required_status_checks: {
      checks: [{ app_id: 15368, context: "Public Release Readiness" }],
      contexts: ["Public Release Readiness"],
      strict: true,
    },
  });
}
if (key === "api repos/JoeWorkspace/JoeSSH/private-vulnerability-reporting") {
  respond({ enabled: !state.controlsFail });
}
const environmentPrefix =
  "api repos/JoeWorkspace/JoeSSH/environments/";
if (
  key.startsWith(environmentPrefix) &&
  !key.includes("/secrets?per_page=100")
) {
  const name = key.slice(environmentPrefix.length);
  if (
    name === "windows-invite-stage-a" ||
    name === "windows-release-stage-b"
  ) {
    respond({
      can_admins_bypass: false,
      deployment_branch_policy: {
        custom_branch_policies: false,
        protected_branches: true,
      },
      name,
      protection_rules: [
        {
          prevent_self_review: false,
          reviewers: [
            {
              reviewer: { id: 1, login: "JoeWorkspace" },
              type: "User",
            },
          ],
          type: "required_reviewers",
        },
      ],
    });
  }
}
if (key.endsWith("/secrets?per_page=100 --paginate --slurp")) {
  respond([{ secrets: [], total_count: 0 }]);
}
if (
  key ===
  "api repos/JoeWorkspace/JoeSSH/actions/artifacts?per_page=100 --paginate --slurp"
) {
  respond([{ artifacts: [], total_count: 0 }]);
}
if (key === "api repos/JoeWorkspace/JoeSSH/actions/cache/usage") {
  respond({ active_caches_count: 0, active_caches_size_in_bytes: 0 });
}
console.error("unexpected gh args: " + key);
process.exit(2);
`,
    "utf8",
  );

  const fakeToolPath = join(binDir, "tool.js");
  writeFileSync(
    fakeToolPath,
    `
const [tool, ...args] = process.argv.slice(2);
if (args.join(" ") !== "--version") {
  console.error("unexpected tool args: " + [tool, ...args].join(" "));
  process.exit(2);
}
const versions = {
  npm: "10.9.7",
  cargo: "cargo 1.88.0 (release-test)",
  rustc: "rustc 1.88.0 (release-test)",
};
console.log(versions[tool] ?? "");
process.exit(versions[tool] ? 0 : 2);
`,
    "utf8",
  );

  const pathKey =
    Object.keys(process.env).find((key) => key.toLowerCase() === "path") ??
    "PATH";
  return {
    ATLASTERM_RELEASE_CARGO_ARGS: JSON.stringify([fakeToolPath, "cargo"]),
    ATLASTERM_RELEASE_CARGO_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GH_ARGS: JSON.stringify([fakeGhPath]),
    ATLASTERM_RELEASE_GH_COMMAND: process.execPath,
    ATLASTERM_RELEASE_GIT_ARGS: JSON.stringify([fakeGitPath]),
    ATLASTERM_RELEASE_GIT_COMMAND: process.execPath,
    ATLASTERM_RELEASE_NPM_ARGS: JSON.stringify([fakeToolPath, "npm"]),
    ATLASTERM_RELEASE_NPM_COMMAND: process.execPath,
    ATLASTERM_RELEASE_RUSTC_ARGS: JSON.stringify([fakeToolPath, "rustc"]),
    ATLASTERM_RELEASE_RUSTC_COMMAND: process.execPath,
    JOESSH_GITHUB_BILLING_CONFIRMED: state.billingConfirmed ? "1" : "0",
    JOESSH_SBOM_TEST_ROOT: root,
    [pathKey]: `${join(root, ".test-bin")}${delimiter}${
      process.env[pathKey] ?? ""
    }`,
  };
}

test("publish preflight verifies checksums, evidence, SBOM, provenance, and release draft dry run", (t) => {
  const result = runPreflight(createReleaseFixture(t));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Verify release Git checkout/);
  assert.match(
    result.stdout,
    /Verified clean Git checkout at v0\.1\.0-beta\.1/,
  );
  assert.match(result.stdout, /Verify GitHub CLI publish readiness/);
  assert.match(
    result.stdout,
    /Verified GitHub CLI authentication, remote v0\.1\.0-beta\.1 at abc123, protected main, successful Public Release Readiness check, and no existing release in JoeWorkspace\/JoeSSH/,
  );
  assert.match(result.stdout, /Verify GitHub release controls/);
  assert.match(result.stdout, /GitHub release controls: PASS/);
  assert.match(result.stdout, /Verify release artifact checksums/);
  assert.match(result.stdout, /Verify Web Admin release package/);
  assert.match(result.stdout, /Verify Sync release evidence/);
  assert.match(result.stdout, /Verify Desktop signing\/distribution evidence/);
  assert.match(result.stdout, /Verify release SBOM/);
  assert.match(result.stdout, /Verify third-party license bundle/);
  assert.match(result.stdout, /Verify release provenance/);
  assert.match(
    result.stdout,
    /Release draft dry run passed for v0\.1\.0-beta\.1/,
  );
  assert.match(result.stdout, /Public release publish preflight passed/);
});

test("publish preflight blocks when lock-bound license source evidence fails", (t) => {
  const root = createReleaseFixture(t);
  writeFile(root, "node_modules/desktop-dependency/LICENSE", "tampered\n");

  const result = runPreflight(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /does not byte-match its lockfile-bound source archive/,
  );
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify third-party license bundle/,
  );
});

test("publish preflight rejects missing Git checkout metadata", (t) => {
  const result = runPreflightWithoutFakeGit(createReleaseFixture(t));

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Git checkout metadata is required for publish preflight/,
  );
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify release Git checkout/,
  );
});

test("publish preflight rejects a dirty Git working tree", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { dirtyStatus: " M package.json" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Git working tree outside reports\/release must be clean for publish preflight/,
  );
  assert.match(result.stderr, /M package\.json/);
});

test("publish preflight rejects a release tag that does not point at HEAD", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { tagCommit: "def456" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Release tag v0\.1\.0-beta\.1 must point at HEAD for publish preflight/,
  );
});

test("publish preflight rejects unauthenticated GitHub CLI state", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { ghAuthFails: true }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /GitHub CLI must be authenticated for publish preflight/,
  );
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub CLI publish readiness/,
  );
});

test("publish preflight rejects a missing remote release tag", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { remoteTagMissing: true }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Unable to query remote release tag v0\.1\.0-beta\.1: HTTP 404 tag not found/,
  );
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub CLI publish readiness/,
  );
});

test("publish preflight rejects a remote release tag at another commit", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { remoteTagCommit: "def456" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Remote release tag v0\.1\.0-beta\.1 points at def456; expected reviewed commit abc123/,
  );
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub CLI publish readiness/,
  );
});

test("publish preflight rejects a topic-branch commit that is not protected main", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { mainCommit: "def456" }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Release candidate abc123 must exactly equal protected main commit def456/,
  );
});

test("publish preflight requires the exact successful release-readiness check", async (t) => {
  const cases = [
    ["missing", { releaseCheckMissing: true }, /must have a latest/],
    [
      "pending",
      { releaseCheckConclusion: null, releaseCheckStatus: "in_progress" },
      /completed\/success; received in_progress\/unreadable/,
    ],
    [
      "failed",
      { releaseCheckConclusion: "failure" },
      /completed\/success; received completed\/failure/,
    ],
    ["wrong app", { releaseCheckAppId: 42 }, /GitHub Actions App 15368/],
    [
      "wrong SHA",
      { releaseCheckHeadSha: "def456" },
      /check run is bound to def456; expected release candidate abc123/,
    ],
  ];

  for (const [name, options, diagnostic] of cases) {
    await t.test(name, (subtest) => {
      const root = createReleaseFixture(subtest);
      const result = runPreflight(root, createFakeGitCommands(root, options));
      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
    });
  }
});

test("publish preflight selects the newest readiness check across check suites", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, {
      releaseChecks: [
        {
          app: { id: 15368 },
          conclusion: "failure",
          head_sha: "abc123",
          id: 123456788,
          name: "Public Release Readiness",
          started_at: "2026-07-31T07:00:00Z",
          status: "completed",
        },
        {
          app: { id: 15368 },
          conclusion: "success",
          head_sha: "abc123",
          id: 123456789,
          name: "Public Release Readiness",
          started_at: "2026-07-31T08:00:00Z",
          status: "completed",
        },
      ],
    }),
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("publish preflight rejects a newer unsuccessful readiness check", async (t) => {
  for (const [name, status, conclusion, diagnostic] of [
    ["pending", "in_progress", null, /in_progress\/unreadable/],
    ["failed", "completed", "failure", /completed\/failure/],
  ]) {
    await t.test(name, (subtest) => {
      const root = createReleaseFixture(subtest);
      const result = runPreflight(
        root,
        createFakeGitCommands(root, {
          releaseChecks: [
            {
              app: { id: 15368 },
              conclusion: "success",
              head_sha: "abc123",
              id: 123456788,
              name: "Public Release Readiness",
              started_at: "2026-07-31T07:00:00Z",
              status: "completed",
            },
            {
              app: { id: 15368 },
              conclusion,
              head_sha: "abc123",
              id: 123456789,
              name: "Public Release Readiness",
              started_at: "2026-07-31T08:00:00Z",
              status,
            },
          ],
        }),
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, diagnostic);
    });
  }
});

test("publish preflight rejects duplicate GitHub releases", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { duplicateRelease: true }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /GitHub Release v0\.1\.0-beta\.1 already exists/);
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub CLI publish readiness/,
  );
});

test("publish preflight rejects ambiguous GitHub release lookup failures", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { releaseViewUnknownFails: true }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Unable to confirm GitHub Release v0\.1\.0-beta\.1 does not already exist/,
  );
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub CLI publish readiness/,
  );
});

test("publish preflight rejects failing GitHub release controls", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, { controlsFail: true }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL private-vulnerability-reporting/);
  assert.match(result.stdout, /GitHub release controls: FAIL/);
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub release controls/,
  );
});

test("publish preflight fails when Desktop evidence is missing", (t) => {
  const root = createReleaseFixture(t);
  rmSync(join(root, "reports", "release", "desktop", "release-evidence.json"));
  rmSync(
    join(
      root,
      "reports",
      "release",
      "desktop",
      "release-evidence-SHA256SUMS.txt",
    ),
  );

  const result = runPreflight(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing desktop release evidence/);
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify Desktop signing\/distribution evidence/,
  );
});

test("publish preflight rejects Desktop evidence without workflow source provenance", (t) => {
  const root = createReleaseFixture(t);
  rmSync(
    join(root, "reports", "release", "desktop", "release-evidence-source.json"),
  );
  writeManifest(
    root,
    "reports/release/desktop/release-evidence-SHA256SUMS.txt",
    [
      [
        readFile(root, "reports/release/desktop/release-evidence.json"),
        "reports/release/desktop/release-evidence.json",
      ],
    ],
  );

  const result = runPreflight(root);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing desktop evidence source sidecar/);
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify Desktop signing\/distribution evidence/,
  );
});

test("release candidate contract verifies complete stable pagination boundaries", async (t) => {
  for (const count of [0, 1, 100, 101, 200, 201]) {
    await t.test(String(count), () => {
      const checks = contractCheckSet(count);
      if (count === 0) {
        assert.throws(
          () => verifyContractResponses(stableContractResponses(checks)),
          /must have a latest Public Release Readiness check run/,
        );
        return;
      }

      const result = verifyContractResponses(stableContractResponses(checks));
      assert.equal(result.checkRunId, 1);
    });
  }
});

test("release candidate contract rechecks protected main after readiness", () => {
  assert.throws(
    () =>
      verifyContractResponses(stableContractResponses(contractCheckSet(1)), [
        "abc123",
        "def456",
      ]),
    /Release candidate abc123 must exactly equal protected main commit def456/,
  );
});

test("release candidate contract selects the newest check from later pages", async (t) => {
  for (const [name, status, conclusion, diagnostic] of [
    ["success", "completed", "success", null],
    ["pending", "in_progress", null, /in_progress\/unreadable/],
    ["failure", "completed", "failure", /completed\/failure/],
  ]) {
    await t.test(name, () => {
      const checks = paginatedContractChecks({ conclusion, status });
      if (diagnostic === null) {
        const result = verifyContractResponses(stableContractResponses(checks));
        assert.equal(result.checkRunId, 101);
        return;
      }
      assert.throws(
        () => verifyContractResponses(stableContractResponses(checks)),
        diagnostic,
      );
    });
  }
});

test("release candidate contract rejects incomplete or unstable pagination", async (t) => {
  const firstPage = contractCheckSet(100);
  const laterSuccess = contractCheck(101, {
    appId: 15368,
    startedAt: "2026-07-31T08:00:00Z",
  });
  const cases = [
    [
      "changing total_count",
      [
        contractResponse(1, firstPage, 101),
        contractResponse(2, [laterSuccess], 102),
      ],
      /total_count changed during pagination/,
    ],
    [
      "duplicate across pages",
      [
        contractResponse(1, firstPage, 101),
        contractResponse(2, [firstPage.at(-1)], 101),
      ],
      /check run ID 100 was repeated during pagination/,
    ],
    [
      "empty middle page",
      [contractResponse(1, firstPage, 201), contractResponse(2, [], 201)],
      /page 2 contained 0 entries; expected 100/,
    ],
    [
      "short final page",
      [
        contractResponse(1, firstPage, 200),
        contractResponse(2, contractCheckSet(99, 101), 200),
      ],
      /page 2 contained 99 entries; expected 100/,
    ],
    [
      "later request failure",
      [
        contractResponse(1, firstPage, 101),
        { error: new Error("page 2 unavailable"), page: 2 },
      ],
      /page 2 unavailable/,
    ],
  ];

  for (const [name, responses, diagnostic] of cases) {
    await t.test(name, () => {
      assert.throws(() => verifyContractResponses(responses), diagnostic);
    });
  }
});

test("release candidate contract rejects a changed second pagination pass", () => {
  const firstPass = paginatedContractChecks({
    conclusion: "success",
    status: "completed",
  });
  const secondPass = paginatedContractChecks({
    conclusion: null,
    status: "in_progress",
  });

  assert.throws(
    () =>
      verifyContractResponses([
        ...contractResponses(firstPass),
        ...contractResponses(secondPass),
      ]),
    /check runs changed while GitHub pagination was being verified/,
  );
});

test("release candidate contract rejects invalid counts and duplicate page entries", async (t) => {
  const duplicatePage = contractCheckSet(100);
  duplicatePage[99] = duplicatePage[98];
  const cases = [
    ["negative total", [contractResponse(1, [], -1)], /invalid total_count/],
    ["fractional total", [contractResponse(1, [], 1.5)], /invalid total_count/],
    [
      "too many pages",
      [contractResponse(1, contractCheckSet(100), 10_001)],
      /too many Public Release Readiness check runs/,
    ],
    [
      "duplicate within page",
      [contractResponse(1, duplicatePage, 100)],
      /check run ID 99 was repeated during pagination/,
    ],
  ];

  for (const [name, responses, diagnostic] of cases) {
    await t.test(name, () => {
      assert.throws(() => verifyContractResponses(responses), diagnostic);
    });
  }
});

test("publish preflight rejects a newer pending readiness check hidden on page two", (t) => {
  const root = createReleaseFixture(t);
  const result = runPreflight(
    root,
    createFakeGitCommands(root, {
      releaseCheckPages: contractResponses(
        paginatedContractChecks({ conclusion: null, status: "in_progress" }),
      ).map(({ check_runs: checkRuns }) => checkRuns),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /in_progress\/unreadable/);
  assert.match(
    result.stderr,
    /Public release publish preflight failed: Verify GitHub CLI publish readiness/,
  );
});

function contractCheck(id, options = {}) {
  return {
    app: { id: options.appId ?? 42 },
    conclusion: "conclusion" in options ? options.conclusion : "success",
    head_sha: options.headSha ?? "abc123",
    id,
    name: "Public Release Readiness",
    started_at:
      options.startedAt ??
      new Date(Date.UTC(2026, 6, 31, 0, 0, id)).toISOString(),
    status: options.status ?? "completed",
  };
}

function contractCheckSet(count, firstId = 1) {
  const checks = Array.from({ length: count }, (_, index) =>
    contractCheck(firstId + index),
  );
  if (firstId === 1 && checks.length > 0) {
    checks[0] = contractCheck(1, {
      appId: 15368,
      startedAt: "2026-07-31T07:00:00Z",
    });
  }
  return checks;
}

function paginatedContractChecks({ conclusion, status }) {
  return [
    ...contractCheckSet(100),
    contractCheck(101, {
      appId: 15368,
      conclusion,
      startedAt: "2026-07-31T08:00:00Z",
      status,
    }),
  ];
}

function contractResponse(page, checkRuns, totalCount) {
  return { check_runs: checkRuns, page, total_count: totalCount };
}

function contractResponses(checkRuns) {
  const pageCount = Math.max(1, Math.ceil(checkRuns.length / 100));
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1;
    return contractResponse(
      page,
      checkRuns.slice(index * 100, page * 100),
      checkRuns.length,
    );
  });
}

function stableContractResponses(checkRuns) {
  const responses = contractResponses(checkRuns);
  return responses.length === 1 ? responses : [...responses, ...responses];
}

function verifyContractResponses(responses, branchCommits = ["abc123"]) {
  let branchIndex = 0;
  let responseIndex = 0;
  return verifyCanonicalReleaseCandidate({
    candidateCommit: "abc123",
    readGithubJson(endpoint) {
      if (endpoint === "repos/JoeWorkspace/JoeSSH/branches/main") {
        const commit =
          branchCommits[Math.min(branchIndex, branchCommits.length - 1)];
        branchIndex += 1;
        return {
          commit: { sha: commit },
          name: "main",
          protected: true,
        };
      }

      const response = responses[responseIndex];
      assert.ok(response, `unexpected check-runs request: ${endpoint}`);
      responseIndex += 1;
      const expectedEndpoint =
        "repos/JoeWorkspace/JoeSSH/commits/abc123/check-runs?" +
        "check_name=Public%20Release%20Readiness&filter=latest&per_page=100" +
        (response.page === 1 ? "" : `&page=${response.page}`);
      assert.equal(endpoint, expectedEndpoint);
      if (response.error) {
        throw response.error;
      }
      return {
        check_runs: response.check_runs,
        total_count: response.total_count,
      };
    },
    repository: "JoeWorkspace/JoeSSH",
  });
}
