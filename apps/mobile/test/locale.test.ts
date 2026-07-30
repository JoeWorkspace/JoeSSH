import { describe, expect, it, vi } from "vitest";

import { applyWebDocumentLanguage } from "../services/documentLanguage";

describe("mobile web document language", () => {
  it("applies the active locale and restores the previous language", () => {
    let language: string | null = "en";
    const documentElement = {
      getAttribute: vi.fn(() => language),
      removeAttribute: vi.fn(() => {
        language = null;
      }),
      setAttribute: vi.fn((_name: string, value: string) => {
        language = value;
      }),
    };

    const restore = applyWebDocumentLanguage("ar", documentElement);

    expect(language).toBe("ar");
    restore();
    expect(language).toBe("en");
  });

  it("is safe when a native runtime has no document", () => {
    expect(() => applyWebDocumentLanguage("en", undefined)).not.toThrow();
  });
});
