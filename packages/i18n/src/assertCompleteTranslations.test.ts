// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

vi.mock("./locales/ja", () => ({
  ja: { "desktop.searchPlaceholder": "Search" },
}));

import { assertCompleteTranslations } from "./index";

describe("assertCompleteTranslations error path", () => {
  it("throws when translations are incomplete", async () => {
    await expect(assertCompleteTranslations(["ja"])).rejects.toThrow(
      /Incomplete JoeSSH translations/,
    );
  });

  it("includes the incomplete locale in the error message", async () => {
    await expect(assertCompleteTranslations(["ja"])).rejects.toThrow(/ja:/);
  });

  it("resolves without error when all requested locales are complete", async () => {
    await expect(assertCompleteTranslations(["en"])).resolves.not.toThrow();
  });
});
