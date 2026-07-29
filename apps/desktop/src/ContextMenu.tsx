import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  ClipboardCheck,
  Copy,
  Folder,
  Gauge,
  Settings,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import type { Translator } from "@atlasterm/i18n";
import { desktopGroupLabel } from "./desktopGroups";
import { getActiveElement } from "./dom-utils";

type ContextMenuProps = {
  allGroupNames: readonly string[];
  capabilities?: {
    connect?: boolean;
    delete?: boolean;
    edit?: boolean;
    test?: boolean;
  };
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
  capabilities = {},
  connection,
  moveToGroupMenu,
  onClose,
  onMoveToGroup,
  onSelect,
  onToggleMoveToGroup,
  position,
  t,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState(position);
  const canConnect = capabilities.connect ?? true;
  const canDelete = capabilities.delete ?? true;
  const canEdit = capabilities.edit ?? true;
  const canTest = capabilities.test ?? true;
  const closeMenu = () => {
    onToggleMoveToGroup(null);
    onClose();
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    setMenuPosition({
      x: Math.max(
        margin,
        Math.min(position.x, window.innerWidth - rect.width - margin),
      ),
      y: Math.max(
        margin,
        Math.min(position.y, window.innerHeight - rect.height - margin),
      ),
    });
  }, [canConnect, canDelete, canEdit, canTest, moveToGroupMenu, position]);

  useEffect(() => {
    const previouslyFocused = getActiveElement();
    const firstItem =
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    firstItem?.focus();

    return () => {
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  return (
    <div
      className="context-menu-backdrop"
      onClick={closeMenu}
      onContextMenu={(e) => {
        e.preventDefault();
        closeMenu();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeMenu();
        }
      }}
    >
      <div
        className="context-menu"
        ref={menuRef}
        style={{ left: menuPosition.x, top: menuPosition.y }}
        role="menu"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          const items = Array.from(
            e.currentTarget.querySelectorAll<HTMLElement>(
              '[role="menuitem"]:not([disabled])',
            ),
          );
          const idx = items.indexOf(document.activeElement as HTMLElement);
          if (e.key === "ArrowDown" && items.length > 0) {
            e.preventDefault();
            items[(idx + 1) % items.length].focus();
          } else if (e.key === "ArrowUp" && items.length > 0) {
            e.preventDefault();
            items[(idx - 1 + items.length) % items.length].focus();
          } else if (e.key === "Home" && items.length > 0) {
            e.preventDefault();
            items[0].focus();
          } else if (e.key === "End" && items.length > 0) {
            e.preventDefault();
            items[items.length - 1].focus();
          } else if (e.key === "Tab") {
            e.preventDefault();
            closeMenu();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
          }
        }}
      >
        {canConnect ? (
          <button
            className="context-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onSelect("connect");
            }}
          >
            <TerminalSquare size={14} aria-hidden="true" />{" "}
            {t("desktop.contextConnect")}
          </button>
        ) : null}
        {canTest ? (
          <button
            className="context-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onSelect("test");
            }}
          >
            <Gauge size={14} aria-hidden="true" /> {t("desktop.contextTest")}
          </button>
        ) : null}
        {canEdit ? (
          <button
            className="context-menu-item"
            type="button"
            role="menuitem"
            onClick={() => {
              closeMenu();
              onSelect("edit");
            }}
          >
            <Settings size={14} aria-hidden="true" /> {t("desktop.contextEdit")}
          </button>
        ) : null}
        <button
          className="context-menu-item"
          type="button"
          role="menuitem"
          onClick={() => {
            closeMenu();
            onSelect("duplicate");
          }}
        >
          <Copy size={14} aria-hidden="true" /> {t("desktop.contextDuplicate")}
        </button>
        <button
          className="context-menu-item"
          type="button"
          role="menuitem"
          onClick={() => {
            closeMenu();
            onSelect("copySsh");
          }}
        >
          <ClipboardCheck size={14} aria-hidden="true" />{" "}
          {t("desktop.contextCopySsh")}
        </button>
        <div className="context-menu-separator" />
        <div className="context-menu-submenu">
          <button
            className="context-menu-item"
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={moveToGroupMenu === connection.name}
            onClick={() =>
              onToggleMoveToGroup(
                moveToGroupMenu === connection.name ? null : connection.name,
              )
            }
          >
            <Folder size={14} aria-hidden="true" /> {t("desktop.moveToGroup")}{" "}
            <ChevronRight size={12} aria-hidden="true" />
          </button>
          {moveToGroupMenu === connection.name ? (
            <div className="context-menu-submenu-list" role="menu">
              {allGroupNames.map((groupName) => (
                <button
                  key={groupName}
                  className={`context-menu-item ${connection.group === groupName ? "is-current" : ""}`}
                  type="button"
                  role="menuitem"
                  aria-current={
                    connection.group === groupName ? "true" : undefined
                  }
                  onClick={() => {
                    if (connection.group !== groupName) {
                      onMoveToGroup(connection.name, groupName);
                    }
                    closeMenu();
                  }}
                >
                  <Folder size={12} aria-hidden="true" />{" "}
                  {desktopGroupLabel(groupName, t)}
                  {connection.group === groupName ? (
                    <Check
                      className="context-menu-check"
                      size={12}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {canDelete ? (
          <>
            <div className="context-menu-separator" />
            <button
              className="context-menu-item context-menu-item--danger"
              type="button"
              role="menuitem"
              onClick={() => {
                closeMenu();
                onSelect("delete");
              }}
            >
              <Trash2 size={14} aria-hidden="true" />{" "}
              {t("desktop.contextDelete")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
});
