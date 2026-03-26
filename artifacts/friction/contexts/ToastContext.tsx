import React, { createContext, useContext, useState, useCallback, useRef } from "react";

export type ToastType = "success" | "error" | "info";

interface ToastAction {
  label: string;
  onPress: () => void;
}

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
  position: "top" | "bottom";
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (opts: {
    message: string;
    type?: ToastType;
    duration?: number;
    position?: "top" | "bottom";
    action?: ToastAction;
  }) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const removeToast = useCallback((id: number) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    ({
      message,
      type = "info",
      duration = 3000,
      position = "bottom",
      action,
    }: {
      message: string;
      type?: ToastType;
      duration?: number;
      position?: "top" | "bottom";
      action?: ToastAction;
    }) => {
      const id = nextId++;
      const item: ToastItem = { id, message, type, duration, position, action };
      setToasts((prev) => [...prev, item]);
      timersRef.current[id] = setTimeout(() => {
        removeToast(id);
      }, duration);
    },
    [removeToast],
  );

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
