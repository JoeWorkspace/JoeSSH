import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXPECTED_CANONICAL_LOCALES,
  EXPECTED_STORE_LOCALES,
  STORE_LOCALE_BY_CANONICAL,
  STORE_LOCALE_CATALOG,
  STORE_LOCALE_CATALOG_SOURCE,
} from "./microsoft-store-locale-catalog.mjs";
import { isUnsafeCsvCell } from "./microsoft-store-csv.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const manifestPath = resolve(
  repositoryRoot,
  "docs/assets/microsoft-store/localization-manifest.json",
);
const i18nIndexPath = resolve(repositoryRoot, "packages/i18n/src/index.ts");

export { EXPECTED_CANONICAL_LOCALES, EXPECTED_STORE_LOCALES };

export const REVIEW_STATUSES = [
  "translation-draft",
  "native-reviewed",
  "native-approved",
];
export const NATIVE_REVIEW_STATUSES = new Set([
  "native-reviewed",
  "native-approved",
]);
export const SUBMISSION_STATUSES = new Set([
  "draft-not-submitted",
  "ready-for-human-submission",
]);
export const STORE_CATALOG_STATUSES = new Set([
  "partner-center-exact-code-confirmation-pending",
  "partner-center-export-confirmed",
]);

export const EXPECTED_RTL = new Set(["ar-SA", "he-IL", "ur-PK", "ug-CN"]);
export const EXPECTED_REVIEW_LOCALES = new Set([
  "kn-IN",
  "qu-PE",
  "es-MX",
  "ca-ES-valencia",
]);

export const EXPECTED_PRODUCT = {
  name: "JoeSSH",
  offer: "free",
  license: "MIT",
  releaseStage: "public-beta",
  architecture: "windows-x64",
  connectionModel: "local-first",
  capabilities: ["ssh", "sftp", "local-port-forwarding"],
  accountRequired: false,
  hostedServiceIncluded: false,
};

const FORBIDDEN_CLAIMS = [
  /\b(?:already|now|officially)\s+(?:published|released|certified)\b/iu,
  /\b(?:published|released|certified)\s+(?:on|by)\s+(?:the\s+)?Microsoft Store\b/iu,
  /\b(?:paid|subscription|in-app purchase|purchase required|telemetry|tracking)\b/iu,
  /\b(?:publicado|publicada|lanzado|lanzada|certificado|certificada)\b.*\b(?:Microsoft Store|Tienda Microsoft)\b/iu,
  /\b(?:de pago|suscripci[oó]n|compra dentro de la aplicaci[oó]n|telemetr[ií]a)\b/iu,
  /(?:已发布|已上架|已认证|付费|订阅|遥测|公開済み|認証済み|有料|購読|テレメトリ)/u,
];

const ENGLISH_FALLBACK = {
  shortDescription:
    "Free, open-source Public Beta for local-first SSH, SFTP and port forwarding on Windows x64.",
  fullDescription:
    "JoeSSH is a free, open-source Public Beta for local SSH work on Windows x64. Connect to an authorized server, review host keys, use an interactive terminal, transfer files with SFTP, and manage local port forwarding. Profiles and preferences stay on this device by default. No JoeSSH account or hosted service is required.",
};
const ENGLISH_FALLBACK_MARKERS = [
  "Free, open-source Public Beta",
  "local-first SSH",
  "Profiles and preferences stay on this device by default",
  "No JoeSSH account or hosted service is required",
];

const EXPECTED_SCRIPT_PATTERNS = {
  am: /[\u1200-\u137f]/u,
  ar: /[\u0600-\u06ff\u0750-\u077f]/u,
  bg: /[\u0400-\u052f]/u,
  bn: /[\u0980-\u09ff]/u,
  el: /[\u0370-\u03ff]/u,
  gu: /[\u0a80-\u0aff]/u,
  he: /[\u0590-\u05ff]/u,
  hi: /[\u0900-\u097f]/u,
  ja: /[\u3040-\u30ff\u3400-\u9fff]/u,
  ka: /[\u10a0-\u10ff]/u,
  kk: /[\u0400-\u052f]/u,
  km: /[\u1780-\u17ff]/u,
  ko: /[\uac00-\ud7af]/u,
  kok: /[\u0900-\u097f]/u,
  lo: /[\u0e80-\u0eff]/u,
  mk: /[\u0400-\u052f]/u,
  ml: /[\u0d00-\u0d7f]/u,
  mr: /[\u0900-\u097f]/u,
  ne: /[\u0900-\u097f]/u,
  or: /[\u0b00-\u0b7f]/u,
  pa: /[\u0a00-\u0a7f]/u,
  ru: /[\u0400-\u052f]/u,
  sr: /[\u0400-\u052f]/u,
  ta: /[\u0b80-\u0bff]/u,
  te: /[\u0c00-\u0c7f]/u,
  th: /[\u0e00-\u0e7f]/u,
  tt: /[\u0400-\u052f]/u,
  uk: /[\u0400-\u052f]/u,
  ug: /[\u0600-\u06ff\u0750-\u077f]/u,
  ur: /[\u0600-\u06ff\u0750-\u077f]/u,
  zh: /[\u3400-\u9fff]/u,
};
const TECHNICAL_WORDS = new Set([
  "joessh",
  "ssh",
  "sftp",
  "windows",
  "public",
  "beta",
  "mib",
  "x64",
  "loopback",
]);

const PUBLIC_BETA_PATTERN =
  /(?:^|[^A-Za-z0-9])Public[\s-]+Beta(?:$|[^A-Za-z0-9])/iu;
const ARABIC_PUBLIC_BETA_PATTERN =
  /\u0625\u0635\u062f\u0627\u0631\s+\u062a\u062c\u0631\u064a\u0628\u064a\s+\u0639\u0627\u0645/u;
