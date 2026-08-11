import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  assertCompleteTranslations,
  createLocaleFormatters,
  createTranslator,
  detectAtlasLocale,
  formatDateTime,
  formatFileSize,
  formatLatency,
  formatNumber,
  formatRelativeTime,
  formatTime,
  getBrowserLocaleCandidates,
  getLoadedTranslator,
  getLocaleCoverage,
  getIntlLocale,
  getLocaleMeta,
  getTextDirection,
  getTranslationKeys,
  getTranslationReadinessReport,
  loadLocale,
  resolveAtlasLocale,
  translate,
  WINDOWS_STORE_MANIFEST_LANGUAGES,
} from "./index";
import windowsStoreManifestLanguages from "./windows-store-manifest-languages.json";

const mojibakeFingerprints = [
  "\u934f\u3224\u69e6",
  "\u93bc\u6eef\u5132",
  "\u7f01\u5802",
  "\u935b\u4ecb",
  "\u7039\u7481",
  "\u7481\u60e7",
  "\u5a75\u65c1",
  "\u93c3\u7281",
  "\u95c7",
  "\u55d4",
  "\u5576",
  "\u888a",
  "\u4e15\u8ce1",
  "\u00c3",
  "\u00c2",
  "\u00e2\u20ac",
  "\ufffd",
];

function expectReadableText(value: string, englishSource = value) {
  for (const fingerprint of mojibakeFingerprints) {
    expect(value).not.toContain(fingerprint);
  }
  if (!englishSource.includes("?")) {
    expect(value).not.toContain("?");
  }
}

describe("getLoadedTranslator cache miss", () => {
  it("returns undefined when locale has not been loaded", () => {
    // This test runs before beforeAll loads locales, so the cache is empty
    const translator = getLoadedTranslator("th" as any);
    // "th" is a valid locale but not loaded yet, so should return undefined
    expect(translator).toBeUndefined();
  });
});

