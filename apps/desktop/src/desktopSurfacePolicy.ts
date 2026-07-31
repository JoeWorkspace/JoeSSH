export const MICROSOFT_STORE_VITE_MODE = "microsoft-store";

const previewModes = new Set(["development", "test", "future-preview"]);

export type DesktopSurfacePolicy = Readonly<{
  profile: "microsoft-store" | "product-preview" | "release";
  showCompanionProductSurfaces: boolean;
  showFutureProductSurfaces: boolean;
}>;

export type SurfacePolicyRightPanel =
  "inspector" | "sftp" | "team" | "forwarding" | "settings";

/**
 * Release builds fail closed: unfinished and companion-product surfaces are
 * available only in explicit development/test preview modes. The dedicated
 * Microsoft Store mode remains distinct so candidate builds can be audited.
 */
export function createDesktopSurfacePolicy(mode: string): DesktopSurfacePolicy {
  const showPreviewSurfaces = previewModes.has(mode);

  return Object.freeze({
    profile:
      mode === MICROSOFT_STORE_VITE_MODE
        ? "microsoft-store"
        : showPreviewSurfaces
          ? "product-preview"
          : "release",
    showCompanionProductSurfaces: showPreviewSurfaces,
    showFutureProductSurfaces: showPreviewSurfaces,
  });
}

export function sanitizeRightPanelForSurfacePolicy(
  panel: SurfacePolicyRightPanel,
  policy: DesktopSurfacePolicy,
): SurfacePolicyRightPanel {
  return panel === "team" && !policy.showFutureProductSurfaces
    ? "inspector"
    : panel;
}

export function resolvePanelShortcutForSurfacePolicy(
  key: string,
  policy: DesktopSurfacePolicy,
): SurfacePolicyRightPanel | null {
  const panelsByKey: Readonly<Record<string, SurfacePolicyRightPanel>> = {
    "1": "inspector",
    "2": "sftp",
    "3": "team",
    "4": "forwarding",
    "5": "settings",
  };
  const panel = panelsByKey[key];
  if (!panel || (panel === "team" && !policy.showFutureProductSurfaces)) {
    return null;
  }
  return panel;
}

export const desktopSurfacePolicy = createDesktopSurfacePolicy(
  import.meta.env.MODE,
);
