import { memo } from "react";
import { Gauge, GitBranch, KeyRound, Wifi } from "lucide-react";
import type {
  LocaleFormatters,
  TranslationKey,
  Translator,
} from "@atlasterm/i18n";
import type { TeamAccessSummary } from "./teamAccess";

type RightPanel = "inspector" | "sftp" | "team" | "forwarding" | "settings";

type StatusBarProps = {
  activeConnection: {
    latencyMs?: number;
    latencyLabel?: string;
    latencyLabelKey?: TranslationKey;
  };
  formatters: LocaleFormatters;
  hasActiveSession?: boolean;
  onPanelChange: (panel: RightPanel) => void;
  showTeamAccess?: boolean;
  t: Translator;
  teamAccess: TeamAccessSummary;
};

export const StatusBar = memo(function StatusBar({
  activeConnection,
  formatters,
  hasActiveSession = true,
  onPanelChange,
  showTeamAccess = true,
  t,
  teamAccess,
}: StatusBarProps) {
  const latencyText = hasActiveSession
    ? activeConnection.latencyLabelKey === "desktop.sampleDataShort"
      ? t("desktop.notAvailable")
      : "latencyMs" in activeConnection
        ? formatters.latency(activeConnection.latencyMs ?? 0)
        : activeConnection.latencyLabelKey
          ? t(activeConnection.latencyLabelKey)
          : (activeConnection.latencyLabel ?? t("desktop.notAvailable"))
    : t("desktop.notAvailable");

  return (
    <footer className="statusbar" role="contentinfo">
      <button
        type="button"
        className="statusbar-item"
        aria-label={t("desktop.sessionContext")}
        onClick={() => onPanelChange("inspector")}
      >
        <Wifi size={14} aria-hidden="true" />{" "}
        {hasActiveSession ? t("desktop.sessions") : t("desktop.noSession")}
      </button>
      <button
        type="button"
        className="statusbar-item"
        aria-label={t("desktop.openSftp")}
        onClick={() => onPanelChange("sftp")}
      >
        <GitBranch size={14} aria-hidden="true" />{" "}
        {hasActiveSession ? t("desktop.sftp") : t("desktop.noSession")}
      </button>
      <button
        type="button"
        className="statusbar-item"
        aria-label={t("desktop.latencyHistory")}
        onClick={() => onPanelChange("inspector")}
      >
        <Gauge size={14} aria-hidden="true" /> {latencyText}
      </button>
      {showTeamAccess ? (
        <button
          type="button"
          className="statusbar-item"
          aria-label={t("team.accessSummary")}
          onClick={() => onPanelChange("team")}
        >
          <KeyRound size={14} aria-hidden="true" />{" "}
          {t("team.summary", {
            active: formatters.number(teamAccess.activeJitMembers),
            pending: formatters.number(teamAccess.pendingVaults),
          })}{" "}
          · {t("desktop.sampleDataShort")}
        </button>
      ) : null}
    </footer>
  );
});
