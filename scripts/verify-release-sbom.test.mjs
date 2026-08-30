import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildCargoCycloneDx,
  canonicalizeNpmCycloneDx,
  inspectCanonicalCargoCycloneDx,
} from "./release-sbom-contract.mjs";
import { verifyVendoredRustPackage } from "./vendored-rust-contract.mjs";

const CHECKER_PATH = fileURLToPath(
  new URL("./verify-release-sbom.mjs", import.meta.url),
);
const VERSION = "0.1.0-beta.10";
const RUST_BOUNDARY =
  "All non-development packages reachable from the Rust workspace members, including normal and build dependencies.";
const TAURI_BOUNDARY =
  "All non-development packages reachable from the Tauri shell workspace members, including normal and build dependencies.";
const CARGO_LOCK_FIXTURE = `version = 4

[[package]]
name = "example-dependency"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"a".repeat(64)}"
`;

function createFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-sbom-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  writeFile(
    root,
    "package.json",
    `${JSON.stringify({ name: "atlasterm", version: VERSION })}\n`,
  );
  writeSourceInputs(root);
  writeSbomFiles(root);
  writeSourceCommandFixtures(root);
  writeSbomManifest(root);
  return root;
}

function writeSbomFiles(root, overrides = {}) {
  const rustMetadata = bindLocalFixtureManifests(
    root,
    overrides["reports/internal/release-inputs/cargo-metadata.json"] ??
      rustWorkspaceCargoMetadataFixture(),
  );
  const tauriMetadata = bindLocalFixtureManifests(
    root,
    overrides["reports/internal/release-inputs/tauri-cargo-metadata.json"] ??
      tauriCargoMetadataFixture(),
  );
  const files = {
    "reports/release/npm-desktop-sbom.cdx.json": cyclonedxFixture("desktop"),
    "reports/release/npm-web-sbom.cdx.json": cyclonedxFixture("web"),
    "reports/release/cargo-workspace-sbom.cdx.json": cargoCyclonedxFixture(
      root,
      rustMetadata,
      "atlasterm-rust-workspace",
      RUST_BOUNDARY,
    ),
    "reports/release/tauri-cargo-sbom.cdx.json": cargoCyclonedxFixture(
      root,
      tauriMetadata,
      "atlasterm-tauri-shell",
      TAURI_BOUNDARY,
    ),
    "reports/internal/release-inputs/cargo-metadata.json": rustMetadata,
    "reports/internal/release-inputs/tauri-cargo-metadata.json": tauriMetadata,
    ...overrides,
  };
  files["reports/internal/release-inputs/cargo-metadata.json"] = rustMetadata;
  files["reports/internal/release-inputs/tauri-cargo-metadata.json"] =
    tauriMetadata;

  for (const [path, content] of Object.entries(files)) {
    writeFile(root, path, content);
  }
}

function bindLocalFixtureManifests(root, input) {
  const metadata = JSON.parse(input);
  const manifests = {
    "atlasterm-core": "crates/core/Cargo.toml",
    "atlasterm-sync": "services/sync/Cargo.toml",
    "atlasterm-desktop-shell": "apps/desktop/src-tauri/Cargo.toml",
  };
  for (const entry of metadata.packages ?? []) {
    if (entry.source === null && manifests[entry.name]) {
      entry.manifest_path = resolve(root, manifests[entry.name]);
      writeFile(
        root,
        manifests[entry.name],
        `[package]\nname = "${entry.name}"\nversion = "${entry.version}"\nlicense = "MIT"\n`,
      );
    }
  }
  return JSON.stringify(metadata);
}

function writeSbomManifest(root) {
  const paths = [
    "reports/release/npm-desktop-sbom.cdx.json",
    "reports/release/npm-web-sbom.cdx.json",
    "reports/release/cargo-workspace-sbom.cdx.json",
    "reports/release/tauri-cargo-sbom.cdx.json",
  ];
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    paths.map((path) => `${sha256File(root, path)}  ${path}`).join("\n") + "\n",
  );
}

