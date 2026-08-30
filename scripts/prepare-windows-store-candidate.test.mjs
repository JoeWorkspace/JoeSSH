import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  assertCertificateSubjectMatchesLegalPublisher,
  assertMicrosoftStoreTauriConfig,
  assertMsixDesktopFullTrustContract,
  assertMsixIdentityMatches,
  assertPartnerCenterLegalPublisher,
  assertProjectReleaseIdentity,
  assertWindowsLegalPublisher,
  deriveMsixVersion,
  normalizeMsixExecutablePath,
  parseMsixManifestContract,
  parseMsixManifestIdentity,
  validatePartnerCenterIdentity,
  validateVersionedHttpsUrl,
} from "./windows-store-contract.mjs";
import {
  assertBundledThirdPartyNoticesMatch,
  assertInstalledProductIdentity,
  assertSignerMatchesExpected,
  capturePrivateSnapshot,
  combineVerificationErrors,
  collectBundledThirdPartyNoticesEvidence,
  parseArgs,
  validateExpectedSigner,
  validateHostedRetentionAttestation,
  validateHttpsArtifactUrl,
  verifyInstalledThirdPartyNotices,
  verifyMsixCandidate,
  verifyUnpackedThirdPartyNotices,
  verifyAuthenticode,
} from "./prepare-windows-store-candidate.mjs";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  publishedLicenseBundleFixture,
  writePublishedLicenseSourceInputFixture,
  writeSourceBoundReleaseSbomFixture,
} from "./release-sbom-test-fixtures.mjs";
import { readWindowsStoreManifestLanguageContract } from "./windows-store-language-contract.mjs";

const SHA256 = "a".repeat(64);
const COMMIT = "b".repeat(40);
const SOURCE_COMMIT = "c".repeat(40);
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const LEGAL_PUBLISHER = "JoeSSH Release";
const EXPECTED_SIGNER = {
  legalPublisher: LEGAL_PUBLISHER,
  subject: `CN=${LEGAL_PUBLISHER}, O=JoeSSH Project`,
  thumbprint: "D".repeat(40),
};
const RELEASE_ENVIRONMENT = {
  ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT: EXPECTED_SIGNER.subject,
  ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT: EXPECTED_SIGNER.thumbprint,
  ATLASTERM_WINDOWS_LEGAL_PUBLISHER: LEGAL_PUBLISHER,
  JOESSH_WINDOWS_RELEASE_ENVIRONMENT: "windows-release-stage-b",
};
const MANIFEST_LANGUAGES =
  readWindowsStoreManifestLanguageContract().manifestLanguages;

