"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteDeal, saveDeal, saveManualDeal } from "@/app/deals/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import type { RentcastListing } from "@/lib/rentcast";
import type { DealStatus } from "@/lib/types";

interface DealRow {
  id: string;
  address: string;
  city: string | null;
  state: string | null;
  zip_code: string;
  list_price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  status: DealStatus;
  project_id: string | null;
  created_at: string;
}

const STATUS_STYLE: Record<DealStatus, string> = {
  researching: "badge bg-blueprint/10 text-blueprint/60",
  pursuing: "badge-amber",
  converted: "badge-sage",
  passed: "badge bg-red-50 text-red-600",
};

// Pursuing (active potential purchases) leads, since that's what you're
// actually deciding on; passed deals trail as a reference archive.
const DEAL_SECTIONS: { status: DealStatus; label: string }[] = [
  { status: "pursuing", label: "Pursuing" },
  { status: "researching", label: "Researching" },
  { status: "converted", label: "Converted to a construction" },
  { status: "passed", label: "Passed" },
];

function currency(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function DealsClient({ initialDeals }: { initialDeals: DealRow[] }) {
  const { notify } = useToast();
  const router = useRouter();
  const [zip, setZip] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RentcastListing[] | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [deals, setDeals] = useState<DealRow[]>(initialDeals);
  const [deleting, setDeleting] = useState<DealRow | null>(null);

  const [showManual, setShowManual] = useState(false);
  const [manual, setManual] = useState({
    address: "",
    city: "",
    state: "",
    zip_code: "",
    list_price: "",
    beds: "",
    baths: "",
    sqft: "",
    lot_size: "",
    year_built: "",
    listing_url: "",
  });
  const [savingManual, setSavingManual] = useState(false);

  async function handleSaveManual(e: React.FormEvent) {
    e.preventDefault();
    setSavingManual(true);
    try {
      const res = await saveManualDeal({
        address: manual.address,
        city: manual.city,
        state: manual.state,
        zip_code: manual.zip_code,
        list_price: manual.list_price ? Number(manual.list_price) : null,
        beds: manual.beds ? Number(manual.beds) : null,
        baths: manual.baths ? Number(manual.baths) : null,
        sqft: manual.sqft ? Number(manual.sqft) : null,
        lot_size: manual.lot_size ? Number(manual.lot_size) : null,
        year_built: manual.year_built ? Number(manual.year_built) : null,
        listing_url: manual.listing_url.trim() || null,
      });
      if (!res.ok || !res.id) throw new Error(res.error ?? "Could not save address.");
      notify("success", "Saved — taking you to analyze it.");
      router.push(`/deals/${res.id}`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not save address.");
    } finally {
      setSavingManual(false);
    }
  }

  const savedAddresses = new Set(deals.map((d) => d.address.toLowerCase()));

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{5}$/.test(zip)) {
      notify("error", "Enter a valid 5-digit ZIP code.");
      return;
    }
    setSearching(true);
    setResults(null);
    try {
      const res = await fetchWithRetry(`/api/rentcast/search?zip=${zip}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed.");
      setResults(json.listings ?? []);
      if ((json.listings ?? []).length === 0) {
        notify("success", "No active listings found for that ZIP.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  async function handleSave(listing: RentcastListing) {
    const res = await saveDeal(listing);
    if (!res.ok || !res.id) {
      notify("error", res.error ?? "Could not save deal.");
      return;
    }
    setSavedIds((prev) => new Set([...prev, listing.id]));
    setDeals((prev) => [
      {
        id: res.id!,
        address: listing.addressLine1 ?? listing.formattedAddress,
        city: listing.city ?? null,
        state: listing.state ?? null,
        zip_code: listing.zipCode ?? "",
        list_price: listing.price ?? null,
        beds: listing.bedrooms ?? null,
        baths: listing.bathrooms ?? null,
        sqft: listing.squareFootage ?? null,
        year_built: listing.yearBuilt ?? null,
        status: "researching",
        project_id: null,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);
    notify("success", "Saved — see it below to analyze the deal.");
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSearch} className="card flex flex-wrap items-end gap-3 p-6">
        <div className="flex-1">
          <label className="label">ZIP code</label>
          <input
            className="input"
            value={zip}
            onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
            placeholder="90210"
            inputMode="numeric"
          />
        </div>
        <button type="submit" className="btn-amber" disabled={searching}>
          {searching ? "Searching…" : "Search homes for sale"}
        </button>
      </form>

      <div className="card p-6">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setShowManual((v) => !v)}
        >
          <span className="font-medium text-blueprint-dark">Have a specific listing from Zillow (or anywhere else)?</span>
          <span className="text-blueprint/40">{showManual ? "▾" : "▸"}</span>
        </button>
        {showManual && (
          <form onSubmit={handleSaveManual} className="mt-4 space-y-3">
            <p className="text-xs text-blueprint/50">
              Paste in the address and whatever details are on the listing — we&apos;ll pull comps and
              a value estimate for it when you run the analysis.
            </p>
            <div>
              <label className="label">Street address</label>
              <input
                className="input"
                required
                value={manual.address}
                onChange={(e) => setManual((m) => ({ ...m, address: e.target.value }))}
                placeholder="123 Main St"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">City</label>
                <input className="input" value={manual.city} onChange={(e) => setManual((m) => ({ ...m, city: e.target.value }))} />
              </div>
              <div>
                <label className="label">State</label>
                <input
                  className="input"
                  maxLength={2}
                  value={manual.state}
                  onChange={(e) => setManual((m) => ({ ...m, state: e.target.value.toUpperCase() }))}
                  placeholder="CA"
                />
              </div>
              <div>
                <label className="label">ZIP</label>
                <input
                  className="input"
                  required
                  inputMode="numeric"
                  value={manual.zip_code}
                  onChange={(e) => setManual((m) => ({ ...m, zip_code: e.target.value.replace(/\D/g, "").slice(0, 5) }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="label">List price</label>
                <input className="input" type="number" value={manual.list_price} onChange={(e) => setManual((m) => ({ ...m, list_price: e.target.value }))} />
              </div>
              <div>
                <label className="label">Beds</label>
                <input className="input" type="number" value={manual.beds} onChange={(e) => setManual((m) => ({ ...m, beds: e.target.value }))} />
              </div>
              <div>
                <label className="label">Baths</label>
                <input className="input" type="number" value={manual.baths} onChange={(e) => setManual((m) => ({ ...m, baths: e.target.value }))} />
              </div>
              <div>
                <label className="label">Home sqft</label>
                <input className="input" type="number" value={manual.sqft} onChange={(e) => setManual((m) => ({ ...m, sqft: e.target.value }))} />
              </div>
              <div>
                <label className="label">Lot size (sqft)</label>
                <input className="input" type="number" value={manual.lot_size} onChange={(e) => setManual((m) => ({ ...m, lot_size: e.target.value }))} />
              </div>
              <div>
                <label className="label">Year built</label>
                <input className="input" type="number" value={manual.year_built} onChange={(e) => setManual((m) => ({ ...m, year_built: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Listing URL (optional)</label>
              <input
                className="input"
                type="url"
                value={manual.listing_url}
                onChange={(e) => setManual((m) => ({ ...m, listing_url: e.target.value }))}
                placeholder="https://www.zillow.com/homedetails/..."
              />
            </div>
            <button type="submit" className="btn-amber w-full" disabled={savingManual}>
              {savingManual ? "Saving…" : "Save & analyze this address"}
            </button>
          </form>
        )}
      </div>

      {results && (
        <div>
          <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">
            {results.length} home{results.length === 1 ? "" : "s"} for sale
          </h2>
          {results.length === 0 ? (
            <p className="text-sm text-blueprint/50">Nothing found for that ZIP right now.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((listing) => {
                const address = listing.addressLine1 ?? listing.formattedAddress;
                const alreadySaved = savedIds.has(listing.id) || savedAddresses.has(address.toLowerCase());
                return (
                  <div key={listing.id} className="card p-4">
                    <p className="font-medium text-blueprint-dark">{address}</p>
                    <p className="text-xs text-blueprint/50">
                      {listing.city}, {listing.state} {listing.zipCode}
                    </p>
                    <p className="mt-2 text-lg font-semibold text-blueprint-dark">{currency(listing.price ?? null)}</p>
                    <p className="text-xs text-blueprint/60">
                      {listing.bedrooms ?? "—"} bd · {listing.bathrooms ?? "—"} ba ·{" "}
                      {listing.squareFootage ? `${listing.squareFootage.toLocaleString()} sqft` : "sqft n/a"}
                      {listing.yearBuilt && ` · built ${listing.yearBuilt}`}
                    </p>
                    <button
                      className="btn-outline mt-3 w-full text-xs"
                      onClick={() => handleSave(listing)}
                      disabled={alreadySaved}
                    >
                      {alreadySaved ? "Saved" : "Save & analyze"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="space-y-8">
        {deals.length === 0 ? (
          <div className="card p-10 text-center text-sm text-blueprint/60">
            Search a ZIP code above and save a listing to start evaluating it.
          </div>
        ) : (
          DEAL_SECTIONS.map(({ status, label }) => {
            const inSection = deals.filter((d) => d.status === status);
            if (inSection.length === 0) return null;
            return (
              <div key={status}>
                <h2 className="mb-3 text-lg font-semibold text-blueprint-dark">
                  {label} <span className="text-sm font-normal text-blueprint/40">({inSection.length})</span>
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {inSection.map((deal) => (
                    <div key={deal.id} className="card p-4">
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <p className="font-medium text-blueprint-dark">{deal.address}</p>
                        <span className={STATUS_STYLE[deal.status]}>{deal.status}</span>
                      </div>
                      <p className="text-xs text-blueprint/50">
                        {deal.city}, {deal.state} {deal.zip_code}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-blueprint-dark">{currency(deal.list_price)}</p>
                      <p className="text-xs text-blueprint/60">
                        {deal.beds ?? "—"} bd · {deal.baths ?? "—"} ba · {deal.sqft ? `${deal.sqft.toLocaleString()} sqft` : "sqft n/a"}
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Link href={`/deals/${deal.id}`} className="btn-primary flex-1 text-center text-xs">
                          {deal.status === "researching" ? "Analyze" : "View"}
                        </Link>
                        <button className="text-xs text-red-500 hover:underline" onClick={() => setDeleting(deal)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <ConfirmDialog
        open={!!deleting}
        title="Delete saved deal?"
        message={`Remove "${deleting?.address}" and its analysis history? This cannot be undone.`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteDeal(deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete deal.");
          } else {
            setDeals((prev) => prev.filter((d) => d.id !== deleting.id));
            notify("success", "Deal deleted.");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}
