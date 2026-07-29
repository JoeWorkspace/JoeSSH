export const LOCALE_STORAGE_KEY = "atlasterm.locale";
export const RECENT_CONNECTIONS_KEY = "atlasterm.recentConnections";
export const RECENT_COMMANDS_KEY = "atlasterm.recentCommands";
export const FAVORITES_KEY = "atlasterm.favorites";
export const THEME_STORAGE_KEY = "atlasterm.theme";
export const GROUPS_STORAGE_KEY = "atlasterm.customGroups";
export const CONNECTION_GROUPS_STORAGE_KEY = "atlasterm.connectionGroups";
export const CONNECTION_ORDER_STORAGE_KEY = "atlasterm.connectionOrder";
export const CUSTOM_CONNECTIONS_STORAGE_KEY = "atlasterm.customConnections";
export const FORWARD_RULES_STORAGE_KEY = "atlasterm.forwardRules";
export const LAYOUT_STORAGE_KEY = "atlasterm.layout";
export const GETTING_STARTED_STORAGE_KEY = "atlasterm.gettingStarted";

export type PersistedRightPanel =
  | "inspector"
  | "sftp"
  | "team"
  | "forwarding"
  | "settings";
export type PersistedTheme = "dark" | "light" | "system";

export type DesktopLayoutState = {
  activeConnection: string;
  activeTab: number;
  rightPanel: PersistedRightPanel;
  sidebarCollapsed: boolean;
};

const rightPanels = new Set<PersistedRightPanel>([
  "inspector",
  "sftp",
  "team",
  "forwarding",
  "settings",
]);
const themes = new Set<PersistedTheme>(["dark", "light", "system"]);

function getLocalStorage(): Storage | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRightPanel(value: unknown): value is PersistedRightPanel {
  return (
    typeof value === "string" && rightPanels.has(value as PersistedRightPanel)
  );
}

function isTheme(value: unknown): value is PersistedTheme {
  return typeof value === "string" && themes.has(value as PersistedTheme);
}

function isActiveTab(value: unknown, maxActiveTab: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= maxActiveTab
  );
}

