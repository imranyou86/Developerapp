"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

// In-app modal used everywhere in place of window.prompt()/confirm(), which
// are blocked in sandboxed/iframe contexts.
export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-blueprint-dark/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-blueprint/10 px-5 py-4">
          <h2 className="text-base font-semibold text-blueprint-dark">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-blueprint/50 hover:bg-concrete hover:text-blueprint"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-blueprint/10 px-5 py-4">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