function writeSourceInputs(root) {
  writeFile(
    root,
    "package-lock.json",
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        name: "atlasterm",
        packages: {
          "": { name: "atlasterm", version: VERSION },
          "node_modules/desktop-dependency": { version: "1.0.0" },
          "node_modules/web-dependency": { version: "1.0.0" },
        },
        requires: true,
        version: VERSION,
      },
      null,
      2,
    )}\n`,
  );
  writeFile(root, "Cargo.lock", CARGO_LOCK_FIXTURE);
  writeFile(root, "apps/desktop/src-tauri/Cargo.lock", CARGO_LOCK_FIXTURE);
}

function writeSourceCommandFixtures(root) {
  const binDirectory = join(root, ".test-bin");
  const runnerPath = join(binDirectory, "source-command.mjs");
  mkdirSync(binDirectory, { recursive: true });
  writeFile(
    root,
    ".test-source/cargo-metadata.json",
    readFileSync(
      join(
        root,
        "reports",
        "internal",
        "release-inputs",
        "cargo-metadata.json",
      ),
      "utf8",
    ),
  );
  writeFile(
    root,
    ".test-source/tauri-cargo-metadata.json",
    readFileSync(
      join(
        root,
        "reports",
        "internal",
        "release-inputs",
        "tauri-cargo-metadata.json",
      ),
      "utf8",
    ),
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
  process.stdout.write(
    JSON.stringify({
      bomFormat: "CycloneDX",
      components: [{ name: dependencyName, version: dependency.version }],
      metadata: { component: { name: packageLock.name } },
      specVersion: "1.5",
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

function cyclonedxFixture(name) {
  return stableJson({
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    metadata: { component: { name: "atlasterm" } },
    components: [{ name: `${name}-dependency`, version: "1.0.0" }],
  });
}

function cargoCyclonedxFixture(root, metadata, packageName, boundary) {
  return buildCargoCycloneDx(metadata, CARGO_LOCK_FIXTURE, {
    boundary,
    packageName,
    packageVersion: VERSION,
    rootPath: root,
  });
}

function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJson(value[key])]),
  );
}

function rustWorkspaceCargoMetadataFixture(
  packageNames = [
    "atlasterm-core",
    "atlasterm-sync",
    "example-dependency",
    "axum",
    "russh",
    "russh-sftp",
    "serde",
    "tokio",
    "uuid",
  ],
) {
  return cargoMetadataFixture(packageNames, [
    "atlasterm-core",
    "atlasterm-sync",
  ]);
}

function tauriCargoMetadataFixture(
  packageNames = [
    "atlasterm-desktop-shell",
    "atlasterm-core",
    "example-dependency",
    "russh",
    "russh-sftp",
    "serde",
    "tauri",
    "tokio",
    "uuid",
  ],
) {
  return cargoMetadataFixture(packageNames, ["atlasterm-desktop-shell"]);
}

function cargoMetadataFixture(packageNames, workspacePackageNames) {
  const registrySource =
    "registry+https://github.com/rust-lang/crates.io-index";
  const localPackageNames = new Set([
    ...workspacePackageNames,
    "atlasterm-core",
  ]);
  const packageIds = new Map(
    packageNames.map((name) => {
      const version = localPackageNames.has(name) ? VERSION : "1.0.0";
      const id = localPackageNames.has(name)
        ? `path+file:///fixture/${name}#${name}@${version}`
        : `${registrySource}#${name}@${version}`;
      return [name, id];
    }),
  );
  const dependenciesFor = (name) => {
    const dependencyNames = [];
    if (
      name === "atlasterm-desktop-shell" &&
      packageIds.has("atlasterm-core")
    ) {
      dependencyNames.push("atlasterm-core");
    }
    if (
      (name === "atlasterm-core" || name === "atlasterm-sync") &&
      packageIds.has("example-dependency")
    ) {
      dependencyNames.push("example-dependency");
    }
    return dependencyNames.map((dependencyName) => ({
      dep_kinds: [{ kind: null }],
      pkg: packageIds.get(dependencyName),
    }));
  };
  return JSON.stringify({
    packages: packageNames.map((name) => ({
      id: packageIds.get(name),
      license: "MIT",
      name,
      source: localPackageNames.has(name) ? null : registrySource,
      version: localPackageNames.has(name) ? VERSION : "1.0.0",
    })),
    resolve: {
      nodes: packageNames.map((name) => ({
        deps: dependenciesFor(name),
        id: packageIds.get(name),
      })),
    },
    workspace_members: workspacePackageNames.map((name) =>
      packageIds.get(name),
    ),
    version: 1,
  });
}

