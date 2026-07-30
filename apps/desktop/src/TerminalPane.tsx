import { memo, useEffect, useRef, type FormEvent } from "react";
import {
  ChevronDown,
  ChevronUp,
  Monitor,
  Search,
  TerminalSquare,
  Video,
  X,
} from "lucide-react";
import { Badge, IconButton, Panel } from "@atlasterm/ui";
import type { Translator } from "@atlasterm/i18n";
import type { TerminalLine } from "./terminalExecutor";
import { useTerminalPane } from "./useTerminalPane";
import { PRIMARY_TERMINAL_PROMPT } from "./desktopTerminalSession";

type CommandFeedback = {
  detail: string;
  title: string;
  tone: "accepted" | "blocked";
};

export function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="terminal-search-highlight">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

export const TerminalPane = memo(function TerminalPane({
  title,
  lines,
  statusLabel,
  t,
  commandFeedback,
  commandInput,
  commandHistory = [],
  onCommandInputChange,
  onCommandSubmit,
  searchOpen,
  searchQuery,
  onSearchQueryChange,
  onSearchClose,
  active = false,
  recording = false,
  recordingTimeLabel,
  onToggleRecording,
  recordingDisabled = false,
}: {
  title: string;
  lines: TerminalLine[];
  statusLabel: string;
  t: Translator;
  commandFeedback?: CommandFeedback | null;
  commandInput?: string;
  commandHistory?: string[];
  onCommandInputChange?: (value: string) => void;
  onCommandSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  searchOpen?: boolean;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  onSearchClose?: () => void;
  active?: boolean;
  recording?: boolean;
  recordingTimeLabel?: string;
  onToggleRecording?: () => void;
  recordingDisabled?: boolean;
}) {
  const {
    currentMatchIdx,
    matchIndices,
    totalMatches,
    matchCount,
    goToMatch,
    canAcceptCommand,
    autocompleteIdx,
    setAutocompleteIdx,
    autocompleteSuggestions,
    handleCommandKeyDown,
    terminalPreRef,
    virtualizedLines,
    handleTerminalScroll,
    LINE_HEIGHT,
  } = useTerminalPane({
    lines,
    active,
    commandInput,
    commandHistory,
    onCommandInputChange,
    onCommandSubmit,
    searchQuery,
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const terminalRefActive = active || Boolean(searchOpen);
  const showRecordingButton = Boolean(onToggleRecording) || recordingDisabled;

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  return (
    <Panel className={`terminal-pane ${active ? "is-active" : ""} ${recording ? "is-recording" : ""}`}>
      <header>
        <span>
          <Monitor size={14} aria-hidden="true" /> {title}
        </span>
        <div>
          {recording ? (
            <span className="recording-indicator" aria-label={t("desktop.recording")}>
              <span className="recording-dot" />
              <span className="recording-time">{recordingTimeLabel}</span>
            </span>
          ) : null}
          <Badge tone={active ? "good" : "neutral"}>{statusLabel}</Badge>
          {showRecordingButton ? (
            <IconButton
              label={recording ? t("desktop.stopRecording") : t("desktop.startRecording")}
              disabled={recordingDisabled || !onToggleRecording}
              onClick={onToggleRecording}
            >
              <Video size={15} className={recording ? "recording-active" : ""} />
            </IconButton>
          ) : null}
        </div>
      </header>
      {searchOpen ? (
        <div className="terminal-search-bar" role="search" aria-label={t("desktop.searchPlaceholder")}>
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchInputRef}
            value={searchQuery ?? ""}
            onChange={(e) => onSearchQueryChange?.(e.target.value)}
            placeholder={t("desktop.searchPlaceholder")}
            aria-label={t("desktop.searchPlaceholder")}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onSearchClose?.();
              }
              if (e.key === "Enter") { e.preventDefault(); goToMatch(e.shiftKey ? -1 : 1); }
            }}
          />
          <span className="terminal-search-count">
            {totalMatches > 0 ? `${currentMatchIdx + 1}/${totalMatches}` : t("desktop.searchMatches", { count: matchCount })}
          </span>
          <IconButton label={t("desktop.searchPrevMatch")} onClick={() => goToMatch(-1)} disabled={totalMatches === 0}>
            <ChevronUp size={14} />
          </IconButton>
          <IconButton label={t("desktop.searchNextMatch")} onClick={() => goToMatch(1)} disabled={totalMatches === 0}>
            <ChevronDown size={14} />
          </IconButton>
          <IconButton label={t("desktop.searchClose")} onClick={onSearchClose}>
            <X size={14} />
          </IconButton>
        </div>
      ) : null}
      <pre
        aria-label={title}
        dir="ltr"
        role="log"
        tabIndex={0}
        ref={terminalRefActive ? terminalPreRef : undefined}
        onScroll={handleTerminalScroll}
        style={lines.length >= 200 ? { overflow: "auto" } : undefined}
      >
        {lines.length >= 200 ? (
          <span style={{ display: "block", height: virtualizedLines.totalHeight, position: "relative" }}>
            <span style={{ display: "block", position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${virtualizedLines.offsetY}px)` }}>
              {virtualizedLines.visible.map((line, vi) => {
                const lineIdx = virtualizedLines.startIndex + vi;
                const isCurrentMatch = searchQuery && totalMatches > 0 && matchIndices[currentMatchIdx] === lineIdx;
                return (
                  <code
                    className={`terminal-line terminal-line--${line.kind}${isCurrentMatch ? " terminal-line--current-match" : ""}`}
                    key={line.id}
                    ref={isCurrentMatch ? (el) => { if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } : undefined}
                    style={{ display: "block", height: LINE_HEIGHT }}
                  >
                    {searchQuery ? highlightMatch(line.text, searchQuery) : line.text}
                  </code>
                );
              })}
            </span>
          </span>
        ) : (
          lines.map((line, lineIdx) => {
            const isCurrentMatch = searchQuery && totalMatches > 0 && matchIndices[currentMatchIdx] === lineIdx;
            return (
              <code
                className={`terminal-line terminal-line--${line.kind}${isCurrentMatch ? " terminal-line--current-match" : ""}`}
                key={line.id}
                ref={isCurrentMatch ? (el) => { if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); } : undefined}
              >
                {searchQuery ? highlightMatch(line.text, searchQuery) : line.text}
              </code>
            );
          })
        )}
        {!canAcceptCommand ? <code className="prompt">{PRIMARY_TERMINAL_PROMPT} <span /></code> : null}
      </pre>
      {canAcceptCommand ? (
        <form className="terminal-command" onSubmit={onCommandSubmit}>
          <label>
            <span>{t("desktop.terminalInputLabel")}</span>
            <input
              aria-describedby={commandFeedback ? "terminal-command-feedback" : undefined}
              aria-autocomplete="list"
              aria-controls={autocompleteSuggestions.length > 0 ? "terminal-autocomplete" : undefined}
              autoComplete="off"
              dir="ltr"
              onChange={(event) => { onCommandInputChange?.(event.currentTarget.value); setAutocompleteIdx(-1); }}
              onKeyDown={handleCommandKeyDown}
              placeholder={t("desktop.terminalInputPlaceholder")}
              spellCheck={false}
              value={commandInput ?? ""}
            />
            {autocompleteSuggestions.length > 0 ? (
              <div className="terminal-autocomplete" id="terminal-autocomplete" role="listbox">
                {autocompleteSuggestions.map((suggestion, idx) => (
                  <div
                    key={suggestion}
                    className={`terminal-autocomplete-item${idx === autocompleteIdx ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={idx === autocompleteIdx}
                    onMouseDown={(e) => { e.preventDefault(); onCommandInputChange?.(suggestion); setAutocompleteIdx(-1); }}
                    onMouseEnter={() => setAutocompleteIdx(idx)}
                  >
                    <TerminalSquare size={12} />
                    <span>{suggestion}</span>
                  </div>
                ))}
                <div className="terminal-autocomplete-hint">
                  <kbd>Tab</kbd> {t("desktop.terminalAutocompleteComplete")} &middot; <kbd>Alt+&uarr;/&darr;</kbd>{" "}
                  {t("desktop.terminalAutocompleteNavigate")}
                </div>
              </div>
            ) : null}
          </label>
          {commandFeedback ? (
            <div
              aria-label={commandFeedback.title}
              className={`terminal-feedback terminal-feedback--${commandFeedback.tone}`}
              id="terminal-command-feedback"
              role={commandFeedback.tone === "blocked" ? "alert" : "status"}
            >
              <strong>{commandFeedback.title}</strong>
              <span>{commandFeedback.detail}</span>
            </div>
          ) : null}
        </form>
      ) : null}
    </Panel>
  );
});
