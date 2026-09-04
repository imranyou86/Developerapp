"use client";

import { useEffect, useRef, useState } from "react";

// Keeps a checkbox-selection Set alive across client-side tab navigation
// (which unmounts the page component and would otherwise reset plain
// useState). Backed by sessionStorage — per-tab, cleared when the browser
// tab closes, which is right for a "what I've currently got checked"
// selection rather than permanent data.
//
// Initializes to `defaultSelected` on every render (server and first client
// render match, so no hydration mismatch), then loads any persisted value
// from sessionStorage in an effect right after mount, and persists on every
// change after that.
export function usePersistedSelection(
  key: string,
  defaultSelected: () => Set<string>
): [Set<string>, (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void] {
  const [selected, setSelectedState] = useState<Set<string>>(defaultSelected);
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) setSelectedState(new Set(JSON.parse(raw)));
    } catch {
      // ignore — storage unavailable or corrupt, keep the default selection
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function setSelected(updater: Set<string> | ((prev: Set<string>) => Set<string>)) {
    setSelectedState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      try {
        sessionStorage.setItem(key, JSON.stringify(Array.from(next)));
      } catch {
        // ignore — storage unavailable (private mode, quota, etc.)
      }
      return next;
    });
  }

  return [selected, setSelected];
}
