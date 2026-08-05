// This catalog is the reviewed draft allowlist used by the generator and
// validators. Partner Center export confirmation remains a submission gate.
export const STORE_LOCALE_CATALOG_SOURCE = {
  authority: "Microsoft BCP 47 and Windows locale identifiers",
  reference:
    "https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/add-and-edit-store-listing-info",
  status: "partner-center-export-confirmation-pending",
};

const STORE_LOCALE_CODES = [
  "af-ZA",
  "sq-AL",
  "am-ET",
  "ar-SA",
  "az-Latn-AZ",
  "eu-ES",
  "bg-BG",
  "ca-ES",
  "zh-CN",
  "zh-TW",
  "hr-HR",
  "cs-CZ",
  "da-DK",
  "nl-NL",
  "en-GB",
  "en-US",
  "et-EE",
  "fil-PH",
  "fi-FI",
  "fr-FR",
  "fr-CA",
  "gl-ES",
  "de-DE",
  "el-GR",
  "he-IL",
  "hi-IN",
  "hu-HU",
  "is-IS",
  "id-ID",
  "it-IT",
  "ja-JP",
  "kn-IN",
  "kk-KZ",
  "km-KH",
  "ko-KR",
  "lo-LA",
  "lv-LV",
  "lt-LT",
  "mk-MK",
  "ms-MY",
  "ml-IN",
  "nb-NO",
  "es-ES",
  "es-MX",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sk-SK",
  "sl-SI",
  "sr-Latn-RS",
  "sv-SE",
  "ta-IN",
  "te-IN",
  "th-TH",
  "tr-TR",
  "uk-UA",
  "vi-VN",
  "as-IN",
  "bn-IN",
  "ka-GE",
  "gu-IN",
  "ga-IE",
  "kok-IN",
  "lb-LU",
  "mt-MT",
  "mi-NZ",
  "mr-IN",
  "ne-NP",
  "or-IN",
  "pa-IN",
  "quz-PE",
  "gd-GB",
  "sr-Cyrl-BA",
  "tt-RU",
  "ur-PK",
  "ug-CN",
  "ca-ES-valencia",
  "cy-GB",
];

const CANONICAL_OVERRIDES = {
  // Windows/Microsoft uses quz-PE; the canonical BCP 47 language subtag is qu.
  "quz-PE": "qu-PE",
};

export const STORE_LOCALE_CATALOG = STORE_LOCALE_CODES.map((storeLocale) => ({
  locale: CANONICAL_OVERRIDES[storeLocale] ?? storeLocale,
  storeLocale,
}));

export const STORE_LOCALE_BY_CANONICAL = new Map(
  STORE_LOCALE_CATALOG.map((entry) => [entry.locale, entry]),
);

export const EXPECTED_CANONICAL_LOCALES = STORE_LOCALE_CATALOG.map(
  (entry) => entry.locale,
);

export const EXPECTED_STORE_LOCALES = STORE_LOCALE_CATALOG.map(
  (entry) => entry.storeLocale,
);
