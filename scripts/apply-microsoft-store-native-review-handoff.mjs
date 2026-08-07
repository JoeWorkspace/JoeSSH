import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  checkMicrosoftStoreLocalizationManifest,
  isHttpsUrl,
  isValidReviewTimestamp,
  readManifest,
} from "./check-microsoft-store-localization.mjs";
import {
  hasDisallowedCsvControl,
  isUnsafeCsvCell,
  parseCsv,
} from "./microsoft-store-csv.mjs";
import {
  handoffBaselineCells,
  HANDOFF_HEADERS,
} from "./microsoft-store-native-review-handoff.mjs";
import { sameExistingFile } from "./microsoft-store-file-safety.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);

function readRequiredOption(name) {
  const matches = process.argv
    .slice(2)
    .filter((value) => value.startsWith(`${name}=`));
  if (matches.length !== 1 || matches[0].slice(name.length + 1).length === 0) {
    throw new Error(`${name}=<path> is required exactly once`);
  }
  return resolve(matches[0].slice(name.length + 1));
}

function readStrictUtf8(path) {
  const bytes = readFileSync(path);
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    bytes,
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertDraftManifest(manifest, label) {
  const failures = checkMicrosoftStoreLocalizationManifest(
    manifest,
    repositoryRoot,
  ).filter((result) => !result.passed);
  if (failures.length > 0) {
    throw new Error(
      `${label} failed: ${failures.map((result) => result.label).join(", ")}`,
    );
  }
}

function assertCellText(value, label) {
  if (hasDisallowedCsvControl(value)) {
    throw new Error(`${label} contains a disallowed control character`);
  }
  if (isUnsafeCsvCell(value)) {
    throw new Error(`${label} starts with a formula-injection prefix`);
  }
  if (value.normalize("NFC") !== value) {
    throw new Error(`${label} is not NFC-normalized`);
  }
}

function assertEvidenceString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  assertCellText(value, label);
}