const WINDOWS_PATTERN = /(?:^|[^A-Za-z0-9])Windows(?:$|[^A-Za-z0-9])/u;
const X64_PATTERN = /(?:^|[^A-Za-z0-9])x64(?:$|[^A-Za-z0-9])/u;
const DEFAULT_SIZE_PATTERN = /(?:^|[^\p{N}])25\s+MiB(?:$|[^\p{N}])/u;
const SIZE_PATTERNS = new Map([
  ["ru-RU", /(?:^|[^\p{N}])25\s+\u041c\u0438\u0411(?:$|[^\p{N}])/u],
  ["as-IN", /(?:^|[^\p{N}])\u09e8\u09eb\s+MiB(?:$|[^\p{N}])/u],
  ["bn-IN", /(?:^|[^\p{N}])\u09e8\u09eb\s+MiB(?:$|[^\p{N}])/u],
]);
const LOOPBACK_ALIASES = new Map([
  ["af-ZA", "teruglus"],
  ["qu-PE", "Loopbacklla"],
]);

function hasTechnicalToken(value, token) {
  if (typeof value !== "string") return false;
  if (token === "JoeSSH") return value.includes("JoeSSH");
  if (token === "SSH") return value.replaceAll("JoeSSH", "").includes("SSH");
  return value.includes(token);
}

function hasPublicBetaAnchor(value, locale) {
  return (
    typeof value === "string" &&
    (PUBLIC_BETA_PATTERN.test(value) ||
      (locale === "ar-SA" && ARABIC_PUBLIC_BETA_PATTERN.test(value)))
  );
}

function hasTechnicalFactAnchor(value, anchor, locale) {
  if (anchor === "Public Beta") return hasPublicBetaAnchor(value, locale);
  if (anchor === "Windows")
    return typeof value === "string" && WINDOWS_PATTERN.test(value);
  if (anchor === "x64")
    return typeof value === "string" && X64_PATTERN.test(value);
  if (anchor === "25 MiB") {
    if (typeof value !== "string") return false;
    return [DEFAULT_SIZE_PATTERN, SIZE_PATTERNS.get(locale)]
      .filter(Boolean)
      .some((pattern) => pattern.test(value));
  }
  if (anchor === "loopback") {
    if (typeof value !== "string") return false;
    const normalized = value.toLocaleLowerCase();
    const alias = LOOPBACK_ALIASES.get(locale)?.toLocaleLowerCase();
    return (
      normalized.includes("loopback") ||
      (alias ? normalized.includes(alias) : false)
    );
  }
  return hasTechnicalToken(value, anchor);
}

function technicalFactAnchorFailures(entry) {
  const locale = entry?.locale ?? "<missing>";
  const listing = entry?.listing ?? {};
  const checks = [
    ["shortDescription", "SSH"],
    ["shortDescription", "SFTP"],
    ["shortDescription", "Windows"],
    ["shortDescription", "x64"],
    ["shortDescription", "Public Beta"],
    ["fullDescription", "JoeSSH"],
    ["fullDescription", "SSH"],
    ["fullDescription", "SFTP"],
    ["fullDescription", "Windows"],
    ["fullDescription", "x64"],
    ["fullDescription", "Public Beta"],
    ["features[0]", "SSH"],
    ["features[2]", "SFTP"],
    ["features[2]", "25 MiB"],
    ["features[3]", "loopback"],
  ];
  return checks
    .filter(([field, anchor]) => {
      const value = field.startsWith("features[")
        ? listing.features?.[Number(field.match(/\d+/u)?.[0])]
        : listing[field];
      return !hasTechnicalFactAnchor(value, anchor, locale);
    })
    .map(([field, anchor]) => `${locale}:${field}/${anchor}`);
}

const KNOWN_TRANSLATION_ERROR_RULES = [
  { locale: "af-ZA", kind: "forbidden-substring", value: "gashere-sleutels" },
  {
    locale: "am-ET",
    kind: "forbidden-substring",
    value: "ተግባራዊ ተርሚናል",
  },
  {
    locale: "eu-ES",
    kind: "forbidden-exact-field",
    field: "features",
    value: "Loopback bidezko ataka-birbidalketa lokala",
  },
  { locale: "cs-CZ", kind: "forbidden-substring", value: "v tomto zařízení" },
  {
    locale: "fi-FI",
    kind: "forbidden-exact-field",
    field: "features",
    value: "Vain loopback-paikallinen porttien välitys",
  },
  {
    locale: "fr-CA",
    kind: "forbidden-substring",
    value: "transfert de ports",
  },
  { locale: "km-KH", kind: "forbidden-substring", value: "ម៉ាស៊ីនភ្ញៀវ" },
  { locale: "nb-NO", kind: "forbidden-substring", value: "driftet tjeneste" },
  {
    locale: "sk-SK",
    kind: "forbidden-substring",
    value: "v tomto zariadení",
  },
  {
    locale: "te-IN",
    kind: "forbidden-exact-field",
    field: "features",
    value: "loopback మాత్రమే స్థానిక పోర్ట్ ఫార్వార్డింగ్",
  },
  {
    locale: "tr-TR",
    kind: "forbidden-exact-field",
    field: "features",
    value: "Yalnızca loopback yerel bağlantı noktası yönlendirmesi",
  },
  { locale: "mi-NZ", kind: "forbidden-substring", value: "kaiwhakahaere" },
  ...[
    "código",
    "servidor",
    "terminal interactivo",
    "archivokuna",
    "preferencias",
    "cuenta",
    "servicio alojado",
    "antes de importar",
    "puertos locales",
  ].map((value) => ({
    locale: "qu-PE",
    kind: "forbidden-substring",
    value,
  })),
];