test("Store evidence binds the verified notices mapped into the installed app", () => {
  const root = mkdtempSync(join(tmpdir(), "joessh-store-legal-"));
  try {
    writeFixtureFile(
      root,
      "package.json",
      '{"name":"atlasterm","version":"0.1.0-beta.1"}\n',
    );
    writeSourceBoundReleaseSbomFixture(root);
    writePublishedLicenseSourceInputFixture(root);
    const sbomFiles = Object.fromEntries(
      [
        "reports/release/cargo-workspace-sbom.cdx.json",
        "reports/release/npm-desktop-sbom.cdx.json",
        "reports/release/npm-web-sbom.cdx.json",
        "reports/release/tauri-cargo-sbom.cdx.json",
      ].map((path) => [
        path,
        readFileSync(resolve(root, ...path.split("/")), "utf8"),
      ]),
    );
    const bundle = publishedLicenseBundleFixture({ root });
    const manifest = JSON.parse(bundle.manifestText);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    const noticesText = bundle.noticesText;
    const sbomChecksumText = `${Object.entries(sbomFiles)
      .map(([path, content]) => `${sha256Text(content)}  ${path}`)
      .join("\n")}\n`;
    const licenseChecksumText = [
      `${sha256Text(noticesText)}  reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt`,
      `${sha256Text(manifestText)}  reports/release/third-party-licenses/manifest.json`,
      "",
    ].join("\n");
    writeFixtureFile(
      root,
      "apps/desktop/src-tauri/tauri.conf.json",
      `${JSON.stringify(
        {
          bundle: {
            resources: {
              "../../../reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt":
                "legal/THIRD-PARTY-NOTICES.txt",
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    writeFixtureFile(
      root,
      "reports/release/third-party-licenses/manifest.json",
      manifestText,
    );
    writeFixtureFile(
      root,
      "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
      noticesText,
    );
    writeFixtureFile(
      root,
      "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
      licenseChecksumText,
    );
    for (const [path, content] of Object.entries(sbomFiles)) {
      writeFixtureFile(root, path, content);
    }
    writeFixtureFile(
      root,
      "reports/release/SBOM-SHA256SUMS.txt",
      sbomChecksumText,
    );

    const evidence = collectBundledThirdPartyNoticesEvidence(root);
    assert.deepEqual(
      {
        bundleResourcePath: evidence.bundleResourcePath,
        checksumManifest: evidence.checksumManifest,
        checksumManifestSha256: evidence.checksumManifestSha256,
        licenseManifest: evidence.licenseManifest,
        licenseManifestSha256: evidence.licenseManifestSha256,
        packageCount: evidence.packageCount,
        sbomChecksumManifest: evidence.sbomChecksumManifest,
        sbomChecksumSha256: evidence.sbomChecksumSha256,
        sboms: evidence.sboms,
        sha256: evidence.sha256,
        sizeBytes: evidence.sizeBytes,
        sourcePath: evidence.sourcePath,
        textCount: evidence.textCount,
      },
      {
        bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
        checksumManifest: "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
        checksumManifestSha256: sha256Text(licenseChecksumText),
        licenseManifest: "reports/release/third-party-licenses/manifest.json",
        licenseManifestSha256: sha256Text(manifestText),
        packageCount: manifest.packages.length,
        sbomChecksumManifest: "reports/release/SBOM-SHA256SUMS.txt",
        sbomChecksumSha256: sha256Text(sbomChecksumText),
        sboms: Object.entries(sbomFiles).map(([path, content]) => ({
          path,
          sha256: sha256Text(content),
        })),
        sha256: sha256Text(noticesText),
        sizeBytes: Buffer.byteLength(noticesText),
        sourcePath:
          "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
        textCount: 2,
      },
    );

    writeFixtureFile(
      root,
      "reports/release/SBOM-SHA256SUMS.txt",
      sbomChecksumText
        .split("\n")
        .filter((line) => !line.includes("tauri-cargo-sbom"))
        .join("\n"),
    );
    assert.throws(
      () => collectBundledThirdPartyNoticesEvidence(root),
      /must exactly cover the four reviewed public SBOM artifacts/,
    );
    writeFixtureFile(
      root,
      "reports/release/SBOM-SHA256SUMS.txt",
      sbomChecksumText,
    );

    const firstSbomPath = "reports/release/cargo-workspace-sbom.cdx.json";
    writeFixtureFile(root, firstSbomPath, `${sbomFiles[firstSbomPath]} `);
    assert.throws(
      () => collectBundledThirdPartyNoticesEvidence(root),
      /input hash does not match current reports\/release\/cargo-workspace-sbom\.cdx\.json/,
    );
    writeFixtureFile(root, firstSbomPath, sbomFiles[firstSbomPath]);

    const mismatchedManifest = structuredClone(manifest);
    mismatchedManifest.inputs.find(
      ({ path }) => path === firstSbomPath,
    ).sha256 = "0".repeat(64);
    const mismatchedManifestText = `${JSON.stringify(
      mismatchedManifest,
      null,
      2,
    )}\n`;
    writeFixtureFile(
      root,
      "reports/release/third-party-licenses/manifest.json",
      mismatchedManifestText,
    );
    writeFixtureFile(
      root,
      "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
      [
        `${sha256Text(noticesText)}  reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt`,
        `${sha256Text(mismatchedManifestText)}  reports/release/third-party-licenses/manifest.json`,
        "",
      ].join("\n"),
    );
    assert.throws(
      () => collectBundledThirdPartyNoticesEvidence(root),
      /input hash does not match current reports\/release\/cargo-workspace-sbom\.cdx\.json/,
    );
    writeFixtureFile(
      root,
      "reports/release/third-party-licenses/manifest.json",
      manifestText,
    );
    writeFixtureFile(
      root,
      "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
      licenseChecksumText,
    );

    writeFixtureFile(
      root,
      "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
      `${noticesText}tamper\n`,
    );
    assert.throws(
      () => collectBundledThirdPartyNoticesEvidence(root),
      /does not exactly render/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

function withSourceCommit(args) {
  return [...args, "--artifact-source-sha", SOURCE_COMMIT];
}

function writeFixtureFile(root, relativePath, content) {
  const path = resolve(root, ...relativePath.split("/"));
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

function compareVersionComponents(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function completeMsixManifest(overrides = {}) {
  const {
    application = `<Application Id="App" Executable="JoeSSH.exe"
      RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />`,
    capabilities = '<rescap:Capability Name="runFullTrust" />',
    identity = `<Identity Publisher="CN=Store Publisher" Version="1.2.3.0"
      Name="JoeSSH.Store.Assigned" ProcessorArchitecture="x64" />`,
    resources = MANIFEST_LANGUAGES.map(
      (language) => `<Resource Language="${language}" />`,
    ).join("\n"),
  } = overrides;
  return `<?xml version="1.0"?>
    <Package
      xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
      xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
      ${identity}
      <Properties>
        <PublisherDisplayName>JoeSSH Publisher</PublisherDisplayName>
      </Properties>
      <Resources>${resources}</Resources>
      <Dependencies>
        <TargetDeviceFamily Name="Windows.Desktop" />
      </Dependencies>
      <Applications>${application}</Applications>
      <Capabilities>${capabilities}</Capabilities>
    </Package>`;
}

function createMsixCandidateVerificationFixture(t, verifyNotices) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "joessh-msix-wiring-"));
  t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

  const partnerIdentityPath = join(temporaryRoot, "partner-identity.json");
  writeFileSync(
    partnerIdentityPath,
    JSON.stringify({
      schemaVersion: 1,
      source: "partner-center",
      productId: "9N1234567890",
      packageIdentityName: "JoeSSH.Store.Assigned",
      publisher: "CN=Store Publisher",
      publisherDisplayName: "JoeSSH Publisher",
      publisherId: "8wekyb3d8bbwe",
      packageFamilyName: "JoeSSH.Store.Assigned_8wekyb3d8bbwe",
      reservedAt: "2026-07-30T00:00:00.000Z",
    }),
    "utf8",
  );

  const artifactPath = join(temporaryRoot, "candidate.msix");
  writeFileSync(artifactPath, "fixture artifact", { flag: "wx" });
  const unpackRoot = resolve(temporaryRoot, "msix-unpacked");
  const executableFixture = readFileSync(
    resolve(
      import.meta.dirname,
      "../node_modules/fb-dotslash/bin/windows/dotslash.exe",
    ),
  );
  const legalNotices = Object.freeze({
    bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
    sha256: SHA256,
    sizeBytes: 42,
  });
  const input = {
    artifactSnapshot: { path: artifactPath },
    identity: {
      publisher: "JoeSSH Publisher",
      version: "0.1.0-beta.10",
    },
    legalNotices,
    options: { partnerIdentity: partnerIdentityPath },
    temporaryRoot,
  };
  const runtime = {
    resolveWindowsSdkTool(fileName) {
      assert.equal(fileName, "makeappx.exe");
      return "fixture-makeappx.exe";
    },
    runRequiredCommand(command, args) {
      assert.equal(command, "fixture-makeappx.exe");
      assert.equal(args[0], "unpack");
      assert.equal(args[4], unpackRoot);
      writeFixtureFile(
        unpackRoot,
        "AppxManifest.xml",
        completeMsixManifest({
          application: `<Application Id="App" Executable="VFS\\Local AppData\\JoeSSH\\JoeSSH.exe"
      RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />`,
          identity: `<Identity Publisher="CN=Store Publisher" Version="1.1.10.0"
      Name="JoeSSH.Store.Assigned" ProcessorArchitecture="x64" />`,
        }),
      );
      const executablePath = resolve(
        unpackRoot,
        "VFS",
        "Local AppData",
        "JoeSSH",
        "JoeSSH.exe",
      );
      mkdirSync(dirname(executablePath), { recursive: true });
      writeFileSync(executablePath, executableFixture, {
        flag: "wx",
      });
      writeFixtureFile(
        unpackRoot,
        "VFS/Local AppData/JoeSSH/legal/THIRD-PARTY-NOTICES.txt",
        "fixture legal notices",
      );
    },
    verifyUnpackedThirdPartyNotices: verifyNotices,
    crossCheckPartnerCenterPackageFamily: () => ({
      method: "fixture",
      packageIdentityName: "JoeSSH.Store.Assigned",
      publisherId: "8wekyb3d8bbwe",
      status: "matched",
    }),
    inspectAuthenticode: (path) => {
      assert.equal(path, artifactPath);
      return { status: "NotSigned" };
    },
  };

  return { input, runtime, unpackRoot };
}

test("accepts only the reviewed offline NSIS Store config", () => {
  assert.doesNotThrow(() =>
    assertMicrosoftStoreTauriConfig({
      build: { beforeBuildCommand: "npm run build:microsoft-store" },
      bundle: {
        targets: ["nsis"],
        windows: {
          nsis: { installMode: "currentUser" },
          webviewInstallMode: { type: "offlineInstaller" },
        },
      },
    }),
  );
  assert.throws(
    () =>
      assertMicrosoftStoreTauriConfig({
        build: { beforeBuildCommand: "npm run build:microsoft-store" },
        bundle: {
          targets: ["nsis"],
          windows: {
            nsis: { installMode: "currentUser" },
            webviewInstallMode: { type: "downloadBootstrapper" },
          },
        },
      }),
    /offlineInstaller/,
  );
  assert.throws(
    () =>
      assertMicrosoftStoreTauriConfig({
        build: { beforeBuildCommand: "npm run build:microsoft-store" },
        bundle: {
          publisher: "Unreviewed Publisher",
          targets: ["nsis"],
          windows: {
            nsis: { installMode: "currentUser" },
            webviewInstallMode: { type: "offlineInstaller" },
          },
        },
      }),
    /temporary identity override/,
  );
  assert.throws(
    () =>
      assertMicrosoftStoreTauriConfig({
        build: { beforeBuildCommand: "npm run build" },
        bundle: {
          targets: ["nsis"],
          windows: {
            nsis: { installMode: "currentUser" },
            webviewInstallMode: { type: "offlineInstaller" },
          },
        },
      }),
    /build:microsoft-store frontend profile/,
  );
});

test("Store project identity requires the protected legal publisher instead of the base community publisher", () => {
  const repository = {
    cargoVersion: "0.1.0-beta.10",
    desktopPackage: { version: "0.1.0-beta.10" },
    legalPublisher: LEGAL_PUBLISHER,
    rootPackage: { version: "0.1.0-beta.10" },
    tauriConfig: {
      bundle: { publisher: "JoeSSH Project" },
      identifier: "dev.atlasterm.joessh",
      productName: "JoeSSH",
      version: "0.1.0-beta.10",
    },
  };
  assert.deepEqual(assertProjectReleaseIdentity(repository), {
    communityPublisher: "JoeSSH Project",
    identifier: "dev.atlasterm.joessh",
    productName: "JoeSSH",
    publisher: LEGAL_PUBLISHER,
    version: "0.1.0-beta.10",
  });
  assert.throws(
    () =>
      assertProjectReleaseIdentity({
        ...repository,
        legalPublisher: undefined,
      }),
    /ATLASTERM_WINDOWS_LEGAL_PUBLISHER/,
  );
  for (const value of [
    "JoeSSH Project",
    " CHANGE-ME ",
    "Joe, Developer",
    "CN=Joe Developer",
  ]) {
    if (value === "JoeSSH Project") {
      assert.equal(assertWindowsLegalPublisher(value), value);
    } else {
      assert.throws(
        () => assertWindowsLegalPublisher(value),
        /ATLASTERM_WINDOWS_LEGAL_PUBLISHER/,
      );
    }
  }
});

test("EXE preflight requires explicit silent-install consent and architecture", () => {
  assert.throws(
    () =>
      parseArgs(
        withSourceCommit([
          "--format",
          "exe",
          "--artifact",
          "JoeSSH_0.1.0_x64-setup.exe",
          "--reviewed-sha",
          COMMIT,
          "--expected-sha256",
          SHA256,
          "--architecture",
          "x64",
        ]),
        RELEASE_ENVIRONMENT,
      ),
    /allow-silent-install/,
  );
  assert.equal(
    parseArgs(
      withSourceCommit([
        "--format",
        "exe",
        "--artifact",
        "JoeSSH_0.1.0_x64-setup.exe",
        "--reviewed-sha",
        COMMIT,
        "--expected-sha256",
        SHA256,
        "--architecture",
        "x64",
        "--allow-silent-install",
      ]),
      RELEASE_ENVIRONMENT,
    ).format,
    "exe",
  );
  assert.throws(
    () =>
      parseArgs(
        withSourceCommit([
          "--format",
          "exe",
          "--artifact",
          "JoeSSH_0.1.0_x64-setup.exe",
          "--reviewed-sha",
          COMMIT,
          "--expected-sha256",
          SHA256,
          "--architecture",
          "neutral",
          "--allow-silent-install",
        ]),
        RELEASE_ENVIRONMENT,
      ),
    /neutral is rejected/,
  );
  assert.throws(
    () =>
      parseArgs(
        withSourceCommit([
          "--format",
          "exe",
          "--artifact",
          "JoeSSH_0.1.0_x64-setup.exe",
          "--reviewed-sha",
          COMMIT,
          "--expected-sha256",
          SHA256,
          "--architecture",
          "x64",
          "--allow-silent-install",
        ]),
        {
          ...RELEASE_ENVIRONMENT,
          ATLASTERM_WINDOWS_LEGAL_PUBLISHER: undefined,
        },
      ),
    /ATLASTERM_WINDOWS_LEGAL_PUBLISHER/,
  );
});

test("EXE hosted URL must be HTTPS, immutable-versioned, and exact-name bound", () => {
  assert.equal(
    validateVersionedHttpsUrl(
      "https://downloads.example.net/joessh/0.1.0/JoeSSH_0.1.0_x64-setup.exe",
      "JoeSSH_0.1.0_x64-setup.exe",
      "0.1.0",
    ),
    "https://downloads.example.net/joessh/0.1.0/JoeSSH_0.1.0_x64-setup.exe",
  );
  assert.throws(
    () =>
      validateVersionedHttpsUrl(
        "https://downloads.example.net/joessh/latest/setup.exe",
        "setup.exe",
        "0.1.0",
      ),
    /immutable release version/,
  );
  assert.throws(
    () =>
      validateVersionedHttpsUrl(
        "https://downloads.example.net/joessh/0.1.0/setup.exe?token=secret",
        "setup.exe",
        "0.1.0",
      ),
    /without credentials, a query, or a fragment/,
  );
});

test("hosted artifacts reject query leakage and require explicit retention proof", () => {
  assert.equal(
    validateHttpsArtifactUrl(
      "https://downloads.example.net/joessh/JoeSSH.msix",
    ),
    "https://downloads.example.net/joessh/JoeSSH.msix",
  );
  assert.throws(
    () =>
      validateHttpsArtifactUrl(
        "https://downloads.example.net/joessh/JoeSSH.msix?token=secret",
      ),
    /without credentials, a query, or a fragment/,
  );

  const verifiedAt = new Date().toISOString();
  const retainedUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const attestation = validateHostedRetentionAttestation(
    {
      artifactSha256: SHA256,
      artifactUrl: "https://downloads.example.net/joessh/JoeSSH.msix",
      objectVersionId: "version-2026-07-30-001",
      retainedUntil,
      retentionMode: "compliance",
      schemaVersion: 1,
      source: "object-storage-retention",
      verifiedAt,
      verifiedBy: "release-owner",
    },
    {
      artifactUrl: "https://downloads.example.net/joessh/JoeSSH.msix",
      expectedSha256: SHA256,
    },
  );
  assert.equal(attestation.retainedUntil, retainedUntil);
  assert.equal(Object.hasOwn(attestation, "artifactUrl"), false);
});

test("GitHub Actions provenance is accepted only with a downloaded MSIX artifact", () => {
  const parsed = parseArgs(
    withSourceCommit([
      "--format",
      "msix",
      "--artifact",
      "JoeSSH.msix",
      "--github-actions-provenance",
      "source-provenance.json",
      "--reviewed-sha",
      COMMIT,
      "--expected-sha256",
      SHA256,
      "--partner-identity",
      "partner-identity.json",
    ]),
    RELEASE_ENVIRONMENT,
  );
  assert.equal(
    parsed.githubActionsProvenance,
    resolve(REPOSITORY_ROOT, "source-provenance.json"),
  );
  assert.throws(
    () =>
      parseArgs(
        withSourceCommit([
          "--format",
          "msix",
          "--download-url",
          "https://downloads.example.test/JoeSSH.msix",
          "--github-actions-provenance",
          "source-provenance.json",
          "--reviewed-sha",
          COMMIT,
          "--expected-sha256",
          SHA256,
          "--partner-identity",
          "partner-identity.json",
        ]),
        RELEASE_ENVIRONMENT,
      ),
    /valid only with a downloaded --artifact/,
  );
  assert.throws(
    () =>
      parseArgs(
        withSourceCommit([
          "--format",
          "exe",
          "--artifact",
          "JoeSSH_0.1.0_x64-setup.exe",
          "--github-actions-provenance",
          "source-provenance.json",
          "--reviewed-sha",
          COMMIT,
          "--expected-sha256",
          SHA256,
          "--architecture",
          "x64",
          "--allow-silent-install",
        ]),
        RELEASE_ENVIRONMENT,
      ),
    /approved only for the reviewed MSIX route/,
  );
});

test("candidate verification uses a private byte snapshot, not the mutable source path", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "joessh-snapshot-test-"));
  try {
    const source = join(temporaryRoot, "source.exe");
    writeFileSync(source, Buffer.from("trusted bytes"), { flag: "wx" });
    const snapshot = capturePrivateSnapshot(
      source,
      "fixture",
      temporaryRoot,
      "snapshot.exe",
    );
    writeFileSync(source, Buffer.from("mutated bytes"), { flag: "w" });

    assert.notEqual(snapshot.path, source);
    assert.equal(readFileSync(snapshot.path, "utf8"), "trusted bytes");
    assert.equal(snapshot.data.toString("utf8"), "trusted bytes");
  } finally {
    rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

for (const [format, verifyPayloadNotices] of [
  ["EXE install", verifyInstalledThirdPartyNotices],
  ["MSIX package", verifyUnpackedThirdPartyNotices],
]) {
  const preparePayload = (payloadRoot) => {
    if (format !== "MSIX package") return payloadRoot;
    const applicationExecutable = resolve(
      payloadRoot,
      "VFS",
      "Local AppData",
      "JoeSSH",
      "JoeSSH.exe",
    );
    mkdirSync(dirname(applicationExecutable), { recursive: true });
    writeFileSync(applicationExecutable, "fixture executable", { flag: "wx" });
    return dirname(applicationExecutable);
  };
  const verifyPayloadNoticesForFixture = (
    payloadRoot,
    expectedEvidence,
    temporaryRoot,
  ) => {
    if (format === "MSIX package") {
      return verifyPayloadNotices(
        payloadRoot,
        resolve(payloadRoot, "VFS", "Local AppData", "JoeSSH", "JoeSSH.exe"),
        expectedEvidence,
        temporaryRoot,
      );
    }
    return verifyPayloadNotices(payloadRoot, expectedEvidence, temporaryRoot);
  };

  test(`${format} accepts exact bundled third-party notices`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    mkdirSync(payloadRoot);
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const content = "Reviewed third-party notices.\n";
    const noticesRoot = preparePayload(payloadRoot);
    writeFixtureFile(noticesRoot, "legal/THIRD-PARTY-NOTICES.txt", content);
    assert.deepEqual(
      verifyPayloadNoticesForFixture(
        payloadRoot,
        {
          bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
          sha256: sha256Text(content),
          sizeBytes: Buffer.byteLength(content),
        },
        temporaryRoot,
      ),
      {
        path: "legal/THIRD-PARTY-NOTICES.txt",
        sha256: sha256Text(content),
        sizeBytes: Buffer.byteLength(content),
        status: "exact-match",
      },
    );
  });

  test(`${format} rejects missing bundled third-party notices`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    mkdirSync(payloadRoot);
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const content = "Reviewed third-party notices.\n";
    preparePayload(payloadRoot);
    assert.throws(
      () =>
        verifyPayloadNoticesForFixture(
          payloadRoot,
          {
            bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
            sha256: sha256Text(content),
            sizeBytes: Buffer.byteLength(content),
          },
          temporaryRoot,
        ),
      /third-party notices is missing/i,
    );
  });

  test(`${format} rejects an illegal bundled notices resource path`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    mkdirSync(payloadRoot);
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const content = "Reviewed third-party notices.\n";
    const noticesRoot = preparePayload(payloadRoot);
    writeFixtureFile(noticesRoot, "legal/THIRD-PARTY-NOTICES.txt", content);
    assert.throws(
      () =>
        verifyPayloadNoticesForFixture(
          payloadRoot,
          {
            bundleResourcePath: "../THIRD-PARTY-NOTICES.txt",
            sha256: sha256Text(content),
            sizeBytes: Buffer.byteLength(content),
          },
          temporaryRoot,
        ),
      /requires exact source path, size, and SHA-256 evidence/i,
    );
  });

  test(`${format} rejects symlinked bundled third-party notices`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    const noticesRoot = preparePayload(payloadRoot);
    const legalRoot = join(noticesRoot, "legal");
    mkdirSync(legalRoot, { recursive: true });
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const content = "Reviewed third-party notices.\n";
    const sourcePath = join(temporaryRoot, "symlink-source-notices.txt");
    const noticesPath = join(legalRoot, "THIRD-PARTY-NOTICES.txt");
    writeFileSync(sourcePath, content, { flag: "wx" });
    try {
      symlinkSync(sourcePath, noticesPath, "file");
    } catch (error) {
      if (skipUnavailableLink(t, "File symlink", error)) {
        return;
      }
      throw error;
    }

    assert.throws(
      () =>
        verifyPayloadNoticesForFixture(
          payloadRoot,
          {
            bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
            sha256: sha256Text(content),
            sizeBytes: Buffer.byteLength(content),
          },
          temporaryRoot,
        ),
      /must be a direct, regular, single-link file/i,
    );
  });

  test(`${format} rejects hard-linked bundled third-party notices`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    const noticesRoot = preparePayload(payloadRoot);
    const legalRoot = join(noticesRoot, "legal");
    mkdirSync(legalRoot, { recursive: true });
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const content = "Reviewed third-party notices.\n";
    const sourcePath = join(temporaryRoot, "hardlink-source-notices.txt");
    const noticesPath = join(legalRoot, "THIRD-PARTY-NOTICES.txt");
    writeFileSync(sourcePath, content, { flag: "wx" });
    try {
      linkSync(sourcePath, noticesPath);
    } catch (error) {
      if (skipUnavailableLink(t, "Hard link", error)) {
        return;
      }
      throw error;
    }

    assert.throws(
      () =>
        verifyPayloadNoticesForFixture(
          payloadRoot,
          {
            bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
            sha256: sha256Text(content),
            sizeBytes: Buffer.byteLength(content),
          },
          temporaryRoot,
        ),
      /must be a direct, regular, single-link file/i,
    );
  });

  test(`${format} rejects wrong-size bundled third-party notices`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    mkdirSync(payloadRoot);
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const reviewed = "Reviewed third-party notices.\n";
    const noticesRoot = preparePayload(payloadRoot);
    writeFixtureFile(
      noticesRoot,
      "legal/THIRD-PARTY-NOTICES.txt",
      `${reviewed}extra\n`,
    );
    assert.throws(
      () =>
        verifyPayloadNoticesForFixture(
          payloadRoot,
          {
            bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
            sha256: sha256Text(reviewed),
            sizeBytes: Buffer.byteLength(reviewed),
          },
          temporaryRoot,
        ),
      /size does not match the verified source notices/i,
    );
  });

  test(`${format} rejects tampered bundled third-party notices`, (t) => {
    const temporaryRoot = mkdtempSync(
      join(tmpdir(), "joessh-store-payload-legal-"),
    );
    const payloadRoot = join(temporaryRoot, "payload");
    mkdirSync(payloadRoot);
    t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));

    const reviewed = "Reviewed third-party notices.\n";
    const tampered = `X${reviewed.slice(1)}`;
    const noticesRoot = preparePayload(payloadRoot);
    writeFixtureFile(noticesRoot, "legal/THIRD-PARTY-NOTICES.txt", tampered);
    assert.equal(Buffer.byteLength(tampered), Buffer.byteLength(reviewed));
    assert.throws(
      () =>
        verifyPayloadNoticesForFixture(
          payloadRoot,
          {
            bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
            sha256: sha256Text(reviewed),
            sizeBytes: Buffer.byteLength(reviewed),
          },
          temporaryRoot,
        ),
      /SHA-256 does not match the verified source notices/i,
    );
  });
}

test("candidate evidence requires an exact bundled notices result", () => {
  const content = "Reviewed third-party notices.\n";
  const expectedEvidence = {
    bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
    sha256: sha256Text(content),
    sizeBytes: Buffer.byteLength(content),
  };
  const verification = {
    bundledThirdPartyNotices: {
      path: expectedEvidence.bundleResourcePath,
      sha256: expectedEvidence.sha256,
      sizeBytes: expectedEvidence.sizeBytes,
      status: "exact-match",
    },
  };

  assert.deepEqual(
    assertBundledThirdPartyNoticesMatch(verification, expectedEvidence),
    {
      ...verification.bundledThirdPartyNotices,
      thirdPartyNoticesBundled: true,
    },
  );
  assert.throws(
    () =>
      assertBundledThirdPartyNoticesMatch(
        {
          bundledThirdPartyNotices: {
            ...verification.bundledThirdPartyNotices,
            sha256: "0".repeat(64),
          },
        },
        expectedEvidence,
      ),
    /must prove an exact match/i,
  );
});

test("MSIX preflight rejects missing or placeholder Partner Center identity", () => {
  assert.throws(
    () =>
      parseArgs(
        withSourceCommit([
          "--format",
          "msix",
          "--artifact",
          "JoeSSH.msix",
          "--reviewed-sha",
          COMMIT,
          "--expected-sha256",
          SHA256,
        ]),
        RELEASE_ENVIRONMENT,
      ),
    /partner-identity/,
  );
  assert.throws(
    () =>
      validatePartnerCenterIdentity({
        schemaVersion: 1,
        source: "partner-center",
        productId: "CHANGE-ME",
        packageIdentityName: "example",
        publisher: "CN=example",
        publisherDisplayName: "example",
        publisherId: "example",
        packageFamilyName: "example_123",
        reservedAt: "2026-07-30T00:00:00.000Z",
      }),
    /placeholder/,
  );
});

test("MSIX manifest identity must exactly match Partner Center", () => {
  const manifest = parseMsixManifestIdentity(completeMsixManifest());
  const partner = validatePartnerCenterIdentity({
    schemaVersion: 1,
    source: "partner-center",
    productId: "9N1234567890",
    packageIdentityName: "JoeSSH.Store.Assigned",
    publisher: "CN=Store Publisher",
    publisherDisplayName: "JoeSSH Publisher",
    publisherId: "8wekyb3d8bbwe",
    packageFamilyName: "JoeSSH.Store.Assigned_8wekyb3d8bbwe",
    reservedAt: "2026-07-30T00:00:00.000Z",
  });

  assert.doesNotThrow(() => assertMsixIdentityMatches(manifest, partner));
  assert.doesNotThrow(() =>
    assertPartnerCenterLegalPublisher(partner, "JoeSSH Publisher"),
  );
  assert.throws(
    () =>
      assertMsixIdentityMatches(manifest, {
        ...partner,
        publisher: "CN=Wrong Publisher",
      }),
    /Publisher/,
  );
  assert.throws(
    () => assertPartnerCenterLegalPublisher(partner, LEGAL_PUBLISHER),
    /publisherDisplayName/,
  );
});

test("MSIX requires a packaged classic desktop full-trust manifest", () => {
  const completeManifest = completeMsixManifest();
  assert.doesNotThrow(() =>
    assertMsixDesktopFullTrustContract(completeManifest),
  );
  assert.throws(
    () =>
      assertMsixDesktopFullTrustContract(
        completeManifest.replace(
          '<rescap:Capability Name="runFullTrust" />',
          "",
        ),
      ),
    /runFullTrust/,
  );
});

test("MSIX capability allowlist rejects extra base, UAP, and restricted capabilities", () => {
  const runFullTrust = '<rescap:Capability Name="runFullTrust" />';
  const extraBaseCapability = completeMsixManifest({
    capabilities: `${runFullTrust}
      <Capability Name="internetClient" />`,
  });
  const extraUapCapability = completeMsixManifest({
    capabilities: `${runFullTrust}
      <uap:Capability Name="documentsLibrary" />`,
  }).replace(
    'xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"',
    `xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
      xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"`,
  );
  const extraRestrictedCapability = completeMsixManifest({
    capabilities: `${runFullTrust}
      <rescap:Capability Name="packageManagement" />`,
  });
  const extraCapabilityAttribute = completeMsixManifest({
    capabilities:
      '<rescap:Capability Name="runFullTrust" ReviewBypass="true" />',
  });

  for (const manifest of [
    extraBaseCapability,
    extraUapCapability,
    extraRestrictedCapability,
    extraCapabilityAttribute,
  ]) {
    assert.throws(
      () => assertMsixDesktopFullTrustContract(manifest),
      /exactly one approved restricted runFullTrust.*no additional base, UAP, or restricted capabilities/,
    );
  }
});

test("MSIX version is deterministically bound to the project version", () => {
  assert.equal(deriveMsixVersion("0.1.0-beta.10"), "1.1.10.0");
  assert.equal(deriveMsixVersion("0.1.0-beta.24"), "1.1.24.0");
  assert.equal(deriveMsixVersion("0.1.0"), "1.1.99.0");
  assert.throws(
    () => deriveMsixVersion("0.1.0-rc.1"),
    /cannot be deterministically mapped/,
  );
});

test("MSIX version mapping preserves beta, stable, and next-patch order", () => {
  const projectVersions = [
    "0.1.0-beta.1",
    "0.1.0-beta.10",
    "0.1.0-beta.22",
    "0.1.0-beta.23",
    "0.1.0-beta.24",
    "0.1.0-beta.98",
    "0.1.0",
    "0.1.1-beta.1",
    "0.1.1",
  ];
  const msixVersions = projectVersions.map(deriveMsixVersion);

  assert.deepEqual(msixVersions, [
    "1.1.1.0",
    "1.1.10.0",
    "1.1.22.0",
    "1.1.23.0",
    "1.1.24.0",
    "1.1.98.0",
    "1.1.99.0",
    "1.1.101.0",
    "1.1.199.0",
  ]);
  for (let index = 1; index < msixVersions.length; index += 1) {
    const previous = msixVersions[index - 1].split(".").map(Number);
    const current = msixVersions[index].split(".").map(Number);
    assert.equal(compareVersionComponents(previous, current) < 0, true);
  }
});

test("MSIX version mapping enforces Store component boundaries", () => {
  assert.equal(deriveMsixVersion("65534.65535.654"), "65535.65535.65499.0");
  for (const projectVersion of [
    "65535.0.0-beta.1",
    "0.65536.0-beta.1",
    "0.0.655-beta.1",
    "0.0.655",
  ]) {
    assert.throws(
      () => deriveMsixVersion(projectVersion),
      /exceeds the deterministic MSIX mapping/,
    );
  }
  for (const projectVersion of ["0.1.0-beta.0", "0.1.0-beta.99"]) {
    assert.throws(
      () => deriveMsixVersion(projectVersion),
      /beta number must be from 1 to 98/,
    );
  }
});

test("MSIX manifests require a nonzero first component and zero revision", () => {
  assert.throws(
    () =>
      parseMsixManifestIdentity(
        completeMsixManifest({
          identity: `<Identity Publisher="CN=Store Publisher" Version="0.1.10.0"
      Name="JoeSSH.Store.Assigned" ProcessorArchitecture="x64" />`,
        }),
      ),
    /first component must be nonzero/,
  );
  assert.throws(
    () =>
      parseMsixManifestIdentity(
        completeMsixManifest({
          identity: `<Identity Publisher="CN=Store Publisher" Version="1.1.10.1"
      Name="JoeSSH.Store.Assigned" ProcessorArchitecture="x64" />`,
        }),
      ),
    /revision \(fourth component\) must be 0/,
  );
  assert.throws(
    () =>
      parseMsixManifestIdentity(
        completeMsixManifest({
          identity: `<Identity Publisher="CN=Store Publisher" Version="1.65536.10.0"
      Name="JoeSSH.Store.Assigned" ProcessorArchitecture="x64" />`,
        }),
      ),
    /from 0 to 65535/,
  );
});

test("MSIX manifest accepts only the exact leading Packaging Tool comment", () => {
  const approved = completeMsixManifest().replace(
    "<Identity ",
    `<!--Package created by MSIX Packaging Tool version: -->
      <Identity `,
  );
  assert.doesNotThrow(() => parseMsixManifestIdentity(approved));

  const decoy = completeMsixManifest().replace(
    "<Package",
    `<!-- <Identity Name="decoy" Publisher="CN=decoy"
      Version="1.2.3.0" ProcessorArchitecture="x64" /> -->
    <Package`,
  );
  assert.throws(
    () => parseMsixManifestIdentity(decoy),
    /decoy contract markers/,
  );

  const misplaced = completeMsixManifest().replace(
    "<Properties>",
    `<!--Package created by MSIX Packaging Tool version: -->
      <Properties>`,
  );
  assert.throws(
    () => parseMsixManifestIdentity(misplaced),
    /exact leading MSIX Packaging Tool comment/,
  );
});

test("MSIX manifest rejects DTD, entity, and CDATA decoys", () => {
  const manifest = completeMsixManifest();
  const dtd = manifest.replace(
    "<Package",
    `<!DOCTYPE Package [<!ENTITY publisher "decoy">]>
    <Package`,
  );
  const cdata = manifest.replace(
    "JoeSSH Publisher</PublisherDisplayName>",
    "<![CDATA[JoeSSH Publisher]]></PublisherDisplayName>",
  );

  for (const unsafe of [dtd, cdata]) {
    assert.throws(
      () => parseMsixManifestIdentity(unsafe),
      /decoy contract markers/,
    );
  }
});

test("MSIX desktop contract binds all execution fields to one unique Application", () => {
  const contract = parseMsixManifestContract(completeMsixManifest());
  assert.deepEqual(contract.desktopApplication, {
    executable: "JoeSSH.exe",
    runtimeBehavior: "packagedClassicApp",
    trustLevel: "mediumIL",
  });
  const packagingToolContract = parseMsixManifestContract(
    completeMsixManifest({
      application: `<Application Id="ATLASTERMDESKTOPSHELL"
        Executable="VFS\\Local AppData\\JoeSSH\\JoeSSH.exe"
        EntryPoint="Windows.FullTrustApplication" />`,
    }),
  );
  assert.deepEqual(packagingToolContract.desktopApplication, {
    executable: "VFS/Local AppData/JoeSSH/JoeSSH.exe",
    runtimeBehavior: "packagedClassicApp",
    trustLevel: "mediumIL",
  });
  assert.throws(
    () =>
      parseMsixManifestContract(
        completeMsixManifest({
          application: `
            <Application Id="First" Executable="JoeSSH.exe"
              RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />
            <Application Id="Second" Executable="decoy.exe"
              RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />`,
        }),
      ),
    /exactly one desktop Application/,
  );

  for (const application of [
    `<Application Id="App" Executable="JoeSSH.exe"
      EntryPoint="Windows.FullTrustApplication"
      RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />`,
    `<Application Id="App" Executable="JoeSSH.exe"
      EntryPoint="Windows.FullTrustApplication" StartPage="index.html" />`,
    `<Application Id="App" Executable="JoeSSH.exe"
      RuntimeBehavior="packagedClassicApp" />`,
  ]) {
    assert.throws(
      () => parseMsixManifestContract(completeMsixManifest({ application })),
      /exactly packagedClassicApp\/mediumIL or the MSIX Packaging Tool Windows.FullTrustApplication profile/,
    );
  }
});

test("MSIX Application.Executable rejects traversal, URI, and encoded paths", () => {
  assert.equal(
    normalizeMsixExecutablePath("bin\\JoeSSH.exe"),
    "bin/JoeSSH.exe",
  );
  for (const value of [
    "..\\JoeSSH.exe",
    "C:\\JoeSSH.exe",
    "https://example.invalid/JoeSSH.exe",
    "bin/%2e%2e/JoeSSH.exe",
  ]) {
    assert.throws(
      () => normalizeMsixExecutablePath(value),
      /package-relative|traversal, URI, or encoded/,
    );
  }
});

test("Partner Center package family binds package name and PublisherId", () => {
  assert.throws(
    () =>
      validatePartnerCenterIdentity({
        schemaVersion: 1,
        source: "partner-center",
        productId: "9N1234567890",
        packageIdentityName: "JoeSSH.Store.Assigned",
        publisher: "CN=Store Publisher",
        publisherDisplayName: "JoeSSH Publisher",
        publisherId: "8wekyb3d8bbwe",
        packageFamilyName: "JoeSSH.Wrong_8wekyb3d8bbwe",
        reservedAt: "2026-07-30T00:00:00.000Z",
      }),
    /packageFamilyName/,
  );
});

test("protected signer and ARP identity require exact release bindings", () => {
  assert.deepEqual(
    validateExpectedSigner(RELEASE_ENVIRONMENT),
    EXPECTED_SIGNER,
  );
  assert.doesNotThrow(() =>
    assertSignerMatchesExpected(
      {
        signerSubject: EXPECTED_SIGNER.subject,
        signerThumbprint: EXPECTED_SIGNER.thumbprint.toLowerCase(),
      },
      EXPECTED_SIGNER,
      "fixture",
    ),
  );
  assert.throws(
    () =>
      assertSignerMatchesExpected(
        {
          signerSubject: EXPECTED_SIGNER.subject,
          signerThumbprint: "E".repeat(40),
        },
        EXPECTED_SIGNER,
        "fixture",
      ),
    /protected expected subject and thumbprint/,
  );
  assert.equal(
    assertCertificateSubjectMatchesLegalPublisher(
      EXPECTED_SIGNER.subject,
      LEGAL_PUBLISHER,
    ),
    LEGAL_PUBLISHER,
  );
  for (const environment of [
    {
      ...RELEASE_ENVIRONMENT,
      ATLASTERM_WINDOWS_LEGAL_PUBLISHER: "Wrong Publisher",
    },
    {
      ...RELEASE_ENVIRONMENT,
      ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT: `CN=${LEGAL_PUBLISHER}, CN=${LEGAL_PUBLISHER}`,
    },
    {
      ...RELEASE_ENVIRONMENT,
      ATLASTERM_WINDOWS_LEGAL_PUBLISHER: "",
    },
  ]) {
    assert.throws(
      () => validateExpectedSigner(environment),
      /legal publisher|ATLASTERM_WINDOWS_LEGAL_PUBLISHER|certificate subject/i,
    );
  }

  const identity = {
    productName: "JoeSSH",
    publisher: LEGAL_PUBLISHER,
    version: "0.1.0-beta.10",
  };
  assert.doesNotThrow(() =>
    assertInstalledProductIdentity(
      {
        displayName: "JoeSSH",
        displayVersion: "0.1.0-beta.10",
        installLocation: "C:\\Program Files\\JoeSSH",
        publisher: LEGAL_PUBLISHER,
      },
      identity,
    ),
  );
  assert.throws(
    () =>
      assertInstalledProductIdentity(
        {
          displayName: "JoeSSH",
          displayVersion: "0.1.0",
          installLocation: "C:\\Program Files\\JoeSSH",
          publisher: LEGAL_PUBLISHER,
        },
        identity,
      ),
    /ARP displayVersion/,
  );
});

test("payload and cleanup failures are both preserved", () => {
  const payloadError = new Error("payload signer mismatch");
  const cleanupError = new Error("uninstaller returned 1");
  const combined = combineVerificationErrors(payloadError, cleanupError);

  assert.equal(combined instanceof AggregateError, true);
  assert.match(combined.message, /payload signer mismatch/);
  assert.match(combined.message, /uninstaller returned 1/);
  assert.deepEqual(combined.errors, [payloadError, cleanupError]);
});

test("EXE notices verification failure remains wired to silent cleanup", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "prepare-windows-store-candidate.mjs"),
    "utf8",
  );
  assert.doesNotThrow(() => assertExeNoticesCleanupWiring(source));

  const shortCircuitedCleanup = source.replace(
    "  } catch (error) {\n    verificationError = error;\n  }\n\n  let uninstall = null;",
    "  } catch (error) {\n    throw error;\n  }\n\n  let uninstall = null;",
  );
  assert.notEqual(shortCircuitedCleanup, source);
  assert.throws(
    () => assertExeNoticesCleanupWiring(shortCircuitedCleanup),
    /must capture notices failures before silent cleanup/i,
  );
});

