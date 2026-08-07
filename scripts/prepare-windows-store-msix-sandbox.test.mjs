import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sax from "sax";
import {
  assertBuildProvenanceBinding,
  assertUnredirectedStagingPath,
  createConversionTemplate,
  createSandboxConfig,
  parseArgs,
  windowsStoreNsisBuildProvenancePath,
} from "./prepare-windows-store-msix-sandbox.mjs";

const commit = "a".repeat(40);
const sha256 = "b".repeat(64);
const partnerIdentity = Object.freeze({
  packageIdentityName: "JoeSSH.Store.Assigned",
  publisher: "CN=Store & Publisher",
  publisherDisplayName: "Test & Publisher",
});

test("Sandbox arguments preserve reviewed commit and resolve only file paths", () => {
  const options = parseArgs([
    "--tool-bundle",
    "tool.msixbundle",
    "--tool-license",
    "license.xml",
    "--driver-cab",
    "driver.cab",
    "--partner-identity",
    "identity.json",
    "--reviewed-sha",
    commit,
    "--memory-mb",
    "8192",
  ]);

  assert.equal(options.reviewedSha, commit);
  assert.equal(options.partnerIdentity, resolve("identity.json"));
  assert.equal(options.memoryInMb, 8192);
});

test("Sandbox arguments fail closed on missing inputs and unsafe memory sizes", () => {
  assert.throws(() => parseArgs([]), /--driver-cab is required/);
  const complete = [
    "--tool-bundle=tool.msixbundle",
    "--tool-license=license.xml",
    "--driver-cab=driver.cab",
    "--partner-identity=identity.json",
    `--reviewed-sha=${commit}`,
  ];
  assert.throws(
    () => parseArgs([...complete, "--memory-mb=2048"]),
    /integer from 4096 to 16384/,
  );
  assert.throws(
    () => parseArgs([...complete, "--unexpected=value"]),
    /Unknown argument/,
  );
  assert.throws(
    () => parseArgs([...complete, "--installer=stale.exe"]),
    /Unknown argument/,
  );
});

test("adjacent build provenance binds every installer identity dimension", () => {
  const installerPath = resolve("JoeSSH_0.1.0-beta.10_x64-setup.exe");
  assert.equal(
    windowsStoreNsisBuildProvenancePath(installerPath),
    `${installerPath}.build-provenance.json`,
  );
  const buildProvenance = {
    schemaVersion: 1,
    format: "nsis-exe",
    generator: "scripts/build-windows-store-candidate.mjs",
    sourceCommit: commit,
    projectVersion: "0.1.0-beta.10",
    artifact: {
      bootstrapMachine: "x86",
      fileName: "JoeSSH_0.1.0-beta.10_x64-setup.exe",
      sha256,
      sizeBytes: 123,
    },
    payload: {
      architecture: "x64",
      fileName: "atlasterm-desktop-shell.exe",
      sha256: "e".repeat(64),
      sizeBytes: 456,
    },
  };
  const binding = {
    buildProvenance,
    installer: { ...buildProvenance.artifact },
    payload: { ...buildProvenance.payload },
    projectVersion: buildProvenance.projectVersion,
    reviewedSha: commit,
  };
  assert.deepEqual(assertBuildProvenanceBinding(binding), buildProvenance);

  for (const tamperedBinding of [
    { reviewedSha: "c".repeat(40) },
    { installer: { ...binding.installer, sha256: "d".repeat(64) } },
    { installer: { ...binding.installer, fileName: "other.exe" } },
    { installer: { ...binding.installer, sizeBytes: 124 } },
    { payload: { ...binding.payload, architecture: "x86" } },
    { payload: { ...binding.payload, sha256: "f".repeat(64) } },
    { projectVersion: "0.1.0" },
  ]) {
    assert.throws(
      () =>
        assertBuildProvenanceBinding({
          ...binding,
          ...tamperedBinding,
        }),
      /does not bind the exact reviewed HEAD/,
    );
  }
  assert.throws(
    () =>
      assertBuildProvenanceBinding({
        ...binding,
        buildProvenance: { ...buildProvenance, unexpected: true },
      }),
    /only the reviewed fields/,
  );
});

test("Sandbox staging rejects a junction or symlink ancestor", (t) => {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "joessh-sandbox-root-"));
  const outsideRoot = mkdtempSync(join(tmpdir(), "joessh-sandbox-outside-"));
  const stagingParent = join(
    repositoryRoot,
    "reports",
    "handoff",
    "windows-store",
    "msix-sandbox",
  );
  mkdirSync(resolve(stagingParent, ".."), { recursive: true });
  try {
    try {
      symlinkSync(
        outsideRoot,
        stagingParent,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip("Filesystem does not permit a junction fixture");
        return;
      }
      throw error;
    }
    assert.throws(
      () =>
        assertUnredirectedStagingPath(
          repositoryRoot,
          join(stagingParent, "candidate"),
        ),
      /symbolic link, junction, reparse point|redirected filesystem path/,
    );
  } finally {
    rmSync(repositoryRoot, { force: true, recursive: true });
    rmSync(outsideRoot, { force: true, recursive: true });
  }
});