export function readStorageText(key: string): string | null {
  const storage = getLocalStorage();

  if (!storage) {
    return null;
  }

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function readStorageJson(key: string): unknown {
  const text = readStorageText(key);

  if (text === null) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function readStoredTheme(defaultTheme: PersistedTheme): PersistedTheme {
  const theme = readStorageText(THEME_STORAGE_KEY);
  return isTheme(theme) ? theme : defaultTheme;
}

export function readStoredLayout(
  defaults: DesktopLayoutState,
  options: {
    activeConnections?: readonly string[];
    maxActiveTab?: number;
  } = {},
): DesktopLayoutState {
  const raw = readStorageJson(LAYOUT_STORAGE_KEY);

  if (!isRecord(raw)) {
    return defaults;
  }

  const activeConnections = new Set(options.activeConnections ?? []);
  const hasConnectionAllowList = activeConnections.size > 0;
  const maxActiveTab = options.maxActiveTab ?? Number.MAX_SAFE_INTEGER;

  return {
    activeConnection:
      typeof raw.activeConnection === "string" &&
      (!hasConnectionAllowList || activeConnections.has(raw.activeConnection))
        ? raw.activeConnection
        : defaults.activeConnection,
    activeTab: isActiveTab(raw.activeTab, maxActiveTab)
      ? raw.activeTab
      : defaults.activeTab,
    rightPanel: isRightPanel(raw.rightPanel)
      ? raw.rightPanel
      : defaults.rightPanel,
    sidebarCollapsed:
      typeof raw.sidebarCollapsed === "boolean"
        ? raw.sidebarCollapsed
        : defaults.sidebarCollapsed,
  };
}

export function readStoredStringList(
  key: string,
  options: { maxItems?: number } = {},
): string[] {
  const raw = readStorageJson(key);

  if (!Array.isArray(raw)) {
    return [];
  }

  const values: string[] = [];
  const seen = new Set<string>();
  const maxItems = options.maxItems ?? Number.MAX_SAFE_INTEGER;

  for (const item of raw) {
    if (typeof item !== "string") {
      continue;
    }

    const value = item.trim();

    if (!value || seen.has(value)) {
      continue;
    }

    values.push(value);
    seen.add(value);

    if (values.length >= maxItems) {
      break;
    }
  }

  return values;
}

export function readStoredConnectionGroups(
  options: {
    allowedGroups?: readonly string[];
    connectionNames?: readonly string[];
  } = {},
): Record<string, string> {
  const raw = readStorageJson(CONNECTION_GROUPS_STORAGE_KEY);

  if (!isRecord(raw)) {
    return {};
  }

  const allowedGroups = new Set(options.allowedGroups ?? []);
  const hasGroupAllowList = allowedGroups.size > 0;
  const connectionNames = new Set(options.connectionNames ?? []);
  const hasConnectionAllowList = connectionNames.size > 0;
  const groups: Record<string, string> = {};

  for (const [connectionName, groupName] of Object.entries(raw)) {
    const normalizedConnectionName = connectionName.trim();

    if (
      !normalizedConnectionName ||
      (hasConnectionAllowList &&
        !connectionNames.has(normalizedConnectionName)) ||
      typeof groupName !== "string"
    ) {
      continue;
    }

    const normalizedGroupName = groupName.trim();

    if (
      !normalizedGroupName ||
      (hasGroupAllowList && !allowedGroups.has(normalizedGroupName))
    ) {
      continue;
    }

    groups[normalizedConnectionName] = normalizedGroupName;
  }

  return groups;
}

export function readStoredConnectionOrder(
  defaultOrder: readonly string[],
): string[] {
  const storedOrder = readStoredStringList(CONNECTION_ORDER_STORAGE_KEY);

  if (storedOrder.length === 0) {
    return [...defaultOrder];
  }

  const allowedNames = new Set(defaultOrder);
  const orderedNames = storedOrder.filter((name) => allowedNames.has(name));
  const orderedNameSet = new Set(orderedNames);

  return [
    ...orderedNames,
    ...defaultOrder.filter((name) => !orderedNameSet.has(name)),
  ];
}

export function writeStorageText(key: string, value: string): boolean {
  const storage = getLocalStorage();

  if (!storage) {
    return false;
  }

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function writeStorageJson(key: string, value: unknown): boolean {
  try {
    return writeStorageText(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

export type PersistedConnection = {
  name: string;
  host: string;
  group: string;
  tags: string[];
  port?: number;
  username?: string;
};

export type PersistedForwardRule = {
  active: false;
  bindHost: string;
  bindPort: number;
  direction: "Local";
  id: string;
  targetHost: string;
  targetPort: number;
};

const MAX_CUSTOM_CONNECTIONS = 100;
const MAX_CONNECTION_NAME_LENGTH = 128;
const MAX_CONNECTION_HOST_LENGTH = 1_024;
const MAX_CONNECTION_GROUP_LENGTH = 128;
const MAX_CONNECTION_USERNAME_LENGTH = 256;
const MAX_CONNECTION_TAGS = 20;
const MAX_CONNECTION_TAG_LENGTH = 64;
// eslint-disable-next-line no-control-regex -- persisted identifiers must reject ASCII control characters
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function normalizePersistedConnection(
  value: unknown,
): PersistedConnection | null {
  if (!isRecord(value)) {
    return null;
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const host = typeof value.host === "string" ? value.host.trim() : "";
  const group = typeof value.group === "string" ? value.group.trim() : "";
  const portOk =
    value.port === undefined ||
    (typeof value.port === "number" &&
      Number.isInteger(value.port) &&
      value.port >= 1 &&
      value.port <= 65535);
  const usernameOk =
    value.username === undefined || typeof value.username === "string";
  if (
    !name ||
    name.length > MAX_CONNECTION_NAME_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(name) ||
    !host ||
    host.length > MAX_CONNECTION_HOST_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(host) ||
    !group ||
    group.length > MAX_CONNECTION_GROUP_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(group) ||
    !isStringArray(value.tags) ||
    !portOk ||
    !usernameOk
  ) {
    return null;
  }

  const tags: string[] = [];
  const seenTags = new Set<string>();
  for (const rawTag of value.tags) {
    const tag = rawTag.trim();
    if (
      !tag ||
      tag.length > MAX_CONNECTION_TAG_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(tag) ||
      seenTags.has(tag)
    ) {
      continue;
    }
    seenTags.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_CONNECTION_TAGS) break;
  }

  const username =
    typeof value.username === "string" ? value.username.trim() : undefined;
  if (
    username !== undefined &&
    (username.length > MAX_CONNECTION_USERNAME_LENGTH ||
      CONTROL_CHARACTER_PATTERN.test(username))
  ) {
    return null;
  }

  return {
    name,
    host,
    group,
    tags,
    ...(value.port === undefined ? {} : { port: value.port as number }),
    ...(!username ? {} : { username }),
  };
}

/// Read user-created connections from storage, dropping any malformed entries
/// and de-duplicating by name (first occurrence wins).
export function readStoredCustomConnections(): PersistedConnection[] {
  const raw = readStorageJson(CUSTOM_CONNECTIONS_STORAGE_KEY);

  if (!Array.isArray(raw)) {
    return [];
  }

  const seen = new Set<string>();
  const result: PersistedConnection[] = [];
  for (const item of raw) {
    const connection = normalizePersistedConnection(item);
    if (!connection || seen.has(connection.name)) continue;
    seen.add(connection.name);
    result.push(connection);
    if (result.length >= MAX_CUSTOM_CONNECTIONS) break;
  }
  return result;
}

export function readStoredForwardRules(): PersistedForwardRule[] {
  const raw = readStorageJson(FORWARD_RULES_STORAGE_KEY);
  if (!Array.isArray(raw)) return [];

  const result: PersistedForwardRule[] = [];
  const ids = new Set<string>();
  for (const item of raw.slice(0, 100)) {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      !item.id.trim() ||
      ids.has(item.id) ||
      item.direction !== "Local" ||
      typeof item.bindHost !== "string" ||
      !isLoopbackBindHost(item.bindHost) ||
      typeof item.bindPort !== "number" ||
      !Number.isInteger(item.bindPort) ||
      item.bindPort < 0 ||
      item.bindPort > 65_535 ||
      typeof item.targetHost !== "string" ||
      !item.targetHost.trim() ||
      typeof item.targetPort !== "number" ||
      !Number.isInteger(item.targetPort) ||
      item.targetPort < 1 ||
      item.targetPort > 65_535
    ) {
      continue;
    }

    const id = item.id.trim();
    ids.add(id);
    result.push({
      active: false,
      bindHost: item.bindHost.trim(),
      bindPort: item.bindPort,
      direction: "Local",
      id,
      targetHost: item.targetHost.trim(),
      targetPort: item.targetPort,
    });
  }
  return result;
}

function isLoopbackBindHost(value: string): boolean {
  const normalized = value.trim().toLocaleLowerCase();
  const withoutBrackets =
    normalized.startsWith("[") && normalized.endsWith("]")
      ? normalized.slice(1, -1)
      : normalized;
  return (
    withoutBrackets === "127.0.0.1" ||
    withoutBrackets === "localhost" ||
    withoutBrackets === "::1"
  );
}