function validateScreenshotEvidence(value, locale) {
  let evidence;
  try {
    evidence = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${locale} ScreenshotEvidence is not valid JSON: ${error.message}`,
      { cause: error },
    );
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error(`${locale} ScreenshotEvidence must be a JSON object`);
  }
  const requiredKeys = ["urls", "reviewer", "reviewedAt", "provenance"];
  const keys = Object.keys(evidence);
  if (
    keys.length !== requiredKeys.length ||
    requiredKeys.some((key) => !keys.includes(key))
  ) {
    throw new Error(
      `${locale} ScreenshotEvidence must contain exactly urls, reviewer, reviewedAt, provenance`,
    );
  }
  if (
    !Array.isArray(evidence.urls) ||
    evidence.urls.length === 0 ||
    new Set(evidence.urls).size !== evidence.urls.length
  ) {
    throw new Error(
      `${locale} ScreenshotEvidence.urls must contain unique URLs`,
    );
  }
  for (const [index, url] of evidence.urls.entries()) {
    assertEvidenceString(url, `${locale} ScreenshotEvidence.urls[${index}]`);
    if (!isHttpsUrl(url)) {
      throw new Error(
        `${locale} ScreenshotEvidence.urls[${index}] must be a valid HTTPS URL`,
      );
    }
  }
  assertEvidenceString(
    evidence.reviewer,
    `${locale} ScreenshotEvidence.reviewer`,
  );
  assertEvidenceString(
    evidence.provenance,
    `${locale} ScreenshotEvidence.provenance`,
  );
  if (!isValidReviewTimestamp(evidence.reviewedAt)) {
    throw new Error(
      `${locale} ScreenshotEvidence.reviewedAt must be canonical ISO-8601`,
    );
  }
  return evidence;
}

function headerIndex(header) {
  if (new Set(header).size !== header.length) {
    throw new Error("handoff CSV header contains duplicate columns");
  }
  const unknown = header.filter((column) => !HANDOFF_HEADERS.includes(column));
  const missing = HANDOFF_HEADERS.filter((column) => !header.includes(column));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(
      `handoff CSV header drifted: unknown=${unknown.join(",")}; missing=${missing.join(",")}`,
    );
  }
  if (JSON.stringify(header) !== JSON.stringify(HANDOFF_HEADERS)) {
    throw new Error("handoff CSV header order drifted");
  }
  return Object.fromEntries(header.map((column, index) => [column, index]));
}

function parseHandoff(text, baseManifest) {
  const rows = parseCsv(text);
  if (rows.length !== 81) {
    throw new Error(
      `handoff CSV must contain exactly 80 data rows; got ${Math.max(rows.length - 1, 0)}`,
    );
  }
  const index = headerIndex(rows[0]);
  const baseByLocale = new Map(
    baseManifest.locales.map((entry) => [entry.locale, entry]),
  );
  const seenLocales = new Set();
  const updates = new Map();

  for (const [rowNumber, row] of rows.slice(1).entries()) {
    const displayRow = rowNumber + 2;
    if (row.length !== HANDOFF_HEADERS.length) {
      throw new Error(
        `handoff CSV row ${displayRow} has ${row.length} columns; expected ${HANDOFF_HEADERS.length}`,
      );
    }
    for (const [column, columnIndex] of Object.entries(index)) {
      assertCellText(
        row[columnIndex],
        `handoff CSV row ${displayRow} ${column}`,
      );
    }

    const locale = row[index.Locale];
    const baseEntry = baseByLocale.get(locale);
    if (!baseEntry) {
      throw new Error(
        `handoff CSV row ${displayRow} has unknown locale ${locale}`,
      );
    }
    if (seenLocales.has(locale)) {
      throw new Error(`handoff CSV repeats locale ${locale}`);
    }
    seenLocales.add(locale);
    const expectedEntry = baseManifest.locales[rowNumber];
    if (locale !== expectedEntry.locale) {
      throw new Error(
        `handoff CSV row ${displayRow} locale order does not match the manifest: expected ${expectedEntry.locale}, got ${locale}`,
      );
    }
    const expectedBaseline = handoffBaselineCells(baseEntry);
    for (const [baselineIndex, expectedValue] of expectedBaseline.entries()) {
      const actualValue = row[baselineIndex];
      if (actualValue !== expectedValue) {
        throw new Error(
          `handoff CSV ${locale} ${HANDOFF_HEADERS[baselineIndex]} does not match the manifest`,
        );
      }
    }
    if (
      !new Set(["native-reviewed", "native-approved"]).has(
        row[index.ReviewStatus],
      )
    ) {
      throw new Error(
        `handoff CSV ${locale} ReviewStatus is not native-reviewed/native-approved`,
      );
    }
    assertEvidenceString(row[index.Reviewer], `${locale} Reviewer`);
    if (!isValidReviewTimestamp(row[index.ReviewedAt])) {
      throw new Error(`${locale} ReviewedAt must be canonical ISO-8601`);
    }
    assertEvidenceString(row[index.Provenance], `${locale} Provenance`);
    const screenshotEvidence = validateScreenshotEvidence(
      row[index.ScreenshotEvidence],
      locale,
    );
    updates.set(locale, {
      reviewStatus: row[index.ReviewStatus],
      nativeReview: {
        reviewer: row[index.Reviewer],
        reviewedAt: row[index.ReviewedAt],
        provenance: row[index.Provenance],
      },
      assets: {
        screenshotUrls: screenshotEvidence.urls,
        screenshotBinding: {
          status: "reviewed",
          reviewer: screenshotEvidence.reviewer,
          reviewedAt: screenshotEvidence.reviewedAt,
          provenance: screenshotEvidence.provenance,
        },
      },
    });
  }

  if (seenLocales.size !== baseManifest.locales.length) {
    throw new Error("handoff CSV does not cover every manifest locale");
  }
  return updates;
}

function stripReviewFields(manifest) {
  const stripped = cloneJson(manifest);
  for (const entry of stripped.locales ?? []) {
    delete entry.reviewStatus;
    delete entry.nativeReview;
    if (entry.listing) delete entry.listing.assets;
  }
  return stripped;
}

function applyUpdates(baseManifest, updates) {
  const outputManifest = cloneJson(baseManifest);
  for (const entry of outputManifest.locales) {
    const update = updates.get(entry.locale);
    if (!update) throw new Error(`missing intake update for ${entry.locale}`);
    entry.reviewStatus = update.reviewStatus;
    entry.nativeReview = update.nativeReview;
    entry.listing.assets = update.assets;
  }
  if (
    outputManifest.submissionStatus !== "draft-not-submitted" ||
    outputManifest.productSourceCommit !== baseManifest.productSourceCommit ||
    JSON.stringify(outputManifest.storeLocaleCatalog) !==
      JSON.stringify(baseManifest.storeLocaleCatalog) ||
    JSON.stringify(stripReviewFields(outputManifest)) !==
      JSON.stringify(stripReviewFields(baseManifest))
  ) {
    throw new Error(
      "intake changed fields outside review status, native review, or assets",
    );
  }
  return outputManifest;
}

const handoffPath = readRequiredOption("--handoff");
const outputPath = readRequiredOption("--output");
if (sameExistingFile(outputPath, manifestPath)) {
  throw new Error("refusing to overwrite tracked localization-manifest.json");
}
if (sameExistingFile(handoffPath, outputPath)) {
  throw new Error("handoff and output must be different files");
}

const baseManifest = readManifest(manifestPath);
assertDraftManifest(baseManifest, "tracked manifest validation");
const handoffText = readStrictUtf8(handoffPath);
const updates = parseHandoff(handoffText, baseManifest);
const outputManifest = applyUpdates(baseManifest, updates);
assertDraftManifest(outputManifest, "intake output validation");

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(outputManifest, null, 2)}\n`, {
  encoding: "utf8",
  flag: "wx",
});
const writtenManifest = readManifest(outputPath);
assertDraftManifest(writtenManifest, "written intake output validation");
console.log(
  `Wrote reviewed evidence for ${updates.size} locales to ${outputPath}`,
);
