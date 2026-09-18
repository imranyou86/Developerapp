"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import type { SearchResult } from "@/app/api/search/route";

const GROUP_LABELS: Record<SearchResult["type"], string> = {
  project: "Constructions",
  checklist_item: "Checklist",
  warranty_item: "Warranty items",
  room: "Rooms",
  task: "Tasks",
  bid: "Bids",
  payment_item: "Payments",
  subcontractor: "Subcontractors",
  deal: "Buyers Guide",
};

const GROUP_ORDER: SearchResult["type"][] = [
  "project",
  "checklist_item",
  "warranty_item",
  "room",
  "task",
  "bid",
  "payment_item",
  "subcontractor",
  "deal",
];

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against an older, slower request's response landing after a
  // newer one — only the response matching the request the user is
  // currently waiting on gets applied.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults(null);
      setError(null);
      setSearching(false);
      return;
    }

    setSearching(true);
    const thisRequestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithRetry(`/api/search?q=${encodeURIComponent(trimmed)}`);
        const json = await res.json();
        if (requestIdRef.current !== thisRequestId) return;
        if (!res.ok) throw new Error(json.error ?? "Search failed.");
        setResults(json.results);
        setError(null);
      } catch (err) {
        if (requestIdRef.current !== thisRequestId) return;
        setError(err instanceof Error ? err.message : "Search failed.");
        setResults(null);
      } finally {
        if (requestIdRef.current === thisRequestId) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const grouped = GROUP_ORDER.map((type) => ({
    type,
    items: (results ?? []).filter((r) => r.type === type),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-4">
      <input
        className="input"
        autoFocus
        placeholder="Search constructions, checklist items, rooms, tasks, bids, payments, subcontractors, deals…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {query.trim().length >= MIN_QUERY_LENGTH && !error && (
        <>
          {searching && !results ? (
            <p className="text-sm text-blueprint/50">Searching…</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-blueprint/50">No matches for &quot;{query.trim()}&quot;.</p>
          ) : (
            <div className="space-y-5">
              {grouped.map((group) => (
                <div key={group.type}>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-blueprint/50">
                    {GROUP_LABELS[group.type]}
                  </p>
                  <div className="card divide-y divide-blueprint/10">
                    {group.items.map((item) => (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="block px-4 py-2.5 transition-colors hover:bg-concrete"
                      >
                        <p className="text-sm text-blueprint-dark">{item.title}</p>
                        {item.subtitle && <p className="text-xs text-blueprint/50">{item.subtitle}</p>}
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
