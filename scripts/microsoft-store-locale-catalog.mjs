// This catalog is the reviewed allowlist used by the generator and validators.
// The recorded Partner Center export confirms the exact Store codes.
export const STORE_LOCALE_CATALOG_SOURCE = {
  authority: "Microsoft BCP 47 and Windows locale identifiers",
  reference:
    "https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msi/add-and-edit-store-listing-info",
  status: "partner-center-export-confirmed",
  confirmedAt: "2026-08-06T02:31:09.000Z",
  exportSha256:
    "5fca727e00dd47c457ddab8ddcbda318c1464427ff3af02ca921a48981e375bf",
  exportEvidencePath:
    "docs/assets/microsoft-store/partner-center-export-1152921505701586331.csv",
  liveOptionsStatus: "all-target-options-observed",
  evidencePath:
    "docs/assets/microsoft-store/partner-center-language-options.json",
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
  "zh-Hans-CN",
  "zh-Hant-TW",
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
  "mk",
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
  "zh-Hans-CN": "zh-CN",
  "zh-Hant-TW": "zh-TW",
  // Partner Center exports Macedonian as the bare Store code `mk`.
  mk: "mk-MK",
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
