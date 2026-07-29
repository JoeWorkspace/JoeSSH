import { memo } from "react";
import {
  Boxes,
  Braces,
  ChevronDown,
  ChevronRight,
  Command,
  Folder,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Star,
  TerminalSquare,
} from "lucide-react";
import { Badge, Button, IconButton } from "@atlasterm/ui";
import type {
  AtlasLocale,
  LocaleFormatters,
  TranslationKey,
  Translator,
} from "@atlasterm/i18n";
import { LanguagePicker } from "./LanguagePicker";
import { Sparkline } from "./sparkline";
import type { DesktopConnection } from "./main";
import type { GroupAction } from "./useGroupManager";
import { desktopGroupLabel } from "./desktopGroups";

type LanguageChoice = AtlasLocale | "auto";

type SidebarProps = {
  activeConnectionName: string;
  activeTagFilters: Set<string>;
  allGroupNames: readonly string[];
  allTags: readonly string[];
  commandSnippets: readonly {
    readonly nameKey: TranslationKey;
    readonly command: string;
  }[];
  collapsedGroups: Set<string>;
  connectionCounts: Record<string, number>;
  direction: "ltr" | "rtl";
  effectiveConnections: readonly DesktopConnection[];
  favorites: readonly string[];
  filteredConnections: readonly DesktopConnection[];
  formatters: LocaleFormatters;
  groupedConnections: Map<string, DesktopConnection[]>;
  groupOrder: readonly string[];
  languageChoice: LanguageChoice;
  locale: AtlasLocale;
  onActivateConnection: (name: string) => void;
  onCommandInputChange: (value: string) => void;
  onGroupDispatch: (action: GroupAction) => void;
  onLanguageChoiceChange: (choice: LanguageChoice) => void;
  onOpenPalette: () => void;
  onSidebarSearchChange: (value: string) => void;
  onTagFilterToggle: (tag: string) => void;
  onToggleFavorite: (name: string) => void;
  onContextMenu: (name: string, x: number, y: number) => void;
  sidebarSearch: string;
  t: Translator;
  // Drag-and-drop props
  dragState: {
    order: string[];
    dragging: string | null;
    dragOver: string | null;
  };
  onDragStart: (name: string) => void;
  onDragOver: (name: string) => void;
  onDragLeave: () => void;
  onDragEnd: () => void;
  onMoveConnectionAfter: (name: string, targetName: string) => void;
  onMoveConnectionBefore: (name: string, targetName: string) => void;
  collapsed?: boolean;
  onToggleCollapsed: () => void;
  onNewConnection?: () => void;
};

function formatConnectionLatency(
  connection: DesktopConnection,
  formatters: LocaleFormatters,
  t: Translator,
): string {
  if (connection.status === "sample") return t("desktop.sampleDataShort");
  if (typeof connection.latencyMs === "number")
    return formatters.latency(connection.latencyMs);
  if ("latencyLabelKey" in connection && connection.latencyLabelKey)
    return t(connection.latencyLabelKey);
  if (
    "latencyLabel" in connection &&
    typeof connection.latencyLabel === "string" &&
    connection.latencyLabel
  )
    return connection.latencyLabel;
  return t("desktop.notAvailable");
}

function connectionStatusLabel(
  connection: DesktopConnection,
  t: Translator,
): string {
  if (connection.status === "sample") return t("desktop.sampleDataShort");
  if (connection.status === "busy") return t("desktop.connectionBusy");
  if (connection.status === "locked") return t("desktop.locked");
  return t("desktop.connectionStatusOnline");
}

