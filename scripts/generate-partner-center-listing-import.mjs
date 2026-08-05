import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMicrosoftStoreSubmissionReadinessManifest } from "./check-microsoft-store-localization.mjs";
import { csvCell, parseCsv } from "./microsoft-store-csv.mjs";
import { sameExistingFile } from "./microsoft-store-file-safety.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const defaultManifestPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);

const FIXED_FIELDS = new Map([
  ["Description", "2"],
  ["Title", "4"],
  ["ShortDescription", "8"],
  ["DesktopScreenshot1", "100"],
  ["Feature1", "700"],
  ["SearchTerm1", "900"],
]);

export function runPartnerCenterListingImport({
  templatePath,
  outputPath,
  manifestPath = defaultManifestPath,
}) {
  if (!templatePath) throw new Error("--template is required");
  if (!outputPath) throw new Error("--output is required");

  const resolvedTemplatePath = resolve(templatePath);
  const resolvedManifestPath = resolve(manifestPath);
  const resolvedOutputPath = resolve(outputPath);
  if (
    sameExistingFile(resolvedOutputPath, resolvedTemplatePath) ||
    sameExistingFile(resolvedOutputPath, resolvedManifestPath)
  ) {
    throw new Error("Output must not overwrite or alias an input file");
  }

  const manifest = JSON.parse(readFileSync(resolvedManifestPath, "utf8"));
  const readinessFailures = checkMicrosoftStoreSubmissionReadinessManifest(
    manifest,
    repositoryRoot,
  ).filter((result) => !result.passed);
  if (readinessFailures.length > 0) {
    throw new Error(
      `Partner Center import refused: ${readinessFailures
        .map((result) => result.label)
        .join(", ")}`,
    );
  }

  const templateBytes = readFileSync(resolvedTemplatePath);
  const actualExportSha256 = createHash("sha256")
    .update(templateBytes)
    .digest("hex");
  if (actualExportSha256 !== manifest.storeLocaleCatalog.exportSha256) {
    throw new Error(
      `Partner Center import refused: template SHA-256 does not match export evidence (expected ${manifest.storeLocaleCatalog.exportSha256}, got ${actualExportSha256})`,
    );
  }

  const output = buildPartnerCenterListingImport({
    manifest,
    templateCsv: templateBytes.toString("utf8"),
  });
  mkdirSync(dirname(resolvedOutputPath), { recursive: true });
  writeFileSync(resolvedOutputPath, output, { encoding: "utf8", flag: "wx" });
  return {
    localeCount: manifest.locales.length,
    outputPath: resolvedOutputPath,
  };
}

export function buildPartnerCenterListingImport({ manifest, templateCsv }) {
  const template = parseCsv(templateCsv, {
    allowBom: true,
    allowCellLineBreaks: true,
  });
  validateTemplate(template);

  const templateHeaders = template[0];
  const existingLocaleColumns = new Map(
    templateHeaders
      .slice(4)
      .map((header, index) => [header.toLowerCase(), index + 4]),
  );
  const locales = manifest.locales;
  const targetHeaders = locales.map((entry) => entry.storeLocale.toLowerCase());
  if (
    targetHeaders.length === 0 ||
    new Set(targetHeaders).size !== targetHeaders.length
  ) {
    throw new Error("Reviewed manifest must contain unique Store locales");
  }
  const targetHeaderSet = new Set(targetHeaders);
  const unexpectedHeaders = [...existingLocaleColumns.keys()].filter(
    (header) => !targetHeaderSet.has(header),
  );
  if (unexpectedHeaders.length > 0) {
    throw new Error(
      `Template contains locales outside the reviewed manifest: ${unexpectedHeaders.join(",")}`,
    );
  }
  const missingHeaders = targetHeaders.filter(
    (header) => !existingLocaleColumns.has(header),
  );
  if (missingHeaders.length > 0) {
    throw new Error(
      `Template is missing reviewed locale columns: ${missingHeaders.join(",")}`,
    );
  }

  const outputRows = [templateHeaders.slice(0, 4).concat(targetHeaders)];
  for (const templateRow of template.slice(1)) {
    const field = templateRow[0];
    const outputRow = templateRow.slice(0, 4);
    for (const entry of locales) {
      const header = entry.storeLocale.toLowerCase();
      const existingIndex = existingLocaleColumns.get(header);
      const existingValue =
        existingIndex === undefined ? "" : templateRow[existingIndex];
      outputRow.push(valueForField(field, entry, existingValue));
    }
    outputRows.push(outputRow);
  }

  const outputCsv = `\ufeff${outputRows
    .map((row, rowIndex) =>
      row
        .map((value, columnIndex) =>
          csvCell(
            value,
            `Partner Center row ${rowIndex + 1} column ${columnIndex + 1}`,
          ),
        )
        .join(","),
    )
    .join("\r\n")}\r\n`;
  verifyOutput(outputCsv, manifest, template.length);
  return outputCsv;
}