const KEYWORD_FIELD_INDEX = {
  terminal: 2,
  portForwarding: 3,
  connectionProfiles: 4,
};
const KNOWN_KEYWORD_DEFECT_RULES = [
  { locale: "vi-VN", field: "terminal", forbidden: "Thiết bị" },
  ...[
    ["am-ET", "በloopback ብቻ"],
    ["az-Latn-AZ", "Yalnız loopback"],
    ["eu-ES", "Loopback bidezko"],
    ["bg-BG", "Локално пренасочване"],
    ["ca-ES", "Reenviament de"],
    ["zh-CN", "仅限 loopback"],
    ["zh-TW", "僅限 loopback"],
    ["hr-HR", "Lokalno prosljeđivanje"],
    ["cs-CZ", "Místní přesměrování"],
    ["nl-NL", "Lokale port"],
    ["en-GB", "Loopback-only local"],
    ["en-US", "Loopback-only local"],
    ["et-EE", "Ainult loopbacki"],
    ["fil-PH", "Loopback-only na"],
    ["fi-FI", "Paikallinen porttien"],
    ["fr-FR", "Redirection de"],
    ["fr-CA", "Redirection de"],
    ["gl-ES", "Reenvío de"],
    ["el-GR", "Τοπική προώθηση"],
    ["hi-IN", "केवल loopback"],
    ["hu-HU", "Csak loopbackes"],
    ["kn-IN", "loopback ಮಾತ್ರದ"],
    ["kk-KZ", "Тек loopback"],
    ["ko-KR", "loopback 전용"],
    ["lv-LV", "Lokāla portu"],
    ["lt-LT", "Vietinis prievadų"],
    ["mk-MK", "Локално препраќање"],
    ["ml-IN", "loopback മാത്രം"],
    ["es-ES", "Reenvío de"],
    ["es-MX", "Reenvío de"],
    ["pl-PL", "Lokalne przekierowanie"],
    ["pt-BR", "Encaminhamento de"],
    ["pt-PT", "Reencaminhamento de"],
    ["ro-RO", "Redirecționare locală"],
    ["ru-RU", "Локальное перенаправление"],
    ["sk-SK", "Miestne presmerovanie"],
    ["sl-SI", "Lokalno posredovanje"],
    ["sr-Latn-RS", "Lokalno prosleđivanje"],
    ["ta-IN", "loopback மட்டும்"],
    ["te-IN", "loopback ద్వారా"],
    ["tr-TR", "Yalnızca loopback"],
    ["uk-UA", "Локальне перенаправлення"],
    ["vi-VN", "Chuyển tiếp"],
    ["as-IN", "কেৱল loopback"],
    ["bn-IN", "শুধু loopback"],
    ["ka-GE", "ლოკალური პორტების"],
    ["gu-IN", "ફક્ત loopback"],
    ["ga-IE", "Cur ar"],
    ["kok-IN", "फकत loopback"],
    ["mt-MT", "Forwarding lokali"],
    ["mi-NZ", "Tuku tauranga"],
    ["mr-IN", "फक्त loopback"],
    ["ne-NP", "loopback मात्र"],
    ["or-IN", "କେବଳ loopback"],
    ["pa-IN", "ਕੇਵਲ loopback"],
    ["qu-PE", "Loopbacklla puertokunapa"],
    ["gd-GB", "Cur air"],
    ["sr-Cyrl-BA", "Локално прослеђивање"],
    ["tt-RU", "Тик loopback"],
    ["ur-PK", "صرف loopback"],
    ["ug-CN", "پەقەت loopback"],
    ["ca-ES-valencia", "Reenviament de"],
  ].map(([locale, forbidden]) => ({
    locale,
    field: "portForwarding",
    forbidden,
  })),
  ...[
    ["am-ET", "የአካባቢ ግንኙነት"],
    ["ar-SA", "ملفات اتصال"],
    ["az-Latn-AZ", "Yerli bağlantı"],
    ["ca-ES", "Perfils de"],
    ["en-GB", "Local connection"],
    ["en-US", "Local connection"],
    ["fil-PH", "Mga lokal"],
    ["fr-FR", "Profils de"],
    ["fr-CA", "Profils de"],
    ["gl-ES", "Perfís de"],
    ["hi-IN", "स्थानीय कनेक्शन"],
    ["hu-HU", "Helyi kapcsolati"],
    ["it-IT", "Profili di"],
    ["kn-IN", "ಸ್ಥಳೀಯ ಸಂಪರ್ಕ"],
    ["kk-KZ", "Жергілікті қосылым"],
    ["ko-KR", "로컬 연결"],
    ["lv-LV", "Lokālie savienojumu"],
    ["lt-LT", "Vietiniai ryšio"],
    ["ml-IN", "പ്രാദേശിക കണക്ഷൻ"],
    ["es-ES", "Perfiles de"],
    ["es-MX", "Perfiles de"],
    ["pt-BR", "Perfis de"],
    ["pt-PT", "Perfis de"],
    ["ta-IN", "உள்ளக இணைப்பு"],
    ["te-IN", "స్థానిక కనెక్షన్"],
    ["tr-TR", "Yerel bağlantı"],
    ["vi-VN", "Hồ sơ"],
    ["as-IN", "স্থানীয় সংযোগ"],
    ["bn-IN", "স্থানীয় সংযোগ"],
    ["ka-GE", "ლოკალური კავშირის"],
    ["gu-IN", "સ્થાનિક કનેક્શન"],
    ["kok-IN", "स्थानिक जोडणी"],
    ["mt-MT", "Profili ta’"],
    ["mi-NZ", "Kōtaha hononga"],
    ["mr-IN", "स्थानिक कनेक्शन"],
    ["ne-NP", "स्थानीय जडान"],
    ["or-IN", "ସ୍ଥାନୀୟ ସଂଯୋଗ"],
    ["pa-IN", "ਸਥਾਨਕ ਕਨੈਕਸ਼ਨ"],
    ["tt-RU", "Җирле тоташу"],
    ["ur-PK", "مقامی کنکشن"],
    ["ug-CN", "يەرلىك ئۇلىنىش"],
    ["ca-ES-valencia", "Perfils de"],
  ].map(([locale, forbidden]) => ({
    locale,
    field: "connectionProfiles",
    forbidden,
  })),
];

