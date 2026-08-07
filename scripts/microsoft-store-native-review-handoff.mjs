import { createHash } from "node:crypto";

export const HANDOFF_HEADERS = [
  "Locale",
  "StoreLocale",
  "SourceName",
  "LanguageName",
  "NativeName",
  "AppUiSupported",
  "AppUiLocale",
  "ReviewRequired",
  "MappingNote",
  "Title",
  "ShortDescription",
  "FullDescription",
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
  "ContentSha256",
  "ReviewStatus",
  "Reviewer",
  "ReviewedAt",
  "Provenance",
  "ScreenshotEvidence",
];

export function handoffBaselineCells(entry) {
  const listing = entry.listing;
  const keywords = [
    ...listing.keywords,
    ...Array.from({ length: 7 - listing.keywords.length }, () => ""),
  ];
  return [
    entry.locale,
    entry.storeLocale,
    entry.sourceName,
    entry.languageName,
    entry.nativeName,
    String(entry.appUiSupported),
    entry.appUiLocale ?? "",
    String(entry.reviewRequired),
    entry.mappingNote ?? "",
    listing.title,
    listing.shortDescription,
    listing.fullDescription,
    ...listing.features,
    ...keywords,
    contentSha256(entry),
  ];
}

export function contentRecord(entry) {
  const listing = entry.listing;
  return {
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
}

export function contentSha256(entry) {
  return createHash("sha256")
    .update(JSON.stringify(contentRecord(entry), null, 0), "utf8")
    .digest("hex");
}
