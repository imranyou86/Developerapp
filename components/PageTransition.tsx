"use client";

import { usePathname } from "next/navigation";

// Server-rendered page content changes when navigating (e.g. switching
// project tabs), but the shared layout it's mounted inside doesn't remount —
// so a plain CSS animation class on that content would only ever play once.
// Keying this wrapper by pathname forces a fresh mount (and a fresh
// animation) on every navigation, without needing to remount the
// surrounding chrome (header, nav, providers) that should stay put.
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="animate-fade-in-up">
      {children}
    </div>
  );
}
