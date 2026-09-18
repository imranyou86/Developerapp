"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";

// Shown once, immediately after a real sign-in — never on an ordinary page
// load or refresh. `show` reflects a one-shot `?welcome=1` query flag set by
// the login/magic-link/sign-up redirect paths (see app/login/page.tsx and
// app/auth/confirm/route.ts); the first effect below strips that flag from
// the URL right away so refreshing this same page never re-triggers it.
export function WelcomeOverlay({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(show);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (show) router.replace(pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [visible]);

  if (!visible || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-blueprint-dark/60 p-4 animate-fade-in"
      onClick={() => setVisible(false)}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-elevated animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <BrandMark size="lg" className="mx-auto mb-4" />
        <h2 className="animate-fade-in-up text-xl font-semibold text-blueprint-dark" style={{ animationDelay: "100ms" }}>
          Welcome to Alaia Homes
        </h2>
        <p className="mt-2 animate-fade-in-up text-sm text-blueprint/60" style={{ animationDelay: "200ms" }}>
          Plans, budgets, checklists, payments, and your whole team — everything you need to manage a construction,
          all in one easy place.
        </p>
        <button
          className="btn-amber mt-5 w-full animate-fade-in-up"
          style={{ animationDelay: "300ms" }}
          onClick={() => setVisible(false)}
        >
          Let&apos;s get started
        </button>
      </div>
    </div>,
    document.body
  );
}