function sha256File(root, relativePath) {
  const path = join(root, ...relativePath.split("/"));
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runChecker(root) {
  const env = { ...process.env };
  const pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${join(root, ".test-bin")}${delimiter}${env[pathKey] ?? ""}`;
  env.JOESSH_SBOM_TEST_ROOT = root;
  return spawnSync(process.execPath, [CHECKER_PATH, "--root", root], {
    encoding: "utf8",
    env,
  });
}

test("accepts complete release SBOM files and checksums", (t) => {
  const result = runChecker(createFixture(t));

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Release SBOM verified for 6 file/);
});

test("canonical npm SBOM output is independent of UUID, timestamp, and checkout name", () => {
  const makeRawSbom = ({ checkoutName, serialNumber, timestamp }) =>
    JSON.stringify({
      serialNumber,
      metadata: {
        timestamp,
        component: {
          name: checkoutName,
          version: "1.2.3",
        },
      },
      specVersion: "1.5",
      bomFormat: "CycloneDX",
      components: [{ version: "1.0.0", name: "dependency" }],
    });

  const first = canonicalizeNpmCycloneDx(
    makeRawSbom({
      checkoutName: "JoeSSH-ui-finalize",
      serialNumber: "urn:uuid:11111111-1111-4111-8111-111111111111",
      timestamp: "2026-07-30T01:02:03.000Z",
    }),
    {
      packageName: "atlasterm",
      rootPath: "C:\\work\\JoeSSH-ui-finalize",
    },
  );
  const second = canonicalizeNpmCycloneDx(
    makeRawSbom({
      checkoutName: "joessh-release-runner-42",
      serialNumber: "urn:uuid:22222222-2222-4222-8222-222222222222",
      timestamp: "2030-01-01T00:00:00.000Z",
    }),
    {
      packageName: "atlasterm",
      rootPath: "/home/runner/work/joessh-release-runner-42",
    },
  );

  assert.equal(first, second);
  assert.doesNotMatch(
    first,
    /serialNumber|timestamp|JoeSSH-ui-finalize|runner-42/,
  );
  assert.match(first, /"name": "atlasterm"/);
});

test("canonical npm SBOM accepts a product name matching the hosted checkout", () => {
  const description =
    "JoeSSH monorepo for a local-first SSH, terminal, SFTP, forwarding, sync, and team workspace product.";
  const rawSbom = JSON.stringify({
    bomFormat: "CycloneDX",
    components: [{ name: "dependency", version: "1.0.0" }],
    metadata: {
      component: {
        description,
        name: "JoeSSH",
        version: "1.2.3",
      },
    },
    specVersion: "1.5",
  });

  const canonical = canonicalizeNpmCycloneDx(rawSbom, {
    packageName: "atlasterm",
    rootPath: "/home/runner/work/JoeSSH/JoeSSH",
  });

  assert.equal(
    JSON.parse(canonical).metadata.component.description,
    description,
  );
});

test("canonical npm SBOM accepts public package names containing a short checkout name", () => {
  const names = ["istanbul-lib-report", "istanbul-reports"];
  const rawSbom = JSON.stringify({
    bomFormat: "CycloneDX",
    components: names.map((name) => ({
      "bom-ref": `${name}@1.0.0`,
      externalReferences: [
        {
          type: "distribution",
          url: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
        },
      ],
      name,
      properties: [
        { name: "cdx:npm:package:path", value: `node_modules/${name}` },
      ],
      purl: `pkg:npm/${name}@1.0.0`,
      version: "1.0.0",
    })),
    dependencies: [
      {
        ref: "istanbul-reports@1.0.0",
        dependsOn: ["istanbul-lib-report@1.0.0"],
      },
    ],
    metadata: { component: { name: "repo", version: "1.2.3" } },
    specVersion: "1.5",
  });
  const canonical = canonicalizeNpmCycloneDx(rawSbom, {
    packageName: "atlasterm",
    rootPath: "/home/runner/work/repo",
  });
  assert.deepEqual(
    JSON.parse(canonical).components.map(({ name }) => name),
    names,
  );
});

for (const value of [
  "repo",
  "checkout=REPO",
  "build-repo-output",
  "../repo/file",
  "/home/runner/work/repo/src/main.rs",
  "C:\\private\\report.txt",
  "file:///opt/report.txt",
]) {
  test(`canonical npm SBOM with a short checkout still rejects local evidence ${value}`, () => {
    const rawSbom = JSON.stringify({
      bomFormat: "CycloneDX",
      components: [
        {
          name: "istanbul-reports",
          version: "1.0.0",
          properties: [{ name: "build-worktree", value }],
        },
      ],
      metadata: { component: { name: "repo", version: "1.2.3" } },
      specVersion: "1.5",
    });
    assert.throws(
      () =>
        canonicalizeNpmCycloneDx(rawSbom, {
          packageName: "atlasterm",
          rootPath: "/home/runner/work/repo",
        }),
      /contains (checkout name repo|an absolute local path)/,
    );
  });
}

test("canonical npm SBOM still rejects a hosted checkout name outside the root description", () => {
  const rawSbom = JSON.stringify({
    bomFormat: "CycloneDX",
    components: [{ name: "dependency", version: "1.0.0" }],
    metadata: {
      component: {
        name: "JoeSSH",
        properties: [{ name: "build-worktree", value: "JoeSSH" }],
        version: "1.2.3",
      },
    },
    specVersion: "1.5",
  });

  assert.throws(
    () =>
      canonicalizeNpmCycloneDx(rawSbom, {
        packageName: "atlasterm",
        rootPath: "/home/runner/work/JoeSSH/JoeSSH",
      }),
    /\$\.metadata\.component\.properties\[0\]\.value contains checkout name JoeSSH/,
  );
});

test("canonical Cargo SBOM is independent of checkout paths and excludes dev-only packages", (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "cargo-sbom-paths-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const makeMetadata = (rootPath) => {
    writeFile(
      rootPath,
      "crates/core/Cargo.toml",
      '[package]\nname = "atlasterm-core"\nversion = "0.1.0-beta.10"\nlicense = "MIT"\n',
    );
    const workspaceId = `path+file:///${rootPath.replaceAll("\\", "/")}/crates/core#atlasterm-core@0.1.0-beta.10`;
    const runtimeId =
      "registry+https://github.com/rust-lang/crates.io-index#runtime-crate@1.0.0";
    const devId =
      "registry+https://github.com/rust-lang/crates.io-index#dev-crate@2.0.0";
    return JSON.stringify({
      packages: [
        {
          id: workspaceId,
          license: "MIT",
          name: "atlasterm-core",
          manifest_path: resolve(rootPath, "crates/core/Cargo.toml"),
          source: null,
          version: "0.1.0-beta.10",
        },
        {
          id: runtimeId,
          license: "MIT OR Apache-2.0",
          name: "runtime-crate",
          source: "registry+https://github.com/rust-lang/crates.io-index",
          version: "1.0.0",
        },
        {
          id: devId,
          license: "MIT",
          name: "dev-crate",
          source: "registry+https://github.com/rust-lang/crates.io-index",
          version: "2.0.0",
        },
      ],
      resolve: {
        nodes: [
          {
            deps: [
              { dep_kinds: [{ kind: null }], pkg: runtimeId },
              { dep_kinds: [{ kind: "dev" }], pkg: devId },
            ],
            id: workspaceId,
          },
          { deps: [], id: runtimeId },
          { deps: [], id: devId },
        ],
      },
      version: 1,
      workspace_members: [workspaceId],
    });
  };
  const lock = `version = 4

[[package]]
name = "runtime-crate"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"b".repeat(64)}"

[[package]]
name = "dev-crate"
version = "2.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${"c".repeat(64)}"
`;
  const options = {
    boundary: "runtime and build dependencies",
    packageName: "atlasterm-rust-workspace",
    packageVersion: "0.1.0-beta.10",
  };
  const first = buildCargoCycloneDx(
    makeMetadata(join(fixtureRoot, "JoeSSH-ui-finalize")),
    lock.replace(/\n/g, "\r\n"),
    { ...options, rootPath: join(fixtureRoot, "JoeSSH-ui-finalize") },
  );
  const second = buildCargoCycloneDx(
    makeMetadata(join(fixtureRoot, "JoeSSH")),
    lock,
    { ...options, rootPath: join(fixtureRoot, "JoeSSH") },
  );

  assert.equal(first, second);
  assert.match(first, /runtime-crate/);
  assert.doesNotMatch(first, /dev-crate|JoeSSH-ui-finalize|\/home\/runner/);
});

