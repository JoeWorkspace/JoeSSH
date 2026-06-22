import { Fragment, memo } from "react";
import { Command } from "lucide-react";
import { Badge, Panel } from "@atlasterm/ui";
import type { TranslationKey, Translator } from "@atlasterm/i18n";

export type PaletteItem = {
  command?: string;
  icon: React.ReactNode;
  name: string;
  shortcut?: string;
  sub?: string;
  kind: "quick-connect" | "recent" | "connection" | "recent-command" | "command";
};

type CommandPaletteProps = {
  input: string;
  index: number;
  items: PaletteItem[];
  onInputChange: (value: string) => void;
  onClose: () => void;
  onIndexChange: (index: number) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onSelect: (item: PaletteItem) => void;
  paletteRef: React.RefObject<HTMLDivElement | null>;
  t: Translator;
};

const sectionLabels: Record<PaletteItem["kind"], TranslationKey> = {
  recent: "desktop.paletteRecent",
  "quick-connect": "desktop.quickConnect",
  connection: "desktop.paletteConnections",
  "recent-command": "desktop.paletteRecentCommands",
  command: "desktop.paletteCommands",
};

export const CommandPalette = memo(function CommandPalette({
  input,
  index,
  items,
  onInputChange,
  onClose,
  onIndexChange,
  onKeyDown,
  onSelect,
  paletteRef,
  t,
}: CommandPaletteProps) {
  return (
    <div className="palette-scrim" onClick={onClose}>
      <Panel className="command-palette" role="dialog" aria-modal="true" aria-label={t("desktop.commandPalette")} onClick={(event) => event.stopPropagation()} onKeyDown={onKeyDown} ref={paletteRef}>
        <div className="palette-search">
          <Command size={18} aria-hidden="true" />
          <input
            autoFocus
            placeholder={t("desktop.palettePlaceholder")}
            aria-label={t("desktop.palettePlaceholder")}
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls="palette-listbox"
            aria-activedescendant={items.length > 0 ? `palette-option-${index}` : undefined}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
          />
          <Badge>Ctrl K</Badge>
        </div>
        <div id="palette-listbox" className="palette-list" role="listbox" aria-label={t("desktop.commandPalette")}>
          {items.length === 0 ? (
            <div className="palette-empty empty-state" role="status">
              <span className="empty-state-icon"><Command size={20} aria-hidden="true" /></span>
              <strong className="empty-state-title">{t("desktop.paletteEmptyTitle")}</strong>
              <span className="empty-state-hint">{t("desktop.paletteEmptyHint")}</span>
            </div>
          ) : null}
          {items.map((item, i) => {
            const prev = i > 0 ? items[i - 1] : undefined;
            const showHeader = !prev || prev.kind !== item.kind;
            return (
              <Fragment key={`${item.kind}-${item.name}`}>
                {showHeader ? <div className="palette-section-header">{t(sectionLabels[item.kind])}</div> : null}
                <button
                  id={`palette-option-${i}`}
                  className={i === index ? "is-active" : ""}
                  role="option"
                  aria-selected={i === index}
                  type="button"
                  onMouseEnter={() => onIndexChange(i)}
                  onClick={() => onSelect(item)}
                >
                  <span>{item.icon}</span>
                  <strong>{item.name}</strong>
                  {item.kind === "recent" ? <Badge tone="neutral">{t("desktop.paletteRecentBadge")}</Badge> : null}
                  {item.kind === "recent-command" ? <Badge tone="neutral">{t("desktop.paletteRecentBadge")}</Badge> : null}
                  {item.sub ? <small className="palette-url">{item.sub}</small> : null}
                  {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
      </Panel>
    </div>
  );
});
