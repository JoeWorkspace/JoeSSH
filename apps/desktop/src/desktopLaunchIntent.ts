export type DesktopShortcutPanel = "forwarding" | "settings" | "sftp";

export type DesktopLaunchIntent = Readonly<{
  connect: boolean;
  panel: DesktopShortcutPanel | null;
}>;

const shortcutPanels = new Set<DesktopShortcutPanel>([
  "forwarding",
  "settings",
  "sftp",
]);

/**
 * Parse only the public PWA shortcut parameters that the Desktop shell
 * implements. Duplicate or unknown values are ignored instead of opening a
 * different prototype surface accidentally.
 */
export function parseDesktopLaunchIntent(search: string): DesktopLaunchIntent {
  const params = new URLSearchParams(search);
  const actionValues = params.getAll("action");
  const panelValues = params.getAll("panel");
  const requestedPanel = panelValues.length === 1 ? panelValues[0] : null;

  return {
    connect: actionValues.length === 1 && actionValues[0] === "connect",
    panel:
      requestedPanel !== null &&
      shortcutPanels.has(requestedPanel as DesktopShortcutPanel)
        ? (requestedPanel as DesktopShortcutPanel)
        : null,
  };
}