export const Sidebar = memo(function Sidebar({
  activeConnectionName,
  activeTagFilters,
  allTags,
  commandSnippets,
  collapsedGroups,
  favorites,
  filteredConnections,
  formatters,
  groupedConnections,
  groupOrder,
  languageChoice,
  locale,
  onActivateConnection,
  onCommandInputChange,
  onGroupDispatch,
  onLanguageChoiceChange,
  onOpenPalette,
  onSidebarSearchChange,
  onTagFilterToggle,
  onToggleFavorite,
  onContextMenu,
  sidebarSearch,
  t,
  dragState,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  onMoveConnectionAfter,
  onMoveConnectionBefore,
  collapsed,
  onToggleCollapsed,
  onNewConnection,
}: SidebarProps) {
  return (
    <aside
      className={`sidebar${collapsed ? " is-collapsed" : ""}`}
      aria-label={t("desktop.workspace")}
      id="desktop-sidebar"
    >
      <div className="brand-row">
        <div className="brand-mark">
          <TerminalSquare size={20} aria-hidden="true" />
        </div>
        <div className="brand-copy">
          <strong>JoeSSH</strong>
          <span>{t("desktop.workspace")}</span>
        </div>
        <IconButton
          aria-controls="desktop-sidebar"
          aria-expanded={!collapsed}
          className="sidebar-toggle"
          label={t("desktop.toggleSidebar")}
          onClick={onToggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={17} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={17} aria-hidden="true" />
          )}
        </IconButton>
      </div>

      <LanguagePicker
        currentLocale={locale}
        languageChoice={languageChoice}
        onLanguageChoiceChange={onLanguageChoiceChange}
        t={t}
      />

      <label className="search-field">
        <Search size={15} />
        <input
          placeholder={t("desktop.searchPlaceholder")}
          aria-label={t("desktop.searchPlaceholder")}
          value={sidebarSearch}
          onChange={(e) => onSidebarSearchChange(e.target.value)}
        />
      </label>

      <div className="sidebar-actions">
        <Button size="sm" onClick={onNewConnection}>
          <Plus size={14} aria-hidden="true" /> {t("desktop.new")}
        </Button>
        <IconButton
          label={t("desktop.manageGroups")}
          onClick={() =>
            onGroupDispatch({ type: "SET_MANAGER_OPEN", open: true })
          }
        >
          <Boxes size={16} />
        </IconButton>
        <IconButton
          label={t("desktop.commandPalette")}
          onClick={() => onOpenPalette()}
        >
          <Command size={16} />
        </IconButton>
      </div>

      <section className="connection-section">
        <header>
          <span>{t("desktop.connections")}</span>
          <Badge tone="info">{filteredConnections.length}</Badge>
        </header>
        {allTags.length > 0 ? (
          <div className="tag-filter-bar">
            {allTags.map((tag) => (
              <button
                className={`tag-chip ${activeTagFilters.has(tag) ? "is-active" : ""}`}
                key={tag}
                aria-pressed={activeTagFilters.has(tag)}
                onClick={() => onTagFilterToggle(tag)}
                type="button"
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
        <div className="connection-list">
          {groupOrder.map((group) => {
            const items = groupedConnections.get(group);
            if (!items) return null;
            const isCollapsed = collapsedGroups.has(group);
            const groupLabel = desktopGroupLabel(group, t);
            return (
              <div className="connection-group" key={group}>
                <button
                  className="connection-group-header"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    onGroupDispatch({ type: "TOGGLE_COLLAPSE", group })
                  }
                  type="button"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} aria-hidden="true" />
                  )}
                  <Folder size={14} aria-hidden="true" />
                  <span>{groupLabel}</span>
                  <Badge tone="neutral">{items.length}</Badge>
                </button>
                {isCollapsed ? null : (
                  <div
                    className="connection-group-items"
                    role="list"
                    aria-label={groupLabel}
                  >
                    {items.map((connection, index) => (
                      <div
                        className={`connection-card ${connection.name === activeConnectionName ? "is-active" : ""} ${dragState.dragging === connection.name ? "is-dragging" : ""} ${dragState.dragOver === connection.name ? "is-drag-over" : ""}`}
                        key={connection.name}
                        role="listitem"
                      >
                        <button
                          className="connection-card-main"
                          type="button"
                          aria-current={
                            connection.name === activeConnectionName
                              ? "true"
                              : undefined
                          }
                          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                          draggable
                          data-tooltip={`${connection.name} \u2014 ${connection.host}`}
                          onClick={() => onActivateConnection(connection.name)}
                          onKeyDown={(event) => {
                            if (!event.altKey || event.ctrlKey || event.metaKey)
                              return;
                            if (event.key === "ArrowUp" && index > 0) {
                              event.preventDefault();
                              onMoveConnectionBefore(
                                connection.name,
                                items[index - 1].name,
                              );
                            } else if (
                              event.key === "ArrowDown" &&
                              index < items.length - 1
                            ) {
                              event.preventDefault();
                              onMoveConnectionAfter(
                                connection.name,
                                items[index + 1].name,
                              );
                            }
                          }}
                          onDragStart={() => onDragStart(connection.name)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            onDragOver(connection.name);
                          }}
                          onDragLeave={onDragLeave}
                          onDragEnd={onDragEnd}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            onContextMenu(
                              connection.name,
                              e.clientX,
                              e.clientY,
                            );
                          }}
                        >
                          <span
                            className={`status-dot status-dot--${connection.color}`}
                            aria-label={connectionStatusLabel(connection, t)}
                            role="img"
                          />
                          <span className="connection-main">
                            <strong>{connection.name}</strong>
                            <small>{connection.host}</small>
                            <span className="connection-tags">
                              {connection.tags.map((tag) => (
                                <span
                                  className={`connection-tag connection-tag--${tag}`}
                                  key={tag}
                                >
                                  {tag}
                                </span>
                              ))}
                            </span>
                          </span>
                          <span className="connection-meta">
                            <b>
                              {formatConnectionLatency(
                                connection,
                                formatters,
                                t,
                              )}
                            </b>
                            {connection.latencyHistory ? (
                              <Sparkline
                                values={connection.latencyHistory}
                                color={connection.color}
                              />
                            ) : null}
                            {connection.status === "online" ? (
                              <span
                                className="health-pulse"
                                aria-label={t("desktop.connectionHealthy")}
                              />
                            ) : null}
                            {connection.status === "busy" ? (
                              <span
                                className="reconnect-badge"
                                aria-label={t("desktop.connectionBusy")}
                              >
                                {t("desktop.connectionBusy")}
                              </span>
                            ) : null}
                            {connection.status === "locked" ? (
                              <Lock
                                size={10}
                                className="lock-icon"
                                aria-hidden="true"
                              />
                            ) : null}
                            {index < 8 ? (
                              <kbd className="shortcut-hint" aria-hidden="true">
                                Alt+{index + 1}
                              </kbd>
                            ) : null}
                          </span>
                        </button>
                        <button
                          className={`connection-fav ${favorites.includes(connection.name) ? "is-favorited" : ""}`}
                          type="button"
                          aria-label={
                            favorites.includes(connection.name)
                              ? t("desktop.removeFromFavorites")
                              : t("desktop.addToFavorites")
                          }
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite(connection.name);
                          }}
                        >
                          <Star
                            size={12}
                            fill={
                              favorites.includes(connection.name)
                                ? "var(--atlas-amber)"
                                : "none"
                            }
                          />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {filteredConnections.length === 0 ? (
            <div className="empty-state" role="status">
              <span className="empty-state-icon">
                <Search size={20} aria-hidden="true" />
              </span>
              <strong className="empty-state-title">
                {t("desktop.searchEmptyTitle")}
              </strong>
              <span className="empty-state-hint">
                {t("desktop.searchEmptyHint")}
              </span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="snippets-section" aria-label={t("desktop.snippets")}>
        <header>
          <span>{t("desktop.snippets")}</span>
        </header>
        <div className="snippet-list">
          {commandSnippets.map((snippet) => (
            <button
              className="snippet-item"
              key={snippet.nameKey}
              onClick={() => onCommandInputChange(snippet.command)}
              title={snippet.command}
              type="button"
            >
              <Braces size={14} />
              <span>{t(snippet.nameKey)}</span>
              <small>{snippet.command}</small>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
});