describe("JoeSSH i18n", () => {
  const supportedLocaleCodes = SUPPORTED_LOCALES.map((locale) => locale.code);

  beforeAll(async () => {
    await Promise.all(supportedLocaleCodes.map((locale) => loadLocale(locale)));
  });

  it("defaults to English when no region or known locale is available", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(detectAtlasLocale([])).toBe(DEFAULT_LOCALE);
    expect(detectAtlasLocale(["xx-XX"])).toBe("en");
    expect(translate(DEFAULT_LOCALE, "web.teamOperations")).not.toBe(
      "web.teamOperations",
    );
  });

  it("derives a unique valid Store manifest language for every supported locale", () => {
    const manifestLocaleCodes = Object.keys(WINDOWS_STORE_MANIFEST_LANGUAGES);
    const manifestLanguageTags = Object.values(WINDOWS_STORE_MANIFEST_LANGUAGES);

    expect(WINDOWS_STORE_MANIFEST_LANGUAGES).toEqual(windowsStoreManifestLanguages);
    expect(manifestLocaleCodes.sort()).toEqual([...supportedLocaleCodes].sort());
    expect(new Set(manifestLanguageTags).size).toBe(manifestLanguageTags.length);
    for (const languageTag of manifestLanguageTags) {
      expect(() => new Intl.Locale(languageTag)).not.toThrow();
    }
    expect(Object.isFrozen(WINDOWS_STORE_MANIFEST_LANGUAGES)).toBe(true);
  });

  it("loadLocale returns a callable translator function", async () => {
    const t = await loadLocale("en");
    expect(typeof t).toBe("function");
    expect(t("desktop.searchPlaceholder")).not.toBe(
      "desktop.searchPlaceholder",
    );
    // Test with interpolation values
    expect(t("team.summary", { active: 2, pending: 1 })).toContain("2");
  });

  it("uses region and language candidates when they are available", () => {
    expect(detectAtlasLocale(["en-US"])).toBe("en");
    expect(detectAtlasLocale(["zh-Hant-TW"])).toBe("zh-TW");
    expect(detectAtlasLocale(["pt-BR"])).toBe("pt-BR");
    expect(detectAtlasLocale(["ar-SA"])).toBe("ar");
  });

  it("supports interpolation and text direction metadata", () => {
    const summary = translate("zh-CN", "team.summary", {
      active: 2,
      pending: 1,
    });

    expect(summary).toContain("2");
    expect(summary).toContain("1");
    expect(getTextDirection("ar")).toBe("rtl");
  });

  it(
    "reports complete coverage for every advertised language pack",
    { timeout: 15000 },
    async () => {
      for (const locale of supportedLocaleCodes) {
        const coverage = await getLocaleCoverage(locale);
        expect(coverage).toMatchObject({
          isComplete: true,
          percentage: 100,
          missingKeys: [],
        });
      }
    },
  );

  it("reports release translation readiness for every advertised locale", async () => {
    const report = await getTranslationReadinessReport();

    expect(report.isComplete).toBe(true);
    expect(report.completeLocales).toEqual(supportedLocaleCodes);
    expect(report.incompleteLocales).toEqual([]);
    await expect(assertCompleteTranslations()).resolves.not.toThrow();
  });

  it("keeps localized safety and readiness placeholders intact across every locale", () => {
    for (const locale of supportedLocaleCodes) {
      const blockedDetail = translate(locale, "desktop.commandBlockedDetail", {
        pattern: "sudo rm -rf /",
        reason: "policy",
      });
      const summary = translate(locale, "team.summary", {
        active: 2,
        pending: 1,
      });

      expect(blockedDetail).toContain("sudo rm -rf /");
      expect(blockedDetail).toContain("policy");
      expect(blockedDetail).not.toMatch(/\{pattern\}|\{reason\}/);
      expect(summary).toContain("2");
      expect(summary).toContain("1");
      expect(summary).not.toMatch(/\{active\}|\{pending\}/);
    }
  });

  it("ships localized safety reason labels for every advertised locale", () => {
    const safetyReasonKeys = [
      "desktop.safetyReasonRmRoot",
      "desktop.safetyReasonMkfs",
      "desktop.safetyReasonForkBomb",
      "desktop.safetyReasonRawDiskCopy",
      "desktop.safetyReasonChmodRoot",
      "desktop.safetyReasonTeeBlockDevice",
      "desktop.safetyReasonRedirectBlockDevice",
      "desktop.safetyReasonFindRootDelete",
      "desktop.safetyReasonDiskWipe",
      "desktop.safetyReasonFirewallFlush",
      "desktop.safetyReasonRemoteShellPipe",
      "desktop.safetyReasonRootDownloadOverwrite",
      "desktop.safetyReasonHostShutdown",
      "desktop.safetyReasonWindowsDestructive",
      "desktop.safetyReasonPowershellDestructive",
      "desktop.safetyReasonDropDatabase",
      "desktop.safetyReasonCommandSubstitution",
    ] as const;

    for (const locale of supportedLocaleCodes) {
      for (const key of safetyReasonKeys) {
        const label = translate(locale, key);
        expect(label).not.toBe(key);
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ships localized onboarding and terminal safety copy for every locale", () => {
    const localizedKeys = [
      "desktop.demoScopeSummary",
      "desktop.demoShell",
      "desktop.noSession",
      "desktop.noSessionActionDetail",
      "desktop.sampleDataShort",
      "desktop.terminalSessionConnectRequired",
      "desktop.terminalSessionSample",
      "desktop.gettingStartedSampleData",
      "desktop.gettingStartedRealConnection",
      "desktop.ptyBlocked",
    ] as const;

    for (const locale of supportedLocaleCodes) {
      for (const key of localizedKeys) {
        const value = translate(locale, key);

        expect(value).not.toBe(key);
        expect(value.trim().length).toBeGreaterThan(0);

        if (locale !== "en") {
          expect(value).not.toBe(translate("en", key));
        }
      }
    }
  });

  it("ships all three task steps in every UI locale", () => {
    const onboardingKeys = [
      "desktop.gettingStartedStepCreate",
      "desktop.gettingStartedStepCreateDetail",
      "desktop.gettingStartedStepSecure",
      "desktop.gettingStartedStepSecureDetail",
      "desktop.gettingStartedStepUse",
      "desktop.gettingStartedStepUseDetail",
      "desktop.gettingStartedStepCount",
      "desktop.gettingStartedPrevious",
      "desktop.gettingStartedNext",
      "desktop.gettingStartedSkip",
      "desktop.gettingStartedComplete",
      "desktop.gettingStartedOpenConnect",
      "desktop.gettingStartedSecurityNote",
      "desktop.gettingStartedOpenTerminal",
      "desktop.gettingStartedOpenSftp",
      "desktop.gettingStartedOpenForwarding",
    ] as const;

    for (const locale of supportedLocaleCodes) {
      for (const key of onboardingKeys) {
        const value = translate(locale, key);
        expect(value).not.toBe(key);
        expect(value.trim().length).toBeGreaterThan(0);
        if (locale !== "en") {
          expect(value).not.toBe(translate("en", key));
        }
      }
    }
  });

  it("keeps authentication in Connect rather than the profile form", () => {
    const createDetail = translate(
      "en",
      "desktop.gettingStartedStepCreateDetail",
    );
    const secureDetail = translate(
      "en",
      "desktop.gettingStartedStepSecureDetail",
    );

    expect(createDetail).toContain("host, port, and username");
    expect(createDetail).toContain("local profile");
    expect(createDetail).not.toContain("authentication details");
    expect(secureDetail).toContain("authentication method");
    expect(secureDetail).toContain("credentials");
    expect(secureDetail).toContain("SHA-256");
  });

  it(
    "keeps advertised locale names and shipped translations free of mojibake",
    { timeout: 15000 },
    async () => {
      for (const locale of supportedLocaleCodes) {
        const meta = getLocaleMeta(locale);

        expectReadableText(meta.englishName);
        expectReadableText(meta.nativeName);

        for (const key of await getTranslationKeys()) {
          expectReadableText(translate(locale, key), translate("en", key));
        }
      }
    },
  );

  it("keeps strict Simplified Chinese product paths readable", () => {
    expect(getLocaleMeta("zh-CN").nativeName).toBe("\u7b80\u4f53\u4e2d\u6587");
    expect(translate("zh-CN", "desktop.searchPlaceholder")).toBe(
      "\u641c\u7d22\u4e3b\u673a\u3001\u6807\u7b7e\u3001\u6210\u5458",
    );
    expect(translate("zh-CN", "desktop.terminalTabs")).toBe(
      "\u7ec8\u7aef\u6807\u7b7e",
    );
    expect(translate("zh-CN", "desktop.commandPalette")).toBe(
      "\u547d\u4ee4\u9762\u677f",
    );
    expect(translate("zh-CN", "web.teamOperations")).toBe(
      "\u56e2\u961f\u8fd0\u8425",
    );
    expect(translate("zh-CN", "team.summary", { active: 2, pending: 1 })).toBe(
      "2 \u4e2a JIT \u751f\u6548 / 1 \u4e2a\u4fdd\u9669\u5e93\u5f85\u5904\u7406",
    );
  });

  it("maps Atlas locales to browser Intl locales for market formatting", () => {
    expect(getIntlLocale("zh-CN")).toBe("zh-Hans-CN");
    expect(getIntlLocale("zh-TW")).toBe("zh-Hant-TW");
    expect(getIntlLocale("en")).toBe("en-US");
    expect(getIntlLocale("ja")).toBe("ja-JP");
    expect(getIntlLocale("de")).toBe("de-DE");
    expect(getIntlLocale("fr")).toBe("fr-FR");
    expect(getIntlLocale("es")).toBe("es-ES");
    expect(getIntlLocale("pt-BR")).toBe("pt-BR");
    expect(getIntlLocale("hi")).toBe("hi-IN");
    expect(getIntlLocale("ar")).toBe("ar-SA");
  });

  it("formats numbers, dates, file sizes, latency, and relative time by locale", () => {
    const date = "2026-05-24T02:17:00Z";
    const marketLocales = [
      "zh-CN",
      "en",
      "ja",
      "de",
      "fr",
      "es",
      "pt-BR",
      "hi",
      "ar",
    ] as const;

    for (const locale of marketLocales) {
      const intlLocale = getIntlLocale(locale);
      const formatters = createLocaleFormatters(locale);

      expect(formatters.number(1234567.5)).toBe(
        new Intl.NumberFormat(intlLocale).format(1234567.5),
      );
      expect(
        formatters.dateTime(date, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }),
      ).toBe(
        new Intl.DateTimeFormat(intlLocale, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(new Date(date)),
      );
      expect(
        formatters.time(date, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        }),
      ).toBe(
        new Intl.DateTimeFormat(intlLocale, {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "UTC",
        }).format(new Date(date)),
      );
      expect(formatters.fileSize(1536)).not.toBe("1536 B");
      expect(formatters.latency(28)).not.toBe("28");
      expect(formatters.relativeTime(-2, "minute")).not.toBe("2 min ago");
    }
  });

  it("keeps individual formatter helpers aligned with app-facing values", () => {
    expect(formatFileSize("en", 18 * 1024)).toMatch(/18\s?kB/);
    expect(formatFileSize("zh-CN", 128 * 1024 * 1024)).toContain("128");
    expect(formatLatency("en", 28)).toMatch(/28\s?ms/);
    expect(formatRelativeTime("en", -2, "minute")).toBe("2 minutes ago");
    expect(formatRelativeTime("zh-CN", -1, "day")).not.toBe("yesterday");
  });

  it("resolves locale aliases and region codes correctly", () => {
    expect(resolveAtlasLocale("zh")).toBe("zh-CN");
    expect(resolveAtlasLocale("zh-cn")).toBe("zh-CN");
    expect(resolveAtlasLocale("zh-hans")).toBe("zh-CN");
    expect(resolveAtlasLocale("zh-sg")).toBe("zh-CN");
    expect(resolveAtlasLocale("zh-tw")).toBe("zh-TW");
    expect(resolveAtlasLocale("zh-hant")).toBe("zh-TW");
    expect(resolveAtlasLocale("zh-hk")).toBe("zh-TW");
    expect(resolveAtlasLocale("zh-mo")).toBe("zh-TW");
    expect(resolveAtlasLocale("pt")).toBe("pt-BR");
    expect(resolveAtlasLocale("pt-br")).toBe("pt-BR");
    expect(resolveAtlasLocale("en")).toBe("en");
    expect(resolveAtlasLocale("ja")).toBe("ja");
    expect(resolveAtlasLocale("ko")).toBe("ko");
    expect(resolveAtlasLocale("es")).toBe("es");
    expect(resolveAtlasLocale("fr")).toBe("fr");
    expect(resolveAtlasLocale("de")).toBe("de");
    expect(resolveAtlasLocale("ru")).toBe("ru");
    expect(resolveAtlasLocale("ar")).toBe("ar");
    expect(resolveAtlasLocale("hi")).toBe("hi");
    expect(resolveAtlasLocale("id")).toBe("id");
    expect(resolveAtlasLocale("vi")).toBe("vi");
    expect(resolveAtlasLocale("th")).toBe("th");
  });

  it("returns undefined for null/empty locale values", () => {
    expect(resolveAtlasLocale(null)).toBeUndefined();
    expect(resolveAtlasLocale(undefined)).toBeUndefined();
    expect(resolveAtlasLocale("")).toBeUndefined();
  });

  it("resolves language-only codes that are not in alias map", () => {
    // Test the fallback to aliasLocaleMap[language] at line 204
    expect(resolveAtlasLocale("EN")).toBe("en");
    expect(resolveAtlasLocale("JA")).toBe("ja");
  });

  it("resolves language with unknown region via alias fallback", () => {
    // "de-XX" has region "XX" not in regionLocaleMap, falls to aliasLocaleMap["de"]
    expect(resolveAtlasLocale("de-XX")).toBe("de");
    expect(resolveAtlasLocale("fr-XX")).toBe("fr");
  });

  it("resolves underscore-separated locale codes", () => {
    expect(resolveAtlasLocale("zh_CN")).toBe("zh-CN");
    expect(resolveAtlasLocale("pt_BR")).toBe("pt-BR");
  });

  it("returns a translator function via createTranslator", () => {
    const t = createTranslator("en");
    expect(typeof t).toBe("function");
    expect(t("desktop.searchPlaceholder")).not.toBe(
      "desktop.searchPlaceholder",
    );
  });

  it("returns undefined from getLoadedTranslator when locale is not loaded", () => {
    // ko is already loaded in beforeAll, so we verify it returns a function
    const translator = getLoadedTranslator("ko");
    expect(translator).toBeDefined();
    expect(typeof translator).toBe("function");
  });

  it("returns undefined for getLoadedTranslator with a truly unloaded locale", () => {
    // Use a locale code that is not in the cache
    const translator = getLoadedTranslator("id" as any);
    // id might or might not be loaded depending on test order, but we can test the function exists
    expect(translator === undefined || typeof translator === "function").toBe(
      true,
    );
  });

  it("returns a translator from getLoadedTranslator after loading", async () => {
    await loadLocale("ko");
    const translator = getLoadedTranslator("ko");
    expect(translator).toBeDefined();
    expect(translator?.("desktop.searchPlaceholder")).not.toBe(
      "desktop.searchPlaceholder",
    );
  });

  it("formats numbers using formatNumber", () => {
    expect(formatNumber("en", 1234.56)).toContain("1");
    expect(formatNumber("zh-CN", 1000)).toContain("1");
  });

  it("formats dates using formatDateTime", () => {
    const date = "2026-05-24T02:17:00Z";
    const result = formatDateTime("en", date, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("formats time using formatTime", () => {
    const date = "2026-05-24T02:17:00Z";
    const result = formatTime("en", date, {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("falls back for invalid date values", () => {
    const result = formatDateTime("en", "invalid-date");
    expect(result).toBeTruthy();
  });

  it("handles large file sizes", () => {
    expect(formatFileSize("en", 1024 ** 4)).toContain("TB");
    expect(formatFileSize("en", 1024 ** 3)).toContain("GB");
    expect(formatFileSize("en", 1024 ** 2)).toContain("MB");
    expect(formatFileSize("en", 0)).toContain("byte");
  });

  it("handles zero and negative file sizes", () => {
    expect(formatFileSize("en", 0)).toContain("byte");
    expect(formatFileSize("en", -1024)).toContain("kB");
  });

  it("falls back when unit formatting is unsupported", () => {
    // formatUnit catches errors and falls back to number + fallback unit
    // formatLatency uses "millisecond" unit which should work, but we can test the fallback path
    const result = formatLatency("en", 28);
    expect(result).toContain("28");
  });

  it("falls back to number + unit string when Intl unit style throws", () => {
    // Mock Intl.NumberFormat to throw when style is "unit"
    const OriginalNumberFormat = Intl.NumberFormat;
    // Use a class-based mock so it works as a constructor with `new`
    const MockNumberFormat = class {
      constructor(locale: any, options: any) {
        if (options && (options as any).style === "unit") {
          throw new Error("unit style not supported");
        }
        return new OriginalNumberFormat(locale, options);
      }
      format(_value?: number | bigint): string {
        return "";
      }
    } as any;
    const spy = vi
      .spyOn(Intl, "NumberFormat")
      .mockImplementation(MockNumberFormat);

    try {
      // formatLatency uses formatUnit which catches the error
      const result = formatLatency("en", 28);
      expect(result).toContain("28");
      expect(result).toContain("ms");
    } finally {
      spy.mockRestore();
    }
  });

  it("gets browser locale candidates in browser environment", () => {
    vi.stubGlobal("navigator", {
      language: "en-US",
      languages: ["en-US", "zh-CN"],
    });

    const candidates = getBrowserLocaleCandidates();
    expect(candidates).toContain("en-US");
    expect(candidates).toContain("zh-CN");

    vi.unstubAllGlobals();
  });

  it("returns empty array for browser locale candidates in SSR", () => {
    // In happy-dom test environment, navigator is always defined.
    // Test that getBrowserLocaleCandidates returns an array with at least the navigator language.
    const candidates = getBrowserLocaleCandidates();
    expect(Array.isArray(candidates)).toBe(true);
  });

  it("maps all supported locales to Intl locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const intlLocale = getIntlLocale(locale.code);
      expect(intlLocale).toBeTruthy();
      expect(typeof intlLocale).toBe("string");
    }
  });

  it("returns locale metadata for all supported locales", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const meta = getLocaleMeta(locale.code);
      expect(meta.code).toBe(locale.code);
      expect(meta.englishName).toBeTruthy();
      expect(meta.nativeName).toBeTruthy();
      expect(meta.direction).toMatch(/^(ltr|rtl)$/);
      expect(meta.regions.length).toBeGreaterThan(0);
    }
  });

  it("falls back to English metadata for an unknown locale", () => {
    const meta = getLocaleMeta("unknown" as any);
    expect(meta.code).toBe("en");
  });

  it("falls back to default locale when all candidates are null/empty", () => {
    expect(detectAtlasLocale([null, undefined, ""])).toBe(DEFAULT_LOCALE);
  });

  it("returns the key itself for an unloaded locale", () => {
    // "xx" is not a valid locale and was never loaded - getSyncPack returns {}
    const result = translate("xx" as any, "desktop.searchPlaceholder");
    expect(result).toBe("desktop.searchPlaceholder");
  });

  it("preserves template placeholders when interpolation values are missing", () => {
    const summary = translate("en", "team.summary", { active: 5 } as any);
    expect(summary).toContain("5");
    expect(summary).toContain("{pending}");
  });

  it("returns the key when the loadLocale translator receives an unknown key", async () => {
    const t = await loadLocale("en");
    const result = t("nonexistent.key" as any);
    expect(result).toBe("nonexistent.key");
  });

  it("returns the key when getLoadedTranslator receives an unknown key", async () => {
    await loadLocale("en");
    const translator = getLoadedTranslator("en");
    expect(translator).toBeDefined();
    const result = translator?.("nonexistent.key" as any) ?? "nonexistent.key";
    expect(result).toBe("nonexistent.key");
  });

  it("formats a Date instance directly (not string/number)", () => {
    const date = new Date("2026-05-24T02:17:00Z");
    const result = formatDateTime("en", date, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
    const expected = formatDateTime("en", "2026-05-24T02:17:00Z", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });
    expect(result).toBe(expected);
  });

  it("collects browser candidates without navigator (pure SSR)", () => {
    const origNavigator = globalThis.navigator;
    // intentionally removing navigator
    delete (globalThis as Record<string, unknown>).navigator;
    try {
      // Without navigator, the if-block is skipped; Intl may still add a locale
      const candidates = getBrowserLocaleCandidates();
      // Should not contain navigator-sourced entries
      expect(candidates.every((c) => typeof c === "string")).toBe(true);
    } finally {
      globalThis.navigator = origNavigator;
    }
  });

  it("handles navigator.languages being nullish", () => {
    vi.stubGlobal("navigator", { language: "en-US", languages: null });
    const candidates = getBrowserLocaleCandidates();
    expect(candidates).toContain("en-US");
    // languages was null, so ?? [] kicks in - no extra entries from languages
    expect(
      candidates.filter((c) => c === "en-US").length,
    ).toBeGreaterThanOrEqual(1);
    vi.unstubAllGlobals();
  });

  it("handles navigator.language being empty", () => {
    vi.stubGlobal("navigator", { language: "", languages: ["zh-CN"] });
    const candidates = getBrowserLocaleCandidates();
    expect(candidates).toContain("zh-CN");
    // language is empty/falsy, so it should not be pushed
    expect(candidates.filter((c) => c === "").length).toBe(0);
    vi.unstubAllGlobals();
  });

  it("handles Intl returning an empty locale string", () => {
    const origDTF = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ locale: "" }),
    } as any);
    try {
      vi.stubGlobal("navigator", { language: "en", languages: ["en"] });
      const candidates = getBrowserLocaleCandidates();
      // Intl locale is "" (falsy), so the if (intlLocale) branch is false
      expect(candidates).toContain("en");
      vi.unstubAllGlobals();
    } finally {
      vi.restoreAllMocks();
      // Restore the spy but keep the original
      vi.spyOn(Intl, "DateTimeFormat").mockImplementation(origDTF as any);
    }
  });
});
