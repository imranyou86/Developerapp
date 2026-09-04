"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/Toast";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteCostEstimate, saveCostEstimate } from "@/app/projects/[id]/cost/actions";
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

const COST_TIER_LABEL: Record<CostTier, string> = {
  low: "Low tier · $250–300/sqft",
  mid: "Mid tier · $350–400/sqft",
  high: "High tier · $450+/sqft",
};

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
  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">AI predicted cost</p>
          <p className="text-2xl font-bold text-blueprint-dark">{currency(estimate.predicted_total_cost ?? estimate.total_cost_mid)}</p>
          <p className="text-xs text-blueprint/50">
            Likely range {currency(estimate.total_cost_low)} – {currency(estimate.total_cost_high)}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {estimate.prediction_confidence && (
            <span className={CONFIDENCE_STYLE[estimate.prediction_confidence]}>{estimate.prediction_confidence} confidence</span>
          )}
          {estimate.cost_tier && <span className={COST_TIER_STYLE[estimate.cost_tier]}>{COST_TIER_LABEL[estimate.cost_tier]}</span>}
          {estimate.quality_tier && <span className={QUALITY_STYLE[estimate.quality_tier]}>{estimate.quality_tier}</span>}
          <span className="text-xs text-blueprint/40">{new Date(estimate.created_at).toLocaleString()}</span>
        </div>
      </div>

      {estimate.prediction_notes && (
        <p className="mb-4 rounded-lg bg-amber/10 px-3 py-2 text-sm text-blueprint-dark">{estimate.prediction_notes}</p>
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
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Predicted $/sqft</p>
          <p className="font-semibold text-blueprint-dark">
            {estimate.predicted_cost_per_sqft ? `$${Math.round(estimate.predicted_cost_per_sqft)}` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">Contingency</p>
          <p className="font-semibold text-blueprint-dark">
            {estimate.contingency_pct != null ? `${Math.round(estimate.contingency_pct)}%` : "—"}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">$/sqft (mid)</p>
          <p className="font-semibold text-blueprint-dark">{estimate.cost_per_sqft_mid ? `$${Math.round(estimate.cost_per_sqft_mid)}` : "—"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-blueprint/50">$/sqft range</p>
          <p className="font-semibold text-blueprint-dark">
            {estimate.cost_per_sqft_low && estimate.cost_per_sqft_high
              ? `$${Math.round(estimate.cost_per_sqft_low)}–$${Math.round(estimate.cost_per_sqft_high)}`
              : "—"}
          </p>
        </div>
      </div>

      {estimate.breakdown.length > 0 && <BreakdownBars breakdown={estimate.breakdown} />}

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

function BreakdownBars({ breakdown }: { breakdown: CostBreakdownLine[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-blueprint/50">Cost breakdown</p>
      <div className="space-y-2">
        {breakdown.map((line, i) => (
          <div key={i}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-blueprint-dark">{line.category}</span>
              <span className="text-blueprint/60">
                {currency(line.cost)} · {line.pct.toFixed(0)}%
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
