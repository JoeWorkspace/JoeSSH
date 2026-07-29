import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const structuralStyles = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");
const themeStyles = readFileSync(fileURLToPath(new URL("./admin-theme.css", import.meta.url)), "utf8");
const mainSource = readFileSync(fileURLToPath(new URL("./main.tsx", import.meta.url)), "utf8");

function getHexTokenValues(source: string, token: string) {
  const escapedToken = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return Array.from(source.matchAll(new RegExp(`${escapedToken}:\\s*(#[0-9a-f]{6})\\s*;`, "gi")), (match) => match[1]);
}

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received ${hex}.`);
  }

  const [red, green, blue] = channels.map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));

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
    const [lightTertiary, darkTertiary] = getHexTokenValues(themeStyles, "--web-text-tertiary");

    expect(lightTertiary).toBe("#5c7079");
    expect(darkTertiary).toBe("#7a8c97");

    for (const background of ["#ffffff", "#f8fafb", "#f3f6f7"]) {
      expect(contrastRatio(lightTertiary, background), `Light tertiary text on ${background}`).toBeGreaterThanOrEqual(4.5);
    }

    for (const background of ["#17232f", "#111923", "#080d12"]) {
      expect(contrastRatio(darkTertiary, background), `Dark tertiary text on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps light and dark status colors AA-readable", () => {
    const semanticPairs = [
      ["#50636c", "#ffffff"],
      ["#087e66", "#ffffff"],
      ["#197347", "#e4f5ed"],
      ["#96600b", "#fff2d9"],
      ["#b43b44", "#fee9e9"],
      ["#a8b8bf", "#081118"],
      ["#a2b1ba", "#111923"],
      ["#38d6ae", "#111923"],
      ["#7ddd9a", "#17232f"],
      ["#f2bd68", "#17232f"],
      ["#ff9097", "#17232f"],
      ["#9fb0b9", "#05090d"],
    ] as const;

    for (const [foreground, background] of semanticPairs) {
      expect(
        contrastRatio(foreground, background),
        `${foreground} on ${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("makes the read-only and non-ready navigation boundaries explicit", () => {
    expect(mainSource).toContain('className="readOnlyBadge"');
    expect(mainSource).toContain("t.local('web.scope.viewer')");
    expect(mainSource).toContain("'aria-disabled': true as const");
    expect(mainSource).toContain("onClick: (event: React.MouseEvent<HTMLAnchorElement>) => event.preventDefault()");
    expect(themeStyles).toContain('.navItem[aria-disabled="true"]');
  });

  it("renders localized section-level empty states instead of blank panels", () => {
    expect(mainSource).toContain("snapshot.members.length === 0");
    expect(mainSource).toContain("snapshot.roles.length === 0");
    expect(mainSource).toContain("devices.length === 0");
    expect(mainSource).toContain("events.length === 0");
    expect(mainSource).toContain("t.local('web.collection.empty')");
    expect(themeStyles).toContain(".collectionEmpty");
  });

  it("keeps narrow controls readable and preserves native select affordance", () => {
    expect(structuralStyles).toMatch(/\.languagePicker select\s*\{[\s\S]*?appearance:\s*auto\s*;/);
    expect(themeStyles).toMatch(/@media \(max-width: 520px\)[\s\S]*?\.telemetryToggle\s*\{[\s\S]*?white-space:\s*normal\s*;/);
    expect(themeStyles).toMatch(/\.telemetryToggle span\s*\{[\s\S]*?overflow-wrap:\s*anywhere\s*;/);
  });

  it("allows long data panels to paginate while keeping print rows intact", () => {
    expect(themeStyles).toMatch(/@media print[\s\S]*?\.dashboardGrid,\s*\.panel\s*\{[\s\S]*?break-inside:\s*auto\s*;/);
    expect(themeStyles).toMatch(/@media print[\s\S]*?\.memberTable \.row:not\(\.headerRow\),[\s\S]*?\.eventList li\s*\{[\s\S]*?break-inside:\s*avoid\s*;/);
  });

  it("describes telemetry consent with the full privacy boundary", () => {
    expect(mainSource).toContain("aria-describedby={telemetryDescriptionId}");
    expect(mainSource).toContain("t.shared('desktop.telemetryPrivacyHint')");
    expect(mainSource).toContain("t.shared('web.telemetryUnavailable')");
  });
});
