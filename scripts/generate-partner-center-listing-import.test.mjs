import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  buildPartnerCenterListingImport,
  runPartnerCenterListingImport,
} from "./generate-partner-center-listing-import.mjs";
import { csvCell, parseCsv } from "./microsoft-store-csv.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const trackedManifestPath = join(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);
const targetStoreLocales = JSON.parse(
  readFileSync(trackedManifestPath, "utf8"),
).locales.map((entry) => entry.storeLocale.toLowerCase());

test("the Partner Center import contains all 80 reviewed locale columns", () => {
  const manifest = makeReadyManifest();
  const output = buildPartnerCenterListingImport({
    manifest,
    templateCsv: buildTemplateCsv(),
  });
  const rows = parseCsv(output, {
    allowBom: true,
    allowCellLineBreaks: true,
  });
  const headers = rows[0];

  assert.equal(headers.length, 84);
  assert.equal(headers.includes("zh-hans-cn"), true);
  assert.equal(headers.includes("zh-hant-tw"), true);
  assert.equal(headers.includes("zh-cn"), false);
  assert.equal(headers.includes("zh-tw"), false);
  assert.equal(
    rows.filter((row) => row.every((value) => value === "")).length,
    2,
  );

  const descriptionRow = rows.find((row) => row[0] === "Description");
  const englishIndex = headers.indexOf("en-us");
  assert.equal(
    descriptionRow[englishIndex],
    manifest.locales.find((entry) => entry.locale === "en-US").listing
      .fullDescription,
  );
});

test("the Partner Center template accepts a BOM and quoted multiline cells", () => {
  const output = buildPartnerCenterListingImport({
    manifest: makeReadyManifest(),
    templateCsv: buildTemplateCsv({ includeMultilineNote: true }),
  });
  const rows = parseCsv(output, {
    allowBom: true,
    allowCellLineBreaks: true,
  });
  const noteRow = rows.find((row) => row[0] === "PublisherNote");
  const englishIndex = rows[0].indexOf("en-us");

  assert.equal(output.startsWith("\ufeff"), true);
  assert.equal(noteRow[englishIndex], "line one\r\nline two");
});

test("allowing multiline CSV cells still rejects embedded tabs", () => {
  assert.throws(
    () =>
      parseCsv('"Field","ID"\r\n"PublisherNote","line\tvalue"\r\n', {
        allowCellLineBreaks: true,
      }),
    /disallowed control/u,
  );
});

test("the Partner Center template rejects required field ID drift", () => {
  const templateCsv = buildTemplateCsv().replace(
    '"Feature20","719"',
    '"Feature20","999"',
  );
  assert.throws(
    () =>
      buildPartnerCenterListingImport({
        manifest: makeReadyManifest(),
        templateCsv,
      }),
    /Feature20 must use ID 719/u,
  );
});

test("the Partner Center template rejects official header drift", () => {
  const templateCsv = buildTemplateCsv().replace(
    '"Type (type)"',
    '"Type"',
  );
  assert.throws(
    () =>
      buildPartnerCenterListingImport({
        manifest: makeReadyManifest(),
        templateCsv,
      }),
    /template header is not recognized/u,
  );
});

test("the Partner Center template rejects a missing reviewed locale column", () => {
  assert.throws(
    () =>
      buildPartnerCenterListingImport({
        manifest: makeReadyManifest(),
        templateCsv: buildTemplateCsv({
          storeLocales: targetStoreLocales.slice(0, -1),
        }),
      }),
    /missing reviewed locale columns: cy-gb/u,
  );
});

test("the Partner Center builder rejects a manifest with locale order drift", () => {
  const manifest = makeReadyManifest();
  [manifest.locales[0], manifest.locales[1]] = [
    manifest.locales[1],
    manifest.locales[0],
  ];
  assert.throws(
    () =>
      buildPartnerCenterListingImport({
        manifest,
        templateCsv: buildTemplateCsv(),
      }),
    /exact ordered 80 Store locales/u,
  );
});

test("the Partner Center builder rejects a manifest with fewer than 80 locales", () => {
  const manifest = makeReadyManifest();
  manifest.locales = manifest.locales.slice(0, -1);
  assert.throws(
    () =>
      buildPartnerCenterListingImport({
        manifest,
        templateCsv: buildTemplateCsv({
          storeLocales: targetStoreLocales.slice(0, -1),
        }),
      }),
    /exact ordered 80 Store locales/u,
  );
});

test("the tracked draft manifest is refused for Partner Center import", (t) => {
  const directory = makeTemporaryDirectory(t);
  const outputPath = join(directory, "refused.csv");

  assert.throws(
    () =>
      runPartnerCenterListingImport({
        templatePath: writeTemplate(directory),
        manifestPath: trackedManifestPath,
        outputPath,
      }),
    /Partner Center import refused/u,
  );
  assert.equal(existsSync(outputPath), false);
});

