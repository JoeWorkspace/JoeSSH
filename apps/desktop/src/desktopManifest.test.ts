// @vitest-environment happy-dom
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_LOCALES, type Translator } from "@atlasterm/i18n";

import {
  applyLocalizedDesktopMetadata,
  createDesktopManifest,
} from "./desktopManifest";

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
    expect(manifest.icons).toEqual([
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
    expect(
      manifest.shortcuts.map((shortcut) => [
        shortcut.name,
        shortcut.short_name,
      ]),
    ).toEqual([
      ["Localized quick connect", "Localized connect"],
      ["Localized SFTP action", "Localized SFTP"],
      ["Localized team access", "Localized team"],
      ["Localized open forwarding", "Localized forwarding"],
      ["Localized settings", "Localized settings"],
    ]);
    expect(
      manifest.shortcuts.every(
        (shortcut) => shortcut.icons[0]?.src === "/icons/icon-192.png",
      ),
    ).toBe(true);
  });

  it("updates social descriptions without replacing the static manifest link", () => {
    document.head.innerHTML = `
      <link rel="manifest" href="/manifest.json" />
      <meta name="description" content="Old" />
      <meta property="og:description" content="Old" />
      <meta name="twitter:description" content="Old" />
    `;

    const cleanup = applyLocalizedDesktopMetadata(t);

    expect(
      document
        .querySelector<HTMLLinkElement>('link[rel="manifest"]')
        ?.getAttribute("href"),
    ).toBe("/manifest.json");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="description"]')
        ?.content,
    ).toBe("Localized SSH workspace");
    expect(
      document.querySelector<HTMLMetaElement>('meta[property="og:description"]')
        ?.content,
    ).toBe("Localized SSH workspace");
    expect(
      document.querySelector<HTMLMetaElement>(
        'meta[name="twitter:description"]',
      )?.content,
    ).toBe("Localized SSH workspace");
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
    expect(manifest.description).toBe(
      "SSH terminal, SFTP, team access, and session management.",
    );
    expect(Object.keys(manifest.description_localized).sort()).toEqual(
      [...supportedLocales].sort(),
    );
    expect(manifest.description_localized.ar).toEqual(
      expect.objectContaining({ dir: "rtl", value: expect.any(String) }),
    );
    expect(manifest.icons).toEqual([
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);

    expect(
      manifest.shortcuts.map((shortcut: { url: string }) => shortcut.url),
    ).toEqual([
      "/?action=connect",
      "/?panel=sftp",
      "/?panel=team",
      "/?panel=forwarding",
      "/?panel=settings",
    ]);

    for (const shortcut of manifest.shortcuts as Array<
      Record<string, unknown>
    >) {
      expect(
        Object.keys(shortcut.name_localized as Record<string, unknown>).sort(),
      ).toEqual([...supportedLocales].sort());
      expect(
        Object.keys(
          shortcut.short_name_localized as Record<string, unknown>,
        ).sort(),
      ).toEqual([...supportedLocales].sort());
      expect(shortcut.name_localized).toHaveProperty("zh-CN");
      expect(shortcut.short_name_localized).toHaveProperty("zh-TW");
      expect(shortcut.icons).toEqual([
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
        },
      ]);
    }
  });

  it("keeps native and browser icon references complete", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const desktopRoot = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(desktopRoot, "index.html"), "utf-8");
    const serviceWorker = fs.readFileSync(
      path.join(desktopRoot, "public/sw.js"),
      "utf-8",
    );
    const tauri = JSON.parse(
      fs.readFileSync(
        path.join(desktopRoot, "src-tauri/tauri.conf.json"),
        "utf-8",
      ),
    );
    const tauriIcons = [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.png",
      "icons/icon.ico",
    ];

    expect(tauri.bundle.icon).toEqual(tauriIcons);
    expect(tauri.bundle).toEqual(
      expect.objectContaining({
        category: "DeveloperTool",
        copyright: "Copyright (c) 2026 JoeSSH contributors",
        license: "MIT",
        publisher: "JoeSSH Project",
      }),
    );
    expect(html).toContain('href="/icons/icon-32.png"');
    expect(html).toContain('href="/icons/apple-touch-icon-180.png"');
    expect(html).not.toContain("favicon.svg");
    expect(serviceWorker).toContain('CACHE_NAME = "joessh-v2"');
    expect(serviceWorker).not.toContain('CACHE_NAME = "joessh-v1"');
    expect(fs.existsSync(path.join(desktopRoot, "public/favicon.svg"))).toBe(
      false,
    );

    const nativePngSizes = new Map([
      ["icons/32x32.png", 32],
      ["icons/128x128.png", 128],
      ["icons/128x128@2x.png", 256],
      ["icons/icon.png", 512],
      ["icons/joessh-icon-master-1024.png", 1024],
    ]);
    for (const [iconPath, expectedSize] of nativePngSizes) {
      const data = fs.readFileSync(
        path.join(desktopRoot, "src-tauri", iconPath),
      );
      expect(readPngDimensions(data)).toEqual([expectedSize, expectedSize]);
      expect(readPngCornerAlphas(data)).toEqual([0, 0, 0, 0]);
    }

    const icoData = fs.readFileSync(
      path.join(desktopRoot, "src-tauri/icons/icon.ico"),
    );
    expect(readIcoSizes(icoData)).toEqual([
      16, 20, 24, 32, 40, 48, 64, 128, 256,
    ]);
    expect(icoData.byteLength).toBeGreaterThan(50_000);

    const browserPngSizes = new Map([
      ["icons/icon-32.png", 32],
      ["icons/apple-touch-icon-180.png", 180],
      ["icons/icon-192.png", 192],
      ["icons/icon-512.png", 512],
      ["icons/icon-maskable-512.png", 512],
    ]);
    for (const [iconPath, expectedSize] of browserPngSizes) {
      const data = fs.readFileSync(path.join(desktopRoot, "public", iconPath));
      expect(readPngDimensions(data)).toEqual([expectedSize, expectedSize]);
    }
    for (const iconPath of [
      "icons/icon-32.png",
      "icons/icon-192.png",
      "icons/icon-512.png",
    ]) {
      const data = fs.readFileSync(path.join(desktopRoot, "public", iconPath));
      expect(readPngCornerAlphas(data)).toEqual([0, 0, 0, 0]);
    }
    for (const iconPath of [
      "icons/apple-touch-icon-180.png",
      "icons/icon-maskable-512.png",
    ]) {
      const data = fs.readFileSync(path.join(desktopRoot, "public", iconPath));
      expect(readPngCornerAlphas(data)).toEqual([255, 255, 255, 255]);
    }

    const primaryIcon = fs.readFileSync(
      path.join(desktopRoot, "src-tauri/icons/icon.png"),
    );
    expect(primaryIcon.byteLength).toBeGreaterThan(100_000);
  });
});

