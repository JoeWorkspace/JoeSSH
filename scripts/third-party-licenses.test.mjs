import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { renderThirdPartyNotices } from "./third-party-license-contract.mjs";
import { publishedLicenseBundleFixture } from "./release-sbom-test-fixtures.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const generator = resolve(
  repositoryRoot,
  "scripts",
  "generate-third-party-licenses.mjs",
);
const verifier = resolve(
  repositoryRoot,
  "scripts",
  "verify-third-party-licenses.mjs",
);

test("every Tauri release build prepares the exact bundled legal resource first", () => {
  const rootPackage = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );
  const desktopPackage = JSON.parse(
    readFileSync(
      join(repositoryRoot, "apps", "desktop", "package.json"),
      "utf8",
    ),
  );
  const tauriConfig = JSON.parse(
    readFileSync(
      join(repositoryRoot, "apps", "desktop", "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  );
  const preparation = rootPackage.scripts["release:desktop:legal-resource"];
  const expectedSteps = [
    "release:sbom",
    "release:sbom:verify",
    "release:third-party-licenses",
    "release:third-party-licenses:verify",
  ];
  let previousIndex = -1;
  for (const step of expectedSteps) {
    const index = preparation.indexOf(`npm run ${step}`);
    assert.ok(index > previousIndex, `${step} must run in fail-closed order`);
    previousIndex = index;
  }
  assert.match(
    rootPackage.scripts["qa:tauri"],
    /^npm run release:desktop:legal-resource && /,
  );
  assert.match(
    desktopPackage.scripts["tauri:build"],
    /^npm --prefix \.\.\/\.\. run release:desktop:legal-resource && tauri build$/,
  );
  assert.deepEqual(tauriConfig.bundle.resources, {
    "../../../reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt":
      "legal/THIRD-PARTY-NOTICES.txt",
  });
});

test("generates and verifies a deterministic npm and Cargo license bundle", (t) => {
  const root = createFixture(t);
  const first = run(generator, root);
  assert.equal(first.status, 0, first.stderr);
  assert.match(
    first.stdout,
    /Wrote third-party license manifest for 3 package/,
  );

  const manifestPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "manifest.json",
  );
  const noticesPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "THIRD-PARTY-NOTICES.txt",
  );
  const firstManifest = readFileSync(manifestPath, "utf8");
  const firstNotices = readFileSync(noticesPath, "utf8");
  const manifest = JSON.parse(firstManifest);

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packages.length, 3);
  assert.match(
    manifest.dependencyBoundary.npm,
    /can include development or build tooling/,
  );
  assert.match(
    manifest.dependencyBoundary.rust,
    /normal or build dependency edges/,
  );
  assert.match(
    manifest.dependencyBoundary.platform,
    /offline WebView2 runtime.*outside this inventory/,
  );
  assert.ok(
    manifest.inputs.some(({ path }) => path === "package.json"),
    "version input must be hash-bound",
  );
  assert.ok(
    manifest.inputs.some(({ path }) => path === "LICENSE"),
    "JoeSSH product license must be hash-bound",
  );
  assert.deepEqual(manifest.productLicense, {
    declaredLicense: "MIT",
    licenseText: {
      kind: "product",
      sha256: manifest.productLicense.licenseText.sha256,
      sourceFile: "LICENSE",
    },
  });
  assert.doesNotMatch(firstManifest, escapeRegExp(root));
  assert.match(firstNotices, /JoeSSH License and Third-Party Notices/);
  assert.match(firstNotices, /Copyright \(c\) 2026 JoeSSH contributors/);
  assert.match(firstNotices, /Permission is hereby granted/);
  assert.match(firstNotices, /bound by the release evidence manifest/);
  assert.doesNotMatch(firstNotices, /adjacent manifest\.json/);
  const fallback = manifest.packages.find(
    ({ name }) => name === "cargo-without-license-file",
  );
  assert.deepEqual(fallback.licenseTexts, [
    {
      kind: "spdx-canonical",
      note: "Official SPDX canonical license template; package attribution is recorded separately from lock-bound Cargo metadata and is not substituted into the template.",
      sha256: fallback.licenseTexts[0].sha256,
      sourceFile: "scripts/spdx-license-texts/v3.28.0/MIT.txt",
      spdxLicense: "MIT",
      spdxListVersion: "3.28.0",
    },
  ]);
  assert.ok(
    manifest.texts.some(
      ({ content, sha256 }) =>
        sha256 === fallback.licenseTexts[0].sha256 &&
        content.includes("Copyright (c) <year> <copyright holders>"),
    ),
    "canonical fallback must embed actual text",
  );

  const second = run(generator, root);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(manifestPath, "utf8"), firstManifest);
  assert.equal(readFileSync(noticesPath, "utf8"), firstNotices);

  const verified = run(verifier, root);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(verified.stdout, /verified for 3 package/);
});

