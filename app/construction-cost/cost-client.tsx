"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/Toast";
import { useBackgroundTasks } from "@/components/BackgroundTasks";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteCostEstimate, saveCostEstimate } from "@/app/construction-cost/actions";
import { addPlanPage, deletePlanPage } from "@/app/projects/[id]/plan/actions";
import { COST_TIER_BANDS, COST_TIER_LABEL } from "@/lib/costTiers";
import { fetchWithRetry } from "@/lib/fetchWithRetry";
import { SIGNED_URL_TTL_SECONDS } from "@/lib/storageClient";
import type { CostBreakdownLine, CostEstimate, CostTier, PlanPage, QualityTier } from "@/lib/types";

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
  initialPlanPages,
  roomsSqftHint,
  initialEstimates,
}: {
  projectId: string | null;
  projectAddress: string | null;
  initialPlanPages: PlanPage[];
  roomsSqftHint: number | null;
  initialEstimates: CostEstimate[];
}) {
  const { notify } = useToast();
  const { run, isRunning } = useBackgroundTasks();
  const taskKeyBase = projectId ?? "standalone";
  const uploadTaskKey = `cost-plan-upload:${taskKeyBase}`;
  const estimateTaskKey = `cost-estimate:${taskKeyBase}`;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [pages, setPages] = useState<PlanPage[]>(initialPlanPages);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [deletingPage, setDeletingPage] = useState<PlanPage | null>(null);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");

  const [estimates, setEstimates] = useState<CostEstimate[]>(initialEstimates);
  const [estimating, setEstimating] = useState(false);
  const [estimateStatus, setEstimateStatus] = useState("");
  const [deleting, setDeleting] = useState<CostEstimate | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      await run(uploadTaskKey, "Uploading plan pages…", async () => {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not signed in.");

        for (const file of Array.from(files)) {
          if (file.type === "application/pdf") {
            await uploadPdfPages(supabase, user.id, file);
          } else if (file.type.startsWith("image/")) {
            await uploadImagePage(supabase, user.id, file);
          } else {
            notify("error", `Skipped "${file.name}": unsupported file type.`);
          }
        }
      });
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      setUploadStatus("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function uploadImagePage(supabase: ReturnType<typeof createClient>, userId: string, file: File) {
    const path = `${userId}/${projectId ?? "standalone"}/${Date.now()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("plan-pages").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw new Error(`Upload of "${file.name}" failed: ${uploadError.message}`);

    const { data: pub, error: pubSignError } = await supabase.storage.from("plan-pages").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
    const sortOrder = pages.length;
    const res = await addPlanPage(projectId, pub.signedUrl, file.name, sortOrder);
    if (!res.ok) throw new Error(res.error ?? "Could not save plan page.");

    setPages((prev) => [
      ...prev,
      {
        id: res.id!,
        project_id: projectId,
        created_by: userId,
        storage_url: pub.signedUrl,
        label: file.name,
        sort_order: sortOrder,
        is_layout: true,
        created_at: new Date().toISOString(),
      },
    ]);
    notify("success", `Added "${file.name}".`);
  }

  async function uploadPdfPages(supabase: ReturnType<typeof createClient>, userId: string, file: File) {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      setUploadStatus(`Rendering ${file.name} — page ${pageNum} of ${pdf.numPages}…`);
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas rendering is not supported in this browser.");
      await page.render({ canvasContext: context, viewport }).promise;

      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode page image."))), "image/png")
      );

      const label = pdf.numPages > 1 ? `${file.name} — Page ${pageNum}` : file.name;
      const path = `${userId}/${projectId ?? "standalone"}/${Date.now()}-${pageNum}-${file.name}.png`;

      const { error: uploadError } = await supabase.storage.from("plan-pages").upload(path, blob, {
        contentType: "image/png",
        upsert: false,
      });
      if (uploadError) throw new Error(`Upload of "${label}" failed: ${uploadError.message}`);

      const { data: pub, error: pubSignError } = await supabase.storage.from("plan-pages").createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
      if (pubSignError || !pub) throw new Error(pubSignError?.message ?? "Could not get a URL for the uploaded file.");
      const sortOrder = pages.length + pageNum - 1;
      const res = await addPlanPage(projectId, pub.signedUrl, label, sortOrder);
      if (!res.ok) throw new Error(`Saving "${label}" failed: ${res.error}`);

      setPages((prev) => [
        ...prev,
        {
          id: res.id!,
          project_id: projectId,
          created_by: userId,
          storage_url: pub.signedUrl,
          label,
          sort_order: sortOrder,
          is_layout: true,
          created_at: new Date().toISOString(),
        },
      ]);
    }
    notify("success", `Added ${pdf.numPages} page(s) from "${file.name}".`);
  }

  async function handleEstimate() {
    setEstimating(true);
    setEstimateStatus("Reading plan pages…");
    try {
      await run(estimateTaskKey, "Estimating construction cost…", async () => {
        const address = projectAddress ?? (location.trim() || null);
        const res = await fetchWithRetry("/api/claude/estimate-construction-cost", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pages: pages.map((p) => ({ label: p.label, url: p.storage_url })),
            projectAddress: address,
            roomsSqftHint,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Cost estimation failed.");

        const saveRes = await saveCostEstimate(projectId, {
          title: projectId ? null : title.trim() || null,
          location: projectId ? null : location.trim() || null,
          ...json,
        });
        if (!saveRes.ok || !saveRes.id) throw new Error(saveRes.error ?? "Could not save estimate.");

        setEstimates((prev) => [
          {
            id: saveRes.id!,
            project_id: projectId,
            created_by: "",
            title: projectId ? null : title.trim() || null,
            location: projectId ? null : location.trim() || null,
            ...json,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
        notify("success", "Cost estimate ready.");
      });
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
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-blueprint-dark">
              {projectId ? "Construction cost estimate" : "Plan cost estimate"}
            </h2>
            <p className="text-sm text-blueprint/60">
              Claude reads every sheet of the uploaded plan — dimensions, room complexity, roofline,
              fixture counts — and gives a single most-accurate predicted cost (with a contingency
              for what the plan can&apos;t show), plus a pricing tier — Low ($250–300/sqft), Mid
              ($350–400/sqft), or High ($450+/sqft) — and a full category breakdown.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              className="btn-outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || isRunning(uploadTaskKey)}
            >
              {uploading || isRunning(uploadTaskKey) ? uploadStatus || "Uploading…" : "Upload plan"}
            </button>
            <button
              className="btn-amber"
              onClick={handleEstimate}
              disabled={estimating || isRunning(estimateTaskKey) || pages.length === 0}
              title={pages.length === 0 ? "Upload a plan first" : undefined}
            >
              {estimating || isRunning(estimateTaskKey) ? estimateStatus || "Estimating…" : "Estimate cost from plan"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {!projectId && (
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Label (optional)</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Backyard ADU" />
            </div>
            <div>
              <label className="label">Location (optional)</label>
              <input
                className="input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, state — used to ground $/sqft in real local data"
              />
            </div>
          </div>
        )}

        {pages.length === 0 ? (
          <p className="text-sm text-blueprint/50">No plan pages yet — upload the plan as PDF or image above.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {pages.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-lg border border-blueprint/10">
                <div className="relative aspect-[4/3] bg-concrete">
                  <Image src={p.storage_url} alt={p.label} fill className="object-contain" unoptimized />
                </div>
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="truncate text-xs text-blueprint/70" title={p.label}>
                    {p.label}
                  </span>
                  <button className="text-xs text-red-600 hover:underline" onClick={() => setDeletingPage(p)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
        open={!!deletingPage}
        title="Remove plan page?"
        message={`Remove "${deletingPage?.label}" from this plan?`}
        confirmLabel="Remove"
        danger
        onCancel={() => setDeletingPage(null)}
        onConfirm={async () => {
          if (!deletingPage) return;
          const res = await deletePlanPage(projectId, deletingPage.id);
          if (!res.ok) {
            notify("error", res.error ?? "Could not remove page.");
          } else {
            setPages((prev) => prev.filter((p) => p.id !== deletingPage.id));
            notify("success", "Plan page removed.");
          }
          setDeletingPage(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        title="Delete this estimate?"
        message="This cost estimate will be permanently removed."
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const res = await deleteCostEstimate(deleting.id);
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
      {(estimate.title || estimate.location) && (
        <p className="mb-2 text-sm font-medium text-blueprint-dark">
          {[estimate.title, estimate.location].filter(Boolean).join(" — ")}
        </p>
      )}
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
              <div
                className="h-full bg-amber transition-all duration-500 ease-out"
                style={{ width: `${Math.min(line.pct, 100)}%` }}
              />
            </div>
            {line.description && <p className="mt-0.5 text-xs text-blueprint/50">{line.description}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
