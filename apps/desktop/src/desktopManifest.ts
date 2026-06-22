import type { Translator } from "@atlasterm/i18n";

type ManifestIcon = {
  readonly sizes: string;
  readonly src: string;
};

type WebAppManifestShortcut = {
  readonly icons: readonly ManifestIcon[];
  readonly name: string;
  readonly short_name: string;
  readonly url: string;
};

export type DesktopWebAppManifest = {
  readonly background_color: string;
  readonly categories: readonly string[];
  readonly description: string;
  readonly display: "standalone";
  readonly icons: readonly (ManifestIcon & {
    readonly purpose: string;
    readonly type: string;
  })[];
  readonly id: string;
  readonly name: string;
  readonly orientation: "any";
  readonly scope: string;
  readonly short_name: string;
  readonly shortcuts: readonly WebAppManifestShortcut[];
  readonly start_url: string;
  readonly theme_color: string;
};

const icon = { src: "/favicon.svg", sizes: "any" } as const;
const descriptionSelectors = [
  'meta[name="description"]',
  'meta[property="og:description"]',
  'meta[name="twitter:description"]',
] as const;

export function createDesktopManifest(t: Translator): DesktopWebAppManifest {
  return {
    id: "/",
    name: "JoeSSH Workbench",
    short_name: "JoeSSH",
    description: t("desktop.manifestDescription"),
    start_url: "/",
    display: "standalone",
    background_color: "#101820",
    theme_color: "#101820",
    orientation: "any",
    icons: [
      {
        ...icon,
        type: "image/svg+xml",
        purpose: "any maskable",
      },
    ],
    shortcuts: [
      {
        name: t("desktop.quickConnect"),
        short_name: t("desktop.connectAction"),
        url: "/?action=connect",
        icons: [icon],
      },
      {
        name: t("desktop.openSftp"),
        short_name: t("desktop.sftp"),
        url: "/?panel=sftp",
        icons: [icon],
      },
      {
        name: t("team.access"),
        short_name: t("desktop.team"),
        url: "/?panel=team",
        icons: [icon],
      },
      {
        name: t("desktop.openForwarding"),
        short_name: t("desktop.forwarding"),
        url: "/?panel=forwarding",
        icons: [icon],
      },
      {
        name: t("desktop.settings"),
        short_name: t("desktop.settings"),
        url: "/?panel=settings",
        icons: [icon],
      },
    ],
    categories: ["developer", "utilities"],
    scope: "/",
  };
}

export function applyLocalizedDesktopMetadata(t: Translator, documentRef: Document = document) {
  const manifest = createDesktopManifest(t);

  for (const selector of descriptionSelectors) {
    const element = documentRef.querySelector<HTMLMetaElement>(selector);
    if (element) {
      element.content = manifest.description;
    }
  }

  return undefined;
}
