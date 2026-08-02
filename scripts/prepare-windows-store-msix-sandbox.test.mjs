import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import sax from "sax";
import {
  createConversionTemplate,
  createSandboxConfig,
  parseArgs,
} from "./prepare-windows-store-msix-sandbox.mjs";

const commit = "a".repeat(40);
const sha256 = "b".repeat(64);
const partnerIdentity = Object.freeze({
  packageIdentityName: "JoeSSH.Store.Assigned",
  publisher: "CN=Store & Publisher",
  publisherDisplayName: "Test & Publisher",
});

test("Sandbox arguments preserve hashes and resolve only file paths", () => {
  const options = parseArgs([
    "--installer",
    "candidate.exe",
    "--expected-installer-sha256",
    sha256,
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
    "--artifact-source-sha",
    commit,
    "--memory-mb",
    "8192",
  ]);

  assert.equal(options.expectedInstallerSha256, sha256);
  assert.equal(options.reviewedSha, commit);
  assert.equal(options.artifactSourceSha, commit);
  assert.equal(options.installer, resolve("candidate.exe"));
  assert.equal(options.partnerIdentity, resolve("identity.json"));
  assert.equal(options.memoryInMb, 8192);
});

test("Sandbox arguments fail closed on missing inputs and unsafe memory sizes", () => {
  assert.throws(() => parseArgs([]), /--artifact-source-sha is required/);
  const complete = [
    "--installer=candidate.exe",
    `--expected-installer-sha256=${sha256}`,
    "--tool-bundle=tool.msixbundle",
    "--tool-license=license.xml",
    "--driver-cab=driver.cab",
    "--partner-identity=identity.json",
    `--reviewed-sha=${commit}`,
    `--artifact-source-sha=${commit}`,
  ];
  assert.throws(
    () => parseArgs([...complete, "--memory-mb=2048"]),
    /integer from 4096 to 16384/,
  );
  assert.throws(
    () => parseArgs([...complete, "--unexpected=value"]),
    /Unknown argument/,
  );
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
