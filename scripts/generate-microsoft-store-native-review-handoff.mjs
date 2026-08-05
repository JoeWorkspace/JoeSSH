import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { csvCell } from "./microsoft-store-csv.mjs";
import {
  handoffBaselineCells,
  HANDOFF_HEADERS,
} from "./microsoft-store-native-review-handoff.mjs";
import {
  checkMicrosoftStoreLocalization,
  readManifest,
} from "./check-microsoft-store-localization.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);
const defaultOutputPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/native-review-handoff.csv",
);

function readOption(name) {
  const prefix = `${name}=`;
  const argument = process.argv
    .slice(2)
    .find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : undefined;
}

if (
  process.argv
    .slice(2)
    .some((value) => value === "--manifest" || value.startsWith("--manifest="))
) {
  throw new Error(
    "--manifest is not supported; native-review handoff always uses the tracked manifest",
  );
}

function validateDraft(root) {
  const failures = checkMicrosoftStoreLocalization(root).filter(
    (result) => !result.passed,
  );
  if (failures.length > 0) {
    throw new Error(
      `draft validation failed: ${failures.map((result) => result.label).join(", ")}`,
    );
  }
}

const manifest = readManifest(manifestPath);
validateDraft(repositoryRoot);

const lines = [
  HANDOFF_HEADERS.map((value) => csvCell(value, "handoff header")).join(","),
];
for (const entry of manifest.locales) {
  const cells = [
    ...handoffBaselineCells(entry),
    entry.reviewStatus,
    "",
    "",
    "",
    "",
  ];
  lines.push(
    cells
      .map((value, index) =>
        csvCell(value, `${entry.locale} handoff column ${index + 1}`),
      )
      .join(","),
  );
}

const outputPath = resolve(readOption("--output") ?? defaultOutputPath);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${lines.join("\r\n")}\r\n`, "utf8");
console.log(
  `Wrote ${manifest.locales.length} native-review handoff rows for ${manifest.localizationRevision} to ${outputPath}`,
);
