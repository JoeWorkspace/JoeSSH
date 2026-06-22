import { useCallback, useEffect, useReducer } from "react";
import {
  FAVORITES_KEY,
  RECENT_COMMANDS_KEY,
  RECENT_CONNECTIONS_KEY,
  readStoredStringList,
  writeStorageJson,
} from "./persistence";

const MAX_RECENT_CONNECTIONS = 8;
const MAX_RECENT_COMMANDS = 10;

export type RecentsState = {
  recentConnections: string[];
  favorites: string[];
  recentCommands: string[];
};

export type RecentsAction =
  | { type: "RECORD_CONNECTION"; name: string }
  | { type: "TOGGLE_FAVORITE"; name: string }
  | { type: "RECORD_COMMAND"; name: string };

function recentsReducer(state: RecentsState, action: RecentsAction): RecentsState {
  switch (action.type) {
    case "RECORD_CONNECTION": {
      const next = [action.name, ...state.recentConnections.filter((n) => n !== action.name)].slice(
        0,
        MAX_RECENT_CONNECTIONS,
      );
      return { ...state, recentConnections: next };
    }

    case "TOGGLE_FAVORITE": {
      const next = state.favorites.includes(action.name)
        ? state.favorites.filter((n) => n !== action.name)
        : [...state.favorites, action.name];
      return { ...state, favorites: next };
    }

    case "RECORD_COMMAND": {
      const next = [action.name, ...state.recentCommands.filter((n) => n !== action.name)].slice(
        0,
        MAX_RECENT_COMMANDS,
      );
      return { ...state, recentCommands: next };
    }

    default:
      return state;
  }
}

export function useRecentFavorites() {
  const [state, dispatch] = useReducer(recentsReducer, {
    recentConnections: readStoredStringList(RECENT_CONNECTIONS_KEY, { maxItems: MAX_RECENT_CONNECTIONS }),
    favorites: readStoredStringList(FAVORITES_KEY),
    recentCommands: readStoredStringList(RECENT_COMMANDS_KEY, { maxItems: MAX_RECENT_COMMANDS }),
  });

  // Persist recent connections
  useEffect(() => {
    writeStorageJson(RECENT_CONNECTIONS_KEY, state.recentConnections);
  }, [state.recentConnections]);

  // Persist favorites
  useEffect(() => {
    writeStorageJson(FAVORITES_KEY, state.favorites);
  }, [state.favorites]);

  // Persist recent commands
  useEffect(() => {
    writeStorageJson(RECENT_COMMANDS_KEY, state.recentCommands);
  }, [state.recentCommands]);

  const recordConnection = useCallback((name: string) => {
    dispatch({ type: "RECORD_CONNECTION", name });
  }, []);

  const toggleFavorite = useCallback((name: string) => {
    dispatch({ type: "TOGGLE_FAVORITE", name });
  }, []);

  const recordCommand = useCallback((name: string) => {
    dispatch({ type: "RECORD_COMMAND", name });
  }, []);

  return { state, dispatch, recordConnection, toggleFavorite, recordCommand };
}