test("public bundle is root-independent and contains no local path identifiers", (t) => {
  const firstRoot = createFixture(t);
  const secondRoot = createFixture(t);
  assert.equal(run(generator, firstRoot).status, 0);
  assert.equal(run(generator, secondRoot).status, 0);

  for (const path of [
    "reports/release/third-party-licenses/manifest.json",
    "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
  ]) {
    const first = readFileSync(join(firstRoot, ...path.split("/")), "utf8");
    const second = readFileSync(join(secondRoot, ...path.split("/")), "utf8");
    assert.equal(first, second, `${path} must be root-independent`);
    assert.doesNotMatch(
      first,
      /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/](?![\\/])|\/(?:Users|home)\/|path\+file:\/\/|file:\/\/)/,
    );
  }
});

test("LF and CRLF controlled inputs generate an identical public bundle", (t) => {
  const lfRoot = createFixture(t);
  const crlfRoot = createFixture(t);
  const controlledTextInputs = [
    "LICENSE",
    "package.json",
    "package-lock.json",
    "scripts/third-party-license-fallbacks.json",
    "scripts/spdx-license-texts/v3.28.0/Apache-2.0.txt",
    "scripts/spdx-license-texts/v3.28.0/BSD-3-Clause.txt",
    "scripts/spdx-license-texts/v3.28.0/MIT.txt",
    "scripts/spdx-license-texts/v3.28.0/MPL-2.0.txt",
    "reports/release/npm-desktop-sbom.cdx.json",
    "reports/release/npm-web-sbom.cdx.json",
    "reports/release/cargo-workspace-sbom.cdx.json",
    "reports/release/tauri-cargo-sbom.cdx.json",
    "Cargo.lock",
    "apps/desktop/src-tauri/Cargo.lock",
  ];
  for (const path of controlledTextInputs) {
    const fullPath = join(crlfRoot, ...path.split("/"));
    const lfText = readFileSync(fullPath, "utf8").replace(/\r\n?/g, "\n");
    writeFileSync(fullPath, lfText.replace(/\n/g, "\r\n"), "utf8");
  }

  const lfResult = run(generator, lfRoot);
  const crlfResult = run(generator, crlfRoot);
  assert.equal(lfResult.status, 0, lfResult.stderr);
  assert.equal(crlfResult.status, 0, crlfResult.stderr);

  for (const path of [
    "reports/release/third-party-licenses/manifest.json",
    "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
    "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
  ]) {
    assert.deepEqual(
      readFileSync(join(lfRoot, ...path.split("/"))),
      readFileSync(join(crlfRoot, ...path.split("/"))),
      `${path} must be identical for LF and CRLF checkouts`,
    );
  }
});

test("rejects an unapproved or missing declared license", (t) => {
  const root = createFixture(t);
  rewriteNpmLicense(root, "BUSL-1.1");
  const disallowed = run(generator, root);
  assert.notEqual(disallowed.status, 0);
  assert.match(disallowed.stderr, /unapproved SPDX license BUSL-1\.1/);

  rewriteNpmLicense(root, "");
  const missing = run(generator, root);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /declared license must be a non-empty string/);
});

