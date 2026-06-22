// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES, type Translator } from "@atlasterm/i18n";

import { applyLocalizedDesktopMetadata, createDesktopManifest } from "./desktopManifest";

const labels: Record<string, string> = {
  "desktop.manifestDescription": "Localized SSH workspace",
  "desktop.quickConnect": "Localized quick connect",
  "desktop.connectAction": "Localized connect",
  "desktop.openSftp": "Localized SFTP action",
  "desktop.sftp": "Localized SFTP",
  "team.access": "Localized team access",
  "desktop.team": "Localized team",
  "desktop.openForwarding": "Localized open forwarding",
  "desktop.forwarding": "Localized forwarding",
  "desktop.settings": "Localized settings",
};

const t = ((key: string) => labels[key] ?? key) as Translator;

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("desktop manifest metadata", () => {
  it("builds install shortcuts from localized labels", () => {
    const manifest = createDesktopManifest(t);

    expect(manifest.description).toBe("Localized SSH workspace");
    expect(manifest.shortcuts.map((shortcut) => [shortcut.name, shortcut.short_name])).toEqual([
      ["Localized quick connect", "Localized connect"],
      ["Localized SFTP action", "Localized SFTP"],
      ["Localized team access", "Localized team"],
      ["Localized open forwarding", "Localized forwarding"],
      ["Localized settings", "Localized settings"],
    ]);
  });

  it("updates social descriptions without replacing the static manifest link", () => {
    document.head.innerHTML = `
      <link rel="manifest" href="/manifest.json" />
      <meta name="description" content="Old" />
      <meta property="og:description" content="Old" />
      <meta name="twitter:description" content="Old" />
    `;

    const cleanup = applyLocalizedDesktopMetadata(t);

    expect(document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.getAttribute("href")).toBe("/manifest.json");
    expect(document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content).toBe("Localized SSH workspace");
    expect(document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content).toBe("Localized SSH workspace");
    expect(document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]')?.content).toBe("Localized SSH workspace");
    expect(cleanup).toBeUndefined();
  });

  it("keeps the static install manifest localized and structurally stable", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const manifestPath = path.resolve(__dirname, "../public/manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const supportedLocales = SUPPORTED_LOCALES.map((locale) => locale.code);

    expect(manifest.lang).toBe("en");
    expect(manifest.dir).toBe("ltr");
    expect(manifest.name).toBe("JoeSSH Workbench");
    expect(manifest.short_name).toBe("JoeSSH");
    expect(manifest.description).toBe("SSH terminal, SFTP, team access, and session management.");
    expect(Object.keys(manifest.description_localized).sort()).toEqual([...supportedLocales].sort());
    expect(manifest.description_localized.ar).toEqual(expect.objectContaining({ dir: "rtl", value: expect.any(String) }));

    expect(manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url)).toEqual([
      "/?action=connect",
      "/?panel=sftp",
      "/?panel=team",
      "/?panel=forwarding",
      "/?panel=settings",
    ]);

    for (const shortcut of manifest.shortcuts as Array<Record<string, unknown>>) {
      expect(Object.keys(shortcut.name_localized as Record<string, unknown>).sort()).toEqual([...supportedLocales].sort());
      expect(Object.keys(shortcut.short_name_localized as Record<string, unknown>).sort()).toEqual([...supportedLocales].sort());
      expect(shortcut.name_localized).toHaveProperty("zh-CN");
      expect(shortcut.short_name_localized).toHaveProperty("zh-TW");
    }
  });
});
