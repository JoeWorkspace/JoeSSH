import "./sw-register";
import {
  createErrorMonitor,
  createNoopErrorMonitor,
  getBrowserTelemetryConsentStorage,
  isTelemetryOptedIn,
  readTelemetryConsent,
  TELEMETRY_CONSENT_STORAGE_KEY,
  writeTelemetryConsent,
} from "@atlasterm/error-monitor";
import {
  StrictMode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  Command,
  Copy,
  HardDrive,
  Lock,
  Maximize2,
  Minimize2,
  Network,
  CircleHelp,
  Server,
  ShieldCheck,
  Sun,
  Moon,
  TerminalSquare,
  X,
} from "lucide-react";
import { Plug } from "lucide-react";
import { Badge, Button, IconButton, SegmentedControl } from "@atlasterm/ui";
import {
  createLocaleFormatters,
  detectAtlasLocale,
  getBrowserLocaleCandidates,
  getTextDirection,
  loadLocale,
  resolveAtlasLocale,
  type AtlasLocale,
  type TranslationKey,
  type Translator,
} from "@atlasterm/i18n";
import { getTeamAccessSummary } from "./teamAccess";
import {
  createTerminalSession,
  submitTerminalCommand,
  type TerminalSession,
} from "./terminalExecutor";
import {
  isDesktopRuntime,
  sshConnect,
  sshDisconnect,
  sshExec,
  sshHostKeyProbe,
  sftpList,
  sftpRead,
  sftpWrite,
  forwardStart,
  forwardStop,
  ptyOpen,
  ptyWrite,
  ptyResize,
  ptyClose,
  onPtyOutput,
  testConnection,
  knownHostsClear,
  knownHostsList,
  knownHostsRemove,
  thirdPartyNotices,
  type KnownHostEntry,
} from "./ipc";
import { ConnectModal } from "./ConnectModal";
import { NewConnectionModal } from "./NewConnectionModal";
import type { PtyDeps } from "./usePtySession";
import { useSftpDirectory } from "./useSftpDirectory";
import { joinSftpRemoteEntryPath } from "./sftpRemotePath";
import { useForwardRules } from "./useForwardRules";
import { SFTP_TRANSFER_MAX_BYTES, useSftpTransfer } from "./useSftpTransfer";
import {
  LOCALE_STORAGE_KEY,
  LAYOUT_STORAGE_KEY,
  FORWARD_RULES_STORAGE_KEY,
  GETTING_STARTED_STATE_VERSION,
  THEME_STORAGE_KEY,
  readStoredGettingStartedState,
  readStorageText,
  readStoredCustomConnections,
  readStoredForwardRules,
  readStoredLayout,
  readStoredTheme,
  writeStorageJson,
  writeStorageText,
  writeStoredGettingStartedState,
  type GettingStartedState,
  type GettingStartedStep,
  type GettingStartedStatus,
  type PersistedTheme,
  type DesktopLayoutState,
  type PersistedConnection,
} from "./persistence";
import type { ForwardRule } from "./panels";
import { useGroupManager } from "./useGroupManager";
import { useCustomConnections } from "./useCustomConnections";
import { useCommandPalette } from "./useCommandPalette";
import { useRecentFavorites } from "./useRecentFavorites";
import { useDragReorder } from "./useDragReorder";
import { useToast } from "./useToast";
import {
  addTerminalTab,
  createQuickConnectionProfile,
  findConnectionNameByTarget,
  getConnectionPresence,
  getConnectionTarget,
  getTerminalTabIndex,
  matchesSidebarSearch,
  removeTerminalTab,
} from "./connectionWorkspace";
import { TerminalPane } from "./TerminalPane";
import { Sidebar } from "./Sidebar";
import { CommandPalette, type PaletteItem } from "./CommandPalette";
import { PanelLoadingState } from "./PanelLoadingState";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { ContextMenu } from "./ContextMenu";
import { GroupManagerModal } from "./GroupManagerModal";
import { StatusBar } from "./StatusBar";
import { ToastContainer } from "./ToastContainer";
import { DesktopErrorBoundary } from "./DesktopErrorBoundary";
import { GettingStartedOverlay } from "./GettingStartedOverlay";
import { isKeyboardShortcutsToggle } from "./keyboardShortcuts";
import {
  createConnectionTerminalSession,
  formatSshCommand,
  PRIMARY_TERMINAL_PROMPT,
} from "./desktopTerminalSession";
import { builtinGroupNames, desktopGroupLabel } from "./desktopGroups";
import { applyLocalizedDesktopMetadata } from "./desktopManifest";
import { parseDesktopLaunchIntent } from "./desktopLaunchIntent";
import {
  desktopSurfacePolicy,
  resolvePanelShortcutForSurfacePolicy,
  sanitizeRightPanelForSurfacePolicy,
} from "./desktopSurfacePolicy";
import { splitConnectionTarget, type ConnectionTarget } from "./connectTarget";
import {
  builtinConnectionDeleteUnavailableToast,
  builtinConnectionEditUnavailableToast,
  connectionCreatedToast,
  connectionDeletedToast,
  connectionDuplicatedToast,
  connectionEditedToast,
  connectionMovedToast,
  connectionSwitchedToast,
  connectionTestResultToast,
  connectionsImportFailedToast,
  connectionsImportedToast,
  duplicateConnectionName,
  groupCreatedToast,
  groupDeletedToast,
  groupRenamedToast,
  sftpUploadCompleteToast,
  sshCommandCopiedToast,
  sshCommandCopyFailedToast,
} from "./desktopToastMessages";
import "@atlasterm/ui/styles.css";
import "./styles.css";
import "./workbench-theme.css";

const LazyInspectorPanel = lazy(() =>
  import("./panels").then((m) => ({ default: m.InspectorPanel })),
);
const LazySftpPanel = lazy(() =>
  import("./panels").then((m) => ({ default: m.SftpPanel })),
);
const LazyTeamAccessPanel = lazy(() =>
  import("./panels").then((m) => ({ default: m.TeamAccessPanel })),
);
const LazyForwardingPanel = lazy(() =>
  import("./panels").then((m) => ({ default: m.ForwardingPanel })),
);
const LazySettingsPanel = lazy(() =>
  import("./panels").then((m) => ({ default: m.SettingsPanel })),
);
const LazyXtermTerminal = lazy(() =>
  import("./XtermTerminal").then((m) => ({ default: m.XtermTerminal })),
);

declare global {
  interface Window {
    __atlastermRoot?: Root;
  }
}

type RightPanel = "inspector" | "sftp" | "team" | "forwarding" | "settings";
type LanguageChoice = AtlasLocale | "auto";
type ThemeChoice = PersistedTheme;
type CommandFeedback = {
  detail: string;
  title: string;
  tone: "accepted" | "blocked";
};
type TelemetryControls = {
  available: boolean;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
};

const stagingConnectionName = ["staging", "api"].join("-");
const initialTerminalTabs = [
  "prod-edge-01",
  stagingConnectionName,
  "db-replica-03",
] as const;
const connections = [
  {
    name: "prod-edge-01",
    host: "10.48.12.11",
    group: "Production",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "ssh"],
  },
  {
    name: "prod-edge-02",
    host: "10.48.12.12",
    group: "Production",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "ssh"],
  },
  {
    name: stagingConnectionName,
    host: "stg-api.atlas",
    group: "Staging",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "ssh"],
  },
  {
    name: "staging-worker",
    host: "stg-worker.atlas",
    group: "Staging",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "ssh"],
  },
  {
    name: "eu-build-runner",
    host: "172.19.0.44",
    group: "CI runners",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "docker"],
  },
  {
    name: "us-build-runner",
    host: "172.19.1.88",
    group: "CI runners",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "docker"],
  },
  {
    name: "db-replica-03",
    host: "db3.internal",
    group: "Data",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "database", "mfa"],
  },
  {
    name: "db-primary",
    host: "db1.internal",
    group: "Data",
    status: "sample",
    latencyLabelKey: "desktop.sampleDataShort",
    color: "neutral",
    tags: ["sample", "database", "ssh"],
  },
] as const;

type DesktopConnectionColor = "neutral" | "good" | "warn" | "info" | "premium";
type DesktopConnectionStatus = "sample" | "online" | "busy" | "locked";
export type DesktopConnection = {
  readonly color: DesktopConnectionColor;
  readonly group: string;
  readonly host: string;
  readonly latencyHistory?: readonly number[];
  readonly latencyLabel?: string;
  readonly latencyLabelKey?: TranslationKey;
  readonly latencyMs?: number;
  readonly name: string;
  readonly port?: number;
  readonly status: DesktopConnectionStatus;
  readonly tags: readonly string[];
  readonly username?: string;
};

const connectionNames = connections.map((connection) => connection.name);
const builtinConnectionNameSet = new Set<string>(connectionNames);
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const commandSnippets = [
  {
    nameKey: "desktop.snippetPodStatus",
    command: "kubectl get pods -n gateway -o wide",
  },
  {
    nameKey: "desktop.snippetTailLogs",
    command: "tail -f /var/log/joessh/session.log",
  },
  { nameKey: "desktop.snippetDiskUsage", command: "df -h | head -10" },
  {
    nameKey: "desktop.snippetActiveConnections",
    command: "ss -tlnp | grep -E ':(22|443|8080)'",
  },
  {
    nameKey: "desktop.snippetMemoryTop",
    command: "ps aux --sort=-%mem | head -6",
  },
] as const;