test("fails closed when the JoeSSH product LICENSE is missing or changed", (t) => {
  const missingRoot = createFixture(t);
  rmSync(join(missingRoot, "LICENSE"));
  const missing = run(generator, missingRoot);
  assert.notEqual(missing.status, 0);
  assert.match(
    missing.stderr,
    /Required release license input is missing: LICENSE/,
  );

  const changedRoot = createFixture(t);
  const generated = run(generator, changedRoot);
  assert.equal(generated.status, 0, generated.stderr);
  appendFileSync(join(changedRoot, "LICENSE"), "\nchanged after generation\n");
  const changed = run(verifier, changedRoot);
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /stale or tampered/);
});

test("rejects Cargo evidence changed after its lock-bound archive was extracted", (t) => {
  const root = createFixture(t);
  writeFileSync(
    join(
      root,
      ".cargo",
      "registry",
      "src",
      "fixture",
      "mit-template-crate-1.0.0",
      "LICENSE",
    ),
    "tampered\n",
  );
  const result = run(generator, root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /does not byte-match its lockfile-bound source archive/,
  );
});

test("rejects npm license evidence changed after npm ci populated the lock-bound cache", (t) => {
  const root = createFixture(t);
  writeFileSync(
    join(root, "node_modules", "npm-license-package", "LICENSE"),
    "tampered\n",
  );
  const result = run(generator, root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /does not byte-match its lockfile-bound source archive/,
  );
});

test("rejects a URL-only package without an exact reviewed SPDX fallback", (t) => {
  const root = createFixture(t, {
    includeReviewedFallback: false,
  });
  const result = run(generator, root);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /no embedded license text and no exact reviewed SPDX fallback/,
  );
});

test("verifier rejects tampered or missing release license artifacts", (t) => {
  const root = createFixture(t);
  assert.equal(run(generator, root).status, 0);
  const manifestPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "manifest.json",
  );
  appendFileSync(manifestPath, "tamper");
  const tampered = run(verifier, root);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /stale or tampered/);

  rmSync(manifestPath);
  const missing = run(verifier, root);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /artifact is missing/);
});

test("artifact-only verifier validates the self-contained published bundle", (t) => {
  const root = createFixture(t);
  assert.equal(run(generator, root).status, 0);

  const verified = run(verifier, root, ["--artifact-only"]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.match(
    verified.stdout,
    /Published third-party license bundle verified/,
  );

  appendFileSync(
    join(
      root,
      "reports",
      "release",
      "third-party-licenses",
      "THIRD-PARTY-NOTICES.txt",
    ),
    "tamper",
  );
  const tampered = run(verifier, root, ["--artifact-only"]);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /does not exactly render/);
});

test("full verifier rejects self-consistent forged upstream text", (t) => {
  const root = createFixture(t);
  assert.equal(run(generator, root).status, 0);
  const manifestPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const npmPackage = manifest.packages.find(
    ({ ecosystem }) => ecosystem === "npm",
  );
  assert(npmPackage);
  const upstream = npmPackage.licenseTexts.find(
    ({ kind }) => kind === "upstream",
  );
  assert(upstream);
  const originalHash = upstream.sha256;
  const forgedText = mitText("forged npm license package");
  const forgedHash = sha256Text(forgedText);
  upstream.sha256 = forgedHash;
  const referencedHashes = new Set([
    manifest.productLicense.licenseText.sha256,
    ...manifest.packages.flatMap((packageEntry) =>
      [...packageEntry.licenseTexts, ...packageEntry.notices].map(
        ({ sha256 }) => sha256,
      ),
    ),
  ]);
  manifest.texts = manifest.texts
    .filter(
      ({ sha256 }) => sha256 !== originalHash || referencedHashes.has(sha256),
    )
    .concat({ content: forgedText, sha256: forgedHash })
    .sort((left, right) => left.sha256.localeCompare(right.sha256));
  writePublishedBundle(root, {
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    noticesText: renderThirdPartyNotices(manifest),
  });

  const selfContained = run(verifier, root, ["--artifact-only"]);
  assert.equal(selfContained.status, 0, selfContained.stderr);

  const sourceBound = run(verifier, root);
  assert.notEqual(sourceBound.status, 0);
  assert.match(sourceBound.stderr, /stale or tampered/);
});

