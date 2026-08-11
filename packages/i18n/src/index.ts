import windowsStoreManifestLanguages from "./windows-store-manifest-languages.json";

export type AtlasLocale =
  | "zh-CN"
  | "zh-TW"
  | "en"
  | "ja"
  | "ko"
  | "es"
  | "fr"
  | "de"
  | "pt-BR"
  | "ru"
  | "ar"
  | "hi"
  | "id"
  | "vi"
  | "th";

export type LocaleMeta = {
  code: AtlasLocale;
  englishName: string;
  nativeName: string;
  regions: string[];
  direction: "ltr" | "rtl";
};

export const WINDOWS_STORE_MANIFEST_LANGUAGES = Object.freeze(
  windowsStoreManifestLanguages,
) satisfies Readonly<Record<AtlasLocale, string>>;

export const DEFAULT_LOCALE: AtlasLocale = "en";

export const SUPPORTED_LOCALES: LocaleMeta[] = [
  { code: "zh-CN", englishName: "Simplified Chinese", nativeName: "\u7b80\u4f53\u4e2d\u6587", regions: ["CN", "SG"], direction: "ltr" },
  { code: "zh-TW", englishName: "Traditional Chinese", nativeName: "\u7e41\u9ad4\u4e2d\u6587", regions: ["TW", "HK", "MO"], direction: "ltr" },
  { code: "en", englishName: "English", nativeName: "English", regions: ["US", "GB", "CA", "AU", "NZ", "IE"], direction: "ltr" },
  { code: "ja", englishName: "Japanese", nativeName: "\u65e5\u672c\u8a9e", regions: ["JP"], direction: "ltr" },
  { code: "ko", englishName: "Korean", nativeName: "\ud55c\uad6d\uc5b4", regions: ["KR"], direction: "ltr" },
  { code: "es", englishName: "Spanish", nativeName: "Espa\u00f1ol", regions: ["ES", "MX", "AR", "CO", "CL", "PE"], direction: "ltr" },
  { code: "fr", englishName: "French", nativeName: "Fran\u00e7ais", regions: ["FR", "BE"], direction: "ltr" },
  { code: "de", englishName: "German", nativeName: "Deutsch", regions: ["DE", "AT", "CH"], direction: "ltr" },
  { code: "pt-BR", englishName: "Portuguese", nativeName: "Portugu\u00eas", regions: ["BR", "PT"], direction: "ltr" },
  { code: "ru", englishName: "Russian", nativeName: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439", regions: ["RU"], direction: "ltr" },
  { code: "ar", englishName: "Arabic", nativeName: "\u0627\u0644\u0639\u0631\u0628\u064a\u0629", regions: ["SA", "AE", "EG"], direction: "rtl" },
  { code: "hi", englishName: "Hindi", nativeName: "\u0939\u093f\u0928\u094d\u0926\u0940", regions: ["IN"], direction: "ltr" },
  { code: "id", englishName: "Indonesian", nativeName: "Bahasa Indonesia", regions: ["ID"], direction: "ltr" },
  { code: "vi", englishName: "Vietnamese", nativeName: "Ti\u1ebfng Vi\u1ec7t", regions: ["VN"], direction: "ltr" },
  { code: "th", englishName: "Thai", nativeName: "\u0e44\u0e17\u0e22", regions: ["TH"], direction: "ltr" },
];

const defaultLocaleMeta = SUPPORTED_LOCALES.find(
  (candidate) => candidate.code === DEFAULT_LOCALE,
) as LocaleMeta;

// All locales are lazy-loaded to minimize main bundle size.
import type { zhCN } from "./locales/zh-CN";

export type TranslationKey = keyof typeof zhCN;
export type Translator = (key: TranslationKey, values?: Record<string, string | number>) => string;
export type TranslationMap = Partial<Record<TranslationKey, string>>;
export type LocaleCoverageReport = {
  isComplete: boolean;
  locale: AtlasLocale;
  missingKeys: TranslationKey[];
  percentage: number;
  totalKeys: number;
  translatedKeys: number;
};
export type TranslationReadinessReport = {
  completeLocales: AtlasLocale[];
  incompleteLocales: LocaleCoverageReport[];
  isComplete: boolean;
  locales: LocaleCoverageReport[];
  totalKeys: number;
};
export type LocaleFormatters = {
  dateTime: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
  fileSize: (bytes: number, options?: Intl.NumberFormatOptions) => string;
  latency: (milliseconds: number, options?: Intl.NumberFormatOptions) => string;
  number: (value: number, options?: Intl.NumberFormatOptions) => string;
  relativeTime: (value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => string;
  time: (value: Date | number | string, options?: Intl.DateTimeFormatOptions) => string;
};

// Dynamic locale loaders; each locale is a separate chunk for code splitting.
const localeLoaders: Record<AtlasLocale, () => Promise<TranslationMap>> = {
  "zh-CN": async () => (await import("./locales/zh-CN")).zhCN,
  "zh-TW": async () => (await import("./locales/zh-TW")).zhTWComplete,
  en: async () => (await import("./locales/en")).en,
  ja: async () => (await import("./locales/ja")).ja,
  ko: async () => (await import("./locales/ko")).ko,
  es: async () => (await import("./locales/es")).es,
  fr: async () => (await import("./locales/fr")).fr,
  de: async () => (await import("./locales/de")).de,
  "pt-BR": async () => (await import("./locales/pt-BR")).ptBR,
  ru: async () => (await import("./locales/ru")).ru,
  ar: async () => (await import("./locales/ar")).ar,
  hi: async () => (await import("./locales/hi")).hi,
  id: async () => (await import("./locales/id")).id,
  vi: async () => (await import("./locales/vi")).vi,
  th: async () => (await import("./locales/th")).th,
};

const localeCache = new Map<AtlasLocale, TranslationMap>();

function getSyncPack(locale: AtlasLocale): TranslationMap {
  return localeCache.get(locale) ?? {};
}

export async function loadLocale(locale: AtlasLocale): Promise<(key: TranslationKey, values?: Record<string, string | number>) => string> {
  if (!localeCache.has(locale)) {
    const loader = localeLoaders[locale];
    localeCache.set(locale, await loader());
  }

  return (key: TranslationKey, values?: Record<string, string | number>) => {
    const template = getSyncPack(locale)[key] ?? key;
    return formatMessage(template, values);
  };
}

export function getLoadedTranslator(locale: AtlasLocale): ((key: TranslationKey, values?: Record<string, string | number>) => string) | undefined {
  if (!localeCache.has(locale)) {
    return undefined;
  }

  return (key: TranslationKey, values?: Record<string, string | number>) => {
    const template = getSyncPack(locale)[key] ?? key;
    return formatMessage(template, values);
  };
}

const aliasLocaleMap: Record<string, AtlasLocale> = {
  "zh": "zh-CN",
  "zh-cn": "zh-CN",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-tw": "zh-TW",
  "zh-hant": "zh-TW",
  "zh-hk": "zh-TW",
  "zh-mo": "zh-TW",
  "en": "en",
  "ja": "ja",
  "ko": "ko",
  "es": "es",
  "fr": "fr",
  "de": "de",
  "pt": "pt-BR",
  "pt-br": "pt-BR",
  "ru": "ru",
  "ar": "ar",
  "hi": "hi",
  "id": "id",
  "vi": "vi",
  "th": "th"
};

const regionLocaleMap = SUPPORTED_LOCALES.reduce<Record<string, AtlasLocale>>((acc, locale) => {
  locale.regions.forEach((region) => {
    acc[region] = locale.code;
  });
  return acc;
}, {});

const intlLocaleMap: Readonly<Record<AtlasLocale, string>> = WINDOWS_STORE_MANIFEST_LANGUAGES;

const fileSizeUnits = [
  { factor: 1024 ** 4, fallback: "TB", unit: "terabyte" },
  { factor: 1024 ** 3, fallback: "GB", unit: "gigabyte" },
  { factor: 1024 ** 2, fallback: "MB", unit: "megabyte" },
  { factor: 1024, fallback: "kB", unit: "kilobyte" },
  { factor: 1, fallback: "B", unit: "byte" }
] as const;

export function resolveAtlasLocale(value: string | null | undefined): AtlasLocale | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().replace(/_/g, "-").toLowerCase();

  if (aliasLocaleMap[normalized]) {
    return aliasLocaleMap[normalized];
  }

  const parts = normalized.split("-");
  const language = parts[0];
  const region = parts.slice(1).find((part) => part.length === 2)?.toUpperCase();

  if (language === "zh" && parts.includes("hant")) {
    return "zh-TW";
  }

  if (region && regionLocaleMap[region]) {
    return regionLocaleMap[region];
  }

  return aliasLocaleMap[language];
}

export function detectAtlasLocale(candidates: readonly (string | null | undefined)[] = []): AtlasLocale {
  for (const candidate of candidates) {
    const resolved = resolveAtlasLocale(candidate);

    if (resolved) {
      return resolved;
    }
  }

  return DEFAULT_LOCALE;
}

export function getBrowserLocaleCandidates(): string[] {
  const candidates: string[] = [];

  if (typeof navigator !== "undefined") {
    candidates.push(...(navigator.languages ?? []));

    if (navigator.language) {
      candidates.push(navigator.language);
    }
  }

  try {
    const intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;

    if (intlLocale) {
      candidates.push(intlLocale);
    }
  } catch {
    // Intl can be unavailable in minimal runtimes; default English remains the fallback.
  }

  return candidates;
}

export function createTranslator(locale: AtlasLocale) {
  return (key: TranslationKey, values?: Record<string, string | number>) => translate(locale, key, values);
}

export function translate(locale: AtlasLocale, key: TranslationKey, values?: Record<string, string | number>) {
  const template = getSyncPack(locale)[key] ?? key;
  return formatMessage(template, values);
}

export function getLocaleMeta(locale: AtlasLocale) {
  return SUPPORTED_LOCALES.find((candidate) => candidate.code === locale) ?? defaultLocaleMeta;
}

export function getTextDirection(locale: AtlasLocale) {
  return getLocaleMeta(locale).direction;
}

export function getIntlLocale(locale: AtlasLocale) {
  return intlLocaleMap[locale];
}

export function createLocaleFormatters(locale: AtlasLocale): LocaleFormatters {
  return {
    dateTime: (value, options) => formatDateTime(locale, value, options),
    fileSize: (bytes, options) => formatFileSize(locale, bytes, options),
    latency: (milliseconds, options) => formatLatency(locale, milliseconds, options),
    number: (value, options) => formatNumber(locale, value, options),
    relativeTime: (value, unit, options) => formatRelativeTime(locale, value, unit, options),
    time: (value, options) => formatTime(locale, value, options)
  };
}

export function formatNumber(locale: AtlasLocale, value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat(getIntlLocale(locale), options).format(value);
}

export function formatDateTime(
  locale: AtlasLocale,
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), options).format(toDate(value));
}

