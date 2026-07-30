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

function blendOverWhite(foreground: string, alpha: number): string {
  const channels = foreground
    .replace("#", "")
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16));
  if (!channels || channels.length !== 3)
    throw new Error(`Invalid color ${foreground}`);

  return `#${channels
    .map((channel) =>
      Math.round(channel * alpha + 255 * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
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

  it("keeps every light semantic badge and danger action AA-readable", () => {
    const lightSemanticColors = [
      ["#245bc7", 0.12],
      ["#8a5707", 0.12],
      ["#ad2635", 0.2],
      ["#6849bf", 0.13],
      ["#197347", 0.12],
    ] as const;

    for (const [foreground, alpha] of lightSemanticColors) {
      expect(
        contrastRatio(foreground, blendOverWhite(foreground, alpha)),
        `${foreground} on its light semantic surface`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    expect(styles).toContain(
      ':root:not([data-theme="dark"]) .ui-button--danger',
    );
    expect(styles).toContain(
      ':root:not([data-theme="dark"]) .ui-badge--premium',
    );
    expect(styles).toContain('[data-theme="light"] .ui-button--danger');
    expect(styles).toContain('[data-theme="light"] .ui-badge--premium');
  });

  it("does not force horizontal overflow at the 320px viewport boundary", () => {
    const body = selectorBlock("body");
    expect(body).toContain("min-width: 0;");
  });

  it("keeps keyboard focus visible when forced colors suppress shadows", () => {
    const buttonFocus = selectorBlock(".ui-button:focus-visible");

    expect(buttonFocus).toContain("outline: 2px solid var(--atlas-accent);");
    expect(buttonFocus).not.toMatch(/outline:\s*0\s*;/);
    expect(styles).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.ui-button:focus-visible,[\s\S]*?outline:\s*2px solid Highlight\s*;/,
    );
  });
});
