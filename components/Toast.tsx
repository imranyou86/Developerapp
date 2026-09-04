"use client";

import { createContext, useCallback, useContext, useState } from "react";

interface ToastMessage {
  id: number;
  kind: "success" | "error";
  text: string;
}

interface ToastContextValue {
  notify: (kind: "success" | "error", text: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Surfaces real errors instead of failing silently on writes — every mutation
// in the app should route its result through notify().
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const notify = useCallback((kind: "success" | "error", text: string) => {
    const id = Date.now() + Math.random();
    setMessages((prev) => [...prev, { id, kind, text }]);
    setTimeout(() => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col items-end gap-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm shadow-elevated animate-slide-in-right ${
              m.kind === "error" ? "bg-red-600 text-white" : "bg-sage-dark text-white"
            }`}
          >
            <span aria-hidden className="text-base leading-none">
              {m.kind === "error" ? "⚠" : "✓"}
            </span>
            {m.text}
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