export function formatTime(
  locale: AtlasLocale,
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
) {
  return new Intl.DateTimeFormat(getIntlLocale(locale), options).format(toDate(value));
}

export function formatFileSize(locale: AtlasLocale, bytes: number, options: Intl.NumberFormatOptions = {}) {
  const absoluteBytes = Math.abs(bytes);
  const sizeUnit = fileSizeUnits.find((candidate) => absoluteBytes >= candidate.factor) ?? fileSizeUnits[fileSizeUnits.length - 1];
  const value = sizeUnit.factor === 1 ? bytes : bytes / sizeUnit.factor;
  const maximumFractionDigits = sizeUnit.factor === 1 || Math.abs(value) >= 10 ? 0 : 1;

  return formatUnit(locale, value, sizeUnit.unit, sizeUnit.fallback, {
    maximumFractionDigits,
    ...options
  });
}

export function formatLatency(locale: AtlasLocale, milliseconds: number, options: Intl.NumberFormatOptions = {}) {
  return formatUnit(locale, milliseconds, "millisecond", "ms", {
    maximumFractionDigits: 0,
    ...options
  });
}

export function formatRelativeTime(
  locale: AtlasLocale,
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = {},
) {
  return new Intl.RelativeTimeFormat(getIntlLocale(locale), {
    numeric: "auto",
    ...options
  }).format(value, unit);
}

