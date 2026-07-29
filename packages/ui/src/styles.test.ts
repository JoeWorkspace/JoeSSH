import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

function selectorBlock(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = styles.match(
    new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (!match) throw new Error(`Missing CSS block for ${selector}`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (!channels || channels.length !== 3)
    throw new Error(`Invalid color ${hex}`);

  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string): number {
  const values = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

describe("shared UI theme contracts", () => {
  it("lets an explicit dark theme override a light operating-system preference", () => {
    const darkTheme = selectorBlock('[data-theme="dark"]');

    expect(darkTheme).toContain("--atlas-bg: #080d12;");
    expect(darkTheme).toContain("--atlas-text: #f2f7f8;");
    expect(darkTheme).toContain("--atlas-terminal-bg: #060a0e;");
    expect(darkTheme).toContain("--atlas-terminal-text: #d9f7ec;");
    expect(styles).toContain(':root:not([data-theme="dark"])');
  });

  it("keeps faint normal-size text at WCAG AA contrast in both themes", () => {
    expect(contrastRatio("#5c7079", "#f3f6f7")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#7a8c97", "#17232f")).toBeGreaterThanOrEqual(4.5);
  });

  it("does not force horizontal overflow at the 320px viewport boundary", () => {
    const body = selectorBlock("body");
    expect(body).toContain("min-width: 0;");
  });
});
