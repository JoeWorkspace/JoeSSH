import assert from "node:assert/strict";
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
  writeFileSync(
    manifestPath,
    `${JSON.stringify(makeReadyManifest(), null, 2)}\n`,
    "utf8",
  );

  const result = runPartnerCenterListingImport({
    templatePath: writeTemplate(directory),
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

test("submission readiness fails closed for a malformed manifest", async () => {
  const { checkMicrosoftStoreSubmissionReadinessManifest } =
    await import("./check-microsoft-store-localization.mjs");
  const failures = checkMicrosoftStoreSubmissionReadinessManifest(
    {},
    repositoryRoot,
  ).filter((result) => !result.passed);

  assert.equal(failures.length > 0, true);
});

function makeReadyManifest() {
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
  manifest.storeLocaleCatalog.exportSha256 = "a".repeat(64);
  manifest.submissionStatus = "ready-for-human-submission";
  return manifest;
}

function buildTemplateCsv({ includeMultilineNote = false } = {}) {
  const rows = [
    ["Field", "ID", "Type (type)", "default", "en-us", "zh-hans-cn"],
    ["Description", "2", "text", "", "existing", "existing"],
    ["", "", "", "", "", ""],
    ["Title", "4", "text", "", "JoeSSH", "JoeSSH"],
    ["ShortDescription", "8", "text", "", "existing", "existing"],
    ["DesktopScreenshot1", "100", "url", "", "existing", "existing"],
  ];
  for (let index = 1; index <= 20; index += 1) {
    rows.push([
      `Feature${index}`,
      String(699 + index),
      "text",
      "",
      "existing",
      "existing",
    ]);
  }
  for (let index = 1; index <= 7; index += 1) {
    rows.push([
      `SearchTerm${index}`,
      String(899 + index),
      "text",
      "",
      "existing",
      "existing",
    ]);
  }
  if (includeMultilineNote) {
    rows.push(["PublisherNote", "999", "text", "", "line one\r\nline two", ""]);
  }
  rows.push(["", "", "", "", "", ""]);
  return `\ufeff${rows
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}\r\n`;
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