export async function getTranslationKeys(): Promise<TranslationKey[]> {
  const zhCNData = await localeLoaders["zh-CN"]();
  return Object.keys(zhCNData) as TranslationKey[];
}

export async function getLocaleCoverage(locale: AtlasLocale): Promise<LocaleCoverageReport> {
  await loadLocale(locale);
  const translationKeys = await getTranslationKeys();
  const pack = getSyncPack(locale);
  const packKeys = new Set(Object.keys(pack) as TranslationKey[]);
  const missingKeys = translationKeys.filter((key) => !packKeys.has(key));
  const translatedKeys = translationKeys.length - missingKeys.length;
  const totalKeys = translationKeys.length;

  return {
    isComplete: missingKeys.length === 0,
    locale,
    missingKeys,
    translatedKeys,
    totalKeys,
    percentage: Math.round((translatedKeys / totalKeys) * 100)
  };
}

export async function getTranslationReadinessReport(
  locales: readonly AtlasLocale[] = SUPPORTED_LOCALES.map((locale) => locale.code),
): Promise<TranslationReadinessReport> {
  await Promise.all(locales.map((locale) => loadLocale(locale)));
  const localeReports = await Promise.all(locales.map(getLocaleCoverage));

  return {
    completeLocales: localeReports.filter((report) => report.isComplete).map((report) => report.locale),
    incompleteLocales: localeReports.filter((report) => !report.isComplete),
    isComplete: localeReports.every((report) => report.isComplete),
    locales: localeReports,
    totalKeys: (await getTranslationKeys()).length
  };
}

export async function assertCompleteTranslations(locales?: readonly AtlasLocale[]): Promise<void> {
  const report = await getTranslationReadinessReport(locales);

  if (report.isComplete) {
    return;
  }

  const missingSummary = report.incompleteLocales
    .map((localeReport) => `${localeReport.locale}: ${localeReport.missingKeys.slice(0, 5).join(", ")}`)
    .join("; ");

  throw new Error(`Incomplete JoeSSH translations: ${missingSummary}`);
}

function formatMessage(template: string, values?: Record<string, string | number>) {
  if (!values) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`));
}

function formatUnit(
  locale: AtlasLocale,
  value: number,
  unit: string,
  fallbackUnit: string,
  options: Intl.NumberFormatOptions = {},
) {
  try {
    return formatNumber(locale, value, {
      style: "unit",
      unit,
      unitDisplay: "short",
      ...options
    });
  } catch {
    return `${formatNumber(locale, value, options)} ${fallbackUnit}`;
  }
}

function toDate(value: Date | number | string) {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}