test("a fully reviewed manifest uses repository evidence and an exclusive output", (t) => {
  const directory = makeTemporaryDirectory(t);
  const manifestPath = join(directory, "reviewed-manifest.json");
  const outputPath = join(directory, "nested", "listing-import.csv");
  const templatePath = writeTemplate(directory);
  const templateBytes = readFileSync(templatePath);
  writeFileSync(
    manifestPath,
    `${JSON.stringify(makeReadyManifest({ templateBytes }), null, 2)}\n`,
    "utf8",
  );

  const result = runPartnerCenterListingImport({
    templatePath,
    manifestPath,
    outputPath,
    root: join(directory, "untrusted-root"),
  });
  assert.equal(result.localeCount, 80);
  assert.equal(existsSync(outputPath), true);

  assert.throws(
    () =>
      runPartnerCenterListingImport({
        templatePath: join(directory, "template.csv"),
        manifestPath,
        outputPath,
      }),
    /EEXIST/u,
  );
});

test("a reviewed manifest rejects a template whose bytes do not match the export hash", (t) => {
  const directory = makeTemporaryDirectory(t);
  const templatePath = writeTemplate(directory);
  const manifestPath = join(directory, "reviewed-manifest.json");
  const outputPath = join(directory, "listing-import.csv");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      makeReadyManifest({ templateBytes: Buffer.from("different export") }),
      null,
      2,
    )}\n`,
    "utf8",
  );

  assert.throws(
    () =>
      runPartnerCenterListingImport({
        templatePath,
        manifestPath,
        outputPath,
      }),
    /template SHA-256 does not match export evidence/u,
  );
  assert.equal(existsSync(outputPath), false);
});

test("submission readiness fails closed for a malformed manifest", async () => {
  const { checkMicrosoftStoreSubmissionReadinessManifest } =
    await import("./check-microsoft-store-localization.mjs");
  const failures = checkMicrosoftStoreSubmissionReadinessManifest(
    {},
    repositoryRoot,
  ).filter((result) => !result.passed);

  assert.equal(failures.length > 0, true);
});

function makeReadyManifest({ templateBytes } = {}) {
  const manifest = JSON.parse(readFileSync(trackedManifestPath, "utf8"));
  const reviewedAt = "2026-08-05T15:32:55.110Z";
  for (const entry of manifest.locales) {
    entry.reviewStatus = "native-approved";
    entry.nativeReview = {
      reviewer: "TEST-FIXTURE-native-reviewer",
      reviewedAt,
      provenance: "TEST-FIXTURE-native-review-record",
    };
    entry.listing.assets = {
      screenshotUrls: [
        `https://developer.microsoft.com/test-fixture/${entry.storeLocale}.png`,
      ],
      screenshotBinding: {
        status: "reviewed",
        reviewer: "TEST-FIXTURE-screenshot-reviewer",
        reviewedAt,
        provenance: "TEST-FIXTURE-screenshot-record",
      },
    };
  }
  manifest.productSourceCommit = manifest.candidateArtifactSourceCommit;
  manifest.storeLocaleCatalog.status = "partner-center-export-confirmed";
  manifest.storeLocaleCatalog.confirmedAt = reviewedAt;
  manifest.storeLocaleCatalog.exportSha256 = templateBytes
    ? sha256(templateBytes)
    : "a".repeat(64);
  manifest.submissionStatus = "ready-for-human-submission";
  return manifest;
}

function buildTemplateCsv({
  includeMultilineNote = false,
  storeLocales = targetStoreLocales,
} = {}) {
  const existingValues = () => storeLocales.map(() => "existing");
  const rows = [
    ["Field", "ID", "Type (type)", "default", ...storeLocales],
    ["Description", "2", "text", "", ...existingValues()],
    ["", "", "", "", ...storeLocales.map(() => "")],
    ["Title", "4", "text", "", ...storeLocales.map(() => "JoeSSH")],
    ["ShortDescription", "8", "text", "", ...existingValues()],
    ["DesktopScreenshot1", "100", "url", "", ...existingValues()],
  ];
  for (let index = 1; index <= 20; index += 1) {
    rows.push([
      `Feature${index}`,
      String(699 + index),
      "text",
      "",
      ...existingValues(),
    ]);
  }
  for (let index = 1; index <= 7; index += 1) {
    rows.push([
      `SearchTerm${index}`,
      String(899 + index),
      "text",
      "",
      ...existingValues(),
    ]);
  }
  if (includeMultilineNote) {
    rows.push([
      "PublisherNote",
      "999",
      "text",
      "",
      ...storeLocales.map((locale) =>
        locale === "en-us" ? "line one\r\nline two" : "",
      ),
    ]);
  }
  rows.push(["", "", "", "", ...storeLocales.map(() => "")]);
  return `\ufeff${rows
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}\r\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeTemporaryDirectory(t) {
  const directory = mkdtempSync(join(tmpdir(), "joessh-partner-center-"));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return directory;
}

function writeTemplate(directory) {
  const templatePath = join(directory, "template.csv");
  if (!existsSync(templatePath)) {
    writeFileSync(templatePath, buildTemplateCsv(), "utf8");
  }
  return templatePath;
}
