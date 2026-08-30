import { describe, expect, it } from "vitest";

describe("mobile entry telemetry policy", () => {
  it("keeps telemetry default-off and versioned for Public Beta", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const layoutPath = path.resolve(__dirname, "../app/_layout.tsx");
    const homePath = path.resolve(__dirname, "../app/index.tsx");
    const localeContextPath = path.resolve(
      __dirname,
      "../services/localeContext.tsx",
    );
    const content = fs.readFileSync(layoutPath, "utf-8");
    const homeContent = fs.readFileSync(homePath, "utf-8");
    const localeContextContent = fs.readFileSync(localeContextPath, "utf-8");

    expect(content).toContain("EXPO_PUBLIC_ATLASTERM_TELEMETRY_OPT_IN");
    expect(content).toContain("isTelemetryOptedIn");
    expect(content).toMatch(
      /messageLabel=\{t\(["']mobile\.error\.boundary\.message["']\)\}/,
    );
    expect(content).not.toContain("this.state.error.message");
    expect(content).toContain("0.1.0-beta.23");
    expect(content).not.toContain("version: '0.1.0'");
    expect(content).not.toContain('version: "0.1.0"');
    expect(content).toContain("<MobileLocaleProvider>");
    expect(localeContextContent).toContain("getStoredMobileLocaleMode");
    expect(content).toContain("headerShown: false");
    expect(content).toMatch(
      /<StatusBar style=\{theme\.mode === ["']dark["'] \? ["']light["'] : ["']dark["']\} \/>/,
    );
    expect(content).not.toMatch(
      /<SafeArea(?:Provider|View)[\s\S]{0,120}style=\{\[/,
    );
    expect(homeContent).not.toMatch(/<SafeAreaView[\s\S]{0,120}style=\{\[/);
  });
});