test("MSIX candidate returns notices evidence produced from its unpacked payload", (t) => {
  const calls = [];
  const bundledThirdPartyNotices = Object.freeze({
    path: "legal/THIRD-PARTY-NOTICES.txt",
    sha256: SHA256,
    sizeBytes: 42,
    status: "exact-match",
  });
  const fixture = createMsixCandidateVerificationFixture(t, (...args) => {
    calls.push(args);
    return bundledThirdPartyNotices;
  });

  const verification = verifyMsixCandidate(fixture.input, fixture.runtime);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], fixture.unpackRoot);
  assert.equal(
    calls[0][1],
    resolve(fixture.unpackRoot, "VFS", "Local AppData", "JoeSSH", "JoeSSH.exe"),
  );
  assert.strictEqual(calls[0][2], fixture.input.legalNotices);
  assert.equal(calls[0][3], fixture.input.temporaryRoot);
  assert.strictEqual(
    verification.bundledThirdPartyNotices,
    bundledThirdPartyNotices,
  );
  assert.deepEqual(verification.manifestLanguages, {
    ...readWindowsStoreManifestLanguageContract(),
    status: "exact-match",
  });
});

test("MSIX candidate propagates unpacked notices verification failures", (t) => {
  const noticesError = new Error("unpacked notices mismatch");
  const fixture = createMsixCandidateVerificationFixture(t, () => {
    throw noticesError;
  });

  assert.throws(
    () => verifyMsixCandidate(fixture.input, fixture.runtime),
    (error) => error === noticesError,
  );
});

