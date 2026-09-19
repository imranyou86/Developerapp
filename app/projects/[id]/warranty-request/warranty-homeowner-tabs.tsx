"use client";

import { useEffect, useState } from "react";

// Splits the 'warranty' role's page into two tabs instead of one long
// stacked page — filing something new is a separate concern from checking
// on what's already been filed, and stacking both meant scrolling past a
// full form just to check status. page.tsx renders CreateWarrantyRequestForm
// and MyWarrantyRequests (both already "use client" components) and hands
// their output in here as plain children/props — a Server Component can
// pass rendered Client Component output into another Client Component this
// way without needing this file to know anything about either one.
export function WarrantyHomeownerTabs({
  createTab,
  trackTab,
}: {
  createTab: React.ReactNode;
  trackTab: React.ReactNode;
}) {
  const [tab, setTab] = useState<"create" | "track">("create");

  // A Calendar warranty-visit link (`#wr-<id>`) always points at a
  // request, which only ever lives in the "Track" tab — switch there so
  // MyWarrantyRequests actually mounts and its own useScrollToHash can find
  // the target. Done in an effect rather than the initial useState because
  // the server always renders "create" first (no access to location.hash
  // during SSR) — reading the hash in useState's initializer would mismatch
  // that on hydration. The brief flash of "create" before this flips it is
  // an acceptable tradeoff for avoiding that.
  useEffect(() => {
    if (window.location.hash.startsWith("#wr-")) setTab("track");
  }, []);

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-blueprint/10">
        <button
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            tab === "create" ? "border-b-2 border-amber text-blueprint-dark" : "text-blueprint/50 hover:text-blueprint-dark"
          }`}
          onClick={() => setTab("create")}
        >
          Create a Request
        </button>
        <button
          className={`px-3 py-2 text-sm font-medium transition-colors ${
            tab === "track" ? "border-b-2 border-amber text-blueprint-dark" : "text-blueprint/50 hover:text-blueprint-dark"
          }`}
          onClick={() => setTab("track")}
        >
          Track Your Requests
        </button>
      </div>
      {tab === "create" ? createTab : trackTab}
    </div>
  );
}