export function readManifest(path = manifestPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readAppUiLocales(path = i18nIndexPath) {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(/\{\s*code:\s*"([^"]+)"/gu)].map(
    (match) => match[1],
  );
}

function unique(values) {
  return new Set(values).size === values.length;
}

function setEquals(left, right) {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fail(label, detail) {
  return { label, passed: false, detail };
}

function pass(label, detail) {
  return { label, passed: true, detail };
}

function wordCount(value) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

export function isHttpsUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function isValidReviewTimestamp(value) {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString() === value;
}

function hasDisallowedUnicodeControl(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      (codePoint >= 0x00 && codePoint <= 0x1f) ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function listingTextFields(entry) {
  const listing = entry?.listing;
  const fields = [
    { field: "title", path: "title", value: listing?.title },
    {
      field: "shortDescription",
      path: "shortDescription",
      value: listing?.shortDescription,
    },
    {
      field: "fullDescription",
      path: "fullDescription",
      value: listing?.fullDescription,
    },
  ];
  for (const field of ["features", "keywords"]) {
    const values = Array.isArray(listing?.[field]) ? listing[field] : [];
    values.forEach((value, index) => {
      fields.push({ field, path: `${field}[${index}]`, value });
    });
  }
  return fields.filter((field) => typeof field.value === "string");
}

function listingCopyFields(entry) {
  return listingTextFields(entry).map(({ value }) => value);
}

function listingCsvValues(entry) {
  const listing = entry?.listing;
  return [
    entry?.locale,
    entry?.storeLocale,
    listing?.title,
    listing?.shortDescription,
    listing?.fullDescription,
    ...(Array.isArray(listing?.features) ? listing.features : []),
    ...(Array.isArray(listing?.keywords) ? listing.keywords : []),
  ];
}

function expectedScriptPattern(locale) {
  if (locale?.startsWith("sr-Latn")) return null;
  return EXPECTED_SCRIPT_PATTERNS[locale?.split("-")[0]] ?? null;
}

function hasExpectedScriptOrOnlyTechnicalWords(value, pattern) {
  if (pattern.test(value)) return true;
  const words = value.match(/[A-Za-z][A-Za-z0-9-]*/gu) ?? [];
  if (
    words.length === 0 ||
    !words.every((word) => TECHNICAL_WORDS.has(word.toLowerCase()))
  ) {
    return false;
  }
  const withoutAsciiWords = value.replace(/[A-Za-z][A-Za-z0-9-]*/gu, "");
  return !/\p{L}/u.test(withoutAsciiWords);
}

function normalizeParagraph(value) {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

function findCrossLanguageDuplicateParagraphs(locales) {
  const duplicates = new Set();
  for (const field of ["shortDescription", "fullDescription"]) {
    const byParagraph = new Map();
    for (const entry of locales) {
      const value = entry?.listing?.[field];
      if (typeof value !== "string") continue;
      const key = normalizeParagraph(value);
      if (!byParagraph.has(key)) byParagraph.set(key, []);
      byParagraph.get(key).push(entry.locale);
    }
    for (const entries of byParagraph.values()) {
      const languages = new Set(
        entries.map((locale) => {
          try {
            return new Intl.Locale(locale).language;
          } catch {
            return locale;
          }
        }),
      );
      if (entries.length > 1 && languages.size > 1) {
        duplicates.add(`${field}:${entries.join(",")}`);
      }
    }
  }
  return [...duplicates];
}

function validateScreenshotAssets(listing) {
  const assets = listing?.assets;
  return (
    assets &&
    Array.isArray(assets.screenshotUrls) &&
    assets.screenshotUrls.every(isHttpsUrl) &&
    (assets.screenshotBinding === null ||
      (typeof assets.screenshotBinding === "object" &&
        typeof assets.screenshotBinding.status === "string"))
  );
}

function hasNativeReviewProvenance(entry) {
  const review = entry?.nativeReview;
  return (
    NATIVE_REVIEW_STATUSES.has(entry?.reviewStatus) &&
    review &&
    typeof review.reviewer === "string" &&
    review.reviewer.trim().length > 0 &&
    isValidReviewTimestamp(review.reviewedAt) &&
    typeof review.provenance === "string" &&
    review.provenance.trim().length > 0
  );
}

function hasReviewedScreenshotBinding(entry) {
  const assets = entry?.listing?.assets;
  const binding = assets?.screenshotBinding;
  return (
    Array.isArray(assets?.screenshotUrls) &&
    assets.screenshotUrls.length >= 1 &&
    assets.screenshotUrls.every(isHttpsUrl) &&
    binding?.status === "reviewed" &&
    typeof binding.reviewer === "string" &&
    binding.reviewer.trim().length > 0 &&
    isValidReviewTimestamp(binding.reviewedAt) &&
    typeof binding.provenance === "string" &&
    binding.provenance.trim().length > 0
  );
}

function validatePartnerCenterLanguageOptionEvidence(root) {
  const failures = [];
  let evidence;
  try {
    evidence = readManifest(
      resolve(root, STORE_LOCALE_CATALOG_SOURCE.evidencePath),
    );
  } catch (error) {
    return [`evidence:${error.message}`];
  }

  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return ["schema"];
  }

  if (
    evidence.schemaVersion !== 1 ||
    evidence.kind !== "joessh-partner-center-language-option-evidence"
  ) {
    failures.push("schema");
  }
  if (!isValidReviewTimestamp(evidence.observedAt)) {
    failures.push("observedAt");
  }
  if (evidence.status !== "all-target-options-observed-exact-codes-pending") {
    failures.push("status");
  }
  if (
    evidence.source?.productId !== "9NK5LLMF8LHM" ||
    evidence.source?.submissionId !== "1152921505701586331" ||
    evidence.source?.availableOptionCount !== 830 ||
    evidence.source?.saveClicked !== false
  ) {
    failures.push("source");
  }

  const options = Array.isArray(evidence.options) ? evidence.options : [];
  const canonicalLocales = options.map((entry) => entry?.canonicalLocale);
  const storeLocales = options.map((entry) => entry?.storeLocale);
  const languageIds = options.map((entry) => entry?.languageId);
  const labels = options.map((entry) => entry?.label);
  if (
    options.length !== STORE_LOCALE_CATALOG.length ||
    !setEquals(
      new Set(canonicalLocales),
      new Set(EXPECTED_CANONICAL_LOCALES),
    ) ||
    !setEquals(new Set(storeLocales), new Set(EXPECTED_STORE_LOCALES))
  ) {
    failures.push("locale-collection");
  }
  if (
    !unique(languageIds) ||
    languageIds.some(
      (languageId) => !Number.isInteger(languageId) || languageId <= 0,
    )
  ) {
    failures.push("language-ids");
  }
  if (
    !unique(labels) ||
    labels.some((label) => typeof label !== "string" || label.trim() === "")
  ) {
    failures.push("labels");
  }
  const mappingFailures = options.filter(
    (entry) =>
      STORE_LOCALE_BY_CANONICAL.get(entry?.canonicalLocale)?.storeLocale !==
      entry?.storeLocale,
  );
  if (mappingFailures.length > 0) failures.push("catalog-mapping");

  const existingCodes = new Map(
    (Array.isArray(evidence.existingListingCodes)
      ? evidence.existingListingCodes
      : []
    ).map((entry) => [entry?.canonicalLocale, entry]),
  );
  if (
    existingCodes.get("en-US")?.languageId !== 4 ||
    existingCodes.get("en-US")?.languageCode !== "en-us" ||
    existingCodes.get("zh-CN")?.languageId !== 479 ||
    existingCodes.get("zh-CN")?.languageCode !== "zh-hans-cn"
  ) {
    failures.push("existing-listing-codes");
  }

  return failures;
}

export function checkMicrosoftStoreLocalization(root = repositoryRoot) {
  const actualManifestPath = resolve(
    root,
    "docs/assets/microsoft-store/localization-manifest.json",
  );
  try {
    const manifest = readManifest(actualManifestPath);
    return [
      pass("manifest is valid JSON", "parsed successfully"),
      ...checkMicrosoftStoreLocalizationManifest(manifest, root),
    ];
  } catch (error) {
    return [fail("manifest is valid JSON", error.message)];
  }
}

export function checkMicrosoftStoreLocalizationManifest(
  manifest,
  root = repositoryRoot,
) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return [fail("manifest is valid JSON", "manifest must be an object")];
  }

  const results = [];
  const actualI18nPath = resolve(root, "packages/i18n/src/index.ts");

  const locales = Array.isArray(manifest.locales) ? manifest.locales : [];
  const codes = locales.map((entry) => entry?.locale);
  const storeCodes = locales.map((entry) => entry?.storeLocale);

  results.push(
    manifest.schemaVersion === 1
      ? pass("manifest schema version", "schemaVersion=1")
      : fail("manifest schema version", `got ${manifest.schemaVersion}`),
  );
  results.push(
    SUBMISSION_STATUSES.has(manifest.submissionStatus)
      ? pass("submission state", "no Partner Center submission claim")
      : fail("submission state", `got ${manifest.submissionStatus}`),
  );
  results.push(
    sameJson(manifest.product, EXPECTED_PRODUCT)
      ? pass(
          "current product fact baseline",
          "product facts match the release baseline",
        )
      : fail("current product fact baseline", "manifest product facts drifted"),
  );
  results.push(
    sameJson(manifest.reviewPolicy?.allowedStatuses, REVIEW_STATUSES) &&
      manifest.reviewPolicy?.nativeReviewRequiredForSubmission === true
      ? pass(
          "review policy contract",
          "status enum and native gate are explicit",
        )
      : fail("review policy contract", "review policy drifted"),
  );
  results.push(
    locales.length === STORE_LOCALE_CATALOG.length
      ? pass("draft locale count", `${locales.length}`)
      : fail(
          "draft locale count",
          `expected ${STORE_LOCALE_CATALOG.length}, got ${locales.length}`,
        ),
  );
  results.push(
    unique(codes) && unique(storeCodes)
      ? pass("locale uniqueness", "canonical and Store values are unique")
      : fail("locale uniqueness", "duplicate canonical or Store locale value"),
  );
  results.push(
    setEquals(new Set(codes), new Set(EXPECTED_CANONICAL_LOCALES))
      ? pass(
          "canonical locale collection",
          "all catalog canonical locales are present",
        )
      : fail(
          "canonical locale collection",
          `missing=${EXPECTED_CANONICAL_LOCALES.filter((code) => !codes.includes(code)).join(",")}; unexpected=${codes.filter((code) => !EXPECTED_CANONICAL_LOCALES.includes(code)).join(",")}`,
        ),
  );
  results.push(
    setEquals(new Set(storeCodes), new Set(EXPECTED_STORE_LOCALES))
      ? pass("Store locale collection", "all catalog Store values are present")
      : fail(
          "Store locale collection",
          "manifest Store values differ from catalog",
        ),
  );
  const nonCanonicalLocales = locales
    .filter((entry) => {
      try {
        return new Intl.Locale(entry.locale).toString() !== entry.locale;
      } catch {
        return true;
      }
    })
    .map((entry) => entry?.locale ?? "<missing>");
  results.push(
    nonCanonicalLocales.length === 0
      ? pass("BCP 47 canonical form", "all canonical locale values round-trip")
      : fail("BCP 47 canonical form", nonCanonicalLocales.join(", ")),
  );
  const mappingFailures = locales
    .filter(
      (entry) =>
        STORE_LOCALE_BY_CANONICAL.get(entry?.locale)?.storeLocale !==
        entry?.storeLocale,
    )
    .map((entry) => entry?.locale ?? "<missing>");
  results.push(
    mappingFailures.length === 0
      ? pass(
          "Microsoft Store locale mapping",
          "canonical BCP 47 and reviewed Store codes are separate",
        )
      : fail("Microsoft Store locale mapping", mappingFailures.join(", ")),
  );
  results.push(
    STORE_CATALOG_STATUSES.has(manifest.storeLocaleCatalog?.status) &&
      manifest.storeLocaleCatalog?.authority ===
        STORE_LOCALE_CATALOG_SOURCE.authority &&
      manifest.storeLocaleCatalog?.reference ===
        STORE_LOCALE_CATALOG_SOURCE.reference &&
      manifest.storeLocaleCatalog?.liveOptionsStatus ===
        STORE_LOCALE_CATALOG_SOURCE.liveOptionsStatus &&
      manifest.storeLocaleCatalog?.evidencePath ===
        STORE_LOCALE_CATALOG_SOURCE.evidencePath
      ? pass("Store catalog provenance", "catalog source status is explicit")
      : fail(
          "Store catalog provenance",
          "catalog source status is missing or drifted",
        ),
  );
  const optionEvidenceResults =
    validatePartnerCenterLanguageOptionEvidence(root);
  results.push(
    optionEvidenceResults.length === 0
      ? pass(
          "Partner Center live language options",
          "all 80 target options have unique live labels and language IDs",
        )
      : fail(
          "Partner Center live language options",
          optionEvidenceResults.join(", "),
        ),
  );
  results.push(
    typeof manifest.localizationRevision === "string" &&
      manifest.localizationRevision.length > 0 &&
      typeof manifest.generatedAt === "string" &&
      manifest.generatedAt.length > 0 &&
      typeof manifest.generation?.sourceCommit === "string" &&
      typeof manifest.generation?.sourceState === "string"
      ? pass(
          "generation metadata",
          "revision, timestamp and generator source are explicit",
        )
      : fail("generation metadata", "generation metadata is incomplete"),
  );

  let appUiLocales;
  try {
    appUiLocales = readAppUiLocales(actualI18nPath);
    results.push(
      pass(
        "application UI locale source",
        `${appUiLocales.length} locale codes read`,
      ),
    );
  } catch (error) {
    results.push(fail("application UI locale source", error.message));
    appUiLocales = [];
  }

  const manifestAppUiLocales = manifest.appUiPolicy?.supportedLocales ?? [];
  results.push(
    unique(manifestAppUiLocales) &&
      setEquals(new Set(manifestAppUiLocales), new Set(appUiLocales))
      ? pass(
          "application UI policy alignment",
          "policy is unique and matches SUPPORTED_LOCALES",
        )
      : fail(
          "application UI policy alignment",
          "policy is duplicated or differs from SUPPORTED_LOCALES",
        ),
  );

  const mappedAppUiLocales = locales
    .filter((entry) => entry.appUiSupported)
    .map((entry) => entry.appUiLocale);
  const appUiSourceSet = new Set(appUiLocales);
  const hasAllAppUiMappings =
    setEquals(new Set(mappedAppUiLocales), appUiSourceSet) &&
    mappedAppUiLocales.every((locale) => appUiSourceSet.has(locale));
  results.push(
    hasAllAppUiMappings &&
      locales.every(
        (entry) => entry.appUiSupported === (entry.appUiLocale !== null),
      )
      ? pass(
          "Store/UI support separation",
          "Store locales may share a shipped UI pack; discoverability-only entries remain explicit",
        )
      : fail(
          "Store/UI support separation",
          "each shipped UI pack needs at least one truthful Store mapping",
        ),
  );

  results.push(
    setEquals(
      new Set(
        locales
          .filter((entry) => entry.direction === "rtl")
          .map((entry) => entry.locale),
      ),
      EXPECTED_RTL,
    )
      ? pass("RTL metadata", [...EXPECTED_RTL].join(", "))
      : fail("RTL metadata", "RTL set is incorrect"),
  );

  const invalidEntries = [];
  const fallbackEntries = [];
  const claimEntries = [];
  const statusEntries = [];
  const keywordEntries = [];
  const assetEntries = [];
  const reviewEntries = [];
  const unicodeEntries = [];
  const scriptEntries = [];
  const csvSafetyEntries = [];
  const technicalFactAnchorEntries = [];
  const knownTranslationErrorEntries = [];
  const knownKeywordDefectEntries = [];
  for (const entry of locales) {
    const listing = entry?.listing;
    const statusValid = REVIEW_STATUSES.includes(entry?.reviewStatus);
    if (!statusValid) statusEntries.push(entry?.locale ?? "<missing>");
    const reviewRecordValid =
      entry?.reviewStatus === "translation-draft"
        ? entry?.nativeReview === null
        : hasNativeReviewProvenance(entry);

    const keywords = Array.isArray(listing?.keywords) ? listing.keywords : [];
    const keywordsValid =
      keywords.length >= 1 &&
      keywords.length <= 7 &&
      unique(keywords) &&
      keywords.every(
        (keyword) =>
          typeof keyword === "string" &&
          keyword.trim().length > 0 &&
          keyword.length <= 40,
      ) &&
      wordCount(keywords.join(" ")) <= 21 &&
      keywords.includes("SSH") &&
      keywords.includes("SFTP");
    if (!keywordsValid) keywordEntries.push(entry?.locale ?? "<missing>");
    for (const rule of KNOWN_KEYWORD_DEFECT_RULES) {
      if (rule.locale !== entry?.locale) continue;
      const keyword = keywords[KEYWORD_FIELD_INDEX[rule.field]];
      if (keyword === rule.forbidden) {
        knownKeywordDefectEntries.push(
          `${entry?.locale ?? "<missing>"}:${rule.field}=${rule.forbidden}`,
        );
      }
    }

    const fieldsValid =
      typeof entry?.sourceName === "string" &&
      typeof entry?.languageName === "string" &&
      typeof entry?.nativeName === "string" &&
      (entry?.direction === "ltr" || entry?.direction === "rtl") &&
      typeof entry?.reviewRequired === "boolean" &&
      typeof entry?.reviewStatus === "string" &&
      statusValid &&
      reviewRecordValid &&
      listing &&
      listing.title === "JoeSSH" &&
      typeof listing.shortDescription === "string" &&
      listing.shortDescription.length >= 20 &&
      listing.shortDescription.length <= 200 &&
      typeof listing.fullDescription === "string" &&
      listing.fullDescription.length >= 80 &&
      listing.fullDescription.length <= 4_000 &&
      Array.isArray(listing.features) &&
      listing.features.length === 5 &&
      listing.features.every(
        (feature) =>
          typeof feature === "string" &&
          feature.length >= 3 &&
          feature.length <= 100,
      ) &&
      keywordsValid &&
      validateScreenshotAssets(listing);
    if (!fieldsValid) invalidEntries.push(entry?.locale ?? "<missing>");
    if (!validateScreenshotAssets(listing))
      assetEntries.push(entry?.locale ?? "<missing>");

    const text = [
      listing?.shortDescription,
      listing?.fullDescription,
      ...(listing?.features ?? []),
    ]
      .filter((value) => typeof value === "string")
      .join(" ");
    const copyFields = listingCopyFields(entry);
    if (
      copyFields.some(
        (value) =>
          value.normalize("NFC") !== value ||
          hasDisallowedUnicodeControl(value),
      )
    ) {
      unicodeEntries.push(entry?.locale ?? "<missing>");
    }
    const scriptPattern = expectedScriptPattern(entry?.locale);
    if (
      scriptPattern &&
      (!hasExpectedScriptOrOnlyTechnicalWords(
        listing?.shortDescription ?? "",
        scriptPattern,
      ) ||
        !hasExpectedScriptOrOnlyTechnicalWords(
          listing?.fullDescription ?? "",
          scriptPattern,
        ) ||
        !hasExpectedScriptOrOnlyTechnicalWords(
          (listing?.features ?? []).join(" "),
          scriptPattern,
        ))
    ) {
      scriptEntries.push(entry?.locale ?? "<missing>");
    }
    const listingFields = listingTextFields(entry);
    for (const rule of KNOWN_TRANSLATION_ERROR_RULES) {
      if (rule.locale !== entry?.locale) continue;
      for (const listingField of listingFields) {
        const matches =
          rule.kind === "forbidden-substring"
            ? listingField.value
                .toLocaleLowerCase()
                .includes(rule.value.toLocaleLowerCase())
            : rule.kind === "forbidden-exact-field" &&
              listingField.field === rule.field &&
              listingField.value === rule.value;
        if (matches) {
          knownTranslationErrorEntries.push(
            `${entry?.locale ?? "<missing>"}:${listingField.path} ${rule.kind}`,
          );
        }
      }
    }
    if (listingCsvValues(entry).some(isUnsafeCsvCell)) {
      csvSafetyEntries.push(entry?.locale ?? "<missing>");
    }
    technicalFactAnchorEntries.push(...technicalFactAnchorFailures(entry));
    if (FORBIDDEN_CLAIMS.some((pattern) => pattern.test(text)))
      claimEntries.push(entry?.locale ?? "<missing>");
    if (
      entry?.locale !== "en-US" &&
      entry?.locale !== "en-GB" &&
      (listing?.shortDescription === ENGLISH_FALLBACK.shortDescription ||
        listing?.fullDescription === ENGLISH_FALLBACK.fullDescription ||
        ENGLISH_FALLBACK_MARKERS.filter((marker) => text.includes(marker))
          .length >= 2)
    ) {
      fallbackEntries.push(entry.locale);
    }
    if (entry?.reviewRequired) reviewEntries.push(entry.locale);
  }

  results.push(
    invalidEntries.length === 0
      ? pass(
          "draft listing fields and Store limits",
          "all 80 draft locales have required fields",
        )
      : fail(
          "draft listing fields and Store limits",
          invalidEntries.join(", "),
        ),
  );
  results.push(
    statusEntries.length === 0
      ? pass("review status enum", REVIEW_STATUSES.join(", "))
      : fail("review status enum", statusEntries.join(", ")),
  );
  results.push(
    keywordEntries.length === 0
      ? pass(
          "localized keyword contract",
          "all draft locales have bounded SSH keywords",
        )
      : fail("localized keyword contract", keywordEntries.join(", ")),
  );
  results.push(
    assetEntries.length === 0
      ? pass(
          "asset binding model",
          "all entries use the explicit screenshot binding shape",
        )
      : fail("asset binding model", assetEntries.join(", ")),
  );
  results.push(
    claimEntries.length === 0
      ? pass(
          "unsupported claims",
          "base scan found no publication, paid-offer or telemetry claims",
        )
      : fail("unsupported claims", claimEntries.join(", ")),
  );
  results.push(
    fallbackEntries.length === 0
      ? pass(
          "fallback scan",
          "no non-English locale exactly equals the English description",
        )
      : fail("fallback scan", fallbackEntries.join(", ")),
  );
  results.push(
    reviewEntries.length === EXPECTED_REVIEW_LOCALES.size &&
      setEquals(new Set(reviewEntries), EXPECTED_REVIEW_LOCALES)
      ? pass("mapping review flags", reviewEntries.join(", "))
      : fail("mapping review flags", reviewEntries.join(", ")),
  );
  results.push(
    unicodeEntries.length === 0
      ? pass(
          "Unicode copy hygiene",
          "listing copy is NFC and contains no C0/C1 or bidi override/isolate controls",
        )
      : fail("Unicode copy hygiene", unicodeEntries.join(", ")),
  );
  results.push(
    scriptEntries.length === 0
      ? pass(
          "target script coverage",
          "non-Latin listings contain their expected script outside technical terms",
        )
      : fail("target script coverage", scriptEntries.join(", ")),
  );
  const duplicateParagraphs = findCrossLanguageDuplicateParagraphs(locales);
  results.push(
    duplicateParagraphs.length === 0
      ? pass(
          "cross-locale paragraph uniqueness",
          "no unrelated language shares a normalized short/full paragraph",
        )
      : fail(
          "cross-locale paragraph uniqueness",
          duplicateParagraphs.join("; "),
        ),
  );
  results.push(
    csvSafetyEntries.length === 0
      ? pass(
          "CSV formula-injection safety",
          "exportable listing cells do not start with =, +, -, @, or tab",
        )
      : fail("CSV formula-injection safety", csvSafetyEntries.join(", ")),
  );
  results.push(
    technicalFactAnchorEntries.length === 0
      ? pass(
          "technical fact anchors",
          "all 80 locales retain the stable listing and feature anchors",
        )
      : fail("technical fact anchors", technicalFactAnchorEntries.join(", ")),
  );
  results.push(
    knownTranslationErrorEntries.length === 0
      ? pass(
          "known translation error markers",
          "no recorded translation error markers were found",
        )
      : fail(
          "known translation error markers",
          knownTranslationErrorEntries.join(", "),
        ),
  );
  results.push(
    knownKeywordDefectEntries.length === 0
      ? pass(
          "known keyword defect markers",
          "no recorded truncated keyword fragments were found",
        )
      : fail(
          "known keyword defect markers",
          knownKeywordDefectEntries.join(", "),
        ),
  );

  return results;
}

