import { describe, expect, it } from "vitest";

import { mobileThemes } from "../theme";

describe("mobile theme accessibility", () => {
  it.each([
    {
      background: mobileThemes.light.selectedOptionBackground,
      foreground: mobileThemes.light.selectedOptionMutedText,
      name: "light selected language metadata",
    },
    {
      background: mobileThemes.light.accentStrong,
      foreground: mobileThemes.light.selectedOptionMutedText,
      name: "light pressed selected language metadata",
    },
    {
      background: mobileThemes.dark.selectedOptionBackground,
      foreground: mobileThemes.dark.selectedOptionMutedText,
      name: "dark selected language metadata",
    },
    {
      background: mobileThemes.dark.accentStrong,
      foreground: mobileThemes.dark.selectedOptionMutedText,
      name: "dark pressed selected language metadata",
    },
    {
      background: mobileThemes.light.liveBadgeBackground,
      foreground: mobileThemes.light.liveBadgeText,
      name: "light live badge",
    },
    {
      background: mobileThemes.light.offlineBadgeBackground,
      foreground: mobileThemes.light.offlineBadgeText,
      name: "light offline badge",
    },
    {
      background: mobileThemes.dark.liveBadgeBackground,
      foreground: mobileThemes.dark.liveBadgeText,
      name: "dark live badge",
    },
    {
      background: mobileThemes.dark.offlineBadgeBackground,
      foreground: mobileThemes.dark.offlineBadgeText,
      name: "dark offline badge",
    },
    {
      background: mobileThemes.light.primaryButtonBackground,
      foreground: mobileThemes.light.primaryButtonText,
      name: "light primary action",
    },
    {
      background: mobileThemes.dark.primaryButtonBackground,
      foreground: mobileThemes.dark.primaryButtonText,
      name: "dark primary action",
    },
    {
      background: mobileThemes.light.warningBackground,
      foreground: mobileThemes.light.warningText,
      name: "light warning",
    },
    {
      background: mobileThemes.dark.warningBackground,
      foreground: mobileThemes.dark.warningText,
      name: "dark warning",
    },
    {
      background: mobileThemes.light.errorBackground,
      foreground: mobileThemes.light.errorText,
      name: "light error",
    },
    {
      background: mobileThemes.dark.errorBackground,
      foreground: mobileThemes.dark.errorText,
      name: "dark error",
    },
    {
      background: mobileThemes.light.panelBackground,
      foreground: mobileThemes.light.faintText,
      name: "light faint status copy",
    },
    {
      background: mobileThemes.dark.panelBackground,
      foreground: mobileThemes.dark.faintText,
      name: "dark faint status copy",
    },
  ])("keeps $name at WCAG AA contrast", ({ background, foreground }) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });
});

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: string) {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255;

    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
