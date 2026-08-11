import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

const root = resolve(import.meta.dirname, "..");
const defaultMappingPath = resolve(
  root,
  "packages/i18n/src/windows-store-manifest-languages.json",
);

export function readWindowsStoreManifestLanguageContract(
  path = defaultMappingPath,
) {
  const bytes = readFileSync(path);
  let mapping;
  try {
    mapping = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error(
      "Windows Store manifest language mapping must be valid UTF-8 JSON.",
    );
  }
  if (
    mapping === null ||
    typeof mapping !== "object" ||
    Array.isArray(mapping) ||
    Object.getPrototypeOf(mapping) !== Object.prototype
  ) {
    throw new Error(
      "Windows Store manifest language mapping must be an object.",
    );
  }
  const entries = Object.entries(mapping);
  if (entries.length === 0 || entries.length > 200 || !mapping.en) {
    throw new Error(
      "Windows Store manifest language mapping must include the English default and no more than 200 locales.",
    );
  }
  const canonicalEntries = entries.map(([uiLocale, manifestLanguage]) => {
    if (
      !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(uiLocale) ||
      typeof manifestLanguage !== "string" ||
      manifestLanguage.trim() !== manifestLanguage
    ) {
      throw new Error(
        "Windows Store manifest language mapping contains an unsafe locale entry.",
      );
    }
    let canonical;
    try {
      canonical = Intl.getCanonicalLocales(manifestLanguage);
    } catch {
      throw new Error(
        "Windows Store manifest language mapping contains an invalid BCP-47 tag.",
      );
    }
    if (canonical.length !== 1 || canonical[0] !== manifestLanguage) {
      throw new Error(
        "Windows Store manifest language tags must already be canonical BCP-47 values.",
      );
    }
    return [uiLocale, manifestLanguage];
  });
  const languages = [
    mapping.en,
    ...canonicalEntries
      .filter(([uiLocale]) => uiLocale !== "en")
      .map(([, manifestLanguage]) => manifestLanguage),
  ];
  if (
    new Set(languages.map((language) => language.toLowerCase())).size !==
    languages.length
  ) {
    throw new Error(
      "Windows Store manifest language mapping must not contain duplicate BCP-47 tags.",
    );
  }
  return {
    defaultUiLocale: "en",
    fileName: "windows-store-manifest-languages.json",
    manifestLanguages: languages,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