test("canonical Cargo SBOM still rejects noncanonical property names containing the hosted checkout", (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "cargo-sbom-property-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  const rootPath = join(fixtureRoot, "JoeSSH");
  writeFile(
    rootPath,
    "crates/core/Cargo.toml",
    '[package]\nname = "atlasterm-core"\nversion = "0.1.0-beta.10"\nlicense = "MIT"\n',
  );
  const boundary = "runtime dependencies";
  const packageName = "atlasterm-rust-workspace";
  const packageVersion = "0.1.0-beta.10";
  const workspaceId =
    "path+file:///home/runner/work/JoeSSH/JoeSSH/crates/core#atlasterm-core@0.1.0-beta.10";
  const sbom = JSON.parse(
    buildCargoCycloneDx(
      JSON.stringify({
        packages: [
          {
            id: workspaceId,
            license: "MIT",
            name: "atlasterm-core",
            manifest_path: resolve(rootPath, "crates/core/Cargo.toml"),
            source: null,
            version: packageVersion,
          },
        ],
        resolve: {
          nodes: [{ deps: [], id: workspaceId }],
        },
        version: 1,
        workspace_members: [workspaceId],
      }),
      "version = 4\n",
      { boundary, packageName, packageVersion, rootPath },
    ),
  );
  sbom.components[0].properties[0].name = "joessh:cargo:source-JoeSSH";

  const errors = inspectCanonicalCargoCycloneDx(
    `${JSON.stringify(sbom, null, 2)}\n`,
    { boundary, packageName, packageVersion, rootPath },
  );

  assert.ok(
    errors.some((error) =>
      /\$\.components\[0\]\.properties\[0\]\.name contains checkout name JoeSSH/.test(
        error,
      ),
    ),
  );
});

