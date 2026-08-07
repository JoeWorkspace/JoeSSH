import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  checkMicrosoftStoreLocalization,
  checkMicrosoftStoreSubmissionReadiness,
} from "./check-microsoft-store-localization.mjs";
import { csvCell } from "./microsoft-store-csv.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);
const defaultOutputPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-listing-draft.csv",
);

function readOption(name) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

function validate(results, label) {
  const failures = results.filter((result) => !result.passed);
  if (failures.length > 0) {
    throw new Error(
      `${label} failed: ${failures.map((result) => result.label).join(", ")}`,
    );
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
validate(checkMicrosoftStoreLocalization(repositoryRoot), "draft validation");
if (process.argv.includes("--require-ready")) {
  validate(
    checkMicrosoftStoreSubmissionReadiness(repositoryRoot),
    "submission readiness",
  );
}

const headers = [
  "Locale",
  "StoreLocale",
  "Title",
  "ShortDescription",
  "Description",
  "Feature1",
  "Feature2",
  "Feature3",
  "Feature4",
  "Feature5",
  "Keyword1",
  "Keyword2",
  "Keyword3",
  "Keyword4",
  "Keyword5",
  "Keyword6",
  "Keyword7",
];
const lines = [headers.map((value) => csvCell(value, "CSV header")).join(",")];
for (const entry of manifest.locales) {
  const listing = entry.listing;
  lines.push(
    [
      entry.locale,
      entry.storeLocale,
      listing.title,
      listing.shortDescription,
      listing.fullDescription,
      ...listing.features,
      ...listing.keywords,
      ...Array.from({ length: 7 - listing.keywords.length }, () => ""),
    ]
      .map((value, index) =>
        csvCell(value, `${entry.locale} column ${index + 1}`),
      )
      .join(","),
  );
}

const outputPath = resolve(readOption("--output") ?? defaultOutputPath);
writeFileSync(outputPath, `${lines.join("\r\n")}\r\n`, "utf8");
console.log(
  `Wrote ${manifest.locales.length} draft Store listing rows for ${manifest.localizationRevision} to ${outputPath}`,
);
