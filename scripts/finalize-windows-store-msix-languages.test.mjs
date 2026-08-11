import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  parseArgs,
  replaceManifestLanguages,
} from "./finalize-windows-store-msix-languages.mjs";
import { parseMsixManifestContract } from "./windows-store-contract.mjs";

const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities">
  <Identity Name="JoeSSH.Store" Publisher="CN=JoeSSH" Version="1.1.22.0" ProcessorArchitecture="x64" />
  <Properties>
    <PublisherDisplayName>JoeSSH</PublisherDisplayName>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="JoeSSH" Executable="VFS\\JoeSSH.exe" RuntimeBehavior="packagedClassicApp" TrustLevel="mediumIL" />
  </Applications>
</Package>
`;

test("replaces only the MSIX Resources language list in reviewed order", () => {
  const languages = ["en-US", "zh-Hans-CN", "zh-Hant-TW", "ja-JP"];
  const updated = replaceManifestLanguages(manifest, languages);
  const originalContract = parseMsixManifestContract(manifest);
  const updatedContract = parseMsixManifestContract(updated);

  assert.deepEqual(updatedContract.languages, languages);
  assert.deepEqual(updatedContract.identity, originalContract.identity);
  assert.deepEqual(
    updatedContract.desktopApplication,
    originalContract.desktopApplication,
  );
  assert.match(updated, /<Resource Language="en-US" \/>/);
  assert.match(updated, /<Resource Language="zh-Hant-TW" \/>/);
  assert.doesNotMatch(updated, /Language="en-us"/);
});

test("rejects duplicate or invalid target language tags", () => {
  assert.throws(
    () => replaceManifestLanguages(manifest, ["en-US", "en-us"]),
    /duplicate BCP-47 tags/,
  );
  assert.throws(
    () => replaceManifestLanguages(manifest, ["not_a_language"]),
    /invalid BCP-47 tag/,
  );
});

test("rejects non-language Resources and prefixed conversion profiles", () => {
  assert.throws(
    () =>
      replaceManifestLanguages(
        manifest.replace('Language="en-us"', 'Scale="200"'),
        ["en-US"],
      ),
    /language-only Resource|Language attribute/,
  );
  const prefixed = manifest
    .replace(
      '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"',
      '<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:f="http://schemas.microsoft.com/appx/manifest/foundation/windows10"',
    )
    .replaceAll("<Resources>", "<f:Resources>")
    .replaceAll("</Resources>", "</f:Resources>");
  assert.throws(
    () => replaceManifestLanguages(prefixed, ["en-US"]),
    /one unprefixed Resources element/,
  );
});

test("requires explicit reviewed HEAD and Sandbox staging root", () => {
  const reviewedSha = "a".repeat(40);
  assert.deepEqual(
    parseArgs([
      `--reviewed-sha=${reviewedSha}`,
      "--staging-root",
      "reports/handoff/windows-store/msix-sandbox/candidate",
    ]),
    {
      help: false,
      reviewedSha,
      stagingRoot: resolve(
        "reports/handoff/windows-store/msix-sandbox/candidate",
      ),
    },
  );
  assert.throws(() => parseArgs([]), /--reviewed-sha is required/);
  assert.throws(
    () => parseArgs([`--reviewed-sha=${reviewedSha}`]),
    /--staging-root is required/,
  );
  assert.throws(() => parseArgs(["--unexpected=value"]), /Unknown argument/);
});