test("MSIX candidate rejects a package that omits reviewed UI languages", (t) => {
  const fixture = createMsixCandidateVerificationFixture(t, () => ({
    path: "legal/THIRD-PARTY-NOTICES.txt",
    sha256: SHA256,
    sizeBytes: 42,
    status: "exact-match",
  }));
  const originalRun = fixture.runtime.runRequiredCommand;
  fixture.runtime.runRequiredCommand = (...args) => {
    originalRun(...args);
    writeFixtureFile(
      fixture.unpackRoot,
      "AppxManifest.xml",
      completeMsixManifest({
        application: `<Application Id="App" Executable="VFS\\Local AppData\\JoeSSH\\JoeSSH.exe"
      RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />`,
        identity: `<Identity Publisher="CN=Store Publisher" Version="1.1.10.0"
      Name="JoeSSH.Store.Assigned" ProcessorArchitecture="x64" />`,
        resources: '<Resource Language="en-US" />',
      }),
    );
  };

  assert.throws(
    () => verifyMsixCandidate(fixture.input, fixture.runtime),
    /must exactly match the reviewed app UI language order/,
  );
});

test("MSIX notices verification resolves legal resources beside the nested application executable", (t) => {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "joessh-msix-nested-legal-"),
  );
  t.after(() => rmSync(temporaryRoot, { force: true, recursive: true }));
  const unpackRoot = resolve(temporaryRoot, "msix-unpacked");
  const executablePath = resolve(
    unpackRoot,
    "VFS",
    "Local AppData",
    "JoeSSH",
    "atlasterm-desktop-shell.exe",
  );
  const notices = "Nested legal notices.\n";
  mkdirSync(dirname(executablePath), { recursive: true });
  writeFileSync(executablePath, Buffer.from("fixture executable"), {
    flag: "wx",
  });
  writeFixtureFile(
    unpackRoot,
    "VFS/Local AppData/JoeSSH/legal/THIRD-PARTY-NOTICES.txt",
    notices,
  );

  assert.deepEqual(
    verifyUnpackedThirdPartyNotices(
      unpackRoot,
      executablePath,
      {
        bundleResourcePath: "legal/THIRD-PARTY-NOTICES.txt",
        sha256: sha256Text(notices),
        sizeBytes: Buffer.byteLength(notices),
      },
      temporaryRoot,
    ),
    {
      path: "legal/THIRD-PARTY-NOTICES.txt",
      sha256: sha256Text(notices),
      sizeBytes: Buffer.byteLength(notices),
      status: "exact-match",
    },
  );
});

