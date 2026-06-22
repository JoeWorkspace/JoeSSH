import { useCallback, useEffect, useState } from "react";
import {
  CUSTOM_CONNECTIONS_STORAGE_KEY,
  readStoredCustomConnections,
  writeStorageJson,
  type PersistedConnection,
} from "./persistence";

/// Manages user-created connections (CRUD) and persists them to localStorage.
/// `reservedNames` are names that already exist among the built-in connections,
/// so `add` cannot collide with them either. Pure logic (no IPC).
export function useCustomConnections(reservedNames: readonly string[] = []) {
  const [connections, setConnections] = useState<PersistedConnection[]>(() => readStoredCustomConnections());

  useEffect(() => {
    writeStorageJson(CUSTOM_CONNECTIONS_STORAGE_KEY, connections);
  }, [connections]);

  const isNameAvailable = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      if (reservedNames.includes(trimmed)) return false;
      return !connections.some((c) => c.name === trimmed);
    },
    [connections, reservedNames],
  );

  const add = useCallback(
    (connection: PersistedConnection): boolean => {
      const name = connection.name.trim();
      if (!name || reservedNames.includes(name)) return false;
      let added = false;
      setConnections((prev) => {
        if (prev.some((c) => c.name === name)) return prev;
        added = true;
        return [...prev, { ...connection, name }];
      });
      return added;
    },
    [reservedNames],
  );

  const remove = useCallback((name: string) => {
    setConnections((prev) => prev.filter((c) => c.name !== name));
  }, []);

  const update = useCallback((name: string, patch: Partial<Omit<PersistedConnection, "name">>) => {
    setConnections((prev) => prev.map((c) => (c.name === name ? { ...c, ...patch } : c)));
  }, []);

  return { connections, isNameAvailable, add, remove, update };
}
