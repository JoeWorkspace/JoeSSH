import {
  formatConnectionTarget,
  splitConnectionTarget,
  type ConnectionTarget,
} from "./connectTarget";

export type ConnectionPresence = {
  color: "good" | "neutral";
  status: "online" | "sample";
};

export type ConnectionTargetSource = {
  host: string;
  port?: number;
  username?: string;
};

export type WorkspaceConnectionIdentity = ConnectionTargetSource & {
  name: string;
};

export type SidebarSearchableConnection = WorkspaceConnectionIdentity & {
  group: string;
  tags: readonly string[];
};

export type QuickConnectionProfile = WorkspaceConnectionIdentity & {
  color: "neutral";
  group: string;
  status: "sample";
  tags: readonly ["ssh"];
};

export function getConnectionTarget(
  connection: ConnectionTargetSource,
): ConnectionTarget {
  const parsedTarget = splitConnectionTarget(connection.host);
  return {
    host: parsedTarget.host,
    port: connection.port ?? parsedTarget.port,
    username: connection.username ?? parsedTarget.username,
  };
}

export function findConnectionNameByTarget(
  connections: readonly WorkspaceConnectionIdentity[],
  target: ConnectionTarget,
): string | undefined {
  const formattedTarget = formatConnectionTarget(target);
  return connections.find(
    (connection) =>
      formatConnectionTarget(getConnectionTarget(connection)) ===
      formattedTarget,
  )?.name;
}

export function createQuickConnectionProfile(
  target: ConnectionTarget,
  existingNames: readonly string[],
  group: string,
): QuickConnectionProfile {
  const baseName = formatConnectionTarget(target);
  let name = baseName;
  let suffix = 2;
  while (existingNames.includes(name)) {
    name = `${baseName} (${suffix})`;
    suffix += 1;
  }
  return {
    color: "neutral",
    group,
    host: target.host,
    name,
    port: target.port,
    status: "sample",
    tags: ["ssh"],
    username: target.username,
  };
}

export function getConnectionPresence(
  sessionId: string | undefined,
): ConnectionPresence {
  return sessionId
    ? { color: "good", status: "online" }
    : { color: "neutral", status: "sample" };
}

export function matchesSidebarSearch(
  connection: SidebarSearchableConnection,
  query: string,
  localizedGroupLabel = connection.group,
): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [
    connection.name,
    connection.host,
    connection.username ?? "",
    connection.group,
    localizedGroupLabel,
    ...connection.tags,
  ].some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function addTerminalTab(
  tabs: readonly string[],
  connectionName: string,
): string[] {
  return tabs.includes(connectionName) ? [...tabs] : [...tabs, connectionName];
}

export function removeTerminalTab(
  tabs: readonly string[],
  connectionName: string,
): string[] {
  return tabs.filter((tab) => tab !== connectionName);
}

export function getTerminalTabIndex(
  tabs: readonly string[],
  activeConnectionName: string,
): number {
  const index = tabs.indexOf(activeConnectionName);
  return index >= 0 ? index : 0;
}
