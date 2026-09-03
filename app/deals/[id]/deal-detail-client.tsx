"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { convertDealToProject, updateDealStatus } from "@/app/deals/actions";
import { saveDealAnalysis } from "@/app/deals/[id]/actions";
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
  const [status, setStatus] = useState<DealStatus>(deal.status);
  const [projectId, setProjectId] = useState<string | null>(deal.project_id);
  const [analyses, setAnalyses] = useState<DealAnalysis[]>(initialAnalyses);
  const [converting, setConverting] = useState(false);
  const [showConvertConfirm, setShowConvertConfirm] = useState(false);

  const [scope, setScope] = useState<DealScope>("remodel");
  const [scopeDescription, setScopeDescription] = useState(
    "Full interior remodel: kitchen, baths, flooring, paint, updated systems."
  );
  const [costPerSqft, setCostPerSqft] = useState(400);
  const [budget, setBudget] = useState(() => Math.round((deal.sqft ?? 2000) * 400));
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState("");

  function handleCostPerSqftChange(value: number) {
    setCostPerSqft(value);
    if (deal.sqft) setBudget(Math.round(deal.sqft * value));
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
      const res = await fetch("/api/claude/evaluate-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address: deal.address,
          city: deal.city,
          state: deal.state,
          zipCode: deal.zip_code,
          listPrice: deal.list_price,
          sqft: deal.sqft,
          beds: deal.beds,
          baths: deal.baths,
          yearBuilt: deal.year_built,
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
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">List price</p>
              <p className="text-lg font-semibold text-blueprint-dark">{currency(deal.list_price)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Size</p>
              <p className="text-lg font-semibold text-blueprint-dark">{deal.sqft ? `${deal.sqft.toLocaleString()} sqft` : "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Beds / Baths</p>
              <p className="text-lg font-semibold text-blueprint-dark">
                {deal.beds ?? "—"} / {deal.baths ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-blueprint/50">Year built</p>
              <p className="text-lg font-semibold text-blueprint-dark">{deal.year_built ?? "—"}</p>
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
                Convert to construction project
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
                  onClick={() => setScope("remodel")}
                >
                  Remodel
                </button>
                <button
                  className={scope === "ground_up" ? "btn-primary flex-1 text-xs" : "btn-outline flex-1 text-xs"}
                  onClick={() => setScope("ground_up")}
                >
                  Ground-up rebuild
                </button>
              </div>
            </div>

            <div>
              <label className="label">Scope description</label>
              <textarea className="input" rows={2} value={scopeDescription} onChange={(e) => setScopeDescription(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Cost per sqft (typical $300–500)</label>
                <input
                  className="input"
                  type="number"
                  value={costPerSqft}
                  onChange={(e) => handleCostPerSqftChange(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <label className="label">Construction budget</label>
                <input className="input" type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
              </div>
            </div>
            {!deal.sqft && (
              <p className="text-xs text-amber-dark">
                This listing has no square footage on file — enter the construction budget directly.
              </p>
            )}

            <button className="btn-amber w-full" onClick={handleAnalyze} disabled={analyzing}>
              {analyzing ? analyzeStatus || "Analyzing…" : "Run analysis"}
            </button>
          </div>
        </div>

        {analyses.length > 0 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-blueprint-dark">
              {analyses.length > 1 ? "Analysis history (most recent first)" : "Analysis"}
            </h2>
            {analyses.map((a) => (
              <AnalysisCard key={a.id} analysis={a} listPrice={deal.list_price} />
            ))}
          </div>
        )}
      </main>

      <ConfirmDialog
        open={showConvertConfirm}
        title="Convert to construction project?"
        message="This creates a new construction with this address, ready for you to add rooms, budget, checklist, and everything else. The deal record stays linked to it."
        confirmLabel="Create construction"
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

      {analysis.reasoning && <p className="mb-4 text-sm text-blueprint/70">{analysis.reasoning}</p>}

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
