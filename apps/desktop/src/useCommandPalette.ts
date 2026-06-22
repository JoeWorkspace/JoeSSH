import { useCallback, useReducer } from "react";

export type PaletteState = {
  open: boolean;
  input: string;
  index: number;
};

export type PaletteAction =
  | { type: "OPEN"; input?: string }
  | { type: "CLOSE" }
  | { type: "SET_INPUT"; input: string }
  | { type: "SET_INDEX"; index: number }
  | { type: "MOVE_UP" }
  | { type: "MOVE_DOWN"; max: number }
  | { type: "RESET_INDEX" };

function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case "OPEN":
      return { open: true, input: typeof action.input === "string" ? action.input : "", index: 0 };

    case "CLOSE":
      return { ...state, open: false };

    case "SET_INPUT":
      return { ...state, input: action.input, index: 0 };

    case "SET_INDEX":
      return { ...state, index: action.index };

    case "MOVE_UP":
      return { ...state, index: Math.max(0, state.index - 1) };

    case "MOVE_DOWN":
      return { ...state, index: Math.min(state.index + 1, action.max) };

    case "RESET_INDEX":
      return { ...state, index: 0 };

    default:
      return state;
  }
}

export function useCommandPalette() {
  const [state, dispatch] = useReducer(paletteReducer, {
    open: false,
    input: "",
    index: 0,
  });

  const open = useCallback((initialInput: unknown = "") => {
    dispatch({ type: "OPEN", input: typeof initialInput === "string" ? initialInput : "" });
  }, []);

  const close = useCallback(() => {
    dispatch({ type: "CLOSE" });
  }, []);

  const setInput = useCallback((input: string) => {
    dispatch({ type: "SET_INPUT", input });
  }, []);

  const setIndex = useCallback((index: number) => {
    dispatch({ type: "SET_INDEX", index });
  }, []);

  return { state, dispatch, open, close, setInput, setIndex };
}
