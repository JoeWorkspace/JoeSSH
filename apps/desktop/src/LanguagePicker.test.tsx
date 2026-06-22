// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguagePicker } from "./LanguagePicker";

const t = ((key: string) => key) as any;

afterEach(() => {
  cleanup();
});

describe("LanguagePicker", () => {
  it("renders a select with auto option", () => {
    render(<LanguagePicker currentLocale="en" languageChoice="auto" onLanguageChoiceChange={vi.fn()} t={t} />);
    expect(screen.getByRole("combobox")).toBeTruthy();
    expect(screen.getByText("language.autoRegion")).toBeTruthy();
  });

  it("renders all supported locale options", () => {
    render(<LanguagePicker currentLocale="en" languageChoice="auto" onLanguageChoiceChange={vi.fn()} t={t} />);
    const options = screen.getAllByRole("option");
    // auto + all supported locales
    expect(options.length).toBeGreaterThan(1);
  });

  it("calls onLanguageChoiceChange when selecting a locale", () => {
    const onChange = vi.fn();
    render(<LanguagePicker currentLocale="en" languageChoice="auto" onLanguageChoiceChange={onChange} t={t} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ja" } });
    expect(onChange).toHaveBeenCalledWith("ja");
  });

  it("displays the current locale English name", () => {
    render(<LanguagePicker currentLocale="en" languageChoice="en" onLanguageChoiceChange={vi.fn()} t={t} />);
    const matches = screen.getAllByText(/English/);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("shows label text", () => {
    render(<LanguagePicker currentLocale="zh-CN" languageChoice="auto" onLanguageChoiceChange={vi.fn()} t={t} />);
    expect(screen.getByText("language.selectorLabel")).toBeTruthy();
  });

  it("sets the select value to languageChoice", () => {
    render(<LanguagePicker currentLocale="en" languageChoice="ja" onLanguageChoiceChange={vi.fn()} t={t} />);
    expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("ja");
  });
});
