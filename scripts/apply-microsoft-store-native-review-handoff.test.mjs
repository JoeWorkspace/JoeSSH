import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { csvCell, parseCsv } from "./microsoft-store-csv.mjs";
import { sameExistingFile } from "./microsoft-store-file-safety.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = join(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);
const trackedHandoffPath = join(
  repositoryRoot,
  "docs/assets/microsoft-store/native-review-handoff.csv",
);
const REVIEWED_AT = "2026-08-05T00:00:00.000Z";

test("applies an explicit TEST FIXTURE handoff to a separate JSON output", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "joessh-native-intake-"));
  const handoffPath = join(directory, "fixture.csv");
  const outputPath = join(directory, "reviewed-manifest.json");
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  writeRows(handoffPath, createFixtureRows());
  runIntake(handoffPath, outputPath);

  const base = readManifest(manifestPath);
  const output = readManifest(outputPath);
  assert.equal(output.locales.length, 80);
  assert.equal(output.submissionStatus, "draft-not-submitted");
  assert.equal(output.productSourceCommit, base.productSourceCommit);
  assert.deepEqual(output.storeLocaleCatalog, base.storeLocaleCatalog);
  assert.deepEqual(stripReviewFields(output), stripReviewFields(base));
  for (const entry of output.locales) {
    assert.equal(entry.reviewStatus, "native-reviewed");
    assert.match(entry.nativeReview.reviewer, /^TEST FIXTURE/u);
    assert.equal(entry.nativeReview.reviewedAt, REVIEWED_AT);
    assert.match(entry.nativeReview.provenance, /^TEST FIXTURE/u);
    assert.equal(entry.listing.assets.screenshotUrls.length, 1);
    assert.match(
      entry.listing.assets.screenshotUrls[0],
      /^https:\/\/example\.test\/TEST-FIXTURE\//u,
    );
    assert.equal(entry.listing.assets.screenshotBinding.status, "reviewed");
    assert.match(
      entry.listing.assets.screenshotBinding.reviewer,
      /^TEST FIXTURE/u,
    );
    assert.equal(
      entry.listing.assets.screenshotBinding.reviewedAt,
      REVIEWED_AT,
    );
    assert.match(
      entry.listing.assets.screenshotBinding.provenance,
      /^TEST FIXTURE/u,
    );
  }
});

test("the tracked empty-evidence handoff fails closed", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "joessh-native-intake-empty-"));
  const outputPath = join(directory, "should-not-exist.json");
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  assert.throws(
    () => runIntake(trackedHandoffPath, outputPath),
    /ReviewStatus is not native-reviewed\/native-approved/u,
  );
  assert.equal(existsSync(outputPath), false);
});

test("the structured CSV parser handles commas, CRLF, and escaped quotes", () => {
  assert.deepEqual(parseCsv('"a,b","say ""hello"""\r\n'), [
    ["a,b", 'say "hello"'],
  ]);
  assert.throws(() => parseCsv('"unterminated\r\n'), /unterminated/u);
});

test("intake rejects content hash tampering", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ContentSha256] = "0".repeat(64);
    },
    /ContentSha256 does not match/u,
  );
});

test("intake rejects stale-hash short description tampering", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ShortDescription] += " tampered";
    },
    /ShortDescription does not match/u,
  );
});

test("intake rejects stale-hash mapping note tampering", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.MappingNote] = "tampered mapping";
    },
    /MappingNote does not match/u,
  );
});

test("intake rejects rows in a different manifest order", (t) => {
  expectRejected(
    t,
    (rows) => {
      const first = rows[1];
      rows[1] = rows[2];
      rows[2] = first;
    },
    /locale order does not match/u,
  );
});

test("intake rejects a missing row", (t) => {
  expectRejected(
    t,
    (rows) => {
      rows.pop();
    },
    /exactly 80 data rows/u,
  );
});

test("intake rejects duplicate, unknown, and mismatched locales", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[2][index.Locale] = rows[1][index.Locale];
    },
    /repeats locale/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.Locale] = "xx-XX";
      rows[1][index.StoreLocale] = "xx-XX";
    },
    /unknown locale/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.StoreLocale] = "en-US";
    },
    /StoreLocale does not match/u,
  );
});

test("intake rejects invalid review status, reviewer, and timestamp", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ReviewStatus] = "translation-draft";
    },
    /ReviewStatus/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.Reviewer] = "";
    },
    /Reviewer must be a non-empty string/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ReviewedAt] = "2026-08-05T00:00:00Z";
    },
    /ReviewedAt must be canonical/u,
  );
});

test("intake rejects malformed or non-HTTPS screenshot evidence", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ScreenshotEvidence] = "{not-json";
    },
    /not valid JSON/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ScreenshotEvidence] = JSON.stringify({
        urls: ["http://example.test/TEST-FIXTURE/a.png"],
        reviewer: "TEST FIXTURE screenshot reviewer",
        reviewedAt: REVIEWED_AT,
        provenance: "TEST FIXTURE screenshot provenance",
      });
    },
    /valid HTTPS URL/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ScreenshotEvidence] = JSON.stringify({
        urls: ["https://example.test/TEST-FIXTURE/a.png"],
        reviewer: "TEST FIXTURE screenshot reviewer",
        reviewedAt: REVIEWED_AT,
      });
    },
    /must contain exactly/u,
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.ScreenshotEvidence] = JSON.stringify({
        urls: ["https://example.test/TEST-FIXTURE/a.png"],
        reviewer: "TEST FIXTURE screenshot\r\nreviewer",
        reviewedAt: REVIEWED_AT,
        provenance: "TEST FIXTURE screenshot provenance",
      });
    },
    /control character/u,
  );
});

