import { memo } from "react";
import { ChevronRight, ClipboardCheck, Copy, Folder, Gauge, Settings, TerminalSquare, Trash2 } from "lucide-react";
import type { Translator } from "@atlasterm/i18n";
import { desktopGroupLabel } from "./desktopGroups";


type ContextMenuProps = {
  allGroupNames: readonly string[];
  connection: { name: string; group: string };
  moveToGroupMenu: string | null;
  onClose: () => void;
  onMoveToGroup: (connection: string, group: string) => void;
  onSelect: (action: string) => void;
  onToggleMoveToGroup: (connection: string | null) => void;
  position: { x: number; y: number };
  t: Translator;
};

export const ContextMenu = memo(function ContextMenu({
  allGroupNames,
  connection,
  moveToGroupMenu,
  onClose,
  onMoveToGroup,
  onSelect,
  onToggleMoveToGroup,
  position,
  t,
}: ContextMenuProps) {
  return (
    <div
      className="context-menu-backdrop"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { onClose(); onToggleMoveToGroup(null); } }}
    >
      <div
        className="context-menu"
        style={{ left: position.x, top: position.y }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
          const idx = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowDown' && items.length > 0) { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
          else if (e.key === 'ArrowUp' && items.length > 0) { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
          else if (e.key === 'Escape') { onClose(); onToggleMoveToGroup(null); }
        }}
      >
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => { onClose(); onSelect("connect"); }}>
          <TerminalSquare size={14} aria-hidden="true" /> {t("desktop.contextConnect")}
        </button>
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => { onClose(); onSelect("test"); }}>
          <Gauge size={14} aria-hidden="true" /> {t("desktop.contextTest")}
        </button>
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => { onClose(); onSelect("edit"); }}>
          <Settings size={14} aria-hidden="true" /> {t("desktop.contextEdit")}
        </button>
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => { onClose(); onSelect("duplicate"); }}>
          <Copy size={14} aria-hidden="true" /> {t("desktop.contextDuplicate")}
        </button>
        <button className="context-menu-item" type="button" role="menuitem" onClick={() => { onClose(); onSelect("copySsh"); }}>
          <ClipboardCheck size={14} aria-hidden="true" /> {t("desktop.contextCopySsh")}
        </button>
        <div className="context-menu-separator" />
        <div className="context-menu-submenu">
          <button className="context-menu-item" type="button" role="menuitem" aria-haspopup="true" aria-expanded={moveToGroupMenu === connection.name} onClick={() => onToggleMoveToGroup(moveToGroupMenu === connection.name ? null : connection.name)}>
            <Folder size={14} aria-hidden="true" /> {t("desktop.moveToGroup")} <ChevronRight size={12} aria-hidden="true" />
          </button>
          {moveToGroupMenu === connection.name ? (
            <div className="context-menu-submenu-list" role="menu">
              {allGroupNames.map((groupName) => (
                <button key={groupName} className={`context-menu-item ${connection.group === groupName ? "is-current" : ""}`} type="button" role="menuitem" aria-current={connection.group === groupName ? "true" : undefined} onClick={() => {
                  if (connection.group !== groupName) {
                    onMoveToGroup(connection.name, groupName);
                  }
                  onClose();
                }}>
                  <Folder size={12} aria-hidden="true" /> {desktopGroupLabel(groupName, t)}
                  {connection.group === groupName ? " ✓" : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="context-menu-separator" />
        <button className="context-menu-item context-menu-item--danger" type="button" role="menuitem" onClick={() => { onClose(); onSelect("delete"); }}>
          <Trash2 size={14} aria-hidden="true" /> {t("desktop.contextDelete")}
        </button>
      </div>
    </div>
  );
});