export function checkMicrosoftStoreSubmissionReadiness(root = repositoryRoot) {
  let manifest;
  try {
    manifest = readManifest(
      resolve(root, "docs/assets/microsoft-store/localization-manifest.json"),
    );
  } catch (error) {
    return [fail("submission manifest", error.message)];
  }
  return checkMicrosoftStoreSubmissionReadinessManifest(manifest, root);
}

export function checkMicrosoftStoreSubmissionReadinessManifest(
  manifest,
  root = repositoryRoot,
) {
  const results = [];
  const draftResults = checkMicrosoftStoreLocalizationManifest(manifest, root);
  const draftFailures = draftResults.filter((result) => !result.passed);
  results.push(
    draftFailures.length === 0
      ? pass("draft validation prerequisite", "structural draft checks pass")
      : fail(
          "draft validation prerequisite",
          draftFailures.map((result) => result.label).join(", "),
        ),
  );

  const locales = Array.isArray(manifest?.locales) ? manifest.locales : [];
  const unreviewed =
    locales.length > 0
      ? locales
          .filter((entry) => !hasNativeReviewProvenance(entry))
          .map((entry) => entry.locale)
      : ["<manifest-locales>"];
  results.push(
    unreviewed.length === 0
      ? pass(
          "native review approval",
          "every locale has native review provenance",
        )
      : fail("native review approval", `unreviewed=${unreviewed.join(",")}`),
  );

  const missingScreenshots =
    locales.length > 0
      ? locales
          .filter((entry) => !hasReviewedScreenshotBinding(entry))
          .map((entry) => entry.locale)
      : ["<manifest-locales>"];
  results.push(
    missingScreenshots.length === 0
      ? pass(
          "screenshot binding",
          "every locale has at least one reviewed screenshot URL",
        )
      : fail("screenshot binding", `missing=${missingScreenshots.join(",")}`),
  );

  results.push(
    typeof manifest?.productSourceCommit === "string" &&
      /^[0-9a-f]{40}$/u.test(manifest.productSourceCommit) &&
      manifest.productSourceCommit === manifest.candidateArtifactSourceCommit
      ? pass(
          "candidate source binding",
          "product source matches the candidate artifact",
        )
      : fail(
          "candidate source binding",
          "productSourceCommit is not bound to the candidate",
        ),
  );
  results.push(
    manifest?.storeLocaleCatalog?.status ===
      "partner-center-export-confirmed" &&
      typeof manifest.storeLocaleCatalog?.confirmedAt === "string" &&
      isValidReviewTimestamp(manifest.storeLocaleCatalog.confirmedAt) &&
      typeof manifest.storeLocaleCatalog?.exportSha256 === "string" &&
      /^[0-9a-f]{64}$/u.test(manifest.storeLocaleCatalog.exportSha256)
      ? pass(
          "Partner Center locale confirmation",
          "Store values have timestamped, checksum-bound export evidence",
        )
      : fail(
          "Partner Center locale confirmation",
          "live options are confirmed, but exact import codes still require timestamped, checksum-bound export evidence",
        ),
  );
  results.push(
    manifest?.submissionStatus === "ready-for-human-submission"
      ? pass("submission status", "ready for final human submission")
      : fail("submission status", `got ${manifest?.submissionStatus}`),
  );

  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const results = checkMicrosoftStoreLocalization();
  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`,
    );
  }
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