test("artifact-only verifier rejects the previous self-consistent forged fixture", (t) => {
  const root = createFixture(t);
  writePublishedBundle(root, publishedLicenseBundleFixture("1.2.3"));

  const result = run(verifier, root, ["--artifact-only"]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /manifest inputs must contain exactly \d+ current release source files/,
  );
});

test("artifact-only verifier rejects drift in every release input class", (t) => {
  for (const path of [
    "LICENSE",
    "package-lock.json",
    "Cargo.lock",
    "apps/desktop/src-tauri/Cargo.lock",
    "reports/release/npm-desktop-sbom.cdx.json",
    "scripts/third-party-license-fallbacks.json",
  ]) {
    const root = createFixture(t);
    assert.equal(run(generator, root).status, 0);
    appendFileSync(
      join(root, ...path.split("/")),
      "\nchanged after generation\n",
    );

    const result = run(verifier, root, ["--artifact-only"]);

    assert.notEqual(result.status, 0, path);
    assert.ok(
      result.stderr.includes(`input hash does not match current ${path}`),
      `${path}: ${result.stderr}`,
    );
  }
});

test("artifact-only verifier binds embedded product text to current LICENSE", (t) => {
  const root = createFixture(t);
  assert.equal(run(generator, root).status, 0);
  const manifestPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const originalProductHash = manifest.productLicense.licenseText.sha256;
  const forgedProductText = mitText("forged product license");
  const forgedProductHash = createHash("sha256")
    .update(forgedProductText)
    .digest("hex");
  manifest.productLicense.licenseText.sha256 = forgedProductHash;
  manifest.texts = manifest.texts
    .filter(({ sha256 }) => sha256 !== originalProductHash)
    .concat({ content: forgedProductText, sha256: forgedProductHash })
    .sort((left, right) => left.sha256.localeCompare(right.sha256));
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writePublishedBundle(root, {
    manifestText,
    noticesText: renderThirdPartyNotices(manifest),
  });

  const result = run(verifier, root, ["--artifact-only"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must embed the complete JoeSSH MIT LICENSE/);
});

test("artifact-only verifier binds the exact current package inventory", (t) => {
  const attacks = [
    {
      mutate(manifest) {
        manifest.packages.pop();
      },
      pattern:
        /packages must contain exactly 3 current SBOM\/lockfile dependencies/,
    },
    {
      mutate(manifest) {
        manifest.packages.push({
          ...structuredClone(manifest.packages.at(-1)),
          name: "extra-package",
        });
      },
      pattern:
        /packages must contain exactly 3 current SBOM\/lockfile dependencies/,
    },
    {
      mutate(manifest) {
        manifest.packages[1] = structuredClone(manifest.packages[0]);
      },
      pattern: /name does not match the current SBOM and lockfile inventory/,
    },
    {
      mutate(manifest) {
        const npmPackage = manifest.packages.find(
          ({ ecosystem }) => ecosystem === "npm",
        );
        const originalHash = npmPackage.licenseTexts[0].sha256;
        const forgedText = mitText("forged substituted dependency");
        const forgedHash = sha256Text(forgedText);
        npmPackage.name = "substituted-npm-package";
        npmPackage.source =
          "https://registry.npmjs.org/substituted-npm-package/-/substituted-npm-package-1.0.0.tgz";
        npmPackage.licenseTexts[0].sha256 = forgedHash;
        const stillReferenced = new Set([
          manifest.productLicense.licenseText.sha256,
          ...manifest.packages.flatMap((packageEntry) =>
            [...packageEntry.licenseTexts, ...packageEntry.notices].map(
              ({ sha256 }) => sha256,
            ),
          ),
        ]);
        manifest.texts = manifest.texts
          .filter(
            ({ sha256 }) =>
              sha256 !== originalHash || stillReferenced.has(originalHash),
          )
          .concat({ content: forgedText, sha256: forgedHash })
          .sort((left, right) => left.sha256.localeCompare(right.sha256));
      },
      pattern: /name does not match the current SBOM and lockfile inventory/,
    },
    {
      mutate(manifest) {
        const cargoPackage = manifest.packages.find(
          ({ ecosystem }) => ecosystem === "cargo",
        );
        cargoPackage.scopes = ["rust-workspace"];
      },
      pattern: /scopes do not match the exact current SBOM coverage/,
    },
    {
      mutate(manifest) {
        const cargoPackage = manifest.packages.find(
          ({ ecosystem }) => ecosystem === "cargo",
        );
        cargoPackage.checksum = "f".repeat(64);
      },
      pattern:
        /checksum does not match the current SBOM and lockfile inventory/,
    },
  ];

  for (const attack of attacks) {
    const root = createFixture(t);
    assert.equal(run(generator, root).status, 0);
    const manifestPath = join(
      root,
      "reports",
      "release",
      "third-party-licenses",
      "manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    attack.mutate(manifest);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    writePublishedBundle(root, {
      manifestText,
      noticesText: renderThirdPartyNotices(manifest),
    });

    const result = run(verifier, root, ["--artifact-only"]);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, attack.pattern);
  }
});

