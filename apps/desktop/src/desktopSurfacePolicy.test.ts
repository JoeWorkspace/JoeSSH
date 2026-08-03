import { describe, expect, it } from "vitest";
import {
  MICROSOFT_STORE_VITE_MODE,
  createDesktopSurfacePolicy,
  resolvePanelShortcutForSurfacePolicy,
  sanitizeRightPanelForSurfacePolicy,
} from "./desktopSurfacePolicy";

describe("desktop surface policy", () => {
  it("fails closed for the dedicated Microsoft Store build mode", () => {
    const policy = createDesktopSurfacePolicy(MICROSOFT_STORE_VITE_MODE);

    expect(policy).toEqual({
      profile: "microsoft-store",
      showCompanionProductSurfaces: false,
      showFutureProductSurfaces: false,
    });
    expect(sanitizeRightPanelForSurfacePolicy("team", policy)).toBe(
      "inspector",
    );
    expect(resolvePanelShortcutForSurfacePolicy("3", policy)).toBeNull();
    expect(resolvePanelShortcutForSurfacePolicy("4", policy)).toBe(
      "forwarding",
    );
  });

  it("also hides unfinished surfaces in ordinary production builds", () => {
    const policy = createDesktopSurfacePolicy("production");

    expect(policy.profile).toBe("release");
    expect(policy.showCompanionProductSurfaces).toBe(false);
    expect(policy.showFutureProductSurfaces).toBe(false);
  });

  it.each(["development", "test", "future-preview"])(
    "keeps deliberate %s preview builds available to contributors",
    (mode) => {
      const policy = createDesktopSurfacePolicy(mode);

      expect(policy.profile).toBe("product-preview");
      expect(policy.showCompanionProductSurfaces).toBe(true);
      expect(policy.showFutureProductSurfaces).toBe(true);
      expect(sanitizeRightPanelForSurfacePolicy("team", policy)).toBe("team");
      expect(resolvePanelShortcutForSurfacePolicy("3", policy)).toBe("team");
    },
  );

  it("does not treat an unknown or misspelled mode as a preview build", () => {
    for (const mode of ["", "store", "microsoft_store", "preview"]) {
      const policy = createDesktopSurfacePolicy(mode);
      expect(policy.showCompanionProductSurfaces).toBe(false);
      expect(policy.showFutureProductSurfaces).toBe(false);
    }
  });
});