test("rejects malformed CycloneDX SBOMs", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/release/npm-web-sbom.cdx.json": JSON.stringify({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      components: [],
      metadata: {},
    }),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Web Admin npm CycloneDX SBOM must include at least one component/,
  );
});

test("rejects nondeterministic npm SBOM fields and local checkout paths", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/release/npm-desktop-sbom.cdx.json": stableJson({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      serialNumber: "urn:uuid:11111111-1111-4111-8111-111111111111",
      metadata: {
        timestamp: "2026-07-30T01:02:03.000Z",
        component: {
          name: "release-sbom-local-checkout",
          properties: [{ name: "source", value: `${root}\\package-lock.json` }],
        },
      },
      components: [{ name: "dependency", version: "1.0.0" }],
    }),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must not contain a nondeterministic serialNumber/,
  );
  assert.match(
    result.stderr,
    /must not contain a nondeterministic metadata\.timestamp/,
  );
  assert.match(
    result.stderr,
    /metadata\.component\.name must equal root package name atlasterm/,
  );
  assert.match(result.stderr, /contains local path or worktree data/);
});

test("rejects local paths in a public Cargo CycloneDX SBOM", (t) => {
  const root = createFixture(t);
  const cargoPath = "reports/release/cargo-workspace-sbom.cdx.json";
  const cargoSbom = JSON.parse(
    readFileSync(join(root, ...cargoPath.split("/")), "utf8"),
  );
  cargoSbom.components[0].properties.push({
    name: "leaked-manifest-path",
    value: `${root}\\Cargo.toml`,
  });
  writeFile(root, cargoPath, stableJson(cargoSbom));
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Rust workspace Cargo CycloneDX SBOM contains local path or worktree data/,
  );
});

test("rejects npm SBOM JSON that is not stable sorted LF output", (t) => {
  const root = createFixture(t);
  const json = JSON.parse(cyclonedxFixture("desktop"));
  writeSbomFiles(root, {
    "reports/release/npm-desktop-sbom.cdx.json": `${JSON.stringify(json)}\r\n`,
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /must use stable sorted JSON with UTF-8 LF output/,
  );
});

test("rejects missing SBOM checksum coverage", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    `${sha256File(root, "reports/release/npm-web-sbom.cdx.json")}  reports/release/npm-web-sbom.cdx.json\n`,
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /SBOM checksum manifest is missing reports\/release\/npm-desktop-sbom\.cdx\.json/,
  );
});

