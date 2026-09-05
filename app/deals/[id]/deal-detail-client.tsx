"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { convertDealToProject, updateDealListingDetails, updateDealStatus, updateDealZoning } from "@/app/deals/actions";
import { saveDealAnalysis } from "@/app/deals/[id]/actions";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { LA_ZONES } from "@/lib/laZoning";
import type { Deal, DealAnalysis, DealScope, DealStatus, DealVerdict } from "@/lib/types";

const STATUS_STYLE: Record<DealStatus, string> = {
  researching: "badge bg-blueprint/10 text-blueprint/60",
  pursuing: "badge-amber",
  converted: "badge-sage",
  passed: "badge bg-red-50 text-red-600",
};

const VERDICT_COPY: Record<DealVerdict, { label: string; className: string }> = {
  good_deal: { label: "Good Deal", className: "bg-sage/15 text-sage-dark border-sage/30" },
  marginal: { label: "Marginal", className: "bg-amber/15 text-amber-dark border-amber/30" },
  pass: { label: "Pass", className: "bg-red-50 text-red-600 border-red-200" },
};

function currency(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function DealDetailClient({ deal, initialAnalyses }: { deal: Deal; initialAnalyses: DealAnalysis[] }) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const lookupTaskKey = `deal-lookup:${deal.id}`;
  const evaluateTaskKey = `deal-evaluate:${deal.id}`;
  const [status, setStatus] = useState<DealStatus>(deal.status);
  const [projectId, setProjectId] = useState<string | null>(deal.project_id);
  const [analyses, setAnalyses] = useState<DealAnalysis[]>(initialAnalyses);
  const [converting, setConverting] = useState(false);
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);

  // Mirrors deal.list_price/beds/baths/sqft/year_built locally so "Refresh from
  // listing" can update the summary card immediately without a full page reload.
  const [listingDetails, setListingDetails] = useState({
    list_price: deal.list_price,
    beds: deal.beds,
    baths: deal.baths,
    sqft: deal.sqft,
    year_built: deal.year_built,
  });
  const [refreshingListing, setRefreshingListing] = useState(false);
  const refreshListingTaskKey = `deal-refresh-listing:${deal.id}`;

  async function handleRefreshListing() {
    if (!deal.listing_url) return;
    setRefreshingListing(true);
    try {
      await run(refreshListingTaskKey, `Refreshing listing details for ${deal.address}…`, async () => {
        const res = await fetchWithRetry("/api/claude/lookup-listing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingUrl: deal.listing_url }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Lookup failed.");

        const next = {
          list_price: json.list_price ?? listingDetails.list_price,
          beds: json.beds ?? listingDetails.beds,
          baths: json.baths ?? listingDetails.baths,
          sqft: json.sqft ?? listingDetails.sqft,
          year_built: json.year_built ?? listingDetails.year_built,
        };
        const saveRes = await updateDealListingDetails(deal.id, { ...next, lot_size: lotSize === "" ? null : Number(lotSize) });
        if (!saveRes.ok) throw new Error(saveRes.error ?? "Could not save refreshed details.");

        setListingDetails(next);
        notify(
          "success",
          `Refreshed (${json.confidence} confidence${json.source ? ` via ${json.source}` : ""}) — double-check the price against the actual listing before relying on it.`
        );
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setRefreshingListing(false);
    }
  }

  const [scope, setScope] = useState<DealScope>("remodel");
  const [scopeDescription, setScopeDescription] = useState(
    "Full interior remodel: kitchen, baths, flooring, paint, updated systems."
  );
  // Remodel and ground-up are different projects with different costs — each
  // scope keeps its own manually-entered $/sqft and budget, so switching
  // between them (e.g. to compare) doesn't clobber whichever number you
  // already typed in for the other one.
  const [costPerSqftByScope, setCostPerSqftByScope] = useState<Record<DealScope, number>>({
    remodel: 400,
    ground_up: 400,
  });
  const costPerSqft = costPerSqftByScope[scope];
  // Ground-up rebuilds aren't bounded by the existing structure's footprint —
  // what you can actually build depends on the lot's zoning (FAR, setbacks,
  // lot coverage, height limits), which varies by jurisdiction. Remodels use
  // the existing home's sqft; ground-up uses this separate, editable target.
  const [buildableSqft, setBuildableSqft] = useState(() => deal.sqft ?? 2000);
  const sqftBasis = scope === "ground_up" ? buildableSqft : (listingDetails.sqft ?? buildableSqft);
  const [budgetByScope, setBudgetByScope] = useState<Record<DealScope, number>>({
    remodel: Math.round((deal.sqft ?? 2000) * 400),
    ground_up: Math.round((deal.sqft ?? 2000) * 400),
  });
  const budget = budgetByScope[scope];
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");

  // Zoning — City of Los Angeles-specific (ZIMAS, zimas.lacity.org). No
  // public API, so entered manually once per deal and remembered from then
  // on. Used as a starting-point calculator for buildable sqft, not an
  // authoritative figure — LA single-family zones use a sliding-scale
  // formula, not a flat lot-coverage %.
  const [lotSize, setLotSize] = useState(deal.lot_size ?? "");
  const [zone, setZone] = useState(deal.zone ?? "");
  const [zoneIsOther, setZoneIsOther] = useState(() => !!deal.zone && !LA_ZONES.some((z) => z.code === deal.zone));
  const [lotCoveragePct, setLotCoveragePct] = useState(deal.lot_coverage_pct ?? "");
  const [savingZoning, setSavingZoning] = useState(false);
  const [lookingUpDetails, setLookingUpDetails] = useState(false);
  const [lookingUpCoverage, setLookingUpCoverage] = useState(false);
  const coverageLookupTaskKey = `deal-zoning-coverage:${deal.id}`;

  async function handleLookupLotSize() {
    setLookingUpDetails(true);
    try {
      await run(lookupTaskKey, `Looking up lot size for ${deal.address}…`, async () => {
        const res = await fetchWithRetry("/api/claude/lookup-property-details", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: deal.address, city: deal.city, state: deal.state, zipCode: deal.zip_code }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Lookup failed.");
        if (json.lot_size == null) {
          notify("error", "Couldn't find a lot size for this address from public sources.");
          return;
        }
        setLotSize(json.lot_size);
        notify(
          "success",
          `Lot size: ${json.lot_size.toLocaleString()} sqft (${json.confidence} confidence, via ${json.source ?? "web search"}). Review and save.`
        );
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLookingUpDetails(false);
    }
  }

  async function handleSaveZoning() {
    setSavingZoning(true);
    const res = await updateDealZoning(deal.id, {
      lot_size: lotSize === "" ? null : Number(lotSize),
      zone: zone.trim() || null,
      lot_coverage_pct: lotCoveragePct === "" ? null : Number(lotCoveragePct),
    });
    setSavingZoning(false);
    if (!res.ok) {
      notify("error", res.error ?? "Could not save zoning info.");
    } else {
      notify("success", "Zoning info saved.");
    }
  }

  function handleCalculateFromCoverage() {
    const size = Number(lotSize);
    const pct = Number(lotCoveragePct);
    if (!size || !pct) {
      notify("error", "Enter both lot size and max lot coverage % first.");
      return;
    }
    handleBuildableSqftChange(Math.round(size * (pct / 100)));
  }

  function handleCostPerSqftChange(value: number) {
    setCostPerSqftByScope((prev) => ({ ...prev, [scope]: value }));
    setBudgetByScope((prev) => ({ ...prev, [scope]: Math.round(sqftBasis * value) }));
  }

  function handleBudgetChange(value: number) {
    setBudgetByScope((prev) => ({ ...prev, [scope]: value }));
  }

  function handleBuildableSqftChange(value: number) {
    setBuildableSqft(value);
    if (scope === "ground_up") {
      setBudgetByScope((prev) => ({ ...prev, ground_up: Math.round(value * costPerSqftByScope.ground_up) }));
    }
  }

  function handleScopeChange(next: DealScope) {
    setScope(next);
  }

  async function handleLookupCoverage() {
    if (!zone.trim()) {
      notify("error", "Select a zone first.");
      return;
    }
    // Sliding-scale (RFA/BMO) zones can't be looked up correctly without a
    // lot size — the route will say so via lot_size_dependent, but catching
    // it here avoids burning a web-search round-trip on a doomed request
    // when we already know the lot size box is empty.
    if (!lotSize) {
      notify("error", "Enter the lot size above first — some zones' buildable % depends on it.");
      return;
    }
    setLookingUpCoverage(true);
    try {
      await run(coverageLookupTaskKey, `Looking up max lot coverage for ${zone}…`, async () => {
        const res = await fetchWithRetry("/api/claude/lookup-zoning-coverage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ zone: zone.trim(), address: deal.address, city: deal.city, state: deal.state, lot_size: Number(lotSize) }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Lookup failed.");
        if (json.buildable_pct == null) {
          notify("error", json.notes || "Couldn't find a buildable percentage for this zone from public sources.");
          return;
        }
        setLotCoveragePct(json.buildable_pct);
        notify(
          "success",
          `${json.buildable_pct}% (${json.confidence} confidence)${json.lot_size_dependent ? ` for a ${Number(lotSize).toLocaleString()} sqft lot` : ""}. ${json.notes}`
        );
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setLookingUpCoverage(false);
    }
  }

  async function handleStatusChange(next: DealStatus) {
    setStatus(next);
    const res = await updateDealStatus(deal.id, next);
    if (!res.ok) {
      notify("error", res.error ?? "Could not update status.");
      setStatus(deal.status);
    }
  }

  async function handleConvert() {
    setConverting(true);
    try {
      const res = await convertDealToProject(deal.id, deal.address);
      if (!res.ok || !res.id) throw new Error(res.error ?? "Could not create construction.");
      setProjectId(res.id);
      setStatus("converted");
      notify("success", "Construction created — add rooms, budget, and everything else there.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Could not create construction.");
    } finally {
      setConverting(false);
      setShowConvertConfirm(false);
    }
  }

  async function handleAnalyze() {
    if (!budget || budget <= 0) {
      notify("error", "Enter a construction budget greater than zero.");
      return;
    }
    setAnalyzing(true);
    setAnalyzeStatus("Pulling comps and researching value…");
    try {
      await run(evaluateTaskKey, `Evaluating ${deal.address}…`, async () => {
        const res = await fetchWithRetry("/api/claude/evaluate-deal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: deal.address,
            city: deal.city,
            state: deal.state,
            zipCode: deal.zip_code,
            listPrice: listingDetails.list_price,
            sqft: listingDetails.sqft,
            targetSqft: sqftBasis,
            beds: listingDetails.beds,
            baths: listingDetails.baths,
            yearBuilt: listingDetails.year_built,
            scope,
            scopeDescription,
            costPerSqft,
            constructionBudget: budget,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Analysis failed.");

        const saveRes = await saveDealAnalysis(deal.id, {
          scope,
          scope_description: scopeDescription,
          target_sqft: sqftBasis,
          cost_per_sqft: costPerSqft,
          construction_budget: budget,
          current_value_estimate: json.current_value_estimate,
          arv_estimate: json.arv_estimate,
          arv_low: json.arv_low,
          arv_high: json.arv_high,
          total_cost: json.total_cost,
          estimated_profit: json.estimated_profit,
          profit_margin_pct: json.profit_margin_pct,
          verdict: json.verdict,
          reasoning: json.reasoning,
          comps: json.comps,
        });
        if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save analysis.");

        setAnalyses((prev) => [
          {
            id: saveRes.id!,
            deal_id: deal.id,
            scope,
            scope_description: scopeDescription,
            target_sqft: sqftBasis,
            cost_per_sqft: costPerSqft,
            construction_budget: budget,
            current_value_estimate: json.current_value_estimate,
            arv_estimate: json.arv_estimate,
            arv_low: json.arv_low,
            arv_high: json.arv_high,
            total_cost: json.total_cost,
            estimated_profit: json.estimated_profit,
            profit_margin_pct: json.profit_margin_pct,
            verdict: json.verdict,
            reasoning: json.reasoning,
            comps: json.comps,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        notify("success", "Analysis complete.");
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Analysis failed.");
    } finally {
      setAnalyzing(false);
      setAnalyzeStatus("");
    }
  }

  return (
    <div className="min-h-screen bg-concrete">
      <header className="border-b border-blueprint/10 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Link href="/deals" className="text-xs text-blueprint/50 hover:text-amber">
            ← Buyers Guide
          </Link>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-blueprint-dark">{deal.address}</h1>
              <p className="text-sm text-blueprint/50">
                {deal.city}, {deal.state} {deal.zip_code}
              </p>
            </div>
            <span className={STATUS_STYLE[status]}>{status}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-8">
        <div className="card p-5">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">List price</p>
              <p className="text-lg font-semibold text-blueprint-dark">{currency(listingDetails.list_price)}</p>
              {deal.listing_url && (
                <button
                  type="button"
                  className="text-xs text-amber-dark hover:underline"
                  onClick={handleRefreshListing}
                  disabled={refreshingListing || isRunning(refreshListingTaskKey)}
                >
                  {refreshingListing || isRunning(refreshListingTaskKey) ? "Refreshing…" : "Refresh from listing ↗"}
                </button>
              )}
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Home size</p>
              <p className="text-lg font-semibold text-blueprint-dark">{listingDetails.sqft ? `${listingDetails.sqft.toLocaleString()} sqft` : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Lot size</p>
              <p className="text-lg font-semibold text-blueprint-dark">
                {lotSize ? `${Number(lotSize).toLocaleString()} sqft` : "—"}
                {lotSize !== "" && Number(lotSize) !== (deal.lot_size ?? null) && (
                  <span className="ml-1 text-xs font-normal text-amber-dark">(unsaved)</span>
                )}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="text-xs text-amber-dark hover:underline"
                  onClick={handleLookupLotSize}
                  disabled={lookingUpDetails || isRunning(lookupTaskKey)}
                >
                  {lookingUpDetails || isRunning(lookupTaskKey) ? "Looking up…" : "Look up from web ↗"}
                </button>
                {lotSize !== "" && Number(lotSize) !== (deal.lot_size ?? null) && (
                  <button type="button" className="text-xs text-sage-dark hover:underline" onClick={handleSaveZoning} disabled={savingZoning}>
                    {savingZoning ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Beds / Baths</p>
              <p className="text-lg font-semibold text-blueprint-dark">
                {listingDetails.beds ?? "—"} / {listingDetails.baths ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Year built</p>
              <p className="text-lg font-semibold text-blueprint-dark">{listingDetails.year_built ?? "—"}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 border-t border-blueprint/10 pt-4">
            {deal.listing_url && (
              <a href={deal.listing_url} target="_blank" rel="noreferrer" className="btn-outline text-xs">
                View listing ↗
              </a>
            )}
            {(["researching", "pursuing", "passed"] as DealStatus[]).map((s) => (
              <button
                key={s}
                className={status === s ? "btn-primary text-xs" : "btn-ghost text-xs"}
                onClick={() => handleStatusChange(s)}
                disabled={status === "converted"}
              >
                Mark {s}
              </button>
            ))}
            {status === "converted" && projectId ? (
              <Link href={`/projects/${projectId}`} className="btn-primary ml-auto text-xs">
                Open construction →
              </Link>
            ) : (
              <button className="btn-amber ml-auto text-xs" onClick={() => setShowConvertConfirm(true)}>
                Build this
              </button>
            )}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 font-semibold text-blueprint-dark">Evaluate this deal</h2>
          <div className="space-y-3">
            <div>
              <label className="label">Scope</label>
              <div className="flex gap-2">
                <button
                  className={scope === "remodel" ? "btn-primary flex-1 text-xs" : "btn-outline flex-1 text-xs"}
                  onClick={() => handleScopeChange("remodel")}
                >
                  Remodel
                </button>
                <button
                  className={scope === "ground_up" ? "btn-primary flex-1 text-xs" : "btn-outline flex-1 text-xs"}
                  onClick={() => handleScopeChange("ground_up")}
                >
                  Ground-up rebuild
                </button>
              </div>
            </div>

            <div>
              <label className="label">Scope description</label>
              <textarea className="input" rows={2} value={scopeDescription} onChange={(e) => setScopeDescription(e.target.value)} />
            </div>

            {scope === "ground_up" && (
              <div className="space-y-3 rounded-lg border border-blueprint/10 p-3">
                <div>
                  <label className="label">Target buildable sqft</label>
                  <input
                    className="input"
                    type="number"
                    value={buildableSqft}
                    onChange={(e) => handleBuildableSqftChange(Number(e.target.value) || 0)}
                    onFocus={(e) => e.target.select()}
                  />
                  <p className="mt-1 text-xs text-blueprint/50">
                    A rebuild isn&apos;t limited to the existing home&apos;s {listingDetails.sqft ? `${listingDetails.sqft.toLocaleString()} sqft` : "footprint"} — what
                    you can actually build depends on the lot&apos;s zoning. Type it directly if{" "}
                    <a href="https://zimas.lacity.org/" target="_blank" rel="noreferrer" className="text-amber-dark hover:underline">
                      ZIMAS
                    </a>{" "}
                    already reports a max buildable/floor-area figure for this parcel, or calculate it below.
                  </p>
                </div>

                <div>
                  <p className="label mb-2">Or calculate from lot size × max lot coverage %</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-blueprint/50">Lot size (sqft)</label>
                      <input
                        className="input"
                        type="number"
                        value={lotSize}
                        onChange={(e) => setLotSize(e.target.value === "" ? "" : Number(e.target.value))}
                        onFocus={(e) => e.target.select()}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-blueprint/50">Zone</label>
                      {zoneIsOther ? (
                        <div className="flex gap-1">
                          <input
                            className="input"
                            value={zone}
                            onChange={(e) => setZone(e.target.value)}
                            placeholder="e.g. RA4-1"
                          />
                          <button
                            type="button"
                            className="btn-ghost shrink-0 px-2 text-xs"
                            onClick={() => {
                              setZoneIsOther(false);
                              setZone("");
                            }}
                            title="Back to zone list"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <select
                          className="input"
                          value={zone}
                          onChange={(e) => {
                            if (e.target.value === "__other__") {
                              setZoneIsOther(true);
                              setZone("");
                            } else {
                              setZone(e.target.value);
                            }
                          }}
                        >
                          <option value="">Select zone…</option>
                          {LA_ZONES.map((z) => (
                            <option key={z.code} value={z.code}>
                              {z.label}
                            </option>
                          ))}
                          <option value="__other__">Other / not listed…</option>
                        </select>
                      )}
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-blueprint/50">Max lot coverage %</label>
                      <input
                        className="input"
                        type="number"
                        value={lotCoveragePct}
                        onChange={(e) => setLotCoveragePct(e.target.value === "" ? "" : Number(e.target.value))}
                        onFocus={(e) => e.target.select()}
                      />
                      <button
                        type="button"
                        className="mt-1 text-[11px] text-amber-dark hover:underline"
                        onClick={handleLookupCoverage}
                        disabled={lookingUpCoverage || isRunning(coverageLookupTaskKey) || !zone.trim() || !lotSize}
                        title={!lotSize ? "Enter lot size first — needed to look up the correct % for lot-size-dependent zones" : undefined}
                      >
                        {lookingUpCoverage || isRunning(coverageLookupTaskKey) ? "Looking up…" : "Look up % ↗"}
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-blueprint/50">
                    &quot;Look up %&quot; grounds a figure in a web search for this zone and lot size. LA single-family
                    zones (R1 and variants, RS, RE9-RE40, RW1, RZ) use a sliding-scale Residential Floor Area formula
                    keyed to lot size rather than a flat % — the lookup finds that zone&apos;s current sliding-scale
                    table and computes the percentage for the lot size entered above (assuming a standard, non-hillside
                    lot), rather than handing back one generic number for the whole zone. A figure directly reported on{" "}
                    <a href="https://zimas.lacity.org/" target="_blank" rel="noreferrer" className="text-amber-dark hover:underline">
                      ZIMAS
                    </a>{" "}
                    for this specific parcel is still more accurate than either — this is a grounded estimate, not an
                    authoritative figure.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn-outline flex-1 text-xs" onClick={handleCalculateFromCoverage}>
                      Use lot size × coverage %
                    </button>
                    <button type="button" className="btn-ghost text-xs" onClick={handleSaveZoning} disabled={savingZoning}>
                      {savingZoning ? "Saving…" : "Save zoning info to this deal"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cost per sqft (typical $300–500)</label>
                <input
                  className="input"
                  type="number"
                  value={costPerSqft}
                  onChange={(e) => handleCostPerSqftChange(Number(e.target.value) || 0)}
                  onFocus={(e) => e.target.select()}
                />
              </div>
              <div>
                <label className="label">Construction budget</label>
                <input
                  className="input"
                  type="number"
                  value={budget}
                  onChange={(e) => handleBudgetChange(Number(e.target.value) || 0)}
                  onFocus={(e) => e.target.select()}
                />
              </div>
            </div>
            <p className="text-xs text-blueprint/50">
              Remodel and ground-up each keep their own $/sqft and budget — switching scope above
              won&apos;t overwrite whichever number you&apos;ve entered for the other one.
            </p>
            {!listingDetails.sqft && scope === "remodel" && (
              <p className="text-xs text-amber-dark">
                This listing has no square footage on file — enter the construction budget directly.
              </p>
            )}

            <button className="btn-amber w-full" onClick={handleAnalyze} disabled={analyzing || isRunning(evaluateTaskKey)}>
              {analyzing || isRunning(evaluateTaskKey) ? analyzeStatus || "Analyzing…" : "Run analysis"}
            </button>
          </div>
        </div>

        {analyses.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-blueprint-dark">
              {analyses.length > 1 ? "Analysis history (most recent first)" : "Analysis"}
            </h2>
            {analyses.map((a) => (
              <AnalysisCard key={a.id} analysis={a} listPrice={listingDetails.list_price} />
            ))}
          </div>
        )}
      </main>

      <ConfirmDialog
        open={showConvertConfirm}
        title="Build this?"
        message="This creates a new construction with this address, ready for you to add rooms, budget, checklist, and everything else. The deal record stays linked to it."
        confirmLabel="Build this"
        busy={converting}
        onCancel={() => setShowConvertConfirm(false)}
        onConfirm={handleConvert}
      />
    </div>
  );
}

function AnalysisCard({ analysis, listPrice }: { analysis: DealAnalysis; listPrice: number | null }) {
  const verdict = VERDICT_COPY[analysis.verdict];
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className={`rounded-lg border px-4 py-2 text-center ${verdict.className}`}>
          <p className="text-lg font-bold">{verdict.label}</p>
          <p className="text-xs">{analysis.profit_margin_pct?.toFixed(1)}% margin</p>
        </div>
        <span className="badge-amber">{analysis.scope === "ground_up" ? "Ground-up rebuild" : "Remodel"}</span>
        <span className="text-xs text-blueprint/40">{new Date(analysis.created_at).toLocaleString()}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">List price</p>
          <p className="font-semibold text-blueprint-dark">{currency(listPrice)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Construction</p>
          <p className="font-semibold text-blueprint-dark">{currency(analysis.construction_budget)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Total cost</p>
          <p className="font-semibold text-blueprint-dark">{currency(analysis.total_cost)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Est. ARV</p>
          <p className="font-semibold text-blueprint-dark">
            {currency(analysis.arv_estimate)}
            <span className="block text-[11px] font-normal text-blueprint/50">
              {currency(analysis.arv_low)}–{currency(analysis.arv_high)}
            </span>
          </p>
        </div>
      </div>

      <p className="mb-3 text-sm">
        Estimated profit:{" "}
        <span className={`font-semibold ${(analysis.estimated_profit ?? 0) >= 0 ? "text-sage-dark" : "text-red-600"}`}>
          {currency(analysis.estimated_profit)}
        </span>
        <span className="ml-1 text-xs text-blueprint/50">(before closing costs, selling commissions, and financing)</span>
      </p>

      {analysis.reasoning && <ReasoningSections text={analysis.reasoning} />}

      {analysis.comps.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Comps used</p>
          <div className="space-y-1">
            {analysis.comps.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-xs text-blueprint/70">
                <span>
                  {c.address}
                  {c.sqft && ` · ${c.sqft.toLocaleString()} sqft`}
                  {c.sold_date && ` · ${c.sold_date}`}
                </span>
                <span className="flex items-center gap-2">
                  {c.sold_price != null && <span className="font-medium">{currency(c.sold_price)}</span>}
                  {c.url && (
                    <a href={c.url} target="_blank" rel="noreferrer" className="text-amber-dark hover:underline">
                      link
                    </a>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Renders the "SECTION HEADER\nbody..." blocks evaluate-deal formats its
// comprehensive analysis into (market context, comp analysis, risks,
// upside, bottom line), with bullet lines (starting "• ") as a list.
function ReasoningSections({ text }: { text: string }) {
  const sections = text.split("\n\n").map((block) => {
    const [firstLine, ...rest] = block.split("\n");
    const isHeader = firstLine === firstLine.toUpperCase() && firstLine.trim().length > 0 && rest.length > 0;
    return isHeader ? { header: firstLine, body: rest.join("\n") } : { header: null, body: block };
  });

  return (
    <div className="mb-4 space-y-3">
      {sections.map((s, i) => {
        const bulletLines = s.body.split("\n").filter((l) => l.trim().startsWith("• "));
        const isBulletList = bulletLines.length > 0 && bulletLines.length === s.body.split("\n").filter((l) => l.trim()).length;
        return (
          <div key={i}>
            {s.header && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blueprint/50">{s.header}</p>}
            {isBulletList ? (
              <ul className="space-y-0.5 text-sm text-blueprint/70">
                {bulletLines.map((line, li) => (
                  <li key={li}>{line.trim()}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-blueprint/70">{s.body}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
