import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOM_CONNECTIONS_STORAGE_KEY,
  normalizePersistedConnection,
  readStoredCustomConnections,
  writeStorageJson,
  type PersistedConnection,
} from "./persistence";

/// Manages user-created connections (CRUD) and persists them to localStorage.
/// `reservedNames` are names that already exist among the built-in connections,
/// so `add` cannot collide with them either. Pure logic (no IPC).
export function useCustomConnections(reservedNames: readonly string[] = []) {
  const reservedNamesKey = reservedNames
    .map((name) => name.trim())
    .filter(Boolean)
    .join("\u0000");
  const reservedNameSet = useMemo(
    () =>
      new Set(
        reservedNamesKey ? reservedNamesKey.split("\u0000") : [],
      ),
    [reservedNamesKey],
  );
  const [connections, setConnections] = useState<PersistedConnection[]>(() =>
    readStoredCustomConnections().filter(
      (connection) => !reservedNameSet.has(connection.name),
    ),
  );
  const connectionsRef = useRef(connections);
  connectionsRef.current = connections;

  useEffect(() => {
    writeStorageJson(CUSTOM_CONNECTIONS_STORAGE_KEY, connections);
  }, [connections]);

  useEffect(() => {
    const filtered = connectionsRef.current.filter(
      (connection) => !reservedNameSet.has(connection.name),
    );
    if (filtered.length === connectionsRef.current.length) return;
    connectionsRef.current = filtered;
    setConnections(filtered);
  }, [reservedNameSet]);

  const isNameAvailable = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      if (reservedNameSet.has(trimmed)) return false;
      return !connections.some((c) => c.name === trimmed);
    },
    [connections, reservedNameSet],
  );

  const add = useCallback(
    (connection: PersistedConnection): boolean => {
      const normalized = normalizePersistedConnection(connection);
      if (
        !normalized ||
        reservedNameSet.has(normalized.name) ||
        connectionsRef.current.length >= 100 ||
        connectionsRef.current.some((item) => item.name === normalized.name)
      ) {
        return false;
      }
      const next = [...connectionsRef.current, normalized];
      connectionsRef.current = next;
      setConnections(next);
      return true;
    },
    [reservedNameSet],
  );

  const remove = useCallback((name: string) => {
    const next = connectionsRef.current.filter((c) => c.name !== name);
    connectionsRef.current = next;
    setConnections(next);
  }, []);

  const update = useCallback((name: string, patch: Partial<Omit<PersistedConnection, "name">>) => {
    const next = connectionsRef.current.map((connection) => {
      if (connection.name !== name) return connection;
      return normalizePersistedConnection({ ...connection, ...patch }) ?? connection;
    });
    connectionsRef.current = next;
    setConnections(next);
  }, []);

  return { connections, isNameAvailable, add, remove, update };
}