test("rejects stale SBOM checksums", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "reports/release/npm-desktop-sbom.cdx.json",
    cyclonedxFixture("mutated"),
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /hash mismatch for reports\/release\/npm-desktop-sbom\.cdx\.json/,
  );
});

test("rejects an npm SBOM stale relative to the current package-lock graph", (t) => {
  const root = createFixture(t);
  const packageLockPath = join(root, "package-lock.json");
  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  packageLock.packages["node_modules/desktop-dependency"].version = "2.0.0";
  writeFileSync(
    packageLockPath,
    `${JSON.stringify(packageLock, null, 2)}\n`,
    "utf8",
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Desktop npm CycloneDX SBOM dependency graph does not match the current package-lock\.json/,
  );
});

test("rejects a forged npm graph even when its checksum is refreshed", (t) => {
  const root = createFixture(t);
  const sbomPath = "reports/release/npm-web-sbom.cdx.json";
  const sbom = JSON.parse(
    readFileSync(join(root, ...sbomPath.split("/")), "utf8"),
  );
  sbom.components[0] = {
    name: "forged-web-dependency",
    version: "9.9.9",
  };
  writeFile(root, sbomPath, stableJson(sbom));
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stderr,
    /SBOM-SHA256SUMS\.txt hash mismatch for reports\/release\/npm-web-sbom/,
  );
  assert.match(
    result.stderr,
    /Web Admin npm CycloneDX SBOM dependency graph does not match the current package-lock\.json/,
  );
});

test("rejects a Cargo SBOM stale relative to current Cargo metadata", (t) => {
  const root = createFixture(t);
  const metadataPath = "reports/internal/release-inputs/cargo-metadata.json";
  const metadata = JSON.parse(
    readFileSync(join(root, ...metadataPath.split("/")), "utf8"),
  );
  const coreNode = metadata.resolve.nodes.find((node) =>
    node.id.includes("#atlasterm-core@"),
  );
  coreNode.deps = [];
  writeFile(root, metadataPath, JSON.stringify(metadata));
  writeFile(root, ".test-source/cargo-metadata.json", JSON.stringify(metadata));

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Rust workspace Cargo CycloneDX SBOM dependency graph does not match the current Cargo metadata and lockfile/,
  );
});

test("rejects stored Cargo metadata stale relative to live metadata", (t) => {
  const root = createFixture(t);
  const metadataPath =
    "reports/internal/release-inputs/tauri-cargo-metadata.json";
  const metadata = JSON.parse(
    readFileSync(join(root, ...metadataPath.split("/")), "utf8"),
  );
  metadata.packages = metadata.packages.filter(
    (entry) => entry.name !== "tauri",
  );
  writeFile(root, metadataPath, JSON.stringify(metadata));

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Tauri shell cargo metadata is stale relative to the current Cargo manifests and lockfile/,
  );
});

test("rejects a Cargo SBOM stale relative to the current Cargo.lock", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "apps/desktop/src-tauri/Cargo.lock",
    CARGO_LOCK_FIXTURE.replace("a".repeat(64), "b".repeat(64)),
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Tauri shell Cargo CycloneDX SBOM dependency graph does not match the current Cargo metadata and lockfile/,
  );
});

test("rejects a forged Cargo graph even when its checksum is refreshed", (t) => {
  const root = createFixture(t);
  const sbomPath = "reports/release/cargo-workspace-sbom.cdx.json";
  const sbom = JSON.parse(
    readFileSync(join(root, ...sbomPath.split("/")), "utf8"),
  );
  const component = sbom.components.find(
    (entry) => entry.name === "example-dependency",
  );
  const oldReference = component["bom-ref"];
  const newReference = "pkg:cargo/forged-dependency@9.9.9";
  component["bom-ref"] = newReference;
  component.name = "forged-dependency";
  component.purl = newReference;
  component.version = "9.9.9";
  for (const dependency of sbom.dependencies) {
    if (dependency.ref === oldReference) {
      dependency.ref = newReference;
    }
    dependency.dependsOn = dependency.dependsOn.map((reference) =>
      reference === oldReference ? newReference : reference,
    );
  }
  sbom.components.sort((left, right) => left.name.localeCompare(right.name));
  sbom.dependencies.sort((left, right) => left.ref.localeCompare(right.ref));
  writeFile(root, sbomPath, stableJson(sbom));
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.doesNotMatch(
    result.stderr,
    /SBOM-SHA256SUMS\.txt hash mismatch for reports\/release\/cargo-workspace-sbom/,
  );
  assert.match(
    result.stderr,
    /Rust workspace Cargo CycloneDX SBOM dependency graph does not match the current Cargo metadata and lockfile/,
  );
});

