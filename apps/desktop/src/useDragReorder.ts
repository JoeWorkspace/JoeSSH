import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  CONNECTION_ORDER_STORAGE_KEY,
  readStoredConnectionOrder,
  writeStorageJson,
} from "./persistence";

export type DragState = {
  dragging: string | null;
  dragOver: string | null;
  order: string[];
};

export type DragAction =
  | { type: "START_DRAG"; name: string }
  | { type: "DRAG_OVER"; name: string }
  | { type: "DRAG_LEAVE" }
  | { type: "DRAG_END" }
  | { type: "MOVE_BEFORE"; name: string; targetName: string }
  | { type: "MOVE_AFTER"; name: string; targetName: string }
  | { type: "SYNC_CONNECTIONS"; connectionNames: readonly string[] }
  | { type: "SET_ORDER"; order: string[] };

function reconcileConnectionOrder(
  order: readonly string[],
  connectionNames: readonly string[],
): string[] {
  const allowedNames = new Set(connectionNames);
  const next = order.filter((name) => allowedNames.has(name));
  const presentNames = new Set(next);
  for (const name of connectionNames) {
    if (!presentNames.has(name)) {
      next.push(name);
      presentNames.add(name);
    }
  }
  return next;
}

function moveConnection(order: string[], name: string, targetName: string, placement: "before" | "after") {
  if (name === targetName) return order;
  const fromIdx = order.indexOf(name);
  const targetIdx = order.indexOf(targetName);
  if (fromIdx === -1 || targetIdx === -1) return order;

  const next = [...order];
  next.splice(fromIdx, 1);
  const adjustedTargetIdx = next.indexOf(targetName);
  next.splice(placement === "before" ? adjustedTargetIdx : adjustedTargetIdx + 1, 0, name);
  return next;
}

function dragReducer(state: DragState, action: DragAction): DragState {
  switch (action.type) {
    case "START_DRAG":
      return { ...state, dragging: action.name };

    case "DRAG_OVER":
      return action.name !== state.dragging ? { ...state, dragOver: action.name } : state;

    case "DRAG_LEAVE":
      return { ...state, dragOver: null };

    case "DRAG_END": {
      if (state.dragging && state.dragOver && state.dragging !== state.dragOver) {
        const next = [...state.order];
        const fromIdx = next.indexOf(state.dragging);
        const toIdx = next.indexOf(state.dragOver);
        if (fromIdx !== -1 && toIdx !== -1) {
          next.splice(fromIdx, 1);
          next.splice(toIdx, 0, state.dragging);
          return { dragging: null, dragOver: null, order: next };
        }
      }
      return { ...state, dragging: null, dragOver: null };
    }

    case "MOVE_BEFORE":
      return { ...state, order: moveConnection(state.order, action.name, action.targetName, "before") };

    case "MOVE_AFTER":
      return { ...state, order: moveConnection(state.order, action.name, action.targetName, "after") };

    case "SYNC_CONNECTIONS": {
      const order = reconcileConnectionOrder(
        state.order,
        action.connectionNames,
      );
      if (
        order.length === state.order.length &&
        order.every((name, index) => name === state.order[index])
      ) {
        return state;
      }
      return { ...state, order };
    }

    case "SET_ORDER":
      return { ...state, order: action.order };

    default:
      return state;
  }
}

export function useDragReorder(defaultOrder: readonly string[]) {
  const defaultOrderRef = useRef(defaultOrder);
  defaultOrderRef.current = defaultOrder;
  const defaultOrderKey = JSON.stringify(defaultOrder);
  const [state, dispatch] = useReducer(dragReducer, {
    dragging: null,
    dragOver: null,
    order: readStoredConnectionOrder(defaultOrder),
  });

  // Persist connection order
  useEffect(() => {
    writeStorageJson(CONNECTION_ORDER_STORAGE_KEY, state.order);
  }, [state.order]);

  useEffect(() => {
    dispatch({
      type: "SYNC_CONNECTIONS",
      connectionNames: defaultOrderRef.current,
    });
  }, [defaultOrderKey]);

  const startDrag = useCallback((name: string) => {
    dispatch({ type: "START_DRAG", name });
  }, []);

  const dragOver = useCallback((name: string) => {
    dispatch({ type: "DRAG_OVER", name });
  }, []);

  const dragLeave = useCallback(() => {
    dispatch({ type: "DRAG_LEAVE" });
  }, []);

  const dragEnd = useCallback(() => {
    dispatch({ type: "DRAG_END" });
  }, []);

  const moveBefore = useCallback((name: string, targetName: string) => {
    dispatch({ type: "MOVE_BEFORE", name, targetName });
  }, []);

  const moveAfter = useCallback((name: string, targetName: string) => {
    dispatch({ type: "MOVE_AFTER", name, targetName });
  }, []);

  return { state, dispatch, startDrag, dragOver, dragLeave, dragEnd, moveBefore, moveAfter };
}
