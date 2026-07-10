import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";

import styles from "./Toast.module.css";

interface Toast {
  id: number;
  message: string;
  tone: "default" | "error";
}

interface ToastContextValue {
  show: (message: string, tone?: Toast["tone"]) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const show = useCallback((message: string, tone: Toast["tone"] = "default") => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className={styles.stack} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={[styles.toast, t.tone === "error" ? styles.error : ""].join(" ")}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
