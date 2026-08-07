import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");

test("the draft CSV contains all listing fields and 80 rows", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "joessh-store-csv-"));
  const output = join(directory, "listing.csv");
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  execFileSync(
    process.execPath,
    ["scripts/generate-microsoft-store-listing-csv.mjs", `--output=${output}`],
    { cwd: repositoryRoot, stdio: "pipe" },
  );
  const lines = readFileSync(output, "utf8").trimEnd().split(/\r?\n/u);
  assert.equal(lines.length, 81);
  assert.match(
    lines[0],
    /"Locale","StoreLocale","Title","ShortDescription","Description"/u,
  );
  assert.match(lines[1], /"af-ZA","af-ZA","JoeSSH"/u);
  assert.equal(
    lines.some((line) => line.includes('"qu-PE","quz-PE","JoeSSH"')),
    true,
  );
  assert.match(lines[0], /"Keyword1".*"Keyword7"/u);
  assert.equal(
    readFileSync(output, "utf8"),
    readFileSync(
      join(
        repositoryRoot,
        "docs/assets/microsoft-store/localization-listing-draft.csv",
      ),
      "utf8",
    ),
  );
});

test("tracked Store CSV artifacts preserve generator bytes across checkout", () => {
  const attributes = readFileSync(
    join(repositoryRoot, ".gitattributes"),
    "utf8",
  );
  assert.match(attributes, /^docs\/assets\/microsoft-store\/\*\.csv binary$/mu);
});

test("the CSV generator refuses submission-only mode while reviews are pending", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "joessh-store-csv-ready-"));
  const output = join(directory, "listing.csv");
  t.after(() => rmSync(directory, { force: true, recursive: true }));

  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          "scripts/generate-microsoft-store-listing-csv.mjs",
          `--output=${output}`,
          "--require-ready",
        ],
        { cwd: repositoryRoot, stdio: "pipe" },
      ),
    /submission readiness failed/u,
  );
});