test("rejects private or renamed Cargo metadata in the public SBOM manifest", (t) => {
  const root = createFixture(t);
  writeFile(
    root,
    "reports/release/renamed-rust-sbom.json",
    rustWorkspaceCargoMetadataFixture(),
  );
  const existing = readFileSync(
    join(root, "reports", "release", "SBOM-SHA256SUMS.txt"),
    "utf8",
  );
  writeFile(
    root,
    "reports/release/SBOM-SHA256SUMS.txt",
    `${existing}${sha256File(root, "reports/release/renamed-rust-sbom.json")}  reports/release/renamed-rust-sbom.json\n`,
  );

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /contains non-public or unexpected artifact.*renamed-rust-sbom\.json/,
  );
});

test("rejects workspace-only Cargo metadata", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/internal/release-inputs/cargo-metadata.json":
      rustWorkspaceCargoMetadataFixture(["atlasterm-core", "atlasterm-sync"]),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Rust workspace cargo metadata must include third-party dependency packages/,
  );
  assert.match(result.stderr, /rerun cargo metadata without --no-deps/);
});

test("rejects Rust workspace Cargo metadata missing required dependency packages", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/internal/release-inputs/cargo-metadata.json":
      rustWorkspaceCargoMetadataFixture([
        "atlasterm-core",
        "atlasterm-sync",
        "russh",
        "russh-sftp",
        "serde",
        "tokio",
        "uuid",
      ]),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Rust workspace cargo metadata is missing expected package\(s\): axum/,
  );
});

test("rejects Tauri shell Cargo metadata missing required shell packages", (t) => {
  const root = createFixture(t);
  writeSbomFiles(root, {
    "reports/internal/release-inputs/tauri-cargo-metadata.json":
      tauriCargoMetadataFixture([
        "atlasterm-desktop-shell",
        "atlasterm-core",
        "russh",
        "russh-sftp",
        "serde",
        "tokio",
        "uuid",
      ]),
  });
  writeSbomManifest(root);

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Tauri shell cargo metadata is missing expected package\(s\): tauri/,
  );
});

test("Cargo SBOM records a verified local third-party patch without misclassifying cross-workspace core", (t) => {
  const fixture = vendoredCargoFixture(t);
  const json = JSON.parse(fixture.build());
  const glib = json.components.find((entry) => entry.name === "glib");
  const core = json.components.find((entry) => entry.name === "atlasterm-core");
  const record = verifyVendoredRustPackage(fixture.root, {
    name: "glib",
    version: "0.18.5",
  });

  assert.equal(
    core.properties.find((entry) => entry.name === "joessh:cargo:source").value,
    "workspace",
  );
  assert.equal(
    glib.properties.find((entry) => entry.name === "joessh:cargo:source").value,
    "vendored",
  );
  assert.equal(glib.hashes[0].content, record.treeSha256);
  assert.notEqual(glib.hashes[0].content, record.metadata.upstream.sha256);
  assert.ok(
    glib.externalReferences.some(
      (entry) => entry.url === record.metadata.upstream.archiveUrl,
    ),
  );
  assert.ok(
    glib.properties.some((entry) => entry.value === "RUSTSEC-2024-0429"),
  );
  assert.deepEqual(
    inspectCanonicalCargoCycloneDx(fixture.build(), fixture.options),
    [],
  );
  assert.ok(!fixture.build().includes(fixture.root));
});

test("Cargo SBOM does not accept an unregistered local dependency even when listed as a workspace member", (t) => {
  const fixture = vendoredCargoFixture(t);
  const glib = fixture.metadata.packages.find((entry) => entry.name === "glib");
  glib.name = "unregistered-local-crate";
  fixture.metadata.workspace_members.push(glib.id);

  assert.throws(
    () => fixture.build(),
    /registered|unsupported|unknown|unrecognized/i,
  );
});

test("Cargo SBOM binds a vendored dependency to its local lockfile entry", (t) => {
  const fixture = vendoredCargoFixture(t);
  fixture.lock = fixture.lock.replace(
    'name = "glib"',
    'name = "different-crate"',
  );

  assert.throws(
    () => fixture.build(),
    /not bound to a local Cargo.lock package/,
  );
});

