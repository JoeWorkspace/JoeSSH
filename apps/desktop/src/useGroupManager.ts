import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  CONNECTION_GROUPS_STORAGE_KEY,
  GROUPS_STORAGE_KEY,
  readStoredConnectionGroups,
  readStoredStringList,
  writeStorageJson,
} from "./persistence";

export type GroupState = {
  collapsedGroups: Set<string>;
  customGroups: string[];
  connectionGroups: Record<string, string>;
  managerOpen: boolean;
  newGroupName: string;
  editingGroup: string | null;
  editingGroupName: string;
  moveToGroupMenu: string | null;
};

export type GroupAction =
  | { type: "TOGGLE_COLLAPSE"; group: string }
  | { type: "ADD_CUSTOM_GROUP"; name: string }
  | { type: "REMOVE_CUSTOM_GROUP"; name: string }
  | { type: "RENAME_GROUP"; oldName: string; newName: string }
  | { type: "MOVE_CONNECTION"; connection: string; group: string }
  | { type: "SET_MANAGER_OPEN"; open: boolean }
  | { type: "SET_NEW_GROUP_NAME"; name: string }
  | { type: "START_EDIT_GROUP"; group: string; name?: string }
  | { type: "SET_EDITING_GROUP_NAME"; name: string }
  | { type: "CANCEL_EDIT" }
  | { type: "SET_MOVE_TO_GROUP_MENU"; connection: string | null }
  | { type: "LOAD_CUSTOM_GROUPS"; groups: string[] }
  | { type: "LOAD_CONNECTION_GROUPS"; groups: Record<string, string> };

function groupReducer(state: GroupState, action: GroupAction): GroupState {
  switch (action.type) {
    case "TOGGLE_COLLAPSE": {
      const next = new Set(state.collapsedGroups);
      if (next.has(action.group)) {
        next.delete(action.group);
      } else {
        next.add(action.group);
      }
      return { ...state, collapsedGroups: next };
    }

    case "ADD_CUSTOM_GROUP": {
      const name = action.name.trim();
      if (!name || state.customGroups.includes(name)) {
        return { ...state, newGroupName: "" };
      }
      return {
        ...state,
        customGroups: [...state.customGroups, name],
        newGroupName: "",
      };
    }

    case "REMOVE_CUSTOM_GROUP": {
      const nextConnectionGroups = { ...state.connectionGroups };
      for (const [connectionName, groupName] of Object.entries(
        nextConnectionGroups,
      )) {
        if (groupName === action.name) {
          nextConnectionGroups[connectionName] = "Production";
        }
      }
      return {
        ...state,
        customGroups: state.customGroups.filter((g) => g !== action.name),
        connectionGroups: nextConnectionGroups,
      };
    }

    case "RENAME_GROUP": {
      // Guard against renaming onto an existing custom group (would create
      // duplicate group entries / React keys); the modal also blocks builtin
      // collisions via isGroupValid.
      if (
        action.newName !== action.oldName &&
        state.customGroups.includes(action.newName)
      ) {
        return { ...state, editingGroup: null };
      }
      const nextCustomGroups = state.customGroups.map((g) =>
        g === action.oldName ? action.newName : g,
      );
      const nextConnectionGroups = Object.fromEntries(
        Object.entries(state.connectionGroups).map(
          ([connectionName, groupName]) => [
            connectionName,
            groupName === action.oldName ? action.newName : groupName,
          ],
        ),
      );
      return {
        ...state,
        customGroups: nextCustomGroups,
        connectionGroups: nextConnectionGroups,
        editingGroup: null,
      };
    }

    case "MOVE_CONNECTION":
      return {
        ...state,
        connectionGroups: {
          ...state.connectionGroups,
          [action.connection]: action.group,
        },
        moveToGroupMenu: null,
      };

    case "SET_MANAGER_OPEN":
      return { ...state, managerOpen: action.open };

    case "SET_NEW_GROUP_NAME":
      return { ...state, newGroupName: action.name };

    case "START_EDIT_GROUP":
      return {
        ...state,
        editingGroup: action.group,
        editingGroupName: action.name ?? action.group,
      };

    case "SET_EDITING_GROUP_NAME":
      return { ...state, editingGroupName: action.name };

    case "CANCEL_EDIT":
      return { ...state, editingGroup: null };

    case "SET_MOVE_TO_GROUP_MENU":
      return { ...state, moveToGroupMenu: action.connection };

    case "LOAD_CUSTOM_GROUPS":
      return { ...state, customGroups: action.groups };

    case "LOAD_CONNECTION_GROUPS":
      return { ...state, connectionGroups: action.groups };

    default:
      return state;
  }
}

export function useGroupManager(
  builtinGroupNames: readonly string[],
  connectionNames: readonly string[],
) {
  const [state, dispatch] = useReducer(groupReducer, {
    collapsedGroups: new Set<string>(),
    customGroups: readStoredStringList(GROUPS_STORAGE_KEY),
    connectionGroups: readStoredConnectionGroups({
      allowedGroups: [
        ...builtinGroupNames,
        ...readStoredStringList(GROUPS_STORAGE_KEY),
      ],
      connectionNames,
    }),
    managerOpen: false,
    newGroupName: "",
    editingGroup: null,
    editingGroupName: "",
    moveToGroupMenu: null,
  });

  // Persist custom groups
  useEffect(() => {
    writeStorageJson(GROUPS_STORAGE_KEY, state.customGroups);
  }, [state.customGroups]);

  // Persist connection group overrides
  useEffect(() => {
    const overrides: Record<string, string> = {};
    for (const [connectionName, groupName] of Object.entries(
      state.connectionGroups,
    )) {
      if (
        connectionNames.includes(connectionName) &&
        (builtinGroupNames.includes(groupName) ||
          state.customGroups.includes(groupName))
      ) {
        // Only persist non-default overrides
        overrides[connectionName] = groupName;
      }
    }
    writeStorageJson(CONNECTION_GROUPS_STORAGE_KEY, overrides);
  }, [
    state.connectionGroups,
    builtinGroupNames,
    connectionNames,
    state.customGroups,
  ]);

  const allGroupNames = useMemo(() => {
    return [...builtinGroupNames, ...state.customGroups].sort();
  }, [builtinGroupNames, state.customGroups]);

  const isGroupValid = useCallback(
    (name: string) =>
      name.trim().length > 0 && !allGroupNames.includes(name.trim()),
    [allGroupNames],
  );

  return { state, dispatch, allGroupNames, isGroupValid };
}