test("artifact-only verifier rejects forged package evidence structure", (t) => {
  const root = createFixture(t);
  assert.equal(run(generator, root).status, 0);
  const manifestPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const npmPackage = manifest.packages.find(
    ({ ecosystem }) => ecosystem === "npm",
  );
  npmPackage.licenseTexts[0].unreviewedSource = "forged";
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writePublishedBundle(root, {
    manifestText,
    noticesText: renderThirdPartyNotices(manifest),
  });

  const result = run(verifier, root, ["--artifact-only"]);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /licenseTexts entry 1 fields must be exactly: kind, sha256, sourceFile/,
  );
});

test("artifact-only verifier rejects unreferenced embedded dependency text", (t) => {
  const root = createFixture(t);
  assert.equal(run(generator, root).status, 0);
  const manifestPath = join(
    root,
    "reports",
    "release",
    "third-party-licenses",
    "manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const orphanText = mitText("unreferenced forged dependency");
  manifest.texts.push({
    content: orphanText,
    sha256: sha256Text(orphanText),
  });
  manifest.texts.sort((left, right) => left.sha256.localeCompare(right.sha256));
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writePublishedBundle(root, {
    manifestText,
    noticesText: renderThirdPartyNotices(manifest),
  });

  const result = run(verifier, root, ["--artifact-only"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /texts must be exactly the product and package/);
});

function createFixture(
  t,
  { includeNpmDependency = true, includeReviewedFallback = true } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "joessh-third-party-license-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));

  writeText(join(root, "LICENSE"), mitText("2026 JoeSSH contributors"));
  writeJson(join(root, "package.json"), {
    name: "fixture",
    version: "1.2.3",
  });
  const packageLock = {
    name: "fixture",
    version: "1.2.3",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "fixture",
        version: "1.2.3",
      },
    },
  };
  let npmPackage = null;
  if (includeNpmDependency) {
    npmPackage = writeNpmPackage(root);
    packageLock.packages["node_modules/npm-license-package"] = {
      version: "1.0.0",
      resolved:
        "https://registry.npmjs.org/npm-license-package/-/npm-license-package-1.0.0.tgz",
      integrity: npmPackage.integrity,
      license: "MIT",
    };
  }
  writeJson(join(root, "package-lock.json"), packageLock);

  const components = includeNpmDependency
    ? [
        {
          "bom-ref": "npm-license-package@1.0.0",
          externalReferences: [
            {
              type: "distribution",
              url: packageLock.packages["node_modules/npm-license-package"]
                .resolved,
            },
          ],
          hashes: [
            {
              alg: "SHA-512",
              content: Buffer.from(
                npmPackage.integrity.slice("sha512-".length),
                "base64",
              ).toString("hex"),
            },
          ],
          type: "library",
          name: "npm-license-package",
          version: "1.0.0",
          scope: "required",
          purl: "pkg:npm/npm-license-package@1.0.0",
          properties: [
            {
              name: "cdx:npm:package:path",
              value: "node_modules/npm-license-package",
            },
          ],
          licenses: [{ license: { id: "MIT" } }],
        },
      ]
    : [
        {
          "bom-ref": "fixture@1.2.3",
          type: "application",
          name: "fixture",
          version: "1.2.3",
          scope: "required",
          properties: [
            {
              name: "cdx:npm:package:path",
              value: "apps/fixture",
            },
          ],
        },
      ];
  const sbom = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    components,
  };
  writeJson(
    join(root, "reports", "release", "npm-desktop-sbom.cdx.json"),
    sbom,
  );
  writeJson(join(root, "reports", "release", "npm-web-sbom.cdx.json"), sbom);

  const providerFiles = {
    "Cargo.toml":
      '[package]\nname = "mit-template-crate"\nversion = "1.0.0"\nlicense = "MIT"\n',
    LICENSE: mitText("canonical provider"),
  };
  const missingFiles = {
    "Cargo.toml":
      '[package]\nname = "cargo-without-license-file"\nversion = "2.0.0"\nlicense = "MIT"\n',
  };
  const provider = writeCargoPackage(
    root,
    "mit-template-crate",
    "1.0.0",
    providerFiles,
  );
  const missing = writeCargoPackage(
    root,
    "cargo-without-license-file",
    "2.0.0",
    missingFiles,
  );
  const lock = `version = 4

[[package]]
name = "fixture-workspace"
version = "1.2.3"

[[package]]
name = "mit-template-crate"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${provider.checksum}"

[[package]]
name = "cargo-without-license-file"
version = "2.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "${missing.checksum}"
`;
  writeText(join(root, "Cargo.lock"), lock);
  writeText(join(root, "apps", "desktop", "src-tauri", "Cargo.lock"), lock);
  const cargoComponents = [
    cargoSbomComponent("cargo-without-license-file", "2.0.0", missing.checksum),
    cargoSbomComponent("mit-template-crate", "1.0.0", provider.checksum),
  ];
  for (const filename of [
    "cargo-workspace-sbom.cdx.json",
    "tauri-cargo-sbom.cdx.json",
  ]) {
    writeJson(join(root, "reports", "release", filename), {
      bomFormat: "CycloneDX",
      components: cargoComponents,
      specVersion: "1.5",
    });
  }

  const workspaceId = "path+file:///fixture#fixture-workspace@1.2.3";
  const providerId =
    "registry+https://github.com/rust-lang/crates.io-index#mit-template-crate@1.0.0";
  const missingId =
    "registry+https://github.com/rust-lang/crates.io-index#cargo-without-license-file@2.0.0";
  const metadata = {
    packages: [
      {
        name: "fixture-workspace",
        version: "1.2.3",
        id: workspaceId,
        license: "MIT",
        license_file: null,
        source: null,
        manifest_path: join(root, "Cargo.toml"),
      },
      {
        name: "mit-template-crate",
        version: "1.0.0",
        id: providerId,
        license: "MIT",
        license_file: null,
        authors: ["Template Author"],
        repository: "https://example.com/mit-template-crate",
        source: "registry+https://github.com/rust-lang/crates.io-index",
        manifest_path: provider.manifestPath,
      },
      {
        name: "cargo-without-license-file",
        version: "2.0.0",
        id: missingId,
        license: "MIT",
        license_file: null,
        authors: ["Fixture Author"],
        repository: "https://example.com/cargo-without-license-file",
        source: "registry+https://github.com/rust-lang/crates.io-index",
        manifest_path: missing.manifestPath,
      },
    ],
    workspace_members: [workspaceId],
    resolve: {
      nodes: [
        {
          id: workspaceId,
          deps: [
            { pkg: providerId, dep_kinds: [{ kind: null, target: null }] },
            { pkg: missingId, dep_kinds: [{ kind: null, target: null }] },
          ],
        },
        { id: providerId, deps: [] },
        { id: missingId, deps: [] },
      ],
    },
    version: 1,
  };
  writeJson(
    join(root, "reports", "internal", "release-inputs", "cargo-metadata.json"),
    metadata,
  );
  writeJson(
    join(
      root,
      "reports",
      "internal",
      "release-inputs",
      "tauri-cargo-metadata.json",
    ),
    metadata,
  );
  writeFallbackPolicy(root, {
    checksum: missing.checksum,
    includeReviewedFallback,
  });
  return root;
}

