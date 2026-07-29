import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const structuralStyles = readFileSync(
  fileURLToPath(new URL("./styles.css", import.meta.url)),
  "utf8",
);
const themeStyles = readFileSync(
  fileURLToPath(new URL("./admin-theme.css", import.meta.url)),
  "utf8",
);

function getHexTokenValues(source: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return Array.from(
    source.matchAll(
      new RegExp(`${escapedToken}:\\s*(#[0-9a-f]{6})\\s*;`, "gi"),
    ),
    (match) => match[1],
  );
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}.`);
  }

  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

describe("Web Admin production UI contracts", () => {
  it("allows a 320px window to shrink inside a classic scrollbar viewport", () => {
    const bodyRule = structuralStyles.match(/body\s*\{([\s\S]*?)\}/)?.[1];

    expect(bodyRule).toBeDefined();
    expect(bodyRule).toMatch(/min-width:\s*0\s*;/);
    expect(bodyRule).not.toMatch(/min-width:\s*320px\s*;/);
  });

  it("keeps tertiary text AA-readable on every production theme surface", () => {
    const [lightTertiary, darkTertiary] = getHexTokenValues(
      themeStyles,
      "--web-text-tertiary",
    );

    expect(lightTertiary).toBe("#5c7079");
    expect(darkTertiary).toBe("#7a8c97");

    for (const background of ["#ffffff", "#f8fafb", "#f3f6f7"]) {
      expect(
        contrastRatio(lightTertiary, background),
        `Light tertiary text on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }

    for (const background of ["#17232f", "#111923", "#080d12"]) {
      expect(
        contrastRatio(darkTertiary, background),
        `Dark tertiary text on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
