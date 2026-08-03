import { memo, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  Boxes,
  Braces,
  CircleAlert,
  CircleDollarSign,
  ClipboardCheck,
  Database,
  DownloadCloud,
  FileDown,
  FileUp,
  Folder,
  Gauge,
  HardDrive,
  KeyRound,
  LoaderCircle,
  Network,
  Play,
  Plus,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Trash2,
  UploadCloud,
  UserCheck,
  X,
  Zap,
} from "lucide-react";
import { Badge, Button, IconButton, Panel } from "@atlasterm/ui";
import {
  auditEvents,
  getTeamAccessSummary,
  memberRoles,
  sharedVaults,
  teamAccessRequests,
  type TeamAccessRequest,
  type TeamAccessRequestStatus,
  type TeamAccessStatus,
  type TeamAuditEvent,
} from "./teamAccess";
import type {
  LocaleFormatters,
  TranslationKey,
  Translator,
} from "@atlasterm/i18n";
import { ThirdPartyNoticesOverlay } from "./ThirdPartyNoticesOverlay";
import { InlineAlert } from "./InlineAlert";
import { Sparkline } from "./sparkline";
import { desktopGroupLabel } from "./desktopGroups";
import { isSafeSftpEntryName } from "./sftpRemotePath";

type RelativeTimeFormatUnit =
  "year" | "quarter" | "month" | "week" | "day" | "hour" | "minute" | "second";

type Connection = {
  readonly name: string;
  readonly host: string;
  readonly group: string;
  readonly status: string;
  readonly color: "neutral" | "good" | "warn" | "info" | "premium";
  readonly tags: readonly string[];
  readonly latencyMs?: number;
  readonly latencyLabel?: string;
  readonly latencyHistory?: readonly number[];
};

export type InspectorSessionContext = {
  readonly regionLabel: string;
  readonly userHandle: string;
};

export type InspectorConnectionStats = {
  readonly averageLatencyMs?: number;
  readonly onlineConnections: number;
  readonly totalConnections: number;
};

type SftpItem = {
  readonly name: string;
  readonly type: "dir" | "file";
  readonly sizeBytes: number | undefined;
  readonly modified: { readonly unit: string; readonly value: number };
};

export type ForwardRule = {
  id: string;
  direction: "Local";
  bindHost: string;
  bindPort: number;
  targetHost: string;
  targetPort: number;
  active: boolean;
};

export const SAMPLE_FORWARD_RULES: readonly ForwardRule[] = [
  {
    id: "fwd-1",
    direction: "Local" as const,
    bindHost: "127.0.0.1",
    bindPort: 5432,
    targetHost: "db.prod.internal",
    targetPort: 5432,
    active: true,
  },
  {
    id: "fwd-2",
    direction: "Local" as const,
    bindHost: "127.0.0.1",
    bindPort: 6379,
    targetHost: "cache.prod.internal",
    targetPort: 6379,
    active: false,
  },
];

function vaultStatusTone(status: TeamAccessStatus) {
  if (status === "approved") return "good";
  if (status === "pending") return "warn";
  return "info";
}

function connectionStatusLabel(status: string, t: Translator) {
  if (status === "sample") return t("desktop.sampleDataShort");
  if (status === "busy") return t("desktop.connectionBusy");
  if (status === "locked") return t("desktop.locked");
  return t("desktop.connectionStatusOnline");
}

function teamStatusLabel(
  status: TeamAccessStatus | TeamAccessRequestStatus,
  t: Translator,
) {
  if (status === "approved") return t("team.statusApproved");
  if (status === "rejected") return t("team.statusRejected");
  if (status === "recording") return t("team.statusRecording");
  return t("team.pending");
}

function localizedText(t: Translator, key?: TranslationKey, fallback = "") {
  return key ? t(key) : fallback;
}

