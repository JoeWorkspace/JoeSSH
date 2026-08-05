import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { csvCell } from "./microsoft-store-csv.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const trackedHandoff = join(
  repositoryRoot,
  "docs/assets/microsoft-store/native-review-handoff.csv",
);

test("the native-review handoff is generated from the manifest without evidence", (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "joessh-native-review-handoff-"),
  );
  const output = join(directory, "handoff.csv");
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  execFileSync(
    process.execPath,
    [
      "scripts/generate-microsoft-store-native-review-handoff.mjs",
      `--output=${output}`,
    ],
    { cwd: repositoryRoot, stdio: "pipe" },
  );

  assert.equal(
    readFileSync(output, "utf8"),
    readFileSync(trackedHandoff, "utf8"),
  );
  const rows = parseCsv(readFileSync(output, "utf8"));
  assert.equal(rows.length, 81);
  const header = rows[0];
  for (const required of [
    "Locale",
    "StoreLocale",
    "ContentSha256",
    "ReviewStatus",
    "Reviewer",
    "ReviewedAt",
    "Provenance",
    "ScreenshotEvidence",
  ]) {
    assert.ok(header.includes(required), `missing ${required}`);
  }

  const index = Object.fromEntries(
    header.map((name, position) => [name, position]),
  );
  const manifest = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "docs/assets/microsoft-store/localization-manifest.json",
      ),
      "utf8",
    ),
  );
  assert.equal(manifest.locales.length, 80);
  for (const row of rows.slice(1)) {
    assert.equal(row.length, header.length);
    assert.match(row[index.ContentSha256], /^[0-9a-f]{64}$/u);
    assert.equal(row[index.ReviewStatus], "translation-draft");
    assert.deepEqual(
      [
        row[index.Reviewer],
        row[index.ReviewedAt],
        row[index.Provenance],
        row[index.ScreenshotEvidence],
      ],
      ["", "", "", ""],
    );
    const entry = manifest.locales.find(
      (candidate) => candidate.locale === row[index.Locale],
    );
    assert.ok(entry);
    assert.equal(row[index.StoreLocale], entry.storeLocale);
    assert.equal(row[index.ContentSha256], contentSha256(entry));
  }
});

test("CSV serialization rejects formula-injection prefixes", () => {
  for (const value of [
    "=SUM(A1:A2)",
    "+cmd",
    "-1",
    "@mention",
    "\tunsafe",
    " =SUM(A1:A2)",
    "\t+cmd",
    " \t-1",
    "  @mention",
  ]) {
    assert.throws(() => csvCell(value), /formula-injection/u);
  }
  assert.equal(csvCell("JoeSSH"), '"JoeSSH"');
  assert.equal(csvCell(" normal text"), '" normal text"');
  assert.equal(csvCell("SSH +cmd"), '"SSH +cmd"');
});

test("the handoff rejects alternate manifests instead of bypassing validation", (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "joessh-native-review-handoff-manifest-"),
  );
  const alternateManifest = join(directory, "malformed-manifest.json");
  const output = join(directory, "handoff.csv");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(alternateManifest, "{malformed", "utf8");

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "scripts/generate-microsoft-store-native-review-handoff.mjs",
          `--manifest=${alternateManifest}`,
          `--output=${output}`,
        ],
        { cwd: repositoryRoot, stdio: "pipe" },
      ),
    /--manifest is not supported/u,
  );
  assert.equal(existsSync(output), false);
});

function contentSha256(entry) {
  const listing = entry.listing;
  const record = {
    locale: entry.locale,
    storeLocale: entry.storeLocale,
    sourceName: entry.sourceName,
    languageName: entry.languageName,
    nativeName: entry.nativeName,
    appUiSupported: entry.appUiSupported,
    appUiLocale: entry.appUiLocale,
    reviewRequired: entry.reviewRequired,
    mappingNote: entry.mappingNote,
    title: listing.title,
    shortDescription: listing.shortDescription,
    fullDescription: listing.fullDescription,
    features: listing.features,
    keywords: listing.keywords,
  };
  return createHash("sha256")
    .update(JSON.stringify(record), "utf8")
    .digest("hex");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\r" && text[index + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      index += 1;
    } else if (character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