const terminalLines = [
  "Sample fixture transcript - no SSH session is connected.",
  "atlas@prod-edge-01:~$ kubectl get pods -n gateway",
  "NAME                             READY   STATUS    RESTARTS   AGE",
  "edge-gateway-7b977f84c9-8hw4s    2/2     Running   0          19h",
  "edge-gateway-7b977f84c9-hmlr9    2/2     Running   0          19h",
  "atlas@prod-edge-01:~$ tail -f /var/log/joessh/session.log",
  "2026-05-24T02:17:14Z host-key status=verified algorithm=ssh-ed25519",
  "2026-05-24T02:17:18Z port-forward local=:8443 remote=gateway:443 status=ready",
  "2026-05-24T02:17:22Z command palette opened by user=lin",
];

const initialTerminalSession = createTerminalSession({
  host: "prod-edge-01",
  lines: terminalLines,
  prompt: PRIMARY_TERMINAL_PROMPT,
});

const metricsTerminalSession = createTerminalSession({
  host: "prod-edge-01",
  lines: [
    "Sample fixture metrics - no live host is attached.",
    "atlas@prod-edge-01:~$ watch -n 2 curl -s localhost:9100/health",
    "uptime: 19h 34m",
    "cpu: 37%    mem: 61%    disk: 48%",
    "p95 latency: 118ms",
    "active tunnels: 7",
  ],
  prompt: PRIMARY_TERMINAL_PROMPT,
});

const sftpItems = [
  {
    name: "deployments",
    type: "dir",
    sizeBytes: undefined,
    modified: { unit: "hour", value: -2 },
  },
  {
    name: "nginx.conf",
    type: "file",
    sizeBytes: 18 * 1024,
    modified: { unit: "minute", value: -33 },
  },
  {
    name: "session.log",
    type: "file",
    sizeBytes: 4.2 * 1024 * 1024,
    modified: { unit: "minute", value: 0 },
  },
  {
    name: "release.tar.zst",
    type: "file",
    sizeBytes: 128 * 1024 * 1024,
    modified: { unit: "day", value: -1 },
  },
] as const;

function getInitialLanguageChoice(): LanguageChoice {
  if (typeof window === "undefined") {
    return "auto";
  }

  const params = new URLSearchParams(window.location.search);
  const requestedLocale = getLanguageChoice(params.get("lang"));

  if (requestedLocale) {
    return requestedLocale;
  }

  const storedLocale = readStorageText(LOCALE_STORAGE_KEY);

  return getLanguageChoice(storedLocale) ?? "auto";
}

function resolveLanguageChoice(choice: LanguageChoice): AtlasLocale {
  return choice === "auto"
    ? detectAtlasLocale(getBrowserLocaleCandidates())
    : choice;
}

function getLanguageChoice(value: string | null): LanguageChoice | undefined {
  if (value === "auto") {
    return "auto";
  }

  return resolveAtlasLocale(value);
}

const defaultLayout: DesktopLayoutState = {
  activeConnection: connections[0].name,
  activeTab: 0,
  rightPanel: "inspector",
  sidebarCollapsed: false,
};

function getStoredLayout() {
  const customConnectionNames = readStoredCustomConnections().map(
    (connection) => connection.name,
  );
  return readStoredLayout(defaultLayout, {
    activeConnections: [
      ...connections.map((connection) => connection.name),
      ...customConnectionNames,
    ],
    maxActiveTab: initialTerminalTabs.length + customConnectionNames.length - 1,
  });
}

function getInitialGettingStartedState(): GettingStartedState {
  return readStoredGettingStartedState();
}

function getInitialGettingStartedOpen() {
  if (typeof window === "undefined") return false;
  const requestedState = new URLSearchParams(window.location.search).get(
    "onboarding",
  );
  if (requestedState === "1") return true;
  if (requestedState === "0") return false;
  const state = readStoredGettingStartedState();
  return (
    isDesktopRuntime() &&
    (state.status === "unseen" || state.status === "in-progress")
  );
}

