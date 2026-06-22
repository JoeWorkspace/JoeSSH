import { describe, expect, it } from "vitest";
import { assertCompleteTranslations, getTranslationReadinessReport } from "./index";

describe("JoeSSH i18n release gate", () => {
  it("blocks release builds while advertised locales still depend on fallback keys", async () => {
    const report = await getTranslationReadinessReport();
    const missingSummary = report.incompleteLocales.map((localeReport) => ({
      locale: localeReport.locale,
      missing: localeReport.missingKeys.slice(0, 8),
      missingCount: localeReport.missingKeys.length,
    }));

    expect(missingSummary).toEqual([]);
    await expect(assertCompleteTranslations()).resolves.not.toThrow();
  });
});