function cargoSbomComponent(name, version, checksum) {
  const purl = `pkg:cargo/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
  return {
    "bom-ref": purl,
    hashes: [{ alg: "SHA-256", content: checksum }],
    licenses: [{ expression: "MIT" }],
    name,
    properties: [
      {
        name: "joessh:cargo:source",
        value: "registry+https://github.com/rust-lang/crates.io-index",
      },
    ],
    purl,
    scope: "required",
    type: "library",
    version,
  };
}

function writeNpmPackage(root) {
  const packageJsonText = `${JSON.stringify(
    {
      name: "npm-license-package",
      version: "1.0.0",
      license: "MIT",
    },
    null,
    2,
  )}\n`;
  const licenseText = mitText("npm license package");
  writeText(
    join(root, "node_modules", "npm-license-package", "package.json"),
    packageJsonText,
  );
  writeText(
    join(root, "node_modules", "npm-license-package", "LICENSE"),
    licenseText,
  );
  const archive = createTarGzip({
    "package/LICENSE": Buffer.from(licenseText, "utf8"),
    "package/package.json": Buffer.from(packageJsonText, "utf8"),
  });
  const digest = createHash("sha512").update(archive).digest();
  const hex = digest.toString("hex");
  const cachePath = join(
    root,
    ".npm-cache",
    "_cacache",
    "content-v2",
    "sha512",
    hex.slice(0, 2),
    hex.slice(2, 4),
    hex.slice(4),
  );
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, archive);
  return { integrity: `sha512-${digest.toString("base64")}` };
}

function writeFallbackPolicy(root, { checksum, includeReviewedFallback }) {
  const textHashes = {
    "Apache-2.0":
      "074e6e32c86a4c0ef8b3ed25b721ca23aca83df277cd88106ef7177c354615ff",
    "BSD-3-Clause":
      "5a93d5831e1297ab10fe643e1a631e83be392896da14ee2951285a79012df69d",
    MIT: "b05785f9f18e6716bab63424b11454513b9943a222595b70411009202fc592b5",
    "MPL-2.0":
      "66a3107d5ad6a058aab753eaac2047ccb2ed0e39465dd0fe5844da3e300d5172",
  };
  const texts = {};
  for (const [identifier, sha256] of Object.entries(textHashes)) {
    const relativePath = `scripts/spdx-license-texts/v3.28.0/${identifier}.txt`;
    const content = readFileSync(
      join(
        repositoryRoot,
        "scripts",
        "spdx-license-texts",
        "v3.28.0",
        `${identifier}.txt`,
      ),
    );
    writeText(join(root, relativePath), content);
    texts[identifier] = { path: relativePath, sha256 };
  }
  writeJson(join(root, "scripts", "third-party-license-fallbacks.json"), {
    schemaVersion: 1,
    spdxLicenseList: {
      version: "3.28.0",
      source: "https://github.com/spdx/license-list-data/tree/v3.28.0/text",
      texts,
    },
    reviewedFallbacks: includeReviewedFallback
      ? [
          {
            ecosystem: "cargo",
            name: "cargo-without-license-file",
            version: "2.0.0",
            declaredLicense: "MIT",
            selectedLicense: "MIT",
            checksum,
            review:
              "Exact Cargo.lock package reviewed because its crates.io archive contains no LICENSE/COPYING file; use only the pinned official SPDX body and retain any archive NOTICE/COPYRIGHT evidence.",
          },
        ]
      : [],
  });
}

function writeCargoPackage(root, name, version, files) {
  const sourceDirectory = join(
    root,
    ".cargo",
    "registry",
    "src",
    "fixture",
    `${name}-${version}`,
  );
  for (const [path, content] of Object.entries(files)) {
    writeText(join(sourceDirectory, path), content);
  }
  const archive = createTarGzip(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        `${name}-${version}/${path}`,
        Buffer.from(content, "utf8"),
      ]),
    ),
  );
  const archivePath = join(
    root,
    ".cargo",
    "registry",
    "cache",
    "fixture",
    `${name}-${version}.crate`,
  );
  mkdirSync(dirname(archivePath), { recursive: true });
  writeFileSync(archivePath, archive);
  return {
    checksum: createHash("sha256").update(archive).digest("hex"),
    manifestPath: join(sourceDirectory, "Cargo.toml"),
  };
}

function createTarGzip(files) {
  const chunks = [];
  for (const path of Object.keys(files).sort()) {
    const content = files[path];
    const header = Buffer.alloc(512);
    header.write(path, 0, 100, "utf8");
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, content.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
    header.write("ustar\0", 257, 6, "ascii");
    header.write("00", 263, 2, "ascii");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    const checksumText = checksum.toString(8).padStart(6, "0");
    header.write(checksumText, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 32;
    chunks.push(header, content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
}

function writeTarOctal(buffer, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text, offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function rewriteNpmLicense(root, license) {
  const packagePath = join(
    root,
    "node_modules",
    "npm-license-package",
    "package.json",
  );
  const installed = JSON.parse(readFileSync(packagePath, "utf8"));
  installed.license = license;
  writeJson(packagePath, installed);

  const lockPath = join(root, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  lock.packages["node_modules/npm-license-package"].license = license;
  writeJson(lockPath, lock);

  for (const filename of [
    "npm-desktop-sbom.cdx.json",
    "npm-web-sbom.cdx.json",
  ]) {
    const sbomPath = join(root, "reports", "release", filename);
    const sbom = JSON.parse(readFileSync(sbomPath, "utf8"));
    sbom.components[0].licenses = [{ license: { id: license } }];
    writeJson(sbomPath, sbom);
  }
}

function run(script, root, extraArgs = []) {
  return spawnSync(process.execPath, [script, "--root", root, ...extraArgs], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

function writeJson(path, value) {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function writePublishedBundle(root, { manifestText, noticesText }) {
  writeText(
    join(root, "reports", "release", "third-party-licenses", "manifest.json"),
    manifestText,
  );
  writeText(
    join(
      root,
      "reports",
      "release",
      "third-party-licenses",
      "THIRD-PARTY-NOTICES.txt",
    ),
    noticesText,
  );
  const checksumText = [
    `${sha256Text(noticesText)}  reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt`,
    `${sha256Text(manifestText)}  reports/release/third-party-licenses/manifest.json`,
    "",
  ].join("\n");
  writeText(
    join(root, "reports", "release", "THIRD-PARTY-LICENSES-SHA256SUMS.txt"),
    checksumText,
  );
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function mitText(owner) {
  return `MIT License

Copyright (c) ${owner}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
`;
}

function escapeRegExp(value) {
  return new RegExp(
    value.replaceAll("\\", "[\\\\/]").replace(/[.*+?^${}()|[\]]/g, "\\$&"),
    "i",
  );
}