test("conversion template is valid XML with exact offline Store settings", () => {
  const template = createConversionTemplate({
    msixVersion: "1.1.10.0",
    packageFileName: "JoeSSH_1.1.10.0_x64.msix",
    partnerIdentity,
    productName: "JoeSSH",
  });

  assertValidXml(template);
  assert.match(
    template,
    /xmlns:V7="http:\/\/schemas\.microsoft\.com\/msix\/msixpackagingtool\/template\/2007"/,
  );
  assert.match(template, /V7:EnforceMicrosoftStoreRequirements="true"/);
  assert.match(template, /AllowTelemetry="false"/);
  assert.match(template, /Arguments="\/S"/);
  assert.match(template, /Version="1\.1\.10\.0"/);
  assert.match(template, /PublisherName="CN=Store &amp; Publisher"/);
  assert.match(template, /PublisherDisplayName="Test &amp; Publisher"/);
  assert.doesNotMatch(template, /SigningInformation|TokenFile|Certificate/);
  assert.doesNotMatch(template, /<Capabilities>/);
});

test("conversion template rejects XML control characters", () => {
  assert.throws(
    () =>
      createConversionTemplate({
        msixVersion: "1.1.10.0",
        packageFileName: "JoeSSH.msix",
        partnerIdentity: {
          ...partnerIdentity,
          publisherDisplayName: "Unsafe\u0001Publisher",
        },
        productName: "JoeSSH",
      }),
    /not safe XML text/,
  );
});

test("WSB exposes only read-only input and isolated writable output", () => {
  const config = createSandboxConfig({
    inputRoot: "C:\\Private & Input",
    memoryInMb: 6144,
    outputRoot: "C:\\Private Output",
  });

  assertValidXml(config);
  assert.match(config, /<Networking>Disable<\/Networking>/);
  assert.match(config, /<ClipboardRedirection>Disable<\/ClipboardRedirection>/);
  assert.match(config, /<AudioInput>Disable<\/AudioInput>/);
  assert.match(config, /<VideoInput>Disable<\/VideoInput>/);
  assert.match(config, /<PrinterRedirection>Disable<\/PrinterRedirection>/);
  assert.match(config, /<HostFolder>C:\\Private &amp; Input<\/HostFolder>/);
  assert.match(
    config,
    /<SandboxFolder>C:\\JoeSSHInput<\/SandboxFolder>\s*<ReadOnly>true<\/ReadOnly>/,
  );
  assert.match(
    config,
    /<SandboxFolder>C:\\JoeSSHOutput<\/SandboxFolder>\s*<ReadOnly>false<\/ReadOnly>/,
  );
  assert.match(config, /bootstrap\.ps1 -SkipWebViewPrewarm<\/Command>/);
});

test("WSB resolves relative host folders without rewriting Windows absolute paths", () => {
  const config = createSandboxConfig({
    inputRoot: "relative-input",
    memoryInMb: 6144,
    outputRoot: "\\\\server\\share\\output",
  });

  assert.match(config, /<HostFolder>[^<]*relative-input<\/HostFolder>/);
  assert.match(config, /<HostFolder>\\\\server\\share\\output<\/HostFolder>/);
});

test("Sandbox bootstrap remains offline and returns sanitized result evidence", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "windows-store-msix-sandbox-bootstrap.ps1"),
    "utf8",
  );

  assert.match(source, /Add-AppxProvisionedPackage/);
  assert.match(source, /MSIXPackagingTool\.License\.xml/);
  assert.match(source, /MSIXPackagingTool\.Driver\.cab/);
  assert.match(source, /MsixPackagingTool\.exe/);
  assert.match(source, /create-package/);
  assert.match(source, /Assert-InputManifest/);
  assert.match(source, /Get-FileHash/);
  assert.match(source, /Get-AuthenticodeSignature/);
  assert.match(source, /Status\.ToString\(\) -ne "NotSigned"/);
  assert.match(source, /Prewarm-WebView2Runtime/);
  assert.match(source, /webview-prewarm/);
  assert.match(source, /uninstall\.exe/);
  assert.match(source, /SkipWebViewPrewarm/);
  assert.doesNotMatch(
    source,
    /Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|curl\.exe|https?:\/\//i,
  );
  assert.doesNotMatch(
    source,
    /partnerIdentity|publisherDisplayName|productId/i,
  );
});

function assertValidXml(xml) {
  const parser = sax.parser(true, { xmlns: true });
  parser.onerror = (error) => {
    throw error;
  };
  parser.write(xml).close();
}
