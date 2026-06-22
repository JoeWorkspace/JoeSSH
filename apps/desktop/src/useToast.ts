import { useCallback, useEffect, useRef, useState } from "react";

export interface Toast {
  id: number;
  message: string;
  tone: "success" | "warning" | "error";
}

export function useToast(timeout = 4000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const addToast = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, tone }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current = timers.current.filter((t) => t !== timer);
    }, timeout);
    timers.current.push(timer);
  }, [timeout]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return { toasts, addToast };
}