function validateTemplate(rows) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error(
      "Partner Center template must contain a header and data rows",
    );
  }
  const width = rows[0].length;
  if (
    width < 4 ||
    rows[0][0] !== "Field" ||
    rows[0][1] !== "ID" ||
    rows[0][3] !== "default"
  ) {
    throw new Error("Partner Center template header is not recognized");
  }
  if (rows.some((row) => row.length !== width)) {
    throw new Error("Partner Center template rows have inconsistent widths");
  }
  const localeHeaders = rows[0].slice(4).map((value) => value.toLowerCase());
  if (new Set(localeHeaders).size !== localeHeaders.length) {
    throw new Error("Partner Center template has duplicate locale columns");
  }

  const fields = new Map();
  for (const row of rows.slice(1)) {
    if (row[0] === "") {
      if (row.some((value) => value !== "")) {
        throw new Error(
          "Partner Center template has data in a row without a field name",
        );
      }
      continue;
    }
    if (fields.has(row[0])) {
      throw new Error(`Partner Center template has duplicate field ${row[0]}`);
    }
    fields.set(row[0], row[1]);
  }
  for (const [field, id] of FIXED_FIELDS) {
    if (fields.get(field) !== id) {
      throw new Error(
        `Partner Center template field ${field} must use ID ${id}`,
      );
    }
  }
  for (const [field, id] of fields) {
    const screenshotMatch = /^DesktopScreenshot(\d+)$/u.exec(field);
    if (screenshotMatch && id !== String(99 + Number(screenshotMatch[1]))) {
      throw new Error(
        `Partner Center template field ${field} has an unexpected ID`,
      );
    }
  }
  for (let index = 1; index <= 20; index += 1) {
    const field = `Feature${index}`;
    const expectedId = String(699 + index);
    if (fields.get(field) !== expectedId) {
      throw new Error(
        `Partner Center template field ${field} must use ID ${expectedId}`,
      );
    }
  }
  for (let index = 1; index <= 7; index += 1) {
    const field = `SearchTerm${index}`;
    const expectedId = String(899 + index);
    if (fields.get(field) !== expectedId) {
      throw new Error(
        `Partner Center template field ${field} must use ID ${expectedId}`,
      );
    }
  }
}

function valueForField(field, entry, existingValue) {
  const listing = entry.listing;
  if (field === "Description") return listing.fullDescription;
  if (field === "Title") return listing.title;
  if (field === "ShortDescription") return listing.shortDescription;

  const featureMatch = /^Feature(\d+)$/u.exec(field);
  if (featureMatch) {
    return listing.features[Number(featureMatch[1]) - 1] ?? "";
  }
  const searchTermMatch = /^SearchTerm(\d+)$/u.exec(field);
  if (searchTermMatch) {
    return listing.keywords[Number(searchTermMatch[1]) - 1] ?? "";
  }
  const screenshotMatch = /^DesktopScreenshot(\d+)$/u.exec(field);
  if (screenshotMatch) {
    return listing.assets.screenshotUrls[Number(screenshotMatch[1]) - 1] ?? "";
  }
  return existingValue;
}

function verifyOutput(outputCsv, manifest, expectedRows) {
  const rows = parseCsv(outputCsv, {
    allowBom: true,
    allowCellLineBreaks: true,
  });
  const expectedWidth = 4 + manifest.locales.length;
  if (
    rows.length !== expectedRows ||
    rows.some((row) => row.length !== expectedWidth)
  ) {
    throw new Error("Generated Partner Center CSV failed shape verification");
  }
  const headers = rows[0];
  const rowsByField = new Map(
    rows
      .slice(1)
      .filter((row) => row[0] !== "")
      .map((row) => [row[0], row]),
  );
  for (const entry of manifest.locales) {
    const columnIndex = headers.indexOf(entry.storeLocale.toLowerCase());
    const expectedFields = [
      ["Title", entry.listing.title],
      ["Description", entry.listing.fullDescription],
      ["ShortDescription", entry.listing.shortDescription],
      ...Array.from({ length: 20 }, (_, index) => [
        `Feature${index + 1}`,
        entry.listing.features[index] ?? "",
      ]),
      ...Array.from({ length: 7 }, (_, index) => [
        `SearchTerm${index + 1}`,
        entry.listing.keywords[index] ?? "",
      ]),
      ...Array.from(
        { length: Math.max(1, entry.listing.assets.screenshotUrls.length) },
        (_, index) => [
          `DesktopScreenshot${index + 1}`,
          entry.listing.assets.screenshotUrls[index] ?? "",
        ],
      ),
    ];
    if (
      columnIndex < 4 ||
      expectedFields.some(
        ([field, expected]) =>
          rowsByField.get(field)?.[columnIndex] !== expected,
      )
    ) {
      throw new Error(
        `Generated Partner Center CSV failed ${entry.locale} verification`,
      );
    }
  }
}

function readCliOptions(args) {
  const options = {};
  for (const argument of args) {
    const match = /^--(template|manifest|output)=(.+)$/u.exec(argument);
    if (!match) throw new Error(`Unknown argument: ${argument}`);
    options[match[1]] = match[2];
  }
  return options;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  try {
    const options = readCliOptions(process.argv.slice(2));
    const result = runPartnerCenterListingImport({
      templatePath: options.template,
      manifestPath: options.manifest,
      outputPath: options.output,
    });
    console.log(
      `Wrote ${result.localeCount} reviewed Partner Center locale columns to ${result.outputPath}`,
    );
  } catch (error) {
    console.error(`Partner Center import error: ${error.message}`);
    process.exitCode = 1;
  }
}
