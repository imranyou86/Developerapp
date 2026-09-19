"use client";

import { useEffect } from "react";

// Scrolls to and briefly highlights the element whose id matches the
// current URL's hash, once on mount — lets a link into a specific record
// (e.g. Calendar linking to one warranty request/group card via
// `#wr-<id>`) land the viewer directly on it instead of just the top of a
// long page. A no-op when there's no hash or no matching element (a plain
// page visit, or a stale/deleted id).
export function useScrollToHash() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber", "ring-offset-2");
    const timeout = setTimeout(() => el.classList.remove("ring-2", "ring-amber", "ring-offset-2"), 2500);
    return () => clearTimeout(timeout);
  }, []);
}