test("intake rejects formula, control, BOM, header, and column ambiguity", (t) => {
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.Reviewer] = '=HYPERLINK("https://example.test")';
    },
    /formula-injection/u,
    { unsafeCsv: true },
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.Reviewer] = "TEST FIXTURE\u0000reviewer";
    },
    /control character/u,
    { unsafeCsv: true },
  );
  expectRejected(
    t,
    (rows, index) => {
      rows[1][index.Provenance] = "TEST FIXTURE\r\nprovenance";
    },
    /control character/u,
    { unsafeCsv: true },
  );
  expectRejected(
    t,
    (rows) => {
      rows[0][0] = "Duplicate";
      rows[0][1] = "Duplicate";
    },
    /duplicate columns/u,
  );
  expectRejected(
    t,
    (rows) => {
      rows[0][0] = "Unknown";
    },
    /header drifted/u,
  );
  expectRejected(
    t,
    (rows) => {
      rows[1].push("extra");
    },
    /columns; expected/u,
  );
  expectRejected(t, null, /BOM/u, { prefix: "\ufeff" });
});

test("intake refuses to overwrite the tracked manifest", (t) => {
  const directory = mkdtempSync(
    join(tmpdir(), "joessh-native-intake-overwrite-"),
  );
  const handoffPath = join(directory, "fixture.csv");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeRows(handoffPath, createFixtureRows());
  const before = readFileSync(manifestPath);

  assert.throws(
    () => runIntake(handoffPath, manifestPath),
    /refusing to overwrite tracked localization-manifest/u,
  );
  assert.throws(
    () => runIntake(handoffPath, manifestPath.toUpperCase()),
    /refusing to overwrite tracked localization-manifest/u,
  );
  assert.deepEqual(readFileSync(manifestPath), before);
});

test("intake refuses existing output and handoff/output identity", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "joessh-native-intake-output-"));
  const handoffPath = join(directory, "fixture.csv");
  const outputPath = join(directory, "reviewed-manifest.json");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeRows(handoffPath, createFixtureRows());
  writeFileSync(outputPath, "protected output", "utf8");

  assert.throws(
    () => runIntake(handoffPath, outputPath),
    /EEXIST|already exists/u,
  );
  assert.equal(readFileSync(outputPath, "utf8"), "protected output");
  assert.throws(
    () => runIntake(handoffPath, handoffPath),
    /handoff and output must be different files/u,
  );
});

test("sameExistingFile detects a temporary hardlink without touching tracked files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "joessh-file-identity-"));
  const protectedPath = join(directory, "protected.txt");
  const hardlinkPath = join(directory, "hardlink.txt");
  const otherPath = join(directory, "other.txt");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  writeFileSync(protectedPath, "TEST FIXTURE protected", "utf8");
  writeFileSync(otherPath, "TEST FIXTURE other", "utf8");
  linkSync(protectedPath, hardlinkPath);

  assert.equal(sameExistingFile(protectedPath, hardlinkPath), true);
  assert.equal(sameExistingFile(protectedPath, otherPath), false);
});

function expectRejected(t, mutate, pattern, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "joessh-native-intake-reject-"));
  const handoffPath = join(directory, "fixture.csv");
  const outputPath = join(directory, "should-not-exist.json");
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  const rows = createFixtureRows();
  if (mutate) mutate(rows, headerIndex(rows[0]));
  const text = `${options.prefix ?? ""}${serializeRows(rows, options.unsafeCsv === true)}\r\n`;
  writeFileSync(handoffPath, text, "utf8");

  assert.throws(() => runIntake(handoffPath, outputPath), pattern);
  assert.equal(existsSync(outputPath), false);
}

function runIntake(handoffPath, outputPath) {
  return execFileSync(
    process.execPath,
    [
      "scripts/apply-microsoft-store-native-review-handoff.mjs",
      `--handoff=${handoffPath}`,
      `--output=${outputPath}`,
    ],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
}

function writeRows(path, rows) {
  writeFileSync(path, `${serializeRows(rows)}\r\n`, "utf8");
}

function createFixtureRows() {
  const rows = parseCsv(readFileSync(trackedHandoffPath, "utf8"));
  const index = headerIndex(rows[0]);
  for (const row of rows.slice(1)) {
    const locale = row[index.Locale];
    row[index.ReviewStatus] = "native-reviewed";
    row[index.Reviewer] = "TEST FIXTURE native reviewer";
    row[index.ReviewedAt] = REVIEWED_AT;
    row[index.Provenance] = "TEST FIXTURE native provenance";
    row[index.ScreenshotEvidence] = JSON.stringify({
      urls: [`https://example.test/TEST-FIXTURE/${locale}.png`],
      reviewer: "TEST FIXTURE screenshot reviewer",
      reviewedAt: REVIEWED_AT,
      provenance: "TEST FIXTURE screenshot provenance",
    });
  }
  return rows;
}

function headerIndex(header) {
  return Object.fromEntries(header.map((name, index) => [name, index]));
}

function serializeRows(rows, unsafeCsv = false) {
  return rows
    .map((row) =>
      row
        .map((value) =>
          unsafeCsv
            ? `"${String(value).replace(/"/gu, '""')}"`
            : csvCell(value),
        )
        .join(","),
    )
    .join("\r\n");
}

function readManifest(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function stripReviewFields(manifest) {
  const output = JSON.parse(JSON.stringify(manifest));
  for (const entry of output.locales) {
    delete entry.reviewStatus;
    delete entry.nativeReview;
    delete entry.listing.assets;
  }
  return output;
}