function App({
  t,
  locale,
  onLanguageChoiceChange,
  languageChoice,
  telemetry,
}: {
  t: Translator;
  locale: AtlasLocale;
  onLanguageChoiceChange: (choice: LanguageChoice) => void;
  languageChoice: LanguageChoice;
  telemetry: TelemetryControls;
}) {
  const storedLayout = useMemo(() => getStoredLayout(), []);
  const launchIntent = useMemo(
    () =>
      parseDesktopLaunchIntent(
        typeof window === "undefined" ? "" : window.location.search,
      ),
    [],
  );
  const [rightPanel, setRightPanel] = useState<RightPanel>(
    sanitizeRightPanelForSurfacePolicy(
      launchIntent.panel ?? storedLayout.rightPanel,
      desktopSurfacePolicy,
    ),
  );
  const [terminalSessions, setTerminalSessions] = useState<
    Record<string, TerminalSession>
  >(() => ({
    [connections[0].name]: initialTerminalSession,
  }));
  const [commandInput, setCommandInput] = useState("");
  const [commandFeedback, setCommandFeedback] =
    useState<CommandFeedback | null>(null);
  const [activeConnectionName, setActiveConnectionName] = useState<string>(
    storedLayout.activeConnection,
  );
  const teamAccess = getTeamAccessSummary();

  // User-created connections (persisted), reserving built-in names.
  const customConnections = useCustomConnections(connectionNames);
  const managedConnectionNames = useMemo(
    () => [
      ...connectionNames,
      ...customConnections.connections.map((connection) => connection.name),
    ],
    [customConnections.connections],
  );

  // Group management hook
  const {
    state: groupState,
    dispatch: groupDispatch,
    allGroupNames,
    isGroupValid,
  } = useGroupManager(builtinGroupNames, managedConnectionNames);

  // Command palette hook
  const {
    state: paletteState,
    open: openPalette,
    close: closePalette,
    setInput: setPaletteInput,
    setIndex: setPaletteIndex,
  } = useCommandPalette();

  // Recent connections and favorites hook
  const {
    state: recentsState,
    recordConnection,
    toggleFavorite,
    recordCommand,
  } = useRecentFavorites();

  const [quickConnections, setQuickConnections] = useState<DesktopConnection[]>(
    [],
  );
  const reorderConnectionNames = useMemo(
    () => [
      ...managedConnectionNames,
      ...quickConnections.map((connection) => connection.name),
    ],
    [managedConnectionNames, quickConnections],
  );

  // Drag and drop reorder hook
  const {
    state: dragState,
    startDrag,
    dragOver: handleDragOver,
    dragLeave,
    dragEnd,
    moveAfter: moveConnectionAfter,
    moveBefore: moveConnectionBefore,
  } = useDragReorder(reorderConnectionNames);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    storedLayout.sidebarCollapsed,
  );
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [gettingStartedState, setGettingStartedState] = useState(
    getInitialGettingStartedState,
  );
  const [gettingStartedOpen, setGettingStartedOpen] = useState(
    getInitialGettingStartedOpen,
  );
  const [terminalMaximized, setTerminalMaximized] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    connection: DesktopConnection;
  } | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(() =>
    readStoredTheme("system"),
  );
  const { toasts, addToast } = useToast();
  const [openTerminalTabs, setOpenTerminalTabs] = useState<string[]>(() =>
    addTerminalTab(initialTerminalTabs, storedLayout.activeConnection),
  );
  const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(
    new Set(),
  );
  // Maps a connection profile name to its live native SSH session id.
  const desktopSessionsRef = useRef<Record<string, string>>({});
  // Bumped whenever a connection is established or closed so derived runtime state refreshes.
  const [connectVersion, setConnectVersion] = useState(0);
  const effectiveConnections = useMemo<DesktopConnection[]>(() => {
    void connectVersion;
    return [
      ...connections.map((connection) => ({
        ...connection,
        group: groupState.connectionGroups[connection.name] ?? connection.group,
        ...getConnectionPresence(desktopSessionsRef.current[connection.name]),
      })),
      ...customConnections.connections.map((connection): DesktopConnection => ({
        name: connection.name,
        host: connection.host,
        group: groupState.connectionGroups[connection.name] ?? connection.group,
        port: connection.port,
        ...getConnectionPresence(desktopSessionsRef.current[connection.name]),
        tags: connection.tags,
        username: connection.username,
      })),
      ...quickConnections.map((connection): DesktopConnection => ({
        ...connection,
        ...getConnectionPresence(desktopSessionsRef.current[connection.name]),
      })),
    ];
  }, [
    groupState.connectionGroups,
    customConnections.connections,
    quickConnections,
    connectVersion,
  ]);
  const activeConnection =
    effectiveConnections.find((c) => c.name === activeConnectionName) ??
    effectiveConnections[0];
  const [connectTargetOverride, setConnectTargetOverride] =
    useState<ConnectionTarget | null>(null);
  const [connectProfileName, setConnectProfileName] = useState<string | null>(
    null,
  );
  const connectDefaults = useMemo(() => {
    if (connectTargetOverride) return connectTargetOverride;
    return getConnectionTarget(activeConnection);
  }, [activeConnection, connectTargetOverride]);
  const inspectorConnectionStats = useMemo(() => {
    const latencies = effectiveConnections.flatMap((connection) =>
      "latencyMs" in connection && typeof connection.latencyMs === "number"
        ? [connection.latencyMs]
        : [],
    );
    const averageLatencyMs =
      latencies.length > 0
        ? Math.round(
            latencies.reduce((total, latency) => total + latency, 0) /
              latencies.length,
          )
        : undefined;
    return {
      averageLatencyMs,
      onlineConnections: effectiveConnections.filter(
        (connection) => connection.status === "online",
      ).length,
      totalConnections: effectiveConnections.length,
    };
  }, [effectiveConnections]);
  const inspectorSessionContext = useMemo(
    () => ({
      regionLabel: t("desktop.notAvailable"),
      userHandle: activeConnection.username ?? t("desktop.notAvailable"),
    }),
    [activeConnection.username, t],
  );
  const [connectOpen, setConnectOpen] = useState(launchIntent.connect);
  const [newConnectionOpen, setNewConnectionOpen] = useState(false);
  const [gettingStartedCreatePending, setGettingStartedCreatePending] =
    useState(false);
  const [editConnection, setEditConnection] =
    useState<PersistedConnection | null>(null);

  const openNewConnection = useCallback(() => {
    setGettingStartedCreatePending(false);
    setNewConnectionOpen(true);
  }, []);
  const openOnboardingNewConnection = useCallback(() => {
    setGettingStartedCreatePending(true);
    setNewConnectionOpen(true);
  }, []);
  // Bumped when known hosts change, to refresh the Settings trust list.
  const [knownHostsVersion, setKnownHostsVersion] = useState(0);
  const [knownHostsStoredCount, setKnownHostsStoredCount] = useState(0);
  const [knownHostEntries, setKnownHostEntries] = useState<KnownHostEntry[]>(
    [],
  );
  useEffect(() => {
    if (!isDesktopRuntime()) {
      setKnownHostsStoredCount(0);
      setKnownHostEntries([]);
      return;
    }

    let cancelled = false;
    void knownHostsList()
      .then((entries) => {
        if (!cancelled) {
          setKnownHostEntries(entries);
          setKnownHostsStoredCount(entries.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setKnownHostEntries([]);
          setKnownHostsStoredCount(0);
          addToast(t("desktop.knownHostActionFailed"), "error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [addToast, connectVersion, knownHostsVersion, t]);
  const activeDesktopSessionId =
    desktopSessionsRef.current[activeConnection.name];
  const hasActiveDesktopSession =
    isDesktopRuntime() && Boolean(activeDesktopSessionId);
  const terminalSession =
    terminalSessions[activeConnection.name] ??
    createConnectionTerminalSession(
      hasActiveDesktopSession
        ? activeConnection
        : { ...activeConnection, status: "sample" },
      t,
      initialTerminalSession,
    );
  const formatters = useMemo(() => createLocaleFormatters(locale), [locale]);
  // Real SFTP loader bound to the active connection's live session (desktop only).
  const sftpListFn = useMemo(() => {
    void connectVersion;
    const sessionId = desktopSessionsRef.current[activeConnection.name];
    if (!isDesktopRuntime() || !sessionId) return undefined;
    return (path: string) => sftpList(sessionId, path);
  }, [activeConnection.name, connectVersion]);
  const sftpDirectory = useSftpDirectory(sftpListFn);
  // Real port-forward start/stop bound to the active connection's live session.
  const forwardFns = useMemo(() => {
    void connectVersion;
    const sessionId = desktopSessionsRef.current[activeConnection.name];
    if (!isDesktopRuntime() || !sessionId)
      return { start: undefined, stop: undefined };
    return {
      start: (bindAddr: string, targetHost: string, targetPort: number) =>
        forwardStart(sessionId, bindAddr, targetHost, targetPort),
      stop: (forwardId: string) => forwardStop(forwardId),
    };
  }, [activeConnection.name, connectVersion]);
  const forwardRules = useForwardRules(forwardFns.start, forwardFns.stop);
  const [customForwardRules, setCustomForwardRules] = useState<ForwardRule[]>(
    readStoredForwardRules,
  );
  useEffect(() => {
    writeStorageJson(FORWARD_RULES_STORAGE_KEY, customForwardRules);
  }, [customForwardRules]);
  // Real SFTP transfer (download/upload) bound to the active connection's session.
  const transferFns = useMemo(() => {
    void connectVersion;
    const sessionId = desktopSessionsRef.current[activeConnection.name];
    if (!isDesktopRuntime() || !sessionId)
      return { read: undefined, write: undefined };
    return {
      read: (path: string) => sftpRead(sessionId, path),
      write: (path: string, data: number[]) => sftpWrite(sessionId, path, data),
    };
  }, [activeConnection.name, connectVersion]);
  const sftpTransfer = useSftpTransfer(transferFns.read, transferFns.write, {
    limitMessage: () =>
      t("desktop.sftpTransferTooLarge", {
        limit: formatters.fileSize(SFTP_TRANSFER_MAX_BYTES),
      }),
    maxBytes: SFTP_TRANSFER_MAX_BYTES,
  });
  // PTY deps for the interactive xterm terminal, bound to the active session.
  const ptyDeps = useMemo<PtyDeps | undefined>(() => {
    void connectVersion;
    const sessionId = desktopSessionsRef.current[activeConnection.name];
    if (!isDesktopRuntime() || !sessionId) return undefined;
    return {
      open: (cols, rows) => ptyOpen(sessionId, cols, rows),
      write: (ptyId, data) => ptyWrite(ptyId, data),
      resize: (ptyId, cols, rows) => ptyResize(ptyId, cols, rows),
      close: (ptyId) => ptyClose(ptyId),
      subscribe: (ptyId, onData, onExit) => onPtyOutput(ptyId, onData, onExit),
    };
  }, [activeConnection.name, connectVersion]);

  async function handleSftpDownload(
    name: string,
    size: number | null,
    directoryPath = sftpDirectory.path,
  ) {
    const remotePath = joinSftpRemoteEntryPath(directoryPath, name);
    if (!remotePath) {
      addToast(t("desktop.sftpTransferError"), "error");
      return;
    }
    const bytes = await sftpTransfer.download(remotePath, {
      knownSizeBytes: size,
    });
    if (!bytes) return;
    const blob = new Blob([new Uint8Array(bytes)], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleSftpUploadFile(
    file: File,
    directoryPath = sftpDirectory.path,
  ) {
    if (file.size > SFTP_TRANSFER_MAX_BYTES) {
      sftpTransfer.rejectTooLarge();
      return;
    }
    const remotePath = joinSftpRemoteEntryPath(directoryPath, file.name);
    if (!remotePath) {
      addToast(t("desktop.sftpTransferError"), "error");
      return;
    }
    const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
    const ok = await sftpTransfer.upload(remotePath, bytes);
    if (ok) {
      addToast(sftpUploadCompleteToast(t, file.name), "success");
      sftpDirectory.refresh();
    }
  }

  function handleImportConnections(parsed: unknown) {
    const list =
      isRecord(parsed) &&
      Array.isArray((parsed as { connections?: unknown }).connections)
        ? (parsed as { connections: unknown[] }).connections
        : Array.isArray(parsed)
          ? parsed
          : null;
    if (!list) {
      addToast(connectionsImportFailedToast(t), "error");
      return;
    }
    let added = 0;
    for (const item of list.slice(0, 100)) {
      if (
        isRecord(item) &&
        typeof item.name === "string" &&
        typeof item.host === "string"
      ) {
        const importedGroup =
          typeof item.group === "string" && item.group.trim()
            ? item.group.trim()
            : (groupOrder[0] ?? "Production");
        if (
          customConnections.add({
            name: item.name,
            host: item.host,
            group: importedGroup,
            port:
              typeof item.port === "number" &&
              Number.isInteger(item.port) &&
              item.port >= 1 &&
              item.port <= 65535
                ? item.port
                : undefined,
            tags: Array.isArray(item.tags)
              ? item.tags.filter(
                  (tag): tag is string => typeof tag === "string",
                )
              : [],
            username:
              typeof item.username === "string" ? item.username : undefined,
          })
        ) {
          if (!allGroupNames.includes(importedGroup)) {
            groupDispatch({
              type: "ADD_CUSTOM_GROUP",
              name: importedGroup,
            });
          }
          added += 1;
        }
      }
    }
    if (added === 0) {
      addToast(connectionsImportFailedToast(t), "error");
      return;
    }
    addToast(connectionsImportedToast(t, added), "success");
  }

  async function handleClearKnownHosts() {
    try {
      await knownHostsClear();
      setKnownHostsVersion((v) => v + 1);
      addToast(t("desktop.clearKnownHosts"), "warning");
    } catch (error) {
      addToast(t("desktop.knownHostActionFailed"), "error");
      throw error;
    }
  }

  async function handleRemoveKnownHost(hostKey: string) {
    try {
      await knownHostsRemove(hostKey);
      setKnownHostsVersion((v) => v + 1);
      addToast(t("desktop.removeKnownHost"), "warning");
    } catch (error) {
      addToast(t("desktop.knownHostActionFailed"), "error");
      throw error;
    }
  }

  const handleCopySshCommand = useCallback(
    async (connection: DesktopConnection) => {
      if (!navigator.clipboard?.writeText) {
        addToast(sshCommandCopyFailedToast(t), "error");
        return;
      }

      try {
        await navigator.clipboard.writeText(formatSshCommand(connection));
        addToast(sshCommandCopiedToast(t, connection.name));
      } catch {
        addToast(sshCommandCopyFailedToast(t), "error");
      }
    },
    [addToast, t],
  );

  const updateGettingStartedState = useCallback(
    (status: GettingStartedStatus, lastStep: GettingStartedStep) => {
      const nextState: GettingStartedState = {
        version: GETTING_STARTED_STATE_VERSION,
        status,
        lastStep,
      };
      setGettingStartedState(nextState);
      writeStoredGettingStartedState(nextState);
    },
    [],
  );
  const closeGettingStarted = useCallback(() => {
    setGettingStartedOpen(false);
    setGettingStartedState((current) => {
      if (current.status !== "unseen") return current;
      const nextState: GettingStartedState = {
        ...current,
        status: "in-progress",
      };
      writeStoredGettingStartedState(nextState);
      return nextState;
    });
  }, []);
  const skipGettingStarted = useCallback(() => {
    const lastStep = gettingStartedState.lastStep;
    updateGettingStartedState("skipped", lastStep);
    setGettingStartedOpen(false);
  }, [gettingStartedState.lastStep, updateGettingStartedState]);
  const completeGettingStarted = useCallback(() => {
    updateGettingStartedState("completed", 2);
    setGettingStartedOpen(false);
  }, [updateGettingStartedState]);
  const updateGettingStartedStep = useCallback(
    (step: GettingStartedStep) => {
      updateGettingStartedState("in-progress", step);
    },
    [updateGettingStartedState],
  );
  const openGettingStartedConnect = useCallback(() => {
    closeGettingStarted();
    if (!isDesktopRuntime()) return;
    setConnectProfileName(activeConnection.name);
    setConnectTargetOverride(null);
    setConnectOpen(true);
  }, [activeConnection.name, closeGettingStarted]);
  const openGettingStartedNewConnection = useCallback(() => {
    closeGettingStarted();
    openOnboardingNewConnection();
  }, [closeGettingStarted, openOnboardingNewConnection]);
  const openGettingStartedPanel = useCallback(
    (panel: "sftp" | "forwarding") => {
      closeGettingStarted();
      setRightPanel(panel);
      setTerminalMaximized(false);
    },
    [closeGettingStarted],
  );
  const openGettingStartedTerminal = useCallback(() => {
    closeGettingStarted();
    setRightPanel("inspector");
    setTerminalMaximized(false);
    window.requestAnimationFrame(() => {
      const terminalZone = document.getElementById("terminal-zone");
      const focusTarget = terminalZone?.querySelector<HTMLElement>(
        'textarea, input, [tabindex="0"]',
      );
      (focusTarget ?? terminalZone)?.focus();
    });
  }, [closeGettingStarted]);
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const c of effectiveConnections) {
      for (const tag of c.tags) tags.add(tag);
    }
    return [...tags].sort();
  }, [effectiveConnections]);
  const connectionCounts = useMemo(
    () =>
      Object.fromEntries(
        allGroupNames.map((g) => [
          g,
          effectiveConnections.filter((c) => c.group === g).length,
        ]),
      ),
    [allGroupNames, effectiveConnections],
  );
  const groupOrder = useMemo(() => {
    const groups: string[] = [...builtinGroupNames, ...groupState.customGroups];

    for (const c of effectiveConnections) {
      if (!groups.includes(c.group)) {
        groups.push(c.group);
      }
    }

    return groups;
  }, [groupState.customGroups, effectiveConnections]);

  const filteredConnections = useMemo(() => {
    return effectiveConnections.filter((c) => {
      if (
        !matchesSidebarSearch(c, sidebarSearch, desktopGroupLabel(c.group, t))
      )
        return false;
      if (
        activeTagFilters.size > 0 &&
        !c.tags.some((tag) => activeTagFilters.has(tag))
      )
        return false;
      return true;
    });
  }, [activeTagFilters, effectiveConnections, sidebarSearch, t]);

  const groupedConnections = useMemo(() => {
    const map = new Map<string, DesktopConnection[]>();
    for (const c of filteredConnections) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => {
        const aFav = recentsState.favorites.includes(a.name) ? 0 : 1;
        const bFav = recentsState.favorites.includes(b.name) ? 0 : 1;
        if (aFav !== bFav) return aFav - bFav;
        const aOrder = dragState.order.indexOf(a.name);
        const bOrder = dragState.order.indexOf(b.name);
        return aOrder - bOrder;
      });
    }
    return map;
  }, [filteredConnections, recentsState.favorites, dragState.order]);
  const direction = getTextDirection(locale);

  const openConnectionTab = useCallback((name: string) => {
    setOpenTerminalTabs((tabs) => addTerminalTab(tabs, name));
  }, []);
  const clearPreparedTerminalInput = useCallback(() => {
    setCommandInput("");
  }, []);

  const activateConnection = useCallback(
    (name: string) => {
      const connection = effectiveConnections.find(
        (candidate) => candidate.name === name,
      );

      if (!connection) {
        return;
      }

      setTerminalSessions((prev) =>
        prev[connection.name]
          ? prev
          : {
              ...prev,
              [connection.name]: createConnectionTerminalSession(
                connection,
                t,
                initialTerminalSession,
              ),
            },
      );
      openConnectionTab(connection.name);
      setActiveConnectionName(connection.name);
      recordConnection(connection.name);
    },
    [effectiveConnections, openConnectionTab, recordConnection, t],
  );

  const handleDisconnect = useCallback(async () => {
    const sessionId = desktopSessionsRef.current[activeConnection.name];
    if (!isDesktopRuntime() || !sessionId) {
      setCommandFeedback({
        detail: t("desktop.noSessionActionDetail"),
        title: t("desktop.noSession"),
        tone: "blocked",
      });
      addToast(t("desktop.noSession"), "warning");
      return false;
    }

    try {
      await sshDisconnect(sessionId);
    } catch {
      addToast(t("desktop.connectFailed"), "error");
      return false;
    }

    delete desktopSessionsRef.current[activeConnection.name];
    setConnectVersion((version) => version + 1);
    setCommandInput("");
    setCommandFeedback(null);
    setTerminalSessions((prev) => ({
      ...prev,
      [activeConnection.name]: createConnectionTerminalSession(
        { ...activeConnection, status: "sample" },
        t,
        initialTerminalSession,
      ),
    }));
    addToast(t("desktop.disconnect"), "success");
    return true;
  }, [activeConnection, addToast, t]);

  useEffect(() => {
    setTerminalSessions((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const connection of effectiveConnections) {
        const session = next[connection.name];
        if (
          !session ||
          connection.name === initialTerminalSession.host ||
          session.history.length > 0
        ) {
          continue;
        }

        next[connection.name] = createConnectionTerminalSession(
          connection,
          t,
          initialTerminalSession,
        );
        changed = true;
      }

      return changed ? next : prev;
    });
  }, [effectiveConnections, t]);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    writeStorageText(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    writeStorageJson(LAYOUT_STORAGE_KEY, {
      sidebarCollapsed,
      activeTab: getTerminalTabIndex(openTerminalTabs, activeConnectionName),
      activeConnection: activeConnectionName,
      rightPanel,
    });
  }, [sidebarCollapsed, openTerminalTabs, activeConnectionName, rightPanel]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const commandPaletteShortcut =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";

      if (paletteState.open) {
        if (commandPaletteShortcut || event.key === "Escape") {
          event.preventDefault();
          closePalette();
        }
        return;
      }

      if (shortcutsOpen) {
        if (isKeyboardShortcutsToggle(event) || event.key === "Escape") {
          event.preventDefault();
          setShortcutsOpen(false);
        }
        return;
      }

      if (gettingStartedOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeGettingStarted();
        }
        return;
      }

      if (
        connectOpen ||
        newConnectionOpen ||
        editConnection !== null ||
        groupState.managerOpen
      ) {
        // Modal components own Escape and focus trapping. Never allow a
        // global shortcut to open or mutate content behind an active dialog.
        return;
      }

      if (contextMenu) {
        if (event.key === "Escape") {
          event.preventDefault();
          setContextMenu(null);
          groupDispatch({
            type: "SET_MOVE_TO_GROUP_MENU",
            connection: null,
          });
        }
        return;
      }

      if (commandPaletteShortcut) {
        event.preventDefault();
        openPalette();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "f") {
        event.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "b") {
        event.preventDefault();
        setSidebarCollapsed((prev) => !prev);
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key >= "1" &&
        event.key <= "5"
      ) {
        event.preventDefault();
        const panel = resolvePanelShortcutForSurfacePolicy(
          event.key,
          desktopSurfacePolicy,
        );
        if (panel) {
          setRightPanel(panel);
          setTerminalMaximized(false);
        }
        return;
      }

      if (isKeyboardShortcutsToggle(event)) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key === "T"
      ) {
        event.preventDefault();
        setTheme((prev) =>
          prev === "dark" ? "light" : prev === "light" ? "system" : "dark",
        );
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "c"
      ) {
        if (isDesktopRuntime()) {
          event.preventDefault();
          openPalette("ssh://");
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "n") {
        event.preventDefault();
        openNewConnection();
        return;
      }

      if (
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key >= "1" &&
        event.key <= String(connections.length)
      ) {
        event.preventDefault();
        const idx = Number(event.key) - 1;
        const target = dragState.order[idx];
        if (target) {
          const conn = effectiveConnections.find((c) => c.name === target);
          if (conn) {
            activateConnection(conn.name);
            addToast(connectionSwitchedToast(t, conn.name), "success");
          }
        }
        return;
      }

      if (event.key === "Escape") {
        if (terminalMaximized) {
          event.preventDefault();
          setTerminalMaximized(false);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activateConnection,
    connectOpen,
    dragState.order,
    contextMenu,
    editConnection,
    effectiveConnections,
    groupState.managerOpen,
    groupDispatch,
    newConnectionOpen,
    openNewConnection,
    openPalette,
    paletteState.open,
    shortcutsOpen,
    gettingStartedOpen,
    terminalMaximized,
    closePalette,
    closeGettingStarted,
    addToast,
    t,
  ]);

  const isSshUrl =
    paletteState.input.startsWith("ssh://") ||
    /^[\w.-]+@[\w.-]+(?::\d+)?$/.test(paletteState.input);

  const commands = useMemo(
    () =>
      [
        {
          command: "focus-terminal",
          icon: <TerminalSquare size={16} aria-hidden="true" />,
          name: t("desktop.openTerminal"),
          shortcut: "Enter",
          kind: "command" as const,
        },
        {
          command: "open-team",
          icon: <ShieldCheck size={16} aria-hidden="true" />,
          name: t("desktop.requestElevated"),
          shortcut: "E",
          kind: "command" as const,
        },
        {
          command: "copy-session",
          icon: <Copy size={16} aria-hidden="true" />,
          name: t("desktop.copySession"),
          kind: "command" as const,
        },
        {
          command: "disconnect",
          icon: <X size={16} aria-hidden="true" />,
          name: t("desktop.disconnect"),
          kind: "command" as const,
        },
        {
          command: "open-sftp",
          icon: <HardDrive size={16} aria-hidden="true" />,
          name: t("desktop.openSftp"),
          shortcut: "Ctrl+2",
          kind: "command" as const,
        },
        {
          command: "open-forwarding",
          icon: <Network size={16} aria-hidden="true" />,
          name: t("desktop.openForwarding"),
          shortcut: "Ctrl+4",
          kind: "command" as const,
        },
        {
          command: "open-shortcuts",
          icon: <Command size={16} aria-hidden="true" />,
          name: t("desktop.keyboardShortcuts"),
          shortcut: "Ctrl+Shift+?",
          kind: "command" as const,
        },
      ].filter(
        (command) =>
          desktopSurfacePolicy.showFutureProductSurfaces ||
          command.command !== "open-team",
      ),
    [t],
  );

  const paletteItems = useMemo(() => {
    const items: Array<{
      icon: React.ReactNode;
      name: string;
      shortcut?: string;
      sub?: string;
      kind:
        | "quick-connect"
        | "recent"
        | "connection"
        | "recent-command"
        | "command";
    }> = [];
    if (isSshUrl && isDesktopRuntime()) {
      items.push({
        icon: <Network size={16} />,
        name: t("desktop.quickConnect"),
        sub: paletteState.input,
        kind: "quick-connect",
      });
    }
    const q = paletteState.input.toLowerCase();
    for (const rn of recentsState.recentConnections) {
      const c = effectiveConnections.find((conn) => conn.name === rn);
      if (
        c &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q))
      ) {
        items.push({
          icon: <Server size={16} />,
          name: c.name,
          sub: c.host,
          kind: "recent",
        });
      }
    }
    for (const c of effectiveConnections) {
      if (recentsState.recentConnections.includes(c.name)) continue;
      if (
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.host.toLowerCase().includes(q)
      ) {
        items.push({
          icon: <Server size={16} />,
          name: c.name,
          sub: c.host,
          kind: "connection",
        });
      }
    }
    for (const rcmd of recentsState.recentCommands) {
      const cmd = commands.find((c) => c.command === rcmd);
      if (cmd && (!q || cmd.name.toLowerCase().includes(q))) {
        items.push({ ...cmd, kind: "recent-command" });
      }
    }
    for (const cmd of commands) {
      if (recentsState.recentCommands.includes(cmd.command)) continue;
      if (!q || cmd.name.toLowerCase().includes(q)) {
        items.push(cmd);
      }
    }
    return items;
  }, [
    isSshUrl,
    paletteState.input,
    commands,
    recentsState.recentConnections,
    recentsState.recentCommands,
    effectiveConnections,
    t,
  ]);

  useEffect(() => {
    setPaletteIndex(0);
  }, [paletteState.input, setPaletteIndex]);

  // Re-clamp when the item set shrinks without an input change (recents/
  // connections recompute) so the active index and Enter target never point
  // past the end of paletteItems.
  useEffect(() => {
    if (paletteState.index >= paletteItems.length) {
      setPaletteIndex(0);
    }
  }, [paletteItems.length, paletteState.index, setPaletteIndex]);

  const selectPaletteItem = useCallback(
    (item: PaletteItem) => {
      if (item.kind === "recent" || item.kind === "connection") {
        recordConnection(item.name);
        activateConnection(item.name);
      }
      if (item.kind === "quick-connect") {
        const target = splitConnectionTarget(item.sub ?? paletteState.input);
        const existingConnectionName = findConnectionNameByTarget(
          effectiveConnections,
          target,
        );
        const existingConnection = effectiveConnections.find(
          (connection) => connection.name === existingConnectionName,
        );
        const quickConnection = existingConnection
          ? undefined
          : createQuickConnectionProfile(
              target,
              effectiveConnections.map((connection) => connection.name),
              t("desktop.quickConnect"),
            );
        const connectionName =
          existingConnection?.name ?? quickConnection?.name ?? target.host;

        if (quickConnection) {
          setQuickConnections((connections) => [
            ...connections,
            quickConnection,
          ]);
          openConnectionTab(connectionName);
          setActiveConnectionName(connectionName);
        } else if (existingConnection) {
          activateConnection(existingConnection.name);
        }

        if (
          !existingConnection ||
          !desktopSessionsRef.current[existingConnection.name]
        ) {
          setConnectProfileName(connectionName);
          setConnectTargetOverride(target);
          setConnectOpen(true);
        }
      }
      if (item.kind === "command" || item.kind === "recent-command") {
        if (item.command === "disconnect") {
          void handleDisconnect().then((didDisconnect) => {
            if (didDisconnect && item.command) recordCommand(item.command);
          });
        } else {
          if (item.command === "focus-terminal") {
            if (isDesktopRuntime() && !hasActiveDesktopSession) {
              setConnectProfileName(activeConnection.name);
              setConnectTargetOverride(null);
              setConnectOpen(true);
            } else {
              window.requestAnimationFrame(() => {
                const terminalZone = document.getElementById("terminal-zone");
                const focusTarget = terminalZone?.querySelector<HTMLElement>(
                  'textarea, input, [tabindex="0"]',
                );
                (focusTarget ?? terminalZone)?.focus();
              });
            }
          }
          if (item.command === "open-sftp") {
            setRightPanel("sftp");
            setTerminalMaximized(false);
          }
          if (
            item.command === "open-team" &&
            desktopSurfacePolicy.showFutureProductSurfaces
          ) {
            setRightPanel("team");
            setTerminalMaximized(false);
          }
          if (item.command === "open-forwarding") {
            setRightPanel("forwarding");
            setTerminalMaximized(false);
          }
          if (item.command === "copy-session") {
            if (hasActiveDesktopSession)
              void handleCopySshCommand(activeConnection);
            else addToast(t("desktop.noSession"), "warning");
          }
          if (item.command === "open-shortcuts") setShortcutsOpen(true);
          if (item.command) recordCommand(item.command);
        }
      }
      closePalette();
    },
    [
      recordConnection,
      activateConnection,
      paletteState.input,
      handleDisconnect,
      recordCommand,
      closePalette,
      hasActiveDesktopSession,
      handleCopySshCommand,
      activeConnection,
      addToast,
      t,
      effectiveConnections,
      openConnectionTab,
    ],
  );

  const handlePaletteKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPaletteIndex(
          Math.min(paletteState.index + 1, paletteItems.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPaletteIndex(Math.max(paletteState.index - 1, 0));
        return;
      }
      if (event.key === "Enter" && paletteItems.length > 0) {
        event.preventDefault();
        const item = paletteItems[paletteState.index] ?? paletteItems[0];
        selectPaletteItem(item);
        return;
      }
    },
    [paletteItems, paletteState.index, setPaletteIndex, selectPaletteItem],
  );

  async function handleTerminalCommandSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const desktopSessionId = desktopSessionsRef.current[activeConnection.name];
    if (!isDesktopRuntime() || !desktopSessionId) {
      setCommandFeedback({
        detail: t("desktop.noSessionActionDetail"),
        title: t("desktop.noSession"),
        tone: "blocked",
      });
      addToast(t("desktop.noSession"), "warning");
      return;
    }

    const runRemote = async (command: string) => {
      const result = await sshExec(desktopSessionId, command);
      return result.stdout;
    };

    const result = await submitTerminalCommand(
      terminalSession,
      commandInput,
      `[local] ${t("desktop.commandAcceptedDetail")}`,
      runRemote,
    );

    if (result.event.type === "ignored") {
      return;
    }

    if (result.event.type === "blocked") {
      setCommandFeedback({
        detail: t("desktop.commandBlockedDetail", {
          pattern: result.event.pattern,
          reason: t(result.event.reasonKey),
        }),
        title: t("desktop.commandBlocked"),
        tone: "blocked",
      });
      addToast(t("desktop.commandBlocked"), "error");
      return;
    }

    setTerminalSessions((prev) => ({
      ...prev,
      [activeConnection.name]: result.session,
    }));
    setCommandFeedback({
      detail: t("desktop.commandAcceptedDetail"),
      title: t("desktop.commandAccepted"),
      tone: "accepted",
    });
    addToast(`${result.event.displayCommand}`, "success");
    setCommandInput("");
  }

  return (
    <main
      className={`workbench ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${terminalMaximized ? "terminal-maximized" : ""}`}
      data-release-surface-profile={desktopSurfacePolicy.profile}
      data-locale={locale}
      dir={direction}
      lang={locale}
    >
      <a className="skipLink" href="#terminal-zone">
        {t("desktop.skipToTerminal")}
      </a>
      <Sidebar
        activeConnectionName={activeConnectionName}
        activeTagFilters={activeTagFilters}
        allGroupNames={allGroupNames}
        allTags={allTags}
        commandSnippets={commandSnippets}
        collapsedGroups={groupState.collapsedGroups}
        connectionCounts={connectionCounts}
        direction={direction}
        effectiveConnections={effectiveConnections}
        favorites={recentsState.favorites}
        filteredConnections={filteredConnections}
        formatters={formatters}
        groupedConnections={groupedConnections}
        groupOrder={groupOrder}
        languageChoice={languageChoice}
        locale={locale}
        onActivateConnection={activateConnection}
        onCommandInputChange={setCommandInput}
        onGroupDispatch={groupDispatch}
        onLanguageChoiceChange={onLanguageChoiceChange}
        onOpenPalette={openPalette}
        onSidebarSearchChange={setSidebarSearch}
        onTagFilterToggle={(tag) => {
          setActiveTagFilters((prev) => {
            const next = new Set(prev);
            if (next.has(tag)) next.delete(tag);
            else next.add(tag);
            return next;
          });
        }}
        onToggleFavorite={toggleFavorite}
        onContextMenu={(name, x, y) => {
          const conn = effectiveConnections.find((c) => c.name === name);
          if (conn) setContextMenu({ x, y, connection: conn });
        }}
        sidebarSearch={sidebarSearch}
        t={t}
        dragState={dragState}
        onDragStart={startDrag}
        onDragOver={handleDragOver}
        onDragLeave={dragLeave}
        onDragEnd={dragEnd}
        onMoveConnectionAfter={moveConnectionAfter}
        onMoveConnectionBefore={moveConnectionBefore}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
        onNewConnection={openNewConnection}
        snippetsEnabled={hasActiveDesktopSession}
      />

      <section className="terminal-zone" id="terminal-zone" tabIndex={-1}>
        <header className="topbar">
          <div className="session-title">
            <Server size={18} />
            <div>
              <strong>{activeConnection.name}</strong>
              <span>
                {hasActiveDesktopSession
                  ? activeConnection.host
                  : t("desktop.demoScopeSummary")}
              </span>
            </div>
          </div>
          <div className="topbar-actions">
            {isDesktopRuntime() && hasActiveDesktopSession ? (
              <Button
                size="sm"
                onClick={() => {
                  void handleDisconnect();
                }}
              >
                <X size={14} aria-hidden="true" /> {t("desktop.disconnect")}
              </Button>
            ) : isDesktopRuntime() ? (
              <Button
                size="sm"
                onClick={() => {
                  setConnectProfileName(activeConnection.name);
                  setConnectTargetOverride(null);
                  setConnectOpen(true);
                }}
              >
                <Plug size={14} aria-hidden="true" />{" "}
                {t("desktop.connectAction")}
              </Button>
            ) : null}
            <IconButton
              label={t("desktop.gettingStarted")}
              onClick={() => setGettingStartedOpen(true)}
            >
              <CircleHelp size={16} />
            </IconButton>
            <IconButton
              label={
                theme === "dark"
                  ? t("desktop.themeSwitchLight")
                  : theme === "light"
                    ? t("desktop.themeSwitchSystem")
                    : t("desktop.themeSwitchDark")
              }
              onClick={() =>
                setTheme(
                  theme === "dark"
                    ? "light"
                    : theme === "light"
                      ? "system"
                      : "dark",
                )
              }
            >
              {theme === "light" ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
            <Badge tone={hasActiveDesktopSession ? "good" : "neutral"}>
              {hasActiveDesktopSession ? (
                <Lock size={12} />
              ) : (
                <Plug size={12} />
              )}
              {hasActiveDesktopSession ? "SSH" : t("desktop.noSession")}
            </Badge>
            <IconButton
              label={t("desktop.copySession")}
              disabled={!hasActiveDesktopSession}
              onClick={() => {
                void handleCopySshCommand(activeConnection);
              }}
            >
              <Copy size={16} />
            </IconButton>
            <IconButton
              aria-pressed={terminalMaximized}
              label={
                terminalMaximized
                  ? t("desktop.restoreWorkbench")
                  : t("desktop.maximizeTerminal")
              }
              onClick={() => setTerminalMaximized((maximized) => !maximized)}
            >
              {terminalMaximized ? (
                <Minimize2 size={16} />
              ) : (
                <Maximize2 size={16} />
              )}
            </IconButton>
          </div>
        </header>

        <nav className="tabbar" aria-label={t("desktop.terminalTabs")}>
          <div role="tablist" aria-label={t("desktop.terminalTabs")}>
            {openTerminalTabs.map((tab) => (
              <button
                className={tab === activeConnection.name ? "is-active" : ""}
                key={tab}
                title={tab}
                type="button"
                role="tab"
                aria-selected={tab === activeConnection.name}
                onClick={() => activateConnection(tab)}
              >
                <TerminalSquare size={15} aria-hidden="true" />
                <span>{tab}</span>
              </button>
            ))}
          </div>
        </nav>

        <div
          className={`terminal-grid ${
            activeConnection.status !== "locked" &&
            activeConnection.name === "prod-edge-01"
              ? "terminal-grid--split"
              : "terminal-grid--single"
          }`}
        >
          {activeConnection.status === "locked" ? (
            <TerminalPane
              statusLabel={t("desktop.locked")}
              t={t}
              title={activeConnection.name}
              lines={terminalSession.lines}
            />
          ) : (
            <>
              {ptyDeps ? (
                <div className="terminal-pane terminal-pane--xterm">
                  <Suspense fallback={<PanelLoadingState t={t} />}>
                    <LazyXtermTerminal
                      deps={ptyDeps}
                      label={t("desktop.xtermTerminalLabel")}
                      onPreparedInputConsumed={clearPreparedTerminalInput}
                      preparedInput={commandInput}
                      search={{
                        closeLabel: t("desktop.searchClose"),
                        matchesLabel: (count) =>
                          t("desktop.searchMatches", { count }),
                        nextLabel: t("desktop.searchNextMatch"),
                        onClose: () => {
                          setSearchOpen(false);
                          setSearchQuery("");
                        },
                        onQueryChange: setSearchQuery,
                        open: searchOpen,
                        placeholder: t("desktop.searchPlaceholder"),
                        previousLabel: t("desktop.searchPrevMatch"),
                        query: searchQuery,
                      }}
                      statusLabels={{
                        opening: t("desktop.ptyOpening"),
                        open: t("desktop.ptyOpen"),
                        blocked: t("desktop.ptyBlocked"),
                        closed: t("desktop.ptyClosed"),
                        error: t("desktop.ptyError"),
                        reconnect: t("desktop.ptyReconnect"),
                      }}
                    />
                  </Suspense>
                </div>
              ) : (
                <TerminalPane
                  active={hasActiveDesktopSession}
                  commandFeedback={commandFeedback}
                  commandInput={commandInput}
                  commandHistory={terminalSession.history}
                  lines={terminalSession.lines}
                  onCommandInputChange={
                    hasActiveDesktopSession ? setCommandInput : undefined
                  }
                  onCommandSubmit={
                    hasActiveDesktopSession
                      ? handleTerminalCommandSubmit
                      : undefined
                  }
                  searchOpen={searchOpen}
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                  onSearchClose={() => {
                    setSearchOpen(false);
                    setSearchQuery("");
                  }}
                  statusLabel={
                    hasActiveDesktopSession
                      ? t("desktop.live")
                      : t("desktop.noSession")
                  }
                  t={t}
                  title={
                    hasActiveDesktopSession
                      ? t("desktop.gatewayShell")
                      : t("desktop.demoShell")
                  }
                />
              )}
              {activeConnection.name === "prod-edge-01" ? (
                <TerminalPane
                  statusLabel={t("desktop.split")}
                  t={t}
                  title={t("desktop.metricsWatch")}
                  lines={metricsTerminalSession.lines}
                />
              ) : null}
            </>
          )}
        </div>
      </section>

      <aside className="context-pane">
        <div className="panel-switcher">
          <SegmentedControl<RightPanel>
            label={t("desktop.context")}
            onChange={setRightPanel}
            options={[
              { value: "inspector", label: t("desktop.context") },
              { value: "sftp", label: t("desktop.sftp") },
              ...(desktopSurfacePolicy.showFutureProductSurfaces
                ? [{ value: "team" as const, label: t("desktop.team") }]
                : []),
              { value: "forwarding", label: t("desktop.forwarding") },
              { value: "settings", label: t("desktop.settings") },
            ]}
            value={rightPanel}
          />
        </div>
        <Suspense fallback={<PanelLoadingState t={t} />}>
          {rightPanel === "inspector" ? (
            <LazyInspectorPanel
              activeConnection={activeConnection}
              connectionStats={inspectorConnectionStats}
              formatters={formatters}
              hasActiveSession={hasActiveDesktopSession}
              onPrepareCommand={() =>
                setCommandInput(`${commandSnippets[0].command}\r`)
              }
              onOpenForwarding={() => setRightPanel("forwarding")}
              sessionContext={inspectorSessionContext}
              t={t}
            />
          ) : null}
          {rightPanel === "sftp" ? (
            <LazySftpPanel
              sftpItems={sftpItems}
              formatters={formatters}
              t={t}
              directory={{
                active: sftpDirectory.active,
                path: sftpDirectory.path,
                status: sftpDirectory.status,
                onRefresh: sftpDirectory.refresh,
                onOpenDir: sftpDirectory.openChild,
                onGoUp: sftpDirectory.goUp,
                canGoUp: sftpDirectory.canGoUp,
              }}
              transfer={
                sftpTransfer.active
                  ? {
                      status: sftpTransfer.status,
                      onUpload: (file, directoryPath) =>
                        void handleSftpUploadFile(file, directoryPath),
                      onDownload: (name, size, directoryPath) =>
                        void handleSftpDownload(name, size, directoryPath),
                    }
                  : undefined
              }
            />
          ) : null}
          {desktopSurfacePolicy.showFutureProductSurfaces &&
          rightPanel === "team" ? (
            <LazyTeamAccessPanel formatters={formatters} t={t} />
          ) : null}
          {rightPanel === "forwarding" ? (
            <LazyForwardingPanel
              customRules={customForwardRules}
              onAddCustomRule={(rule) =>
                setCustomForwardRules((current) => [...current, rule])
              }
              onRemoveCustomRule={(id) =>
                setCustomForwardRules((current) =>
                  current.filter((rule) => rule.id !== id),
                )
              }
              showSampleRules={!forwardRules.active}
              t={t}
              forwards={
                forwardRules.active
                  ? {
                      runtime: forwardRules.runtime,
                      onStart: (id, bindAddr, targetHost, targetPort) =>
                        void forwardRules.startRule(
                          id,
                          bindAddr,
                          targetHost,
                          targetPort,
                        ),
                      onStop: (id) => void forwardRules.stopRule(id),
                    }
                  : undefined
              }
            />
          ) : null}
          {rightPanel === "settings" ? (
            <LazySettingsPanel
              t={t}
              connectionsIO={{
                exportConnections: customConnections.connections,
                onImport: handleImportConnections,
                onImportError: () =>
                  addToast(connectionsImportFailedToast(t), "error"),
              }}
              knownHosts={{
                count: knownHostsStoredCount,
                entries: knownHostEntries,
                onClear: handleClearKnownHosts,
                onRemove: handleRemoveKnownHost,
              }}
              legal={{
                available: isDesktopRuntime(),
                loadThirdPartyNotices: thirdPartyNotices,
              }}
              showFutureProductSurfaces={
                desktopSurfacePolicy.showFutureProductSurfaces
              }
              telemetry={telemetry}
            />
          ) : null}
        </Suspense>
      </aside>

      <StatusBar
        activeConnection={activeConnection}
        formatters={formatters}
        hasActiveSession={hasActiveDesktopSession}
        onPanelChange={(panel) => {
          setRightPanel(panel);
          setTerminalMaximized(false);
        }}
        t={t}
        teamAccess={teamAccess}
        showTeamAccess={desktopSurfacePolicy.showFutureProductSurfaces}
      />

      {paletteState.open ? (
        <CommandPalette
          input={paletteState.input}
          index={paletteState.index}
          items={paletteItems}
          onInputChange={setPaletteInput}
          onClose={closePalette}
          onIndexChange={setPaletteIndex}
          onKeyDown={handlePaletteKeyDown}
          onSelect={selectPaletteItem}
          t={t}
        />
      ) : null}

      {shortcutsOpen ? (
        <ShortcutsOverlay
          desktopRuntime={isDesktopRuntime()}
          onClose={() => setShortcutsOpen(false)}
          showFutureProductSurfaces={
            desktopSurfacePolicy.showFutureProductSurfaces
          }
          t={t}
        />
      ) : null}

      {gettingStartedOpen ? (
        <GettingStartedOverlay
          desktopRuntime={isDesktopRuntime()}
          initialStep={gettingStartedState.lastStep}
          onClose={closeGettingStarted}
          onComplete={completeGettingStarted}
          onCreateConnection={() => {
            openGettingStartedNewConnection();
          }}
          onOpenConnect={openGettingStartedConnect}
          onOpenForwarding={() => openGettingStartedPanel("forwarding")}
          onOpenSftp={() => openGettingStartedPanel("sftp")}
          onOpenTerminal={openGettingStartedTerminal}
          onSkip={skipGettingStarted}
          onStepChange={updateGettingStartedStep}
          showCompanionProductSurfaces={
            desktopSurfacePolicy.showCompanionProductSurfaces
          }
          t={t}
        />
      ) : null}

      <ToastContainer toasts={toasts} />

      {contextMenu ? (
        <ContextMenu
          allGroupNames={allGroupNames}
          capabilities={{
            connect:
              isDesktopRuntime() &&
              !desktopSessionsRef.current[contextMenu.connection.name],
            delete: !builtinConnectionNameSet.has(contextMenu.connection.name),
            edit: customConnections.connections.some(
              (connection) => connection.name === contextMenu.connection.name,
            ),
            test: isDesktopRuntime(),
          }}
          connection={contextMenu.connection}
          moveToGroupMenu={groupState.moveToGroupMenu}
          onClose={() => setContextMenu(null)}
          onMoveToGroup={(connection, group) => {
            groupDispatch({ type: "MOVE_CONNECTION", connection, group });
            addToast(
              connectionMovedToast(t, connection, desktopGroupLabel(group, t)),
            );
          }}
          onSelect={(action) => {
            if (action === "connect") {
              activateConnection(contextMenu.connection.name);
              if (
                isDesktopRuntime() &&
                !desktopSessionsRef.current[contextMenu.connection.name]
              ) {
                setConnectProfileName(contextMenu.connection.name);
                setConnectTargetOverride(null);
                setConnectOpen(true);
              } else if (!isDesktopRuntime()) {
                addToast(t("desktop.noSessionActionDetail"), "warning");
              }
            } else if (action === "test") {
              const conn = effectiveConnections.find(
                (c) => c.name === contextMenu.connection.name,
              );
              const target = getConnectionTarget(
                conn ?? { host: contextMenu.connection.name },
              );
              if (isDesktopRuntime()) {
                void testConnection(target.host, target.port ?? 22)
                  .then((probe) => {
                    if (probe.outcome === "reachable") {
                      addToast(
                        connectionTestResultToast(
                          t,
                          formatters.latency(probe.latency_ms ?? 0),
                        ),
                        "success",
                      );
                    } else if (probe.outcome === "timed_out") {
                      addToast(
                        connectionTestResultToast(
                          t,
                          t("desktop.connectFailed"),
                        ),
                        "warning",
                      );
                    } else {
                      addToast(
                        connectionTestResultToast(
                          t,
                          probe.message ?? t("desktop.connectFailed"),
                        ),
                        "error",
                      );
                    }
                  })
                  .catch((error: unknown) => {
                    addToast(
                      connectionTestResultToast(
                        t,
                        error instanceof Error
                          ? error.message
                          : t("desktop.connectFailed"),
                      ),
                      "error",
                    );
                  });
              } else {
                addToast(t("desktop.noSessionActionDetail"), "warning");
              }
            } else if (action === "edit") {
              const existing = customConnections.connections.find(
                (c) => c.name === contextMenu.connection.name,
              );
              if (existing) setEditConnection(existing);
              else
                addToast(builtinConnectionEditUnavailableToast(t), "warning");
            } else if (action === "duplicate") {
              const src =
                customConnections.connections.find(
                  (c) => c.name === contextMenu.connection.name,
                ) ??
                effectiveConnections.find(
                  (c) => c.name === contextMenu.connection.name,
                );
              if (src) {
                let copyName = duplicateConnectionName(t, src.name);
                let n = 1;
                while (!customConnections.isNameAvailable(copyName)) {
                  n += 1;
                  copyName = duplicateConnectionName(t, src.name, n);
                }
                customConnections.add({
                  name: copyName,
                  host: src.host,
                  group: src.group,
                  tags: [...src.tags],
                  port: src.port,
                  username: src.username,
                });
                addToast(connectionDuplicatedToast(t, copyName));
              }
            } else if (action === "copySsh")
              void handleCopySshCommand(contextMenu.connection);
            else if (action === "delete") {
              const name = contextMenu.connection.name;
              if (builtinConnectionNameSet.has(name)) {
                addToast(builtinConnectionDeleteUnavailableToast(t), "warning");
              } else {
                const removeProfile = () => {
                  if (
                    quickConnections.some(
                      (connection) => connection.name === name,
                    )
                  ) {
                    setQuickConnections((profiles) =>
                      profiles.filter((connection) => connection.name !== name),
                    );
                  } else {
                    customConnections.remove(name);
                  }
                  setTerminalSessions((sessions) => {
                    const { [name]: removedSession, ...remainingSessions } =
                      sessions;
                    void removedSession;
                    return remainingSessions;
                  });
                  setOpenTerminalTabs((tabs) => removeTerminalTab(tabs, name));
                  if (activeConnectionName === name) {
                    setActiveConnectionName(connections[0].name);
                  }
                  addToast(connectionDeletedToast(t, name), "warning");
                };
                const sessionId = desktopSessionsRef.current[name];
                if (isDesktopRuntime() && sessionId) {
                  void sshDisconnect(sessionId)
                    .then(() => {
                      delete desktopSessionsRef.current[name];
                      setConnectVersion((version) => version + 1);
                      removeProfile();
                    })
                    .catch(() => addToast(t("desktop.connectFailed"), "error"));
                } else {
                  removeProfile();
                }
              }
            }
          }}
          onToggleMoveToGroup={(connection) =>
            groupDispatch({ type: "SET_MOVE_TO_GROUP_MENU", connection })
          }
          position={{ x: contextMenu.x, y: contextMenu.y }}
          t={t}
        />
      ) : null}

      {groupState.managerOpen ? (
        <GroupManagerModal
          allGroupNames={allGroupNames}
          connectionCounts={connectionCounts}
          customGroups={groupState.customGroups}
          editingGroup={groupState.editingGroup}
          editingGroupName={groupState.editingGroupName}
          isGroupValid={isGroupValid}
          newGroupName={groupState.newGroupName}
          onClose={() =>
            groupDispatch({ type: "SET_MANAGER_OPEN", open: false })
          }
          onCreateGroup={(name) => {
            groupDispatch({ type: "ADD_CUSTOM_GROUP", name });
            addToast(groupCreatedToast(t, name));
          }}
          onDeleteGroup={(name) => {
            for (const connection of effectiveConnections) {
              if (connection.group === name) {
                groupDispatch({
                  type: "MOVE_CONNECTION",
                  connection: connection.name,
                  group: "Production",
                });
              }
            }
            groupDispatch({ type: "REMOVE_CUSTOM_GROUP", name });
            addToast(groupDeletedToast(t, name), "warning");
          }}
          onRenameGroup={(oldName, newName) => {
            for (const connection of effectiveConnections) {
              if (connection.group === oldName) {
                groupDispatch({
                  type: "MOVE_CONNECTION",
                  connection: connection.name,
                  group: newName,
                });
              }
            }
            groupDispatch({ type: "RENAME_GROUP", oldName, newName });
            addToast(groupRenamedToast(t, newName));
          }}
          onSetEditingGroup={(group, name) => {
            if (group) groupDispatch({ type: "START_EDIT_GROUP", group, name });
            else groupDispatch({ type: "CANCEL_EDIT" });
          }}
          onSetEditingGroupName={(name) =>
            groupDispatch({ type: "SET_EDITING_GROUP_NAME", name })
          }
          onSetNewGroupName={(name) =>
            groupDispatch({ type: "SET_NEW_GROUP_NAME", name })
          }
          onStartEditGroup={(group, name) =>
            groupDispatch({ type: "START_EDIT_GROUP", group, name })
          }
          t={t}
        />
      ) : null}
      {newConnectionOpen ? (
        <NewConnectionModal
          defaultGroup={groupOrder[0] ?? "Production"}
          isNameAvailable={customConnections.isNameAvailable}
          onClose={() => {
            setNewConnectionOpen(false);
            setGettingStartedCreatePending(false);
          }}
          onCreate={(connection) => {
            const created = customConnections.add(connection);
            if (created) {
              if (!allGroupNames.includes(connection.group)) {
                groupDispatch({
                  type: "ADD_CUSTOM_GROUP",
                  name: connection.group,
                });
              }
              openConnectionTab(connection.name);
              setActiveConnectionName(connection.name);
              addToast(connectionCreatedToast(t, connection.name));
              if (gettingStartedCreatePending) {
                setGettingStartedCreatePending(false);
                updateGettingStartedState("in-progress", 1);
                setConnectProfileName(connection.name);
                setConnectTargetOverride(null);
                setConnectOpen(true);
              }
            }
            return created;
          }}
          t={t}
        />
      ) : null}
      {editConnection ? (
        <NewConnectionModal
          defaultGroup={editConnection.group}
          isNameAvailable={() => true}
          edit={editConnection}
          onClose={() => setEditConnection(null)}
          onCreate={(connection) => {
            customConnections.update(connection.name, {
              host: connection.host,
              group: connection.group,
              tags: connection.tags,
              port: connection.port,
              username: connection.username,
            });
            if (!allGroupNames.includes(connection.group)) {
              groupDispatch({
                type: "ADD_CUSTOM_GROUP",
                name: connection.group,
              });
            }
            addToast(connectionEditedToast(t, connection.name));
            return true;
          }}
          t={t}
        />
      ) : null}
      {connectOpen ? (
        <ConnectModal
          defaultHost={connectDefaults.host}
          defaultPort={connectDefaults.port}
          defaultUsername={connectDefaults.username}
          onClose={() => {
            setConnectOpen(false);
            setConnectProfileName(null);
            setConnectTargetOverride(null);
          }}
          onConnect={async (connectInput) => {
            const result = await sshConnect(connectInput);
            return result.session_id;
          }}
          onHostKeyProbe={isDesktopRuntime() ? sshHostKeyProbe : undefined}
          onConnected={(sessionId) => {
            const connectionName = connectProfileName ?? activeConnection.name;
            desktopSessionsRef.current[connectionName] = sessionId;
            openConnectionTab(connectionName);
            setActiveConnectionName(connectionName);
            setConnectProfileName(null);
            setConnectVersion((v) => v + 1);
            addToast(t("desktop.connectedToast"));
          }}
          t={t}
        />
      ) : null}
    </main>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("JoeSSH root element was not found");
}

function AppWithBoundary() {
  const [languageChoice, setLanguageChoice] = useState<LanguageChoice>(
    getInitialLanguageChoice,
  );
  const [telemetryEnabled, setTelemetryEnabled] = useState(
    initialDesktopTelemetryEnabled,
  );
  const locale = useMemo(
    () => resolveLanguageChoice(languageChoice),
    [languageChoice],
  );
  const [t, setT] = useState<Translator | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadLocale(locale).then((translator) => {
      if (!cancelled) {
        setT(() => translator);
        document.documentElement.lang = locale;
        document.documentElement.dir = getTextDirection(locale);
        writeStorageText(LOCALE_STORAGE_KEY, languageChoice);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [locale, languageChoice]);

  useEffect(() => {
    if (!t) return undefined;
    return applyLocalizedDesktopMetadata(t);
  }, [t]);

  useEffect(() => {
    if (!desktopTelemetryAvailable || !telemetryEnabled) {
      errorMonitor.disable();
      return undefined;
    }

    errorMonitor.enable();
    const uninstall = errorMonitor.install();

    return () => {
      uninstall?.();
      errorMonitor.disable();
    };
  }, [telemetryEnabled]);

  const handleTelemetryChange = useCallback((enabled: boolean) => {
    const nextEnabled = desktopTelemetryAvailable && enabled;
    writeTelemetryConsent(getBrowserTelemetryConsentStorage(), nextEnabled);
    setTelemetryEnabled(nextEnabled);
  }, []);

  if (!t) {
    return null;
  }

  return (
    <DesktopErrorBoundary
      errorMonitor={errorMonitor}
      messageLabel={t("desktop.error.boundary.message")}
      titleLabel={t("desktop.error.boundary.title")}
      reloadLabel={t("desktop.error.boundary.reload")}
    >
      <App
        t={t}
        locale={locale}
        onLanguageChoiceChange={setLanguageChoice}
        languageChoice={languageChoice}
        telemetry={{
          available: desktopTelemetryAvailable,
          enabled: telemetryEnabled,
          onChange: handleTelemetryChange,
        }}
      />
    </DesktopErrorBoundary>
  );
}

const desktopEnv =
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> })
    .env ?? {};
const desktopTelemetryAvailable = isTelemetryOptedIn(
  desktopEnv.VITE_ATLASTERM_TELEMETRY_OPT_IN,
);
const initialDesktopTelemetryEnabled =
  desktopTelemetryAvailable &&
  readTelemetryConsent(getBrowserTelemetryConsentStorage());
void TELEMETRY_CONSENT_STORAGE_KEY;
const errorMonitor = desktopTelemetryAvailable
  ? createErrorMonitor({
      app: "desktop",
      endpoint: desktopEnv.VITE_ATLASTERM_ERROR_MONITOR_ENDPOINT,
      version: desktopEnv.VITE_ATLASTERM_APP_VERSION ?? "0.1.0-beta.18",
    })
  : createNoopErrorMonitor();

if (!initialDesktopTelemetryEnabled) {
  errorMonitor.disable();
}

const root = window.__atlastermRoot ?? createRoot(rootElement);
window.__atlastermRoot = root;

root.render(
  <StrictMode>
    <AppWithBoundary />
  </StrictMode>,
);