function readPngDimensions(data: Buffer): [number, number] {
  expect(data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(data.subarray(12, 16).toString("ascii")).toBe("IHDR");
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function readPngCornerAlphas(data: Buffer): [number, number, number, number] {
  expect(data.readUInt8(24)).toBe(8);
  expect(data.readUInt8(25)).toBe(6);
  expect(data.readUInt8(28)).toBe(0);
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);

  const idatChunks: Buffer[] = [];
  let offset = 8;
  while (offset + 12 <= data.byteLength) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") {
      idatChunks.push(data.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
    if (type === "IEND") break;
  }

  expect(idatChunks.length).toBeGreaterThan(0);
  const decoded = inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4;
  expect(decoded.byteLength).toBe((stride + 1) * height);
  let previous = Buffer.alloc(stride);
  let topLeft = -1;
  let topRight = -1;
  let bottomLeft = -1;
  let bottomRight = -1;
  let sourceOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = decoded.readUInt8(sourceOffset);
    expect(filter).toBeLessThanOrEqual(4);
    sourceOffset += 1;
    const current = Buffer.alloc(stride);
    for (let index = 0; index < stride; index += 1) {
      const raw = decoded.readUInt8(sourceOffset + index);
      const left = index >= 4 ? current[index - 4] : 0;
      const above = previous[index];
      const upperLeft = index >= 4 ? previous[index - 4] : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paethPredictor(left, above, upperLeft);
      current[index] = (raw + predictor) & 0xff;
    }
    sourceOffset += stride;
    if (row === 0) {
      topLeft = current[3];
      topRight = current[stride - 1];
    }
    if (row === height - 1) {
      bottomLeft = current[3];
      bottomRight = current[stride - 1];
    }
    previous = current;
  }

  return [topLeft, topRight, bottomLeft, bottomRight];
}

function paethPredictor(
  left: number,
  above: number,
  upperLeft: number,
): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function readIcoSizes(data: Buffer): number[] {
  expect(data.readUInt16LE(0)).toBe(0);
  expect(data.readUInt16LE(2)).toBe(1);
  const count = data.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entryOffset = 6 + index * 16;
    const encodedWidth = data.readUInt8(entryOffset);
    const imageSize = data.readUInt32LE(entryOffset + 8);
    const imageOffset = data.readUInt32LE(entryOffset + 12);
    expect(imageSize).toBeGreaterThanOrEqual(4);
    expect(imageOffset + imageSize).toBeLessThanOrEqual(data.byteLength);
    const imageHeader = data.subarray(imageOffset, imageOffset + 8);
    const isPng = imageHeader.toString("hex") === "89504e470d0a1a0a";
    const isBitmap = imageHeader.readUInt32LE(0) >= 40;
    expect(isPng || isBitmap).toBe(true);
    return encodedWidth === 0 ? 256 : encodedWidth;
  });
}