function assertExeNoticesCleanupWiring(source) {
  const verifyStart = source.indexOf("function verifyExeCandidate({");
  const verifyEnd = source.indexOf(
    "export function combineVerificationErrors",
    verifyStart,
  );
  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart);
  const verifyExeSource = source.slice(verifyStart, verifyEnd);

  assert.match(
    verifyExeSource,
    /let verificationError = null;\s*try \{\s*bundledThirdPartyNotices = verifyInstalledThirdPartyNotices\([\s\S]*?\}\s*catch \(error\) \{\s*verificationError = error;\s*\}\s*let uninstall = null;\s*let cleanupError = null;\s*try \{\s*uninstall = verifySilentUninstall\(/u,
    "EXE verification must capture notices failures before silent cleanup.",
  );
  assert.match(
    verifyExeSource,
    /const combinedError = combineVerificationErrors\(\s*verificationError,\s*cleanupError,\s*\);\s*if \(combinedError\) \{\s*throw combinedError;\s*\}/u,
    "EXE verification must combine payload and cleanup failures after cleanup.",
  );
}

test(
  "real Authenticode verifier rejects an installed unsigned PE fixture",
  { skip: process.platform !== "win32" },
  () => {
    const unsignedFixture = resolve(
      import.meta.dirname,
      "../node_modules/fb-dotslash/bin/windows/dotslash.exe",
    );
    assert.equal(
      existsSync(unsignedFixture),
      true,
      "npm ci must install the unsigned PE fixture",
    );
    assert.throws(
      () => verifyAuthenticode(unsignedFixture, { requireTimestamp: true }),
      /Authenticode validation failed/,
    );
  },
);

function skipUnavailableLink(t, kind, error) {
  const unavailableCodes = new Set([
    "EACCES",
    "EINVAL",
    "ENOSYS",
    "ENOTSUP",
    "EPERM",
    "EROFS",
  ]);
  if (!unavailableCodes.has(error?.code)) {
    return false;
  }
  t.skip(
    `${kind} creation is unavailable on ${process.platform} (${error.code}): ${error.message}`,
  );
  return true;
}