export function formatClockTime(value: string, formatters: LocaleFormatters) {
  if (value === "now") return formatters.relativeTime(0, "minute");
  const clockMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!clockMatch) return value;
  const [, hour, minute] = clockMatch;
  return formatters.time(Date.UTC(2026, 4, 24, Number(hour), Number(minute)), {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

export { Sparkline };

export const LatencyChart = memo(function LatencyChart({
  color,
  label,
  values,
}: {
  color: "neutral" | "good" | "warn" | "info" | "premium";
  label: string;
  values: readonly number[];
}) {
  const series = values.length > 0 ? values : [0];
  const max = Math.max(...series);
  const min = Math.min(...series);
  const range = max - min || 1;
  const w = 280;
  const h = 80;
  const padding = 4;
  const chartW = w - padding * 2;
  const chartH = h - padding * 2;
  const divisor = Math.max(series.length - 1, 1);

  const points = series
    .map(
      (v, i) =>
        `${padding + (i / divisor) * chartW},${padding + chartH - ((v - min) / range) * chartH}`,
    )
    .join(" ");

  const areaPoints = `${padding},${padding + chartH} ${points} ${padding + chartW},${padding + chartH}`;

  const colorMap: Record<string, string> = {
    good: "var(--atlas-green)",
    info: "var(--atlas-blue)",
    warn: "var(--atlas-amber)",
    premium: "var(--atlas-violet)",
  };

  const strokeColor = colorMap[color] ?? "var(--atlas-text-muted)";

  const avg = Math.round(series.reduce((a, b) => a + b, 0) / series.length);
  const avgY = padding + chartH - ((avg - min) / range) * chartH;

  return (
    <svg
      className="latency-chart-svg"
      role="img"
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      aria-label={label}
    >
      <defs>
        <linearGradient
          id={`latency-grad-${color}`}
          x1="0"
          x2="0"
          y1="0"
          y2="1"
        >
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={strokeColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#latency-grad-${color})`} points={areaPoints} />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <line
        x1={padding}
        y1={avgY}
        x2={padding + chartW}
        y2={avgY}
        stroke="var(--atlas-text-faint)"
        strokeWidth="1"
        strokeDasharray="4 3"
      />
      {series.map((v, i) => {
        const cx = padding + (i / divisor) * chartW;
        const cy = padding + chartH - ((v - min) / range) * chartH;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r="3"
            fill={strokeColor}
            stroke="var(--atlas-bg)"
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
  );
});

export const InspectorPanel = memo(function InspectorPanel({
  activeConnection,
  connectionStats,
  formatters,
  hasActiveSession = true,
  onOpenForwarding,
  onPrepareCommand,
  sessionContext,
  t,
}: {
  activeConnection: Connection;
  connectionStats: InspectorConnectionStats;
  formatters: LocaleFormatters;
  hasActiveSession?: boolean;
  onOpenForwarding?: () => void;
  onPrepareCommand?: () => void;
  sessionContext: InspectorSessionContext;
  t: Translator;
}) {
  return (
    <div className="stack">
      <Panel className="context-card">
        <header>
          <span>{activeConnection.name}</span>
          <Badge tone={activeConnection.color}>
            {connectionStatusLabel(activeConnection.status, t)}
          </Badge>
        </header>
        <dl className="facts">
          <div>
            <dt>{t("desktop.host")}</dt>
            <dd>{activeConnection.host}</dd>
          </div>
          <div>
            <dt>{t("desktop.group")}</dt>
            <dd>{desktopGroupLabel(activeConnection.group, t)}</dd>
          </div>
          <div>
            <dt>{t("desktop.tags")}</dt>
            <dd>{activeConnection.tags.join(", ")}</dd>
          </div>
          {activeConnection.latencyMs !== undefined ? (
            <div>
              <dt>{t("desktop.avgLatency")}</dt>
              <dd>{formatters.latency(activeConnection.latencyMs)}</dd>
            </div>
          ) : null}
        </dl>
        {"latencyHistory" in activeConnection &&
        activeConnection.latencyHistory &&
        activeConnection.latencyHistory.length > 0 ? (
          <div className="latency-chart">
            <div className="latency-chart-header">
              <span>{t("desktop.latencyHistory")}</span>
              <span className="latency-chart-range">
                {formatters.latency(
                  Math.min(...activeConnection.latencyHistory),
                )}
                -
                {formatters.latency(
                  Math.max(...activeConnection.latencyHistory),
                )}
              </span>
            </div>
            <LatencyChart
              values={activeConnection.latencyHistory}
              color={activeConnection.color}
              label={t("desktop.latencyChartLabel", {
                average: formatters.latency(
                  Math.round(
                    activeConnection.latencyHistory.reduce((a, b) => a + b, 0) /
                      activeConnection.latencyHistory.length,
                  ),
                ),
              })}
            />
          </div>
        ) : null}
      </Panel>
      <Panel className="context-card">
        <header>
          <span>{t("desktop.sessionContext")}</span>
          <Badge tone={hasActiveSession ? "good" : "neutral"}>
            {hasActiveSession ? t("desktop.trusted") : t("desktop.noSession")}
          </Badge>
        </header>
        <dl className="facts">
          <div>
            <dt>{t("desktop.user")}</dt>
            <dd>{sessionContext.userHandle}</dd>
          </div>
          <div>
            <dt>{t("desktop.policy")}</dt>
            <dd>
              {hasActiveSession
                ? t("desktop.productionPolicy")
                : t("desktop.noSessionActionDetail")}
            </dd>
          </div>
          <div>
            <dt>{t("desktop.region")}</dt>
            <dd>{sessionContext.regionLabel}</dd>
          </div>
        </dl>
      </Panel>
      <Panel className="context-card">
        <header>
          <span>{t("desktop.connectionStats")}</span>
          <Gauge size={16} aria-hidden="true" />
        </header>
        <dl className="facts">
          <div>
            <dt>{t("desktop.connections")}</dt>
            <dd>{formatters.number(connectionStats.totalConnections)}</dd>
          </div>
          <div>
            <dt>
              {hasActiveSession
                ? t("desktop.connectionsOnline")
                : t("desktop.noSession")}
            </dt>
            <dd>{formatters.number(connectionStats.onlineConnections)}</dd>
          </div>
          <div>
            <dt>{t("desktop.avgLatency")}</dt>
            <dd>
              {hasActiveSession &&
              connectionStats.averageLatencyMs !== undefined
                ? formatters.latency(connectionStats.averageLatencyMs)
                : t("desktop.notAvailable")}
            </dd>
          </div>
        </dl>
      </Panel>
      <Panel className="context-card">
        <header>
          <span>{t("desktop.runbook")}</span>
          <Badge tone={hasActiveSession ? "info" : "neutral"}>
            {hasActiveSession ? t("desktop.attached") : t("desktop.noSession")}
          </Badge>
        </header>
        <div className="runbook-item">
          <Braces size={16} aria-hidden="true" />
          <span>{t("desktop.gatewayTriage")}</span>
          <Button
            disabled={!hasActiveSession || !onPrepareCommand}
            onClick={onPrepareCommand}
            size="sm"
            title={
              !hasActiveSession
                ? t("desktop.noSessionActionDetail")
                : !onPrepareCommand
                  ? t("desktop.notAvailable")
                  : undefined
            }
            variant="ghost"
          >
            <Play size={13} aria-hidden="true" /> {t("desktop.run")}
          </Button>
        </div>
        <div className="runbook-item">
          <Network size={16} aria-hidden="true" />
          <span>{t("desktop.openSecureTunnel")}</span>
          <Button
            disabled={!hasActiveSession || !onOpenForwarding}
            onClick={onOpenForwarding}
            size="sm"
            title={
              !hasActiveSession ? t("desktop.noSessionActionDetail") : undefined
            }
            variant="ghost"
          >
            <Zap size={13} aria-hidden="true" /> {t("desktop.start")}
          </Button>
        </div>
      </Panel>
    </div>
  );
});

export type SftpDirectoryView = {
  active: boolean;
  path: string;
  status:
    | { phase: "idle" }
    | { phase: "loading" }
    | {
        phase: "ready";
        entries: readonly {
          name: string;
          is_dir: boolean;
          size: number | null;
        }[];
      }
    | { phase: "error"; message: string };
  onRefresh?: () => void;
  onOpenDir?: (name: string) => void;
  onGoUp?: () => void;
  canGoUp?: boolean;
};

export type SftpTransferView = {
  status:
    | { phase: "idle" }
    | { phase: "transferring" }
    | { phase: "error"; message: string };
  onUpload: (file: File, directoryPath?: string) => void;
  onDownload: (
    name: string,
    size: number | null,
    directoryPath?: string,
  ) => void;
};

function SftpStateNotice({
  detail,
  icon,
  role = "status",
  title,
  tone,
}: {
  detail?: string;
  icon: "error" | "loading" | "transfer";
  role?: "alert" | "status";
  title: string;
  tone: "error" | "loading" | "transfer";
}) {
  const Icon =
    icon === "error"
      ? CircleAlert
      : icon === "transfer"
        ? UploadCloud
        : LoaderCircle;

  return (
    <div className={`sftp-state sftp-state--${tone}`} role={role}>
      <span className="sftp-state-icon">
        <Icon size={18} aria-hidden="true" />
      </span>
      <span>
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </div>
  );
}

export const SftpPanel = memo(function SftpPanel({
  sftpItems,
  formatters,
  t,
  directory,
  transfer,
}: {
  sftpItems: readonly SftpItem[];
  formatters: LocaleFormatters;
  t: Translator;
  directory?: SftpDirectoryView;
  transfer?: SftpTransferView;
}) {
  const live = directory?.active ? directory : undefined;
  const liveEntries =
    live?.status.phase === "ready" ? live.status.entries : undefined;
  const canTransfer = Boolean(transfer);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [pendingUpload, setPendingUpload] = useState<{
    file: File;
    directoryPath: string;
  } | null>(null);
  const [selectedDownloadName, setSelectedDownloadName] = useState<
    string | null
  >(null);
  const selectedEntry = liveEntries?.find(
    (entry) =>
      isSafeSftpEntryName(entry.name) &&
      !entry.is_dir &&
      entry.name === selectedDownloadName,
  );
  const canDownloadSelected = Boolean(transfer && selectedEntry);
  const transferBusy = transfer?.status.phase === "transferring";

  useEffect(() => {
    if (!canTransfer) {
      setPendingUpload(null);
    }
  }, [canTransfer]);

  useEffect(() => {
    setPendingUpload(null);
    setSelectedDownloadName(null);
  }, [live?.path, liveEntries]);

  function queueOrUploadFile(file: File) {
    const collision = liveEntries?.some((entry) => entry.name === file.name);
    if (collision) {
      setPendingUpload({ file, directoryPath: live?.path ?? "." });
      return;
    }
    transfer?.onUpload(file, live?.path);
  }

  function handleUploadFileChange(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    queueOrUploadFile(file);
  }

  function confirmPendingUpload() {
    if (!pendingUpload || pendingUpload.directoryPath !== live?.path) {
      setPendingUpload(null);
      return;
    }
    transfer?.onUpload(pendingUpload.file, pendingUpload.directoryPath);
    setPendingUpload(null);
  }

  return (
    <div className="stack">
      <Panel className="context-card">
        <header>
          <span>{live ? live.path : "/srv/atlas"}</span>
          <Badge tone="info">
            {live ? t("desktop.sftp") : t("desktop.sampleDataShort")}
          </Badge>
        </header>
        <div className="sftp-toolbar">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canTransfer || transferBusy}
            onClick={() => uploadInputRef.current?.click()}
            title={
              !canTransfer ? t("desktop.noSessionActionDetail") : undefined
            }
          >
            <FileUp size={13} aria-hidden="true" /> {t("desktop.upload")}
          </Button>
          {transfer ? (
            <input
              ref={uploadInputRef}
              type="file"
              onChange={handleUploadFileChange}
              aria-hidden="true"
              tabIndex={-1}
              style={{ display: "none" }}
            />
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={!canDownloadSelected}
            onClick={
              selectedEntry && transfer
                ? () =>
                    transfer.onDownload(
                      selectedEntry.name,
                      selectedEntry.size,
                      live?.path,
                    )
                : undefined
            }
            title={
              !canTransfer ? t("desktop.noSessionActionDetail") : undefined
            }
          >
            <DownloadCloud size={13} aria-hidden="true" />{" "}
            {t("desktop.download")}
          </Button>
          {live ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={!live.canGoUp}
              onClick={live.onGoUp}
            >
              {t("desktop.sftpUp")}
            </Button>
          ) : null}
          {live ? (
            <Button size="sm" variant="ghost" onClick={live.onRefresh}>
              {t("desktop.sftpRefresh")}
            </Button>
          ) : null}
        </div>
        {live && live.status.phase === "loading" ? (
          <SftpStateNotice
            icon="loading"
            title={t("desktop.sftpLoading")}
            tone="loading"
          />
        ) : null}
        {live && live.status.phase === "error" ? (
          <SftpStateNotice
            detail={live.status.message}
            icon="error"
            role="alert"
            title={t("desktop.sftpError")}
            tone="error"
          />
        ) : null}
        {transfer && transfer.status.phase === "transferring" ? (
          <SftpStateNotice
            icon="transfer"
            title={t("desktop.sftpTransferring")}
            tone="transfer"
          />
        ) : null}
        {transfer && transfer.status.phase === "error" ? (
          <SftpStateNotice
            detail={transfer.status.message}
            icon="error"
            role="alert"
            title={t("desktop.sftpTransferError")}
            tone="error"
          />
        ) : null}
        {pendingUpload ? (
          <div
            className="sftp-overwrite-confirm"
            role="group"
            aria-label={t("desktop.sftpOverwriteTitle")}
          >
            <strong>{t("desktop.sftpOverwriteTitle")}</strong>
            <small>
              {t("desktop.sftpOverwriteDetail", {
                name: pendingUpload.file.name,
              })}
            </small>
            <span className="sftp-overwrite-confirm-actions">
              <Button
                size="sm"
                variant="ghost"
                disabled={transferBusy}
                onClick={() => setPendingUpload(null)}
              >
                <X size={13} aria-hidden="true" />{" "}
                {t("desktop.sftpOverwriteCancel")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={transferBusy}
                onClick={confirmPendingUpload}
              >
                <UploadCloud size={13} aria-hidden="true" />{" "}
                {t("desktop.sftpOverwriteConfirm")}
              </Button>
            </span>
          </div>
        ) : null}
        {liveEntries && liveEntries.length === 0 ? (
          <div className="empty-state" role="status">
            <span className="empty-state-icon">
              <Folder size={20} aria-hidden="true" />
            </span>
            <strong className="empty-state-title">
              {t("desktop.sftpEmpty")}
            </strong>
            <span className="empty-state-hint">
              {t("desktop.sftpEmptyHint")}
            </span>
          </div>
        ) : null}
        <div
          className="file-list"
          role="list"
          aria-label={t("desktop.sftpFiles")}
        >
          {liveEntries
            ? liveEntries.map((entry) => {
                const onOpenDir = live?.onOpenDir;
                const safeEntryName = isSafeSftpEntryName(entry.name);
                const onClick = !safeEntryName
                  ? undefined
                  : entry.is_dir
                    ? onOpenDir
                      ? () => onOpenDir(entry.name)
                      : undefined
                    : transfer
                      ? () => setSelectedDownloadName(entry.name)
                      : undefined;
                const isSelected =
                  !entry.is_dir && entry.name === selectedDownloadName;
                return (
                  <button
                    key={entry.name}
                    type="button"
                    aria-label={`${entry.is_dir ? t("desktop.folder") : t("desktop.file")}: ${entry.name}`}
                    aria-pressed={entry.is_dir ? undefined : isSelected}
                    className={isSelected ? "is-selected" : undefined}
                    role="listitem"
                    disabled={!onClick}
                    onClick={onClick}
                    title={
                      !safeEntryName ? t("desktop.notAvailable") : undefined
                    }
                  >
                    {entry.is_dir ? (
                      <Folder size={16} aria-hidden="true" />
                    ) : (
                      <FileDown size={16} aria-hidden="true" />
                    )}
                    <span>{entry.name}</span>
                    <small>
                      {!safeEntryName || entry.size === null
                        ? t("desktop.notAvailable")
                        : formatters.fileSize(entry.size)}
                    </small>
                  </button>
                );
              })
            : !live
              ? sftpItems.map((item) => (
                  <button
                    key={item.name}
                    type="button"
                    aria-label={`${item.type === "dir" ? t("desktop.folder") : t("desktop.file")}: ${item.name}`}
                    role="listitem"
                    disabled
                    title={t("desktop.noSessionActionDetail")}
                  >
                    {item.type === "dir" ? (
                      <Folder size={16} aria-hidden="true" />
                    ) : (
                      <FileDown size={16} aria-hidden="true" />
                    )}
                    <span>{item.name}</span>
                    <small>
                      {item.sizeBytes === undefined
                        ? t("desktop.notAvailable")
                        : formatters.fileSize(item.sizeBytes)}
                    </small>
                    <small>
                      {formatters.relativeTime(
                        item.modified.value,
                        item.modified.unit as RelativeTimeFormatUnit,
                      )}
                    </small>
                  </button>
                ))
              : null}
        </div>
      </Panel>
    </div>
  );
});

export const TeamAccessPanel = memo(function TeamAccessPanel({
  formatters,
  t,
}: {
  formatters: LocaleFormatters;
  t: Translator;
}) {
  const [reviewVisible, setReviewVisible] = useState(false);
  const summary = getTeamAccessSummary();
  const primaryRequest: TeamAccessRequest = teamAccessRequests[0];
  const sampleAuditEvents: readonly TeamAuditEvent[] = auditEvents;

  return (
    <div className="stack">
      <Panel className="context-card team-access-card">
        <header>
          <span>{t("team.access")}</span>
          <Badge tone="neutral">{t("desktop.sampleDataShort")}</Badge>
        </header>
        <div className="team-summary" aria-label={t("team.accessSummary")}>
          <span>
            <KeyRound size={15} />
            <strong>{formatters.number(summary.activeJitMembers)}</strong>
            <small>{t("team.jitActive")}</small>
          </span>
          <span>
            <Database size={15} />
            <strong>{formatters.number(sharedVaults.length)}</strong>
            <small>{t("desktop.sharedVaults")}</small>
          </span>
          <span>
            <ClipboardCheck size={15} />
            <strong>{formatters.number(summary.recordedEvents)}</strong>
            <small>{t("team.auditEvents")}</small>
          </span>
        </div>
        <div className="jit-request">
          <div>
            <strong>
              {localizedText(t, primaryRequest.titleKey, primaryRequest.title)}
            </strong>
            <small>
              {localizedText(
                t,
                primaryRequest.detailKey,
                primaryRequest.detail,
              )}
            </small>
          </div>
          <Button
            aria-expanded={reviewVisible}
            aria-controls="team-access-review"
            onClick={() => setReviewVisible((visible) => !visible)}
            size="sm"
            variant="ghost"
          >
            <ShieldCheck size={13} /> {t("team.review")}
          </Button>
        </div>
        {reviewVisible ? (
          <div
            className="review-card"
            id="team-access-review"
            role="region"
            aria-label={t("team.accessReview")}
          >
            <div>
              <span
                className="review-status"
                role="status"
                aria-label={t("team.accessRequestStatus")}
              >
                {teamStatusLabel(primaryRequest.status, t)}
              </span>
              <strong>{primaryRequest.requestedBy}</strong>
              <small>
                {primaryRequest.target}
                {primaryRequest.reviewer
                  ? ` / ${t("team.reviewedBy", { reviewer: primaryRequest.reviewer })}`
                  : ""}
              </small>
            </div>
            <div className="review-actions">
              <Button
                disabled
                size="sm"
                title={t("desktop.notAvailable")}
                variant="ghost"
              >
                {t("team.approve")}
              </Button>
              <Button
                disabled
                size="sm"
                title={t("desktop.notAvailable")}
                variant="ghost"
              >
                {t("team.reject")}
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      <Panel className="context-card">
        <header>
          <span>{t("team.sharedVault")}</span>
          <Badge tone="info">
            {summary.pendingVaults} {t("team.pending")}
          </Badge>
        </header>
        <div className="vault-list">
          {sharedVaults.map((vault) => (
            <div key={vault.nameKey}>
              <span
                className={`status-dot status-dot--${vaultStatusTone(vault.status)}`}
                aria-label={teamStatusLabel(vault.status, t)}
                role="img"
              />
              <div>
                <strong>{t(vault.nameKey)}</strong>
                <small>
                  {t(vault.scopeKey)} / {t(vault.ownersKey)}
                </small>
              </div>
              <Badge
                tone={
                  vault.status === "pending"
                    ? "warn"
                    : vault.status === "recording"
                      ? "info"
                      : "good"
                }
              >
                {teamStatusLabel(vault.status, t)}
              </Badge>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="context-card">
        <header>
          <span>{t("team.memberRoles")}</span>
          <UserCheck size={16} />
        </header>
        <div className="role-list">
          {memberRoles.map((member) => (
            <div key={member.handle}>
              <span>
                <strong>{member.name}</strong>
                <small>{member.handle}</small>
              </span>
              <span>
                <strong>{t(member.roleKey)}</strong>
                <small>{t(member.accessKey)}</small>
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="context-card">
        <header>
          <span>{t("team.auditTrail")}</span>
          <Badge tone="info">{t("desktop.sampleDataShort")}</Badge>
        </header>
        <div className="audit-list">
          {sampleAuditEvents.map((event) => (
            <div key={`${event.time}-${event.actionKey ?? event.action}`}>
              <time>{formatClockTime(event.time, formatters)}</time>
              <span>
                <strong>
                  {localizedText(t, event.actionKey, event.action)}
                </strong>
                <small>
                  {event.actor} /{" "}
                  {localizedText(t, event.targetKey, event.target)}
                </small>
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
});

export type ForwardRuntimeView = {
  runtime: Record<
    string,
    { active: boolean; boundAddr?: string; error?: string; pending?: boolean }
  >;
  onStart: (
    id: string,
    bindAddr: string,
    targetHost: string,
    targetPort: number,
  ) => void;
  onStop: (id: string) => void;
};

type ForwardDraft = {
  bindHost: string;
  bindPort: string;
  targetHost: string;
  targetPort: string;
};

const defaultForwardDraft: ForwardDraft = {
  bindHost: "127.0.0.1",
  bindPort: "0",
  targetHost: "",
  targetPort: "5432",
};

function isLoopbackBindHost(value: string) {
  const host = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function parsePort(value: string, allowZero: boolean) {
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(port) && port >= minimum && port <= 65535
    ? port
    : undefined;
}

function formatBindAddress(host: string, port: number) {
  const trimmedHost = host.trim();
  return trimmedHost.includes(":") && !trimmedHost.startsWith("[")
    ? `[${trimmedHost}]:${port}`
    : `${trimmedHost}:${port}`;
}

function validateForwardDraft(draft: ForwardDraft) {
  const bindPort = parsePort(draft.bindPort, true);
  const targetPort = parsePort(draft.targetPort, false);
  const targetHost = draft.targetHost.trim();

  if (
    !isLoopbackBindHost(draft.bindHost) ||
    bindPort === undefined ||
    !targetHost ||
    targetPort === undefined
  ) {
    return undefined;
  }

  return {
    bindHost: draft.bindHost.trim().replace(/^\[|\]$/g, ""),
    bindPort,
    targetHost,
    targetPort,
  };
}

export const ForwardingPanel = memo(function ForwardingPanel({
  customRules,
  forwards,
  onAddCustomRule,
  onRemoveCustomRule,
  rules = SAMPLE_FORWARD_RULES,
  showSampleRules = true,
  t,
}: {
  customRules?: readonly ForwardRule[];
  forwards?: ForwardRuntimeView;
  onAddCustomRule?: (rule: ForwardRule) => void;
  onRemoveCustomRule?: (id: string) => void;
  rules?: readonly ForwardRule[];
  showSampleRules?: boolean;
  t: Translator;
}) {
  const [addingRule, setAddingRule] = useState(false);
  const [localCustomRules, setLocalCustomRules] = useState<ForwardRule[]>([]);
  const [draft, setDraft] = useState<ForwardDraft>(defaultForwardDraft);
  const managedCustomRules = customRules ?? localCustomRules;
  const validDraft = validateForwardDraft(draft);
  const visibleRules = [
    ...(showSampleRules ? rules : []),
    ...managedCustomRules,
  ];

  function updateDraft(field: keyof ForwardDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handleAddRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validDraft) {
      return;
    }

    const usedIds = new Set(visibleRules.map((rule) => rule.id));
    let suffix = 1;
    while (usedIds.has(`custom-fwd-${suffix}`)) suffix += 1;
    const rule: ForwardRule = {
      id: `custom-fwd-${suffix}`,
      direction: "Local",
      active: false,
      ...validDraft,
    };
    if (onAddCustomRule) {
      onAddCustomRule(rule);
    } else {
      setLocalCustomRules((current) => [...current, rule]);
    }
    setDraft(defaultForwardDraft);
    setAddingRule(false);
  }

  return (
    <div className="stack">
      <Panel className="context-card">
        <header>
          <span>{t("desktop.forwarding")}</span>
          <IconButton
            label={t("desktop.forwardAdd")}
            onClick={() => setAddingRule((open) => !open)}
          >
            <Plus size={16} />
          </IconButton>
        </header>
        {addingRule ? (
          <form className="forward-rule-form" onSubmit={handleAddRule}>
            <label>
              <span>
                {t("desktop.forwardLocal")} {t("desktop.host")}
              </span>
              <input
                value={draft.bindHost}
                onChange={(event) =>
                  updateDraft("bindHost", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>
                {t("desktop.forwardLocal")} {t("desktop.port")}
              </span>
              <input
                min={0}
                max={65535}
                type="number"
                value={draft.bindPort}
                onChange={(event) =>
                  updateDraft("bindPort", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>
                {t("desktop.forwardRemote")} {t("desktop.host")}
              </span>
              <input
                value={draft.targetHost}
                onChange={(event) =>
                  updateDraft("targetHost", event.currentTarget.value)
                }
              />
            </label>
            <label>
              <span>
                {t("desktop.forwardRemote")} {t("desktop.port")}
              </span>
              <input
                min={1}
                max={65535}
                type="number"
                value={draft.targetPort}
                onChange={(event) =>
                  updateDraft("targetPort", event.currentTarget.value)
                }
              />
            </label>
            <div className="forward-rule-form-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setAddingRule(false)}
              >
                {t("desktop.close")}
              </Button>
              <Button type="submit" disabled={!validDraft}>
                {t("desktop.forwardAdd")}
              </Button>
            </div>
          </form>
        ) : null}
        {visibleRules.length === 0 ? (
          <div className="empty-state" role="status">
            <span className="empty-state-icon">
              <Network size={20} aria-hidden="true" />
            </span>
            <strong className="empty-state-title">
              {t("desktop.forwardNoRules")}
            </strong>
            <span className="empty-state-hint">
              {t("desktop.forwardNoRulesHint")}
            </span>
          </div>
        ) : (
          <div className="forward-list">
            {visibleRules.map((rule) => {
              const rt = forwards?.runtime[rule.id];
              const isActive = rt ? rt.active : false;
              const isPending = Boolean(rt?.pending);
              const isCustomRule = managedCustomRules.some(
                (candidate) => candidate.id === rule.id,
              );
              return (
                <div
                  className={`forward-rule ${isActive ? "is-active" : ""}`}
                  key={rule.id}
                >
                  <div className="forward-rule-header">
                    <Network size={14} />
                    <span className="forward-direction">
                      {t("desktop.forwardLocal")}
                    </span>
                    <Badge tone={isActive ? "good" : "neutral"}>
                      {isActive
                        ? t("desktop.forwardActive")
                        : t("desktop.forwardInactive")}
                    </Badge>
                  </div>
                  <div className="forward-rule-details">
                    <small>
                      {rt?.boundAddr ?? `${rule.bindHost}:${rule.bindPort}`}
                    </small>
                    <ArrowRight size={12} />
                    <small>
                      {rule.targetHost}:{rule.targetPort}
                    </small>
                  </div>
                  {rt?.error ? (
                    <InlineAlert className="forward-error" title={rt.error} />
                  ) : null}
                  <div className="forward-rule-actions">
                    <Button
                      disabled={!forwards || isPending}
                      variant="ghost"
                      onClick={
                        forwards
                          ? () =>
                              isActive
                                ? forwards.onStop(rule.id)
                                : forwards.onStart(
                                    rule.id,
                                    formatBindAddress(
                                      rule.bindHost,
                                      rule.bindPort,
                                    ),
                                    rule.targetHost,
                                    rule.targetPort,
                                  )
                          : undefined
                      }
                      title={
                        !forwards
                          ? t("desktop.noSessionActionDetail")
                          : undefined
                      }
                    >
                      {isActive
                        ? t("desktop.forwardStop")
                        : t("desktop.forwardStart")}
                    </Button>
                    {isCustomRule ? (
                      <IconButton
                        disabled={isActive || isPending}
                        label={t("desktop.contextDelete")}
                        onClick={() => {
                          if (onRemoveCustomRule) {
                            onRemoveCustomRule(rule.id);
                          } else {
                            setLocalCustomRules((current) =>
                              current.filter(
                                (candidate) => candidate.id !== rule.id,
                              ),
                            );
                          }
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
});

export type SettingsConnectionsIO = {
  exportConnections: readonly {
    name: string;
    host: string;
    group: string;
    tags: readonly string[];
  }[];
  onImport: (parsed: unknown) => void;
  onImportError?: () => void;
};

export type SettingsKnownHosts = {
  count: number;
  entries: readonly {
    key: string;
    host: string;
    port: number;
    fingerprint: string;
    first_seen_at_ms: number | null;
    last_seen_at_ms: number | null;
    source: "legacy" | "tofu" | "confirmed";
  }[];
  onClear: () => Promise<void> | void;
  onRemove: (hostKey: string) => Promise<void> | void;
};

export type SettingsTelemetryControl = {
  available: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

export type SettingsLegalDocuments = {
  available: boolean;
  loadThirdPartyNotices: () => Promise<string>;
};

const CONNECTION_IMPORT_MAX_BYTES = 1024 * 1024;

export const SettingsPanel = memo(function SettingsPanel({
  t,
  connectionsIO,
  knownHosts,
  legal,
  showFutureProductSurfaces = true,
  telemetry,
}: {
  t: Translator;
  connectionsIO?: SettingsConnectionsIO;
  knownHosts?: SettingsKnownHosts;
  legal?: SettingsLegalDocuments;
  showFutureProductSurfaces?: boolean;
  telemetry?: SettingsTelemetryControl;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingKnownHostAction, setPendingKnownHostAction] = useState<
    { type: "clear" } | { type: "remove"; key: string } | null
  >(null);
  const [knownHostActionBusy, setKnownHostActionBusy] = useState(false);
  const [legalBusy, setLegalBusy] = useState(false);
  const [legalError, setLegalError] = useState(false);
  const [thirdPartyNotices, setThirdPartyNotices] = useState<string | null>(
    null,
  );

  function handleExportConnections() {
    const blob = new Blob(
      [
        JSON.stringify(
          { connections: connectionsIO?.exportConnections ?? [] },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "joessh-connections.json";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function handleImportConnections(event: FormEvent<HTMLInputElement>) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > CONNECTION_IMPORT_MAX_BYTES) {
      connectionsIO?.onImportError?.();
      input.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        connectionsIO?.onImport(parsed);
      } catch {
        connectionsIO?.onImportError?.();
      }
    };
    reader.onerror = () => connectionsIO?.onImportError?.();
    reader.readAsText(file);
    input.value = "";
  }

  async function confirmKnownHostAction() {
    if (!knownHosts || !pendingKnownHostAction) return;
    setKnownHostActionBusy(true);
    try {
      if (pendingKnownHostAction.type === "clear") {
        await knownHosts.onClear();
      } else {
        await knownHosts.onRemove(pendingKnownHostAction.key);
      }
      setPendingKnownHostAction(null);
    } catch {
      // The parent owns user-facing failure feedback so the confirmation stays open.
    } finally {
      setKnownHostActionBusy(false);
    }
  }

  async function openThirdPartyNotices() {
    if (!legal?.available || legalBusy) return;
    setLegalBusy(true);
    setLegalError(false);
    try {
      const notices = await legal.loadThirdPartyNotices();
      if (notices.trim() === "") {
        throw new Error("empty third-party notices");
      }
      setThirdPartyNotices(notices);
    } catch {
      setLegalError(true);
    } finally {
      setLegalBusy(false);
    }
  }

  return (
    <>
      <div className="stack">
        <Panel className="context-card">
          <header>
            <span>{t("desktop.workspaceSettings")}</span>
            <Settings size={16} />
          </header>
          {showFutureProductSurfaces ? (
            <>
              <label className="toggle-row">
                <span>
                  <strong>{t("desktop.recordTerminal")}</strong>
                  <small>{t("desktop.plannedUnavailable")}</small>
                </span>
                <input disabled readOnly type="checkbox" />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>{t("desktop.syncEncrypted")}</strong>
                  <small>{t("desktop.plannedUnavailable")}</small>
                </span>
                <input disabled readOnly type="checkbox" />
              </label>
            </>
          ) : null}
          {telemetry ? (
            <label className="toggle-row">
              <span>
                <strong>{t("desktop.telemetryErrors")}</strong>
                <small>{t("desktop.telemetryPrivacyHint")}</small>
              </span>
              <input
                checked={telemetry.enabled}
                disabled={!telemetry.available}
                onChange={(event) =>
                  telemetry.onChange(event.currentTarget.checked)
                }
                type="checkbox"
              />
            </label>
          ) : null}
          <div className="settings-actions">
            <Button size="sm" variant="ghost" onClick={handleExportConnections}>
              <FileDown size={13} /> {t("desktop.exportConnections")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={13} /> {t("desktop.importConnections")}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportConnections}
              aria-label={t("desktop.importConnections")}
              style={{ display: "none" }}
            />
          </div>
          {knownHosts ? (
            <>
              <div className="known-hosts-row">
                <span>
                  <strong>{t("desktop.knownHosts")}</strong>
                  <small>
                    {t("desktop.knownHostsCount", { count: knownHosts.count })}
                  </small>
                </span>
                {pendingKnownHostAction?.type === "clear" ? (
                  <span
                    className="known-hosts-confirm"
                    role="group"
                    aria-label={t("desktop.confirmKnownHostsClear")}
                  >
                    <small>{t("desktop.confirmKnownHostsClear")}</small>
                    <span className="known-hosts-confirm-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={knownHostActionBusy}
                        onClick={() => setPendingKnownHostAction(null)}
                      >
                        <X size={13} /> {t("desktop.cancelKnownHostAction")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={knownHostActionBusy}
                        onClick={() => {
                          void confirmKnownHostAction();
                        }}
                      >
                        <KeyRound size={13} />{" "}
                        {t("desktop.confirmKnownHostAction")}
                      </Button>
                    </span>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={knownHosts.count === 0}
                    onClick={() => setPendingKnownHostAction({ type: "clear" })}
                  >
                    <KeyRound size={13} /> {t("desktop.clearKnownHosts")}
                  </Button>
                )}
              </div>
              {knownHosts.entries.length > 0 ? (
                <div className="known-hosts-list">
                  {knownHosts.entries.map((entry) => (
                    <div className="known-hosts-item" key={entry.key}>
                      <span className="known-hosts-item-main">
                        <strong>
                          {entry.host}:{entry.port}
                        </strong>
                        <code>{entry.fingerprint}</code>
                      </span>
                      <span className="known-hosts-item-meta">
                        <small>
                          {t("desktop.knownHostSource", {
                            source: entry.source,
                          })}
                        </small>
                        <small>
                          {t("desktop.knownHostFirstSeen", {
                            time: formatKnownHostTime(
                              entry.first_seen_at_ms,
                              t,
                            ),
                          })}
                        </small>
                        <small>
                          {t("desktop.knownHostLastSeen", {
                            time: formatKnownHostTime(entry.last_seen_at_ms, t),
                          })}
                        </small>
                      </span>
                      {pendingKnownHostAction?.type === "remove" &&
                      pendingKnownHostAction.key === entry.key ? (
                        <span
                          className="known-hosts-confirm known-hosts-confirm--inline"
                          role="group"
                          aria-label={t("desktop.confirmKnownHostRemove", {
                            host: `${entry.host}:${entry.port}`,
                          })}
                        >
                          <small>
                            {t("desktop.confirmKnownHostRemove", {
                              host: `${entry.host}:${entry.port}`,
                            })}
                          </small>
                          <span className="known-hosts-confirm-actions">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={knownHostActionBusy}
                              onClick={() => setPendingKnownHostAction(null)}
                            >
                              <X size={13} />{" "}
                              {t("desktop.cancelKnownHostAction")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={knownHostActionBusy}
                              onClick={() => {
                                void confirmKnownHostAction();
                              }}
                            >
                              <Trash2 size={13} />{" "}
                              {t("desktop.confirmKnownHostAction")}
                            </Button>
                          </span>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={knownHostActionBusy}
                          onClick={() =>
                            setPendingKnownHostAction({
                              type: "remove",
                              key: entry.key,
                            })
                          }
                        >
                          <Trash2 size={13} /> {t("desktop.removeKnownHost")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <small className="known-hosts-empty">
                  {t("desktop.knownHostsEmpty")}
                </small>
              )}
            </>
          ) : null}
        </Panel>
        <Panel className="context-card legal-card">
          <header>
            <span>{t("desktop.thirdPartyNotices")}</span>
            <Scale aria-hidden="true" size={16} />
          </header>
          <p>{t("desktop.thirdPartyNoticesHint")}</p>
          <div className="settings-actions">
            <Button
              disabled={!legal?.available || legalBusy}
              onClick={() => {
                void openThirdPartyNotices();
              }}
              size="sm"
              variant="ghost"
            >
              <ScrollText aria-hidden="true" size={13} />
              {legalBusy
                ? t("desktop.thirdPartyNoticesLoading")
                : t("desktop.thirdPartyNotices")}
            </Button>
          </div>
          {!legal?.available || legalError ? (
            <small
              className="legal-notices-status"
              role={legalError ? "alert" : undefined}
            >
              {t("desktop.thirdPartyNoticesUnavailable")}
            </small>
          ) : null}
        </Panel>
        {showFutureProductSurfaces ? (
          <Panel className="context-card commercial-card">
            <header>
              <span>{t("desktop.businessLayer")}</span>
              <Badge>{t("desktop.plannedUnavailable")}</Badge>
            </header>
            <div className="tier-grid">
              <span>
                <Boxes size={16} /> {t("desktop.sharedVaults")}
              </span>
              <span>
                <Database size={16} /> {t("desktop.auditExport")}
              </span>
              <span>
                <HardDrive size={16} /> {t("desktop.devicePosture")}
              </span>
              <span>
                <CircleDollarSign size={16} /> {t("desktop.seatBilling")}
              </span>
            </div>
            <Button disabled title={t("desktop.notAvailable")} variant="ghost">
              <Bell size={15} /> {t("desktop.managePlan")}
            </Button>
          </Panel>
        ) : null}
      </div>
      {thirdPartyNotices !== null ? (
        <ThirdPartyNoticesOverlay
          notices={thirdPartyNotices}
          onClose={() => setThirdPartyNotices(null)}
          t={t}
        />
      ) : null}
    </>
  );
});

function formatKnownHostTime(value: number | null, t: Translator): string {
  return value
    ? new Date(value).toLocaleString()
    : t("desktop.knownHostLegacyTime");
}