test("Cargo SBOM rejects a vendored dependency with an untrusted manifest path", (t) => {
  const fixture = vendoredCargoFixture(t);
  fixture.metadata.packages.find(
    (entry) => entry.name === "glib",
  ).manifest_path = join(fixture.root, "elsewhere", "Cargo.toml");

  assert.throws(() => fixture.build(), /manifest|path|registered/i);
});

test("Cargo SBOM generation checks the actual patched source bytes", (t) => {
  const fixture = vendoredCargoFixture(t);
  const sourcePath = join(
    fixture.root,
    "vendor",
    "glib-0.18.5",
    "src",
    "variant_iter.rs",
  );
  writeFileSync(
    sourcePath,
    `${readFileSync(sourcePath, "utf8")}\n// unexpected edit\n`,
  );

  assert.throws(() => fixture.build(), /hash|checksum|mismatch|digest/i);
});

test("Cargo SBOM inspection rejects forged patch provenance and license claims", (t) => {
  const fixture = vendoredCargoFixture(t);
  const json = JSON.parse(fixture.build());
  const glib = json.components.find((entry) => entry.name === "glib");
  glib.properties.find(
    (entry) => entry.name === "joessh:cargo:patch-commit",
  ).value = "f".repeat(40);
  glib.licenses[0].expression = "Apache-2.0";

  const failures = inspectCanonicalCargoCycloneDx(
    stableJson(json),
    fixture.options,
  );
  assert.ok(failures.some((entry) => /vendored component/i.test(entry)));
});

test("Cargo SBOM inspection rejects third-party components relabeled as workspace packages", (t) => {
  const fixture = vendoredCargoFixture(t);
  const json = JSON.parse(fixture.build());
  const glib = json.components.find((entry) => entry.name === "glib");
  glib.properties.find((entry) => entry.name === "joessh:cargo:source").value =
    "workspace";
  const failures = inspectCanonicalCargoCycloneDx(
    stableJson(json),
    fixture.options,
  );
  assert.ok(failures.some((entry) => /unrecognized first-party/i.test(entry)));
});

function vendoredCargoFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vendored-cargo-sbom-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(
    resolve(import.meta.dirname, "../vendor/glib-0.18.5"),
    join(root, "vendor", "glib-0.18.5"),
    { recursive: true },
  );
  const packageFor = (name, version, manifest) => ({
    id: `path+file:///${root.replaceAll("\\", "/")}/${manifest}#${name}@${version}`,
    name,
    version,
    source: null,
    license: "MIT",
    manifest_path: join(root, ...manifest.split("/")),
  });
  const core = packageFor("atlasterm-core", VERSION, "crates/core/Cargo.toml");
  const shell = packageFor(
    "atlasterm-desktop-shell",
    VERSION,
    "apps/desktop/src-tauri/Cargo.toml",
  );
  const glib = packageFor("glib", "0.18.5", "vendor/glib-0.18.5/Cargo.toml");
  for (const own of [core, shell]) {
    mkdirSync(resolve(own.manifest_path, ".."), { recursive: true });
    writeFileSync(
      own.manifest_path,
      `[package]\nname = "${own.name}"\nversion = "${own.version}"\nlicense = "MIT"\n`,
    );
  }
  const fixture = {
    root,
    metadata: {
      version: 1,
      packages: [shell, core, glib],
      workspace_members: [shell.id],
      resolve: {
        nodes: [
          {
            id: shell.id,
            deps: [{ pkg: core.id, dep_kinds: [{ kind: null }] }],
          },
          {
            id: core.id,
            deps: [{ pkg: glib.id, dep_kinds: [{ kind: null }] }],
          },
          { id: glib.id, deps: [] },
        ],
      },
    },
    lock: `version = 4\n\n[[package]]\nname = "glib"\nversion = "0.18.5"\n`,
    options: {
      boundary: TAURI_BOUNDARY,
      packageName: "atlasterm-tauri-shell",
      packageVersion: VERSION,
      rootPath: root,
    },
    build() {
      return buildCargoCycloneDx(
        JSON.stringify(this.metadata),
        this.lock,
        this.options,
      );
    },
  };
  return fixture;
}
