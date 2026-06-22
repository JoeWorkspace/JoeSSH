import { memo } from "react";
import { Command } from "lucide-react";
import { Badge, Panel } from "@atlasterm/ui";
import type { TranslationKey, Translator } from "@atlasterm/i18n";
import { useFocusTrap } from "./useFocusTrap";

const shortcuts = [
  ["Ctrl+K", "desktop.commandPalette"],
  ["Ctrl+N", "desktop.new"],
  ["Ctrl+B", "desktop.toggleSidebar"],
  ["Ctrl+F", "desktop.searchPlaceholder"],
  ["Ctrl+1", "desktop.context"],
  ["Ctrl+2", "desktop.openSftp"],
  ["Ctrl+3", "desktop.team"],
  ["Ctrl+4", "desktop.openForwarding"],
  ["Ctrl+5", "desktop.settings"],
  ["Alt+1-8", "desktop.shortcutSwitchConnection"],
  ["Ctrl+Shift+?", "desktop.keyboardShortcuts"],
  ["Ctrl+Shift+T", "desktop.shortcutToggleTheme"],
  ["Ctrl+Shift+C", "desktop.quickConnect"],
  ["Up/Down", "desktop.shortcutCommandHistory"],
] as const satisfies readonly (readonly [string, TranslationKey])[];

export const ShortcutsOverlay = memo(function ShortcutsOverlay({
  onClose,
  t,
}: {
  onClose: () => void;
  t: Translator;
}) {
  const focusTrapRef = useFocusTrap<HTMLDivElement>(true);
  return (
    <div className="palette-scrim" onClick={onClose} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <Panel className="command-palette shortcuts-overlay" ref={focusTrapRef} role="dialog" aria-modal="true" aria-label={t("desktop.keyboardShortcuts")} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className="palette-search">
          <Command size={16} aria-hidden="true" />
          <strong>{t("desktop.keyboardShortcuts")}</strong>
          <Badge>Esc</Badge>
        </div>
        <div className="shortcuts-grid">
          {shortcuts.map(([key, messageKey]) => (
            <div className="shortcut-row" key={key}>
              <kbd>{key}</kbd>
              <span>{t(messageKey)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
});
