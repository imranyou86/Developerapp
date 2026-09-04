"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteCostEstimate, saveCostEstimate } from "@/app/projects/[id]/cost/actions";
import { COST_TIER_BANDS, COST_TIER_LABEL } from "@/lib/costTiers";
import type { CostBreakdownLine, CostEstimate, CostTier, QualityTier } from "@/lib/types";

interface PlanPage {
  id: string;
  storage_url: string;
  label: string;
}

const QUALITY_STYLE: Record<QualityTier, string> = {
  economy: "badge bg-blueprint/10 text-blueprint/60",
  standard: "badge-sage",
  premium: "badge-amber",
  luxury: "badge bg-blueprint text-white",
};

const COST_TIER_STYLE: Record<CostTier, string> = {
  low: "badge bg-blueprint/10 text-blueprint/60",
  mid: "badge-sage",
  high: "badge bg-blueprint text-white",
};

const COST_TIERS: CostTier[] = ["low", "mid", "high"];

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "badge-sage",
  medium: "badge-amber",
  low: "badge bg-blueprint/10 text-blueprint/60",
};

function currency(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function CostClient({
  projectId,
  projectAddress,
  planPages,
  roomsSqftHint,
  initialEstimates,
}: {
  projectId: string;
  projectAddress: string | null;
  planPages: PlanPage[];
  roomsSqftHint: number | null;
  initialEstimates: CostEstimate[];
}) {
  const { notify } = useToast();
  const [estimates, setEstimates] = useState<CostEstimate[]>(initialEstimates);
  const [estimating, setEstimating] = useState(false);
  const [estimateStatus, setEstimateStatus] = useState("");
  const [deleting, setDeleting] = useState<CostEstimate | null>(null);

  async function handleEstimate() {
    setEstimating(true);
    setEstimateStatus("Reading plan pages…");
    try {
      const res = await fetch("/api/claude/estimate-construction-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pages: planPages.map((p) => ({ label: p.label, url: p.storage_url })),
          projectAddress,
          roomsSqftHint,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Cost estimation failed.");

      const saveRes = await saveCostEstimate(projectId, json);
      if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save estimate.");

      setEstimates((prev) => [{ id: saveRes.id!, project_id: projectId, ...json, created_at: new Date().toISOString() }, ...prev]);
      notify("success", "Cost estimate ready.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Cost estimation failed.");
    } finally {
      setEstimating(false);
      setEstimateStatus("");
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">Construction cost estimate</h2>
            <p className="text-sm text-blueprint/60">
              Claude reads every sheet of the uploaded plan — dimensions, room complexity, roofline,
              fixture counts — and gives a single most-accurate predicted cost (with a contingency
              for what the plan can&apos;t show), plus a pricing tier — Low ($250–300/sqft), Mid
              ($350–400/sqft), or High ($450+/sqft) — and a full category breakdown.
            </p>
          </div>
          {planPages.length === 0 ? (
            <Link href={`/projects/${projectId}/plan`} className="btn-outline text-xs">
              Upload a plan first →
            </Link>
          ) : (
            <button className="btn-amber" onClick={handleEstimate} disabled={estimating}>
              {estimating ? estimateStatus || "Estimating…" : "Estimate cost from plan"}
            </button>
          )}
        </div>
      </div>

      {estimates.length === 0 ? (
        <div className="card p-10 text-center text-sm text-blueprint/60">No estimates yet.</div>
      ) : (
        <div className="space-y-4">
          {estimates.map((estimate) => (
            <EstimateCard key={estimate.id} estimate={estimate} onDelete={() => setDeleting(estimate)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete this estimate?"
        message="This cost estimate will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteCostEstimate(projectId, deleting.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not delete estimate.");
          } else {
            setEstimates((prev) => prev.filter((e) => e.id !== deleting.id));
            notify("success", "Estimate deleted.");
          }
          setDeleting(null);
        }}
      />
    </div>
  );
}

function EstimateCard({ estimate, onDelete }: { estimate: CostEstimate; onDelete: () => void }) {
  const recommendedTier = estimate.cost_tier ?? "mid";
  const [selectedTier, setSelectedTier] = useState<CostTier>(recommendedTier);
  const isRecommended = selectedTier === recommendedTier;
  const sqft = estimate.total_sqft ?? 0;
  const band = COST_TIER_BANDS[selectedTier];

  // The AI's own headline numbers only apply to the tier it actually reasoned about. Swapping to
  // a different tier falls back to a straight sqft × fixed-band calc — still deterministic and
  // useful, just not AI-reasoned for this specific plan.
  const perSqftLow = isRecommended && estimate.cost_per_sqft_low != null ? estimate.cost_per_sqft_low : band.low;
  const perSqftHigh = isRecommended && estimate.cost_per_sqft_high != null ? estimate.cost_per_sqft_high : band.high;
  const headlinePerSqft = isRecommended && estimate.predicted_cost_per_sqft != null
    ? estimate.predicted_cost_per_sqft
    : (band.low + band.high) / 2;
  const contingencyPct = isRecommended ? estimate.contingency_pct ?? 0 : 0;
  const headlineTotal = isRecommended && estimate.predicted_total_cost != null
    ? estimate.predicted_total_cost
    : Math.round(sqft * headlinePerSqft);
  const totalLow = sqft * perSqftLow;
  const totalHigh = sqft * perSqftHigh;
  const midForBreakdown = isRecommended && estimate.total_cost_mid != null ? estimate.total_cost_mid : sqft * ((band.low + band.high) / 2);

  return (
    <div className="card p-5">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {COST_TIERS.map((tier) => (
          <button
            key={tier}
            onClick={() => setSelectedTier(tier)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              selectedTier === tier
                ? "border-amber-dark bg-amber-dark text-white"
                : "border-blueprint/15 text-blueprint/60 hover:border-blueprint/30"
            }`}
          >
            {COST_TIER_LABEL[tier]}
            {tier === recommendedTier && <span className="ml-1 opacity-80">· AI pick</span>}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">
            {isRecommended ? "AI predicted cost" : "Tier estimate (not AI-reasoned for this plan)"}
          </p>
          <p className="text-2xl font-bold text-blueprint-dark">{currency(headlineTotal)}</p>
          <p className="text-xs text-blueprint/50">
            Likely range {currency(totalLow)} – {currency(totalHigh)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isRecommended && estimate.prediction_confidence && (
            <span className={CONFIDENCE_STYLE[estimate.prediction_confidence]}>{estimate.prediction_confidence} confidence</span>
          )}
          {estimate.quality_tier && <span className={QUALITY_STYLE[estimate.quality_tier]}>{estimate.quality_tier}</span>}
          <span className="text-xs text-blueprint/40">{new Date(estimate.created_at).toLocaleString()}</span>
        </div>
      </div>

      {isRecommended && estimate.prediction_notes && (
        <p className="mb-4 rounded-lg bg-amber/10 px-3 py-2 text-sm text-blueprint-dark">{estimate.prediction_notes}</p>
      )}
      {!isRecommended && (
        <p className="mb-4 rounded-lg bg-blueprint/5 px-3 py-2 text-sm text-blueprint/60">
          Claude recommended the {COST_TIER_LABEL[recommendedTier]} for this plan. This {COST_TIER_LABEL[selectedTier]} view is a
          straight {estimate.total_sqft?.toLocaleString() ?? "—"} sqft × fixed-band calculation, not reasoned against the plan&apos;s
          specific complexity.
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Total sqft</p>
          <p className="font-semibold text-blueprint-dark">{estimate.total_sqft ? estimate.total_sqft.toLocaleString() : "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Stories</p>
          <p className="font-semibold text-blueprint-dark">{estimate.stories ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">{isRecommended ? "Predicted $/sqft" : "$/sqft (mid)"}</p>
          <p className="font-semibold text-blueprint-dark">{headlinePerSqft ? `$${Math.round(headlinePerSqft)}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">{isRecommended ? "Contingency" : "$/sqft range"}</p>
          <p className="font-semibold text-blueprint-dark">
            {isRecommended ? `${Math.round(contingencyPct)}%` : `$${Math.round(perSqftLow)}–$${Math.round(perSqftHigh)}`}
          </p>
        </div>
      </div>

      {estimate.breakdown.length > 0 && <BreakdownBars breakdown={estimate.breakdown} total={midForBreakdown} />}

      {estimate.complexity_factors.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Complexity factors</p>
          <ul className="space-y-0.5 text-sm text-blueprint/70">
            {estimate.complexity_factors.map((f, i) => (
              <li key={i}>• {f}</li>
            ))}
          </ul>
        </div>
      )}

      {estimate.reasoning && <p className="mt-4 text-sm text-blueprint/70">{estimate.reasoning}</p>}

      <button className="mt-4 text-xs text-red-500 hover:underline" onClick={onDelete}>
        Delete estimate
      </button>
    </div>
  );
}

function BreakdownBars({ breakdown, total }: { breakdown: CostBreakdownLine[]; total: number }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Cost breakdown</p>
      <div className="space-y-2">
        {breakdown.map((line, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-blueprint-dark">{line.category}</span>
              <span className="text-blueprint/60">
                {currency(Math.round(total * (line.pct / 100)))} · {line.pct.toFixed(0)}%
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-concrete">
              <div className="h-full bg-amber" style={{ width: `${Math.min(line.pct, 100)}%` }} />
            </div>
            {line.description && <p className="mt-0.5 text-xs text-blueprint/50">{line.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
